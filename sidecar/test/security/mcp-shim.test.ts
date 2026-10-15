import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runMcpStdio } from "../../src/main"
import { safeThreadId } from "../../src/mcp/auth"

test("MCP stdio rejects unsafe thread IDs before reading a token or opening the socket", async () => {
  const root = mkdtempSync(join(tmpdir(), "touri-security-shim-"))
  const runDir = join(root, "run")
  mkdirSync(join(runDir, "mcp-tokens"), { recursive: true, mode: 0o700 })
  writeFileSync(join(root, "outside-token"), "must-not-be-read\n")
  const socketPath = join(runDir, "mcp.sock")
  let connections = 0
  const server = createServer(() => {
    connections += 1
  })
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
  const invalid = ["../outside-token", "/tmp/token", "thread/child", "thread\\child", "..", "thread\u0000child"]
  const previousExitCode = process.exitCode ?? 0
  try {
    for (const threadId of invalid) {
      expect(safeThreadId(threadId)).toBe(false)
      await runMcpStdio({ threadId, appData: root })
      expect(process.exitCode).toBe(1)
    }
    expect(connections).toBe(0)
  } finally {
    process.exitCode = previousExitCode
    server.close()
    rmSync(root, { recursive: true, force: true })
  }
})
