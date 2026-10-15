import type { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { createKernel } from "../../src/kernel"
import { init as initMcp, stop as stopMcp } from "../../src/mcp"
import { init as initStore } from "../../src/store"

const repoRoot = join(import.meta.dir, "..", "..", "..")

test("MCP SDK interoperates with the real stdio shim", async () => {
  const root = mkdtempSync(join(tmpdir(), "touri-mcp-sdk-"))
  const runtime = createKernel({ appData: root })
  const threadId = "thread-sdk-fixture"
  const token = "s".repeat(64)
  const tokenDir = join(root, "run", "mcp-tokens")
  mkdirSync(tokenDir, { recursive: true, mode: 0o700 })
  writeFileSync(join(tokenDir, threadId), token, { mode: 0o600 })
  const database = runtime.kernel.db as Database
  const timestamp = Date.now()
  database
    .query("INSERT INTO bots (id, name, provider, home_dir, created_at, updated_at) VALUES (?, ?, 'codex', ?, ?, ?)")
    .run("bot-sdk-fixture", "SDK fixture", join(root, "bots", "bot-sdk-fixture"), timestamp, timestamp)
  database
    .query("INSERT INTO threads (id, bot_id, kind, title, created_at, updated_at) VALUES (?, ?, 'chat', ?, ?, ?)")
    .run(threadId, "bot-sdk-fixture", "SDK fixture thread", timestamp, timestamp)

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["run", "sidecar/src/main.ts", "mcp-stdio", "--thread", threadId],
    cwd: repoRoot,
    env: { PATH: process.env.PATH ?? "", TOURI_APP_DATA: root },
    stderr: "pipe",
  })
  const client = new Client({ name: "touri-sdk-interop", version: "0.1.0" })
  try {
    await initStore(runtime.kernel)
    const store = runtime.kernel.services.use("store.api")
    if (!store) throw new Error("store service was not initialized")
    const inserted = store.insertMessage({
      message: {
        id: "sdk-fixture-message",
        threadId,
        parentId: null,
        role: "user",
        kind: "text",
        status: "complete",
        runId: null,
        text: "SDK fixture history hit",
        parts: [{ type: "text", text: "SDK fixture history hit" }],
        sender: null,
        source: "local",
      },
    })
    expect(inserted.success).toBe(true)
    await initMcp(runtime.kernel)
    await client.connect(transport)

    const listed = await client.listTools()
    expect(listed.tools.map((tool) => tool.name)).toContain("history_search")
    const called = await client.callTool({ name: "history_search", arguments: { query: "fixture history" } })
    expect(JSON.stringify(called.content)).toContain("sdk-fixture-message")
  } finally {
    await client.close().catch(() => undefined)
    await transport.close().catch(() => undefined)
    await stopMcp({ kernel: runtime.kernel })
    runtime.stop()
    rmSync(root, { recursive: true, force: true })
  }
})
