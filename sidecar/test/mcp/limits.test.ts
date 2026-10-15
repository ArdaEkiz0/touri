import type { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import type { Socket } from "node:net"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Kernel } from "@touri/contracts"
import { createKernel } from "../../src/kernel"
import { MCP_LIMITS, serveMcpConnection } from "../../src/mcp/connection"
import { createMcpSocket } from "../../src/mcp/socket"
import { init as initStore } from "../../src/store"

class FakeSocket extends EventEmitter {
  destroyed = false
  writableEnded = false
  writableLength = 0
  writableNeedDrain = false
  setEncoding() {}
  setNoDelay() {}
  pause() {}
  resume() {}
  write() {
    return !this.writableNeedDrain
  }
  destroy() {
    this.destroyed = true
    this.emit("close")
  }
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const close of cleanups.splice(0)) close()
})
const authenticated = async (slow = false) => {
  const root = mkdtempSync(join(tmpdir(), "touri-mcp-limits-"))
  const runtime = createKernel({ appData: root })
  const socket = new FakeSocket()
  cleanups.push(() => {
    socket.destroy()
    runtime.stop()
    rmSync(root, { recursive: true, force: true })
  })
  await initStore(runtime.kernel)
  const db = runtime.kernel.db as Database
  db.query(
    "INSERT INTO bots(id,name,provider,access,approvals,home_dir,browser_enabled,created_at,updated_at) VALUES ('bot','bot','codex','full','never',?,1,1,1)",
  ).run(root)
  db.exec("INSERT INTO threads(id,bot_id,title,created_at,updated_at) VALUES ('thread','bot','test',1,1)")
  writeFileSync(join(root, "run", "mcp-tokens", "thread"), "test-only", { mode: 0o600 })
  let started = 0
  let aborted = false
  const registrations = new Map<string, import("@touri/contracts").ToolRegistration>()
  if (slow)
    registrations.set("browser_open", {
      name: "browser_open",
      group: "browser",
      handler: ({ ctx }) =>
        new Promise((resolve) => {
          started++
          ctx.signal.addEventListener(
            "abort",
            () => {
              aborted = true
              resolve({ success: false, errorCode: "CANCELED", error: "test" })
            },
            { once: true },
          )
        }),
    })
  serveMcpConnection({
    socket: socket as unknown as Socket,
    kernel: runtime.kernel,
    tokenDir: join(root, "run", "mcp-tokens"),
    registrations,
    deadlines: { writeMs: 20 },
  })
  socket.emit("data", `${JSON.stringify({ touriAuth: { thread: "thread", token: "test-only" } })}\n`)
  await Bun.sleep(1)
  expect(socket.destroyed).toBe(false)
  return { runtime, socket, state: () => ({ started, aborted }) }
}

test("A17: authenticated frames and queued calls behind a slow tool remain bounded", async () => {
  const large = await authenticated()
  large.socket.emit("data", "x".repeat(MCP_LIMITS.frameBytes + 1))
  expect(large.socket.destroyed).toBe(true)
  const f = await authenticated(true)
  f.socket.emit(
    "data",
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "browser_open", arguments: { url: "https://example.com" } } })}\n`,
  )
  await Bun.sleep(5)
  expect(f.state().started).toBe(1)
  f.socket.emit("data", `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })}\n`.repeat(MCP_LIMITS.queued + 1))
  expect(f.socket.destroyed).toBe(true)
  expect(f.state().aborted).toBe(true)
  await Bun.sleep(1)
})

const slowCall = (id: number | null | undefined): string =>
  `${JSON.stringify({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method: "tools/call", params: { name: "browser_open", arguments: { url: "https://example.com" } } })}\n`

test("R13-B05: a repeated request id cannot add executions beyond the first", async () => {
  const f = await authenticated(true)
  for (let index = 0; index < MCP_LIMITS.queued * 2; index++) {
    f.socket.emit("data", slowCall(7))
    await Bun.sleep(1)
  }
  expect(f.state().started).toBe(1)
  expect(f.socket.destroyed).toBe(false)
})

test("R13-B05: calls without an id never execute", async () => {
  const f = await authenticated(true)
  f.socket.emit("data", slowCall(undefined) + slowCall(null))
  await Bun.sleep(5)
  expect(f.state().started).toBe(0)
})

test("A17: in-flight calls are bounded by a connection counter, not by request id", async () => {
  const f = await authenticated(true)
  for (let index = 1; index <= MCP_LIMITS.queued; index++) {
    f.socket.emit("data", slowCall(index))
    await Bun.sleep(1)
  }
  expect(f.state().started).toBe(MCP_LIMITS.queued)
  expect(f.socket.destroyed).toBe(false)
  f.socket.emit("data", slowCall(99))
  await Bun.sleep(5)
  expect(f.socket.destroyed).toBe(true)
  expect(f.state().started).toBe(MCP_LIMITS.queued)
  expect(f.state().aborted).toBe(true)
})

test("A17: stalled writes time out and pending output bytes are capped", async () => {
  const f = await authenticated()
  f.socket.writableNeedDrain = true
  f.socket.emit("data", '{"jsonrpc":"2.0","id":1,"method":"ping"}\n')
  await Bun.sleep(40)
  expect(f.socket.destroyed).toBe(true)
  const large = await authenticated()
  large.socket.writableLength = MCP_LIMITS.writeBytes
  large.socket.emit("data", '{"jsonrpc":"2.0","id":1,"method":"ping"}\n')
  await Bun.sleep(1)
  expect(large.socket.destroyed).toBe(true)
})

test("A17: concurrent IPC connections cannot exceed the server budget", async () => {
  const f = await authenticated()
  const server = createMcpSocket({ kernel: f.runtime.kernel, registrations: new Map() })
  await server.listen()
  const peers: Socket[] = []
  try {
    for (let i = 0; i <= MCP_LIMITS.connections; i++) {
      const peer = createConnection(server.socketPath)
      peer.on("error", () => {})
      peers.push(peer)
      await new Promise<void>((resolve) => peer.once("connect", resolve))
    }
    await Bun.sleep(10)
    expect(peers.filter((peer) => !peer.destroyed).length).toBe(MCP_LIMITS.connections)
  } finally {
    for (const peer of peers) peer.destroy()
    await server.close()
  }
})

test("A17: an endless pre-auth frame is disconnected before buffering unbounded bytes", () => {
  const socket = new FakeSocket()
  serveMcpConnection({
    socket: socket as unknown as Socket,
    kernel: {} as Kernel,
    tokenDir: "/unused",
    registrations: new Map(),
  })
  socket.emit("data", "x".repeat(2 * 1024 * 1024))
  expect(socket.destroyed).toBe(true)
  socket.destroy()
})

test("A17: pre-auth queued frames are capped even in a single data callback", () => {
  const socket = new FakeSocket()
  serveMcpConnection({
    socket: socket as unknown as Socket,
    kernel: {} as Kernel,
    tokenDir: "/unused",
    registrations: new Map(),
  })
  socket.emit("data", "{}\n".repeat(100))
  expect(socket.destroyed).toBe(true)
  socket.destroy()
})

test("A17: idle unauthenticated and partial frames have deadlines", async () => {
  const sockets = [new FakeSocket(), new FakeSocket()]
  for (const socket of sockets)
    serveMcpConnection({
      socket: socket as unknown as Socket,
      kernel: {} as Kernel,
      tokenDir: "/unused",
      registrations: new Map(),
      deadlines: { authMs: 30, readMs: 10 },
    })
  sockets[1]?.emit("data", "{")
  await Bun.sleep(50)
  expect(sockets.every((socket) => socket.destroyed)).toBe(true)
})
