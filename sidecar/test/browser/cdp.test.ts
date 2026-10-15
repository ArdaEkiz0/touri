import { expect, test } from "bun:test"
import { connectCdpWebSocket, createCdpClient } from "../../src/browser/cdp"

test("closing CDP cancels its pending read, releases both pipes and rejects outstanding calls", async () => {
  let cancelled = false
  let writerClosed = false
  const read = new ReadableStream<Uint8Array>({
    cancel: () => {
      cancelled = true
    },
  })
  const write = new WritableStream<Uint8Array>({
    close: () => {
      writerClosed = true
    },
  })
  const client = createCdpClient({ pipe: { read, write } })
  const call = client.call("Browser.getVersion").catch((error: unknown) => error)
  await client.close()
  expect(await call).toMatchObject({ message: "Chrome debugging pipe closed" })
  expect(cancelled).toBe(true)
  expect(writerClosed).toBe(true)
  expect(read.locked).toBe(false)
  expect(write.locked).toBe(false)
  expect(client.isClosed()).toBe(true)
  await client.close()
})

test("unexpected CDP pipe EOF marks the client closed and reports one disconnect", async () => {
  let end: ReadableStreamDefaultController<Uint8Array> | undefined
  const client = createCdpClient({
    pipe: {
      read: new ReadableStream({
        start: (controller) => {
          end = controller
        },
      }),
      write: new WritableStream(),
    },
  })
  let disconnects = 0
  client.onDisconnect?.(() => {
    disconnects++
  })
  const pending = client.call("Browser.getVersion").catch((error: unknown) => error)
  end?.close()
  expect(await pending).toBeInstanceOf(Error)
  expect(client.isClosed()).toBe(true)
  expect(disconnects).toBe(1)
  await client.close()
  expect(disconnects).toBe(1)
})

test("CDP WebSocket disconnect invalidates the client and rejects its pending call", async () => {
  let disconnect: (() => void) | undefined
  const server = Bun.serve({
    port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response("upgrade required")),
    websocket: {
      open: (socket) => {
        disconnect = () => socket.close()
      },
      message: () => {},
    },
  })
  const client = await connectCdpWebSocket({ url: `ws://127.0.0.1:${server.port}/`, timeoutMs: 200 })
  try {
    let disconnects = 0
    client.onDisconnect?.(() => {
      disconnects++
    })
    const pending = client.call("Browser.getVersion").catch((error: unknown) => error)
    disconnect?.()
    expect(await pending).toBeInstanceOf(Error)
    expect(client.isClosed()).toBe(true)
    expect(disconnects).toBe(1)
    await client.close()
    expect(disconnects).toBe(1)
  } finally {
    await client.close()
    server.stop(true)
  }
})

test("aborting a connected CDP WebSocket closes it and cancels pending requests", async () => {
  const controller = new AbortController()
  const server = Bun.serve({
    port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response("upgrade required")),
    websocket: { message: () => {} },
  })
  const client = await connectCdpWebSocket({ url: `ws://127.0.0.1:${server.port}/`, signal: controller.signal })
  try {
    const pending = client.call("Browser.getVersion").catch((error: unknown) => error)
    controller.abort()
    expect(await pending).toBeInstanceOf(Error)
    expect(client.isClosed()).toBe(true)
  } finally {
    await client.close()
    server.stop(true)
  }
})
