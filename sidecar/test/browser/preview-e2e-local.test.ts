import type { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Bot, Run } from "@touri/contracts"
import { init as initBrowser } from "../../src/browser"
import { createKernel } from "../../src/kernel"
import { init as initMcp, stop as stopMcp } from "../../src/mcp"
import { createRuntimeEngine } from "../../src/runtime/engine"
import { init as initStore } from "../../src/store"
import { hasSystemChrome } from "./test-helper"

const PROOF_DIR = process.env.TOURI_PREVIEW_PROOF_DIR
const OPEN_TIMEOUT_MS = 20_000
const enabled = hasSystemChrome && Bun.which("codex") !== null && process.env.TOURI_E2E_REAL_CLI !== "0"

type AuditRow = { tool: string; ok: number; duration_ms: number }

const waitFor = async <T>(read: () => T | null, ms: number): Promise<T> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const value = read()
    if (value !== null) return value
    await Bun.sleep(100)
  }
  throw new Error("timed out")
}

/** Luminance variance of a 24/32-bit BMP, the format macOS sips writes. */
const bmpVariance = (bmp: Buffer): number => {
  const offset = bmp.readUInt32LE(10)
  const width = bmp.readInt32LE(18)
  const height = Math.abs(bmp.readInt32LE(22))
  const bytes = bmp.readUInt16LE(28) / 8
  const stride = Math.ceil((width * bytes) / 4) * 4
  let sum = 0
  let squares = 0
  let count = 0
  for (let row = 0; row < height; row += 2)
    for (let column = 0; column < width; column += 2) {
      const at = offset + row * stride + column * bytes
      const luma = 0.114 * (bmp[at] ?? 0) + 0.587 * (bmp[at + 1] ?? 0) + 0.299 * (bmp[at + 2] ?? 0)
      sum += luma
      squares += luma * luma
      count += 1
    }
  const mean = sum / count
  return squares / count - mean * mean
}

