import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("mcp-stdio sends thread auth first and does not open the database", async () => {
  const root = mkdtempSync(join(tmpdir(), "touri-mcp-"))
  const runDir = join(root, "run")
  const tokenDir = join(runDir, "mcp-tokens")
  const socketPath = join(runDir, "mcp.sock")
  mkdirSync(tokenDir, { recursive: true })
  writeFileSync(join(tokenDir, "thread-fixture"), "fixture-token\n", { mode: 0o600 })
  let received = ""
  const server = createServer((socket) => {
    socket.on("data", (chunk) => {
      received += chunk.toString("utf8")
      if (!received.includes("\n")) return
      socket.write("echo-from-mcp\n")
      socket.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
  const child = Bun.spawn({
    cmd: ["bun", "run", "sidecar/src/main.ts", "mcp-stdio", "--thread", "thread-fixture"],
    cwd: join(import.meta.dir, "..", "..", ".."),
    env: { ...process.env, TOURI_APP_DATA: root, TOURI_MCP_SOCK: socketPath },
    stdout: "pipe",
    stderr: "pipe",
  })
  try {
    const output = await new Response(child.stdout).text()
    const errorOutput = await new Response(child.stderr).text()
    await child.exited
    expect(errorOutput).toBe("")
    const first = JSON.parse(received.trim()) as { touriAuth: { thread: string; token: string } }
    expect(first).toEqual({ touriAuth: { thread: "thread-fixture", token: "fixture-token" } })
    expect(output).toContain("echo-from-mcp")
    expect(existsSync(join(root, "touri.db"))).toBe(false)
  } finally {
    server.close()
    rmSync(root, { recursive: true, force: true })
  }
})
