import type { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createKernel } from "../../src/kernel"
import { init, stop } from "../../src/mcp"
import { createFixtureStore } from "./store-fixture"

type WireResponse = { result?: unknown; error?: unknown }

const readLine = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = stream.getReader()
  let output = ""
  try {
    while (!output.includes("\n")) {
      const chunk = await reader.read()
      if (chunk.done) break
      output += new TextDecoder().decode(chunk.value)
    }
    return output.slice(0, output.indexOf("\n"))
  } finally {
    reader.releaseLock()
  }
}

test("the real stdio shim forwards MCP requests with the exact WP3 command shape", async () => {
  const root = mkdtempSync(join(tmpdir(), "touri-wp4-shim-"))
  const runtime = createKernel({ appData: root })
  const token = "e".repeat(64)
  mkdirSync(join(root, "run", "mcp-tokens"), { recursive: true, mode: 0o700 })
  writeFileSync(join(root, "run", "mcp-tokens", "thread-mark"), token, { mode: 0o600 })
  const database = runtime.kernel.db as Database
  database
    .query(
      `INSERT INTO bots (id, name, provider, home_dir, created_at, updated_at)
       VALUES ('bot-mark', 'mark', 'codex', ?, ?, ?)`,
    )
    .run(join(root, "bots", "bot-mark"), Date.now(), Date.now())
  database
    .query(
      `INSERT INTO threads (id, bot_id, kind, title, created_at, updated_at)
       VALUES ('thread-mark', 'bot-mark', 'chat', 'Fixture', ?, ?)`,
    )
    .run(Date.now(), Date.now())
  runtime.kernel.services.provide("store.api", createFixtureStore({ root }))
  let child: ReturnType<typeof Bun.spawn> | null = null
  try {
    await init(runtime.kernel)
    const configuredBinary = process.env.TOURI_TEST_SHIM_BIN
    const command = configuredBinary ?? "bun"
    const args = configuredBinary
      ? ["mcp-stdio", "--thread", "thread-mark"]
      : ["run", "sidecar/src/main.ts", "mcp-stdio", "--thread", "thread-mark"]
    child = Bun.spawn({
      cmd: [command, ...args],
      cwd: join(import.meta.dir, "..", "..", ".."),
      env: { ...process.env, TOURI_APP_DATA: root },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    const stdin = child.stdin
    const stdout = child.stdout
    if (stdin === undefined || typeof stdin === "number" || !("write" in stdin))
      throw new Error("shim stdin unavailable")
    if (stdout === undefined || typeof stdout === "number") throw new Error("shim stdout unavailable")
    stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } })}\n`,
    )
    const initialized = JSON.parse(await readLine(stdout)) as WireResponse
    expect(initialized.error).toBeUndefined()
    stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "history_search", arguments: { query: "campaign" } } })}\n`,
    )
    const search = JSON.parse(await readLine(stdout)) as WireResponse
    expect(JSON.stringify(search.result)).toContain("Review the campaign")
  } finally {
    child?.kill()
    if (child) await child.exited
    await stop({ kernel: runtime.kernel })
    runtime.stop()
    rmSync(root, { recursive: true, force: true })
  }
})