test.skipIf(!enabled)(
  "local bot: a real Codex CLI with on-request approvals opens a page through Touri MCP and the inline preview shows it",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "touri-local-preview-"))
    const runtime = createKernel({ appData: root })
    const shim = join(root, "sidecar-shim")
    writeFileSync(
      shim,
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} run ${JSON.stringify(join(import.meta.dir, "../../src/main.ts"))} "$@"\n`,
      { mode: 0o700 },
    )
    runtime.kernel.paths.sidecarBinary = shim
    const page = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () =>
        new Response(
          "<!doctype html><title>Touri preview fixture</title><body style='margin:0;font:48px sans-serif;background:#f4f1ea'><h1 style='background:#1b6ef3;color:#fff;padding:40px'>Touri preview fixture</h1><p style='padding:40px'>Página local aberta pelo bot.</p></body>",
          { headers: { "content-type": "text/html; charset=utf-8" } },
        ),
    })
    const target = `http://127.0.0.1:${page.port}/`
    const modelLog = join(root, "model.log")
    const model = Bun.spawn({
      cmd: [process.execPath, join(import.meta.dir, "../fixtures/mock-responses-model.cjs"), "0", target, modelLog],
      stdout: "ignore",
      stderr: "inherit",
    })
    const codexHome = join(root, "codex-home")
    let engine: ReturnType<typeof createRuntimeEngine> | null = null
    try {
      const port = await waitFor(() => {
        try {
          return (JSON.parse(readFileSync(modelLog, "utf8").split("\n")[0] ?? "") as { port: number }).port
        } catch {
          return null
        }
      }, 10_000)
      mkdirSync(codexHome, { recursive: true })
      writeFileSync(
        join(codexHome, "config.toml"),
        `model_provider = "mock"\nmodel = "gpt-5"\n[model_providers.mock]\nname = "mock"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`,
      )
      await initStore(runtime.kernel)
      await initMcp(runtime.kernel)
      await initBrowser(runtime.kernel)
      engine = createRuntimeEngine({
        kernel: runtime.kernel,
        environment: {
          PATH: process.env.PATH ?? "",
          SHELL: process.env.SHELL ?? "/bin/zsh",
          HOME: process.env.HOME ?? root,
          CODEX_HOME: codexHome,
        },
      })
      const active = engine
      runtime.kernel.services.provide("runtime.activeRun", (args) => active.activeRun(args))
      const api = (path: string, init: RequestInit = {}) =>
        fetch(`http://127.0.0.1:${runtime.handshake.port}/api/v1${path}`, {
          ...init,
          headers: {
            Authorization: "Bearer dev-ui-token",
            "x-touri-client": "local-preview-e2e",
            "Content-Type": "application/json",
          },
        })
      const created = await api("/bots", {
        method: "POST",
        body: JSON.stringify({ name: "Local preview e2e", provider: "codex", machine: "local" }),
      })
      const bot = ((await created.json()) as { bot: Bot }).bot
      expect(bot).toMatchObject({ access: "workspace-write", approvals: "on-request", browserEnabled: true })
      const store = runtime.kernel.services.use("store.api")
      if (!store || !bot.mainThreadId) throw new Error("Missing store/thread")
      const message = store.insertMessage({
        message: {
          id: runtime.kernel.newId(),
          threadId: bot.mainThreadId,
          parentId: null,
          role: "user",
          kind: "text",
          status: "complete",
          runId: null,
          text: `Abra ${target} no navegador`,
          parts: [],
          sender: null,
          source: "local",
        },
      })
      if (!message.success) throw new Error(message.error)
      const started = Date.now()
      const enqueued = engine.enqueue({
        threadId: bot.mainThreadId,
        requestMessageId: message.message.id,
        trigger: "user",
      })
      if (!enqueued.success) throw new Error(enqueued.error)
      const run: Run = enqueued.run
      while (!["succeeded", "failed", "canceled", "interrupted"].includes(run.status) && Date.now() - started < 90_000)
        await Bun.sleep(200)
      const audit = (runtime.kernel.db as Database)
        .query("SELECT tool, ok, duration_ms FROM tool_calls WHERE bot_id = ? ORDER BY created_at")
        .all(bot.id) as Array<AuditRow>
      console.info("[local preview e2e]", JSON.stringify({ status: run.status, error: run.errorMessage, audit }))
      expect(run.status).toBe("succeeded")
      expect(audit.map((row) => row.tool)).toEqual(["browser_open", "browser_snapshot", "browser_screenshot"])
      for (const row of audit) expect(row.ok).toBe(1)
      expect(audit[0]?.duration_ms).toBeLessThan(OPEN_TIMEOUT_MS)
      expect(readFileSync(modelLog, "utf8")).toContain("Touri preview fixture")

      const preview = (await (await api(`/bots/${bot.id}/browser-preview`)).json()) as {
        image: string
        title: string
        url: string
      }
      expect(preview.title).toBe("Touri preview fixture")
      const jpeg = Buffer.from(preview.image.slice(preview.image.indexOf(",") + 1), "base64")
      const jpegPath = join(root, "preview.jpg")
      const bmpPath = join(root, "preview.bmp")
      writeFileSync(jpegPath, jpeg)
      expect(Bun.spawnSync(["/usr/bin/sips", "-s", "format", "bmp", jpegPath, "--out", bmpPath]).exitCode).toBe(0)
      expect(bmpVariance(readFileSync(bmpPath))).toBeGreaterThan(200)
      if (PROOF_DIR) {
        mkdirSync(PROOF_DIR, { recursive: true })
        Bun.spawnSync(["/usr/bin/sips", "-s", "format", "png", jpegPath, "--out", join(PROOF_DIR, "preview-local.png")])
      }
    } finally {
      await engine?.shutdown()
      model.kill()
      await page.stop(true)
      await stopMcp({ kernel: runtime.kernel })
      runtime.stop()
      rmSync(root, { recursive: true, force: true })
    }
  },
  150_000,
)
