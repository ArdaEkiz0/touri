import type { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import type { Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolRegistration } from "@touri/contracts"
import { createKernel } from "../../src/kernel"
import { asStructuredContent, serveMcpConnection } from "../../src/mcp/connection"
import { init as initStore } from "../../src/store"

class CaptureSocket extends EventEmitter {
  destroyed = false
  writableEnded = false
  writableLength = 0
  writableNeedDrain = false
  frames: Array<{ id: number; result?: Record<string, unknown> }> = []
  setEncoding() {}
  setNoDelay() {}
  pause() {}
  resume() {}
  write(frame: string) {
    this.frames.push(JSON.parse(frame))
    return true
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

const connect = async (registrations: Map<string, ToolRegistration>) => {
  const root = mkdtempSync(join(tmpdir(), "touri-mcp-concurrency-"))
  const runtime = createKernel({ appData: root })
  const socket = new CaptureSocket()
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
  serveMcpConnection({
    socket: socket as unknown as Socket,
    kernel: runtime.kernel,
    tokenDir: join(root, "run", "mcp-tokens"),
    registrations,
  })
  socket.emit("data", `${JSON.stringify({ touriAuth: { thread: "thread", token: "test-only" } })}\n`)
  await Bun.sleep(1)
  return socket
}

const call = (id: number, name: string, args: Record<string, unknown>): string =>
  `${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })}\n`

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let tick = 0; tick < 200 && !predicate(); tick++) await Bun.sleep(5)
}

test("a pending tool call does not block later calls on the same connection", async () => {
  let aborted = false
  const registrations = new Map<string, ToolRegistration>([
    [
      "browser_open",
      {
        name: "browser_open",
        group: "browser",
        handler: ({ ctx }) =>
          new Promise((resolve) =>
            ctx.signal.addEventListener(
              "abort",
              () => {
                aborted = true
                resolve({ success: false, errorCode: "CANCELED", error: "canceled" })
              },
              { once: true },
            ),
          ),
      },
    ],
    [
      "history_search",
      {
        name: "history_search",
        group: "core",
        handler: async () => ({ success: true, content: [{ type: "text", text: '{"results":[]}' }] }),
      },
    ],
  ])
  const socket = await connect(registrations)
  socket.emit("data", call(1, "browser_open", { url: "https://example.com" }))
  socket.emit("data", call(2, "history_search", { query: "ENV.md", limit: 6 }))
  await waitFor(() => socket.frames.some((frame) => frame.id === 2))
  expect(socket.frames.find((frame) => frame.id === 2)?.result?.isError).toBe(false)
  expect(socket.frames.some((frame) => frame.id === 1)).toBe(false)
  socket.emit(
    "data",
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } })}\n`,
  )
  await waitFor(() => socket.frames.some((frame) => frame.id === 1))
  expect(aborted).toBe(true)
  expect(socket.destroyed).toBe(false)
})

test("structuredContent is always an object", () => {
  expect(asStructuredContent([{ id: 1 }])).toEqual({ result: [{ id: 1 }] })
  expect(asStructuredContent("text")).toEqual({ result: "text" })
  expect(asStructuredContent(null)).toEqual({ result: null })
  expect(asStructuredContent({ processes: [] })).toEqual({ processes: [] })
})

test("an array structured result reaches the client as an object", async () => {
  const registrations = new Map<string, ToolRegistration>([
    [
      "history_search",
      {
        name: "history_search",
        group: "core",
        handler: async () => ({ success: true, content: [{ type: "text", text: "[]" }], structured: [] }),
      },
    ],
  ])
  const socket = await connect(registrations)
  socket.emit("data", call(1, "history_search", { query: "ENV.md" }))
  await waitFor(() => socket.frames.length > 0)
  expect(socket.frames[0]?.result?.structuredContent).toEqual({ result: [] })
})
