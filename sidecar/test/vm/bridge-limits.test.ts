import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MCP_LIMITS } from "../../src/mcp/connection"
import { connectMcpBridge } from "../../src/vm/bridge"

test("A17: stalled guest bridge authentication closes connections within the deadline", async () => {
  const root = mkdtempSync(join(tmpdir(), "touri-bridge-limits-"))
  const peers = new Set<Socket>()
  let forwarded = 0
  let rejected = 0
  const host = createServer((socket) => {
    peers.add(socket)
    socket.on("data", (data) => {
      forwarded += data.length
    })
    socket.on("close", () => peers.delete(socket))
  })
  const guest = createServer((socket) => {
    peers.add(socket)
    socket.on("data", () => {})
    socket.on("error", () => {})
    socket.on("close", () => {
      peers.delete(socket)
      rejected++
    })
  })
  const socketPath = join(root, "host.sock")
  await new Promise<void>((resolve) => host.listen(socketPath, resolve))
  await new Promise<void>((resolve) => guest.listen(0, "127.0.0.1", resolve))
  const address = guest.address()
  if (!address || typeof address === "string") throw new Error("missing guest port")
  const stop = connectMcpBridge({ port: address.port, token: "test-only", socketPath })
  try {
    const deadline = Date.now() + MCP_LIMITS.authMs + 1000
    while (Date.now() < deadline && rejected < 4) await Bun.sleep(10)
    expect(rejected).toBeGreaterThanOrEqual(4)
    expect(forwarded).toBe(0)
  } finally {
    stop()
    for (const peer of peers) peer.destroy()
    await Promise.all([
      new Promise<void>((resolve) => host.close(() => resolve())),
      new Promise<void>((resolve) => guest.close(() => resolve())),
    ])
    rmSync(root, { recursive: true, force: true })
  }
}, 8000)
