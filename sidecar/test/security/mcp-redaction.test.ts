import type { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createConnection, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolRegistration } from "@touri/contracts"
import { createKernel } from "../../src/kernel"
import { init, stop } from "../../src/mcp"
import { auditToolCall } from "../../src/mcp/audit"
import { init as initStore } from "../../src/store"

type WireResponse = { result?: unknown; error?: unknown }

const readLine = (socket: Socket): Promise<string> =>
  new Promise((resolve) => {
    let buffer = ""
    const onData = (chunk: string): void => {
      buffer += chunk
      const index = buffer.indexOf("\n")
      if (index < 0) return
      socket.off("data", onData)
      resolve(buffer.slice(0, index))
    }
    socket.on("data", onData)
  })

test("MCP recursively redacts structured results and audit arguments before serialization", async () => {
  const root = mkdtempSync(join(tmpdir(), "touri-security-mcp-"))
  const runtime = createKernel({ appData: root })
  const token = "m".repeat(64)
  const database = runtime.kernel.db as Database
  mkdirSync(join(root, "run", "mcp-tokens"), { recursive: true, mode: 0o700 })
  writeFileSync(join(root, "run", "mcp-tokens", "thread-mcp"), token, { mode: 0o600 })
  database
    .query(
      `INSERT INTO bots (id, name, provider, home_dir, browser_enabled, computer_use, created_at, updated_at)
       VALUES ('bot-mcp', 'mcp', 'codex', ?, 1, 0, ?, ?)`,
    )
    .run(join(root, "bots", "bot-mcp"), Date.now(), Date.now())
  database
    .query(
      `INSERT INTO threads (id, bot_id, kind, title, created_at, updated_at)
       VALUES ('thread-mcp', 'bot-mcp', 'chat', 'MCP', ?, ?)`,
    )
    .run(Date.now(), Date.now())
  const secret = "nested-structured-secret"
  database.query("UPDATE bots SET access = 'full', approvals = 'never' WHERE id = 'bot-mcp'").run()
  await initStore(runtime.kernel)
  runtime.kernel.addRedactionValue(secret)
  const registration: ToolRegistration = {
    name: "browser_open",
    group: "browser",
    handler: async () => ({
      success: true,
      content: [{ type: "text", text: `visible ${secret}` }],
      structured: { outer: [{ inner: secret }, { values: ["safe", secret] }] },
    }),
  }
  try {
    await init(runtime.kernel)
    expect(runtime.kernel.registerTools({ tools: [registration] }).success).toBe(true)
    auditToolCall({
      kernel: runtime.kernel,
      runId: null,
      threadId: "thread-mcp",
      botId: "bot-mcp",
      tool: "browser_open",
      args: { nested: [{ value: secret }] },
      result: { success: true, content: [] },
      durationMs: 1,
    })
    const audit = database.query("SELECT args_json FROM tool_calls ORDER BY created_at DESC LIMIT 1").get() as {
      args_json: string
    }
    expect(audit.args_json).not.toContain(secret)

    const socket = await new Promise<Socket>((resolve, reject) => {
      const candidate = createConnection(join(root, "run", "mcp.sock"))
      candidate.once("connect", () => resolve(candidate))
      candidate.once("error", reject)
    })
    socket.setEncoding("utf8")
    socket.write(`${JSON.stringify({ touriAuth: { thread: "thread-mcp", token } })}\n`)
    socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`)
    await readLine(socket)
    socket.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "browser_open", arguments: { url: "https://example.com" } } })}\n`,
    )
    const response = JSON.parse(await readLine(socket)) as WireResponse
    expect(JSON.stringify(response.result)).not.toContain(secret)
    expect(JSON.stringify(response.result)).toContain("[REDACTED]")
    socket.destroy()
  } finally {
    await stop({ kernel: runtime.kernel })
    runtime.stop()
    rmSync(root, { recursive: true, force: true })
  }
})
