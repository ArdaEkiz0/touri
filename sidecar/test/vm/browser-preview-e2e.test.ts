import type { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Bot, Run } from "@touri/contracts"
import { init as initBrowser } from "../../src/browser"
import { init as initComputer } from "../../src/computer"
import { createKernel } from "../../src/kernel"
import { init as initMcp, stop as stopMcp } from "../../src/mcp"
import { createRuntimeEngine } from "../../src/runtime/engine"
import { init as initStore } from "../../src/store"
import { createAppleContainerProvider } from "../../src/vm"
import { createDesktopGateway } from "../../src/vm/desktop"
import { createVmRuntime } from "../../src/vm/runtime"
import { appleContainerAvailable } from "./integration-available"
import { desktopGatewayFrame, framePng, frameVariance, type VncFrame } from "./vnc-client"

const TARGET_URL = "http://example.com"
const OPEN_TIMEOUT_MS = 20_000
const MODEL_PORT = 18_080
const ORIGIN = "http://localhost:1420"
const PROOF_DIR = process.env.TOURI_PREVIEW_PROOF_DIR

type AuditRow = { tool: string; ok: number; error_code: string | null; duration_ms: number }

test.skipIf(!appleContainerAvailable)(
  "real VM: a Codex bot with on-request approvals opens a page through Touri MCP and the preview/viewer show it",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "tvpe-"))
    const runtime = createKernel({ appData: root })
    const provider = createAppleContainerProvider()
    const hostHome = join(root, "host-home")
    mkdirSync(join(hostHome, ".codex"), { recursive: true })
    writeFileSync(join(hostHome, ".codex/auth.json"), JSON.stringify({ OPENAI_API_KEY: "fake-e2e-key" }), {
      mode: 0o600,
    })
    await initStore(runtime.kernel)
    await initMcp(runtime.kernel)
    await initComputer(runtime.kernel)
    const vm = createVmRuntime({
      kernel: runtime.kernel,
      provider,
      hostHome,
      connectionKeys: { rotate: async () => randomBytes(32), remove: async () => {} },
    })
    runtime.kernel.services.provide("vm.runtime", vm.service)
    const desktop = createDesktopGateway(runtime.kernel, vm.service, vm.paste)
    runtime.kernel.services.provide("vm.desktop", desktop.service)
    runtime.kernel.registerRoutes(desktop.routes)
    await initBrowser(runtime.kernel)
    const engine = createRuntimeEngine({ kernel: runtime.kernel })
    runtime.kernel.services.provide("runtime.activeRun", (args) => engine.activeRun(args))
    const api = (path: string, body: unknown) =>
      fetch(`http://127.0.0.1:${runtime.handshake.port}/api/v1${path}`, {
        method: "POST",
        headers: {
          Authorization: "Bearer dev-ui-token",
          "x-touri-client": "preview-e2e",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
    const viewerFrame = async (botId: string, mode: { control: false; preview?: true }): Promise<VncFrame> => {
      const session = (await (await api(`/bots/${botId}/desktop`, mode)).json()) as { path: string }
      const { ticket } = (await (await api("/ws-ticket", { path: session.path })).json()) as { ticket: string }
      return desktopGatewayFrame(`ws://127.0.0.1:${runtime.handshake.port}${session.path}?ticket=${ticket}`, ORIGIN)
    }
    let botId: string | null = null
    try {
      const created = await api("/bots", {
        name: "Preview e2e",
        provider: "codex",
        machine: "vm",
        vmProviderLogin: true,
        computerUse: true,
      })
      const bot = ((await created.json()) as { bot: Bot }).bot
      botId = bot.id
      expect(bot).toMatchObject({ access: "workspace-write", approvals: "on-request", browserEnabled: true })
      ;(runtime.kernel.db as Database)
        .query("INSERT INTO settings(key,value_json,updated_at) VALUES (?,?,?)")
        .run(`vm-login-source:${bot.id}:codex`, '"host-file"', Date.now())
      const release = await vm.service.acquire({ botId })
      const machineId = vm.service.states().find((state) => state.botId === botId)?.connection?.machineId ?? ""
      await vm.service.writeFile({
        botId,
        path: "/workspace/mock-model.cjs",
        content: readFileSync(join(import.meta.dir, "../fixtures/mock-responses-model.cjs"), "utf8"),
      })
      await vm.service.writeFile({
        botId,
        path: "/workspace/.home/.codex/config.toml",
        content: `model_provider = "mock"\nmodel = "gpt-5"\n[model_providers.mock]\nname = "mock"\nbase_url = "http://127.0.0.1:${MODEL_PORT}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`,
      })
      const started = await provider.exec({
        id: machineId,
        user: "1000",
        command: "node",
        args: ["/workspace/mock-model.cjs", String(MODEL_PORT), TARGET_URL, "/workspace/mock-model.log"],
        detach: true,
      })
      expect(started.success).toBe(true)
      await release()

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
          text: `Abra ${TARGET_URL} no navegador`,
          parts: [],
          sender: null,
          source: "local",
        },
      })
      if (!message.success) throw new Error(message.error)
      const turnStarted = Date.now()
      const enqueued = engine.enqueue({
        threadId: bot.mainThreadId,
        requestMessageId: message.message.id,
        trigger: "user",
      })
      if (!enqueued.success) throw new Error(enqueued.error)
      const run: Run = enqueued.run
      while (
        !["succeeded", "failed", "canceled", "interrupted"].includes(run.status) &&
        Date.now() - turnStarted < 120_000
      )
        await Bun.sleep(200)
      const log = await vm.service.exec({ botId, command: "cat", args: ["/workspace/mock-model.log"] })
      const modelLog = log.success ? log.stdout : ""
      const audit = (runtime.kernel.db as Database)
        .query("SELECT tool, ok, error_code, duration_ms FROM tool_calls WHERE bot_id = ? ORDER BY created_at")
        .all(botId) as Array<AuditRow>
      console.info("[preview e2e]", JSON.stringify({ status: run.status, error: run.errorMessage, audit }))
      expect(run.status).toBe("succeeded")
      expect(audit.map((row) => row.tool)).toEqual(["browser_open", "browser_snapshot", "browser_screenshot"])
      for (const row of audit) expect(row.ok).toBe(1)
      expect(audit[0]?.duration_ms).toBeLessThan(OPEN_TIMEOUT_MS)
      expect(modelLog).toContain("Example Domain")

      const preview = await viewerFrame(botId, { control: false, preview: true })
      const viewer = await viewerFrame(botId, { control: false })
      for (const frame of [preview, viewer]) {
        expect(frame.width).toBeGreaterThan(0)
        expect(frameVariance(frame)).toBeGreaterThan(200)
      }
      if (PROOF_DIR) {
        mkdirSync(PROOF_DIR, { recursive: true })
        writeFileSync(join(PROOF_DIR, "preview.png"), framePng(preview))
        writeFileSync(join(PROOF_DIR, "viewer.png"), framePng(viewer))
        writeFileSync(join(PROOF_DIR, "vm-model-log.jsonl"), modelLog)
      }
    } finally {
      await engine.shutdown()
      desktop.service.dispose()
      if (botId) await vm.service.destroy({ botId, deleteVolumes: true })
      await vm.dispose()
      await stopMcp({ kernel: runtime.kernel })
      runtime.stop()
      rmSync(root, { recursive: true, force: true })
    }
  },
  300_000,
)
