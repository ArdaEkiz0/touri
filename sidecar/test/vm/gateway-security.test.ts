import { expect, test } from "bun:test"
import { statSync } from "node:fs"
import { dirname } from "node:path"
import type { CloudClient } from "../../src/cloud/client"
import { httpGateway, tcpGateway } from "../../src/cloud/gateway"

const fixture = () => {
  let calls = 0
  const upstream = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => {
      calls++
      return Response.json({ ok: true })
    },
  })
  const client = {
    endpoint: () => `http://127.0.0.1:${upstream.port}/`,
    access: async () => "test-only",
  } as unknown as CloudClient
  const proxy = httpGateway(client, "/control", {
    generation: 1,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  })
  return {
    proxy,
    client,
    calls: () => calls,
    stop: () => {
      proxy.close()
      upstream.stop(true)
    },
  }
}

test("A08 C-04 cloud HTTP and WS reject unauthenticated and rebinding requests before upstream access", async () => {
  const f = fixture()
  const base = `http://127.0.0.1:${f.proxy.hostPort}`
  const authorized = (f.proxy as { url?: string }).url ?? base
  try {
    expect((await fetch(`${base}/json/version`)).status).toBe(403)
    expect((await fetch(`${authorized}/json/version`, { headers: { Host: "rebind.example" } })).status).toBe(403)
    expect((await fetch(`${authorized}/json/version`, { headers: { Origin: "http://localhost:34123" } })).status).toBe(
      403,
    )
    expect((await fetch(`${authorized}/json/version`, { headers: { Origin: "https://evil.example" } })).status).toBe(
      403,
    )
    expect(
      (
        await fetch(`${base}/devtools/browser/1`, {
          headers: {
            Upgrade: "websocket",
            Connection: "Upgrade",
            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version": "13",
          },
        })
      ).status,
    ).toBe(403)
    expect(f.calls()).toBe(0)
    for (const origin of [undefined, "tauri://localhost", "http://tauri.localhost", "http://localhost:1420"]) {
      expect((await fetch(`${authorized}/json/version`, { headers: origin ? { Origin: origin } : {} })).status).toBe(
        200,
      )
    }
  } finally {
    f.stop()
  }
})

test("A08 C-04 raw cloud TCP uses an owner-only Unix socket", async () => {
  const f = fixture()
  const proxy = await tcpGateway(f.client, "/unused")
  try {
    expect(proxy.hostPort).toBe(0)
    expect(proxy.url).toStartWith("unix:")
    expect(statSync(dirname(proxy.url.slice(5))).mode & 0o777).toBe(0o700)
  } finally {
    proxy.close()
    f.stop()
  }
})

test("A08 C-04 a TCP upstream that finishes opening after revocation is immediately closed", async () => {
  const { createConnection } = await import("node:net")
  let finish: (socket: WebSocket) => void = () => {}
  let opening = false
  let closed = 0
  const client = {
    socket: () => {
      opening = true
      return new Promise<WebSocket>((resolve) => {
        finish = resolve
      })
    },
  } as unknown as CloudClient
  const proxy = await tcpGateway(client, "/test")
  const local = createConnection({ path: proxy.url.slice(5) })
  try {
    for (let i = 0; i < 50 && !opening; i++) await Bun.sleep(1)
    expect(opening).toBe(true)
    const localClosed = new Promise<void>((resolve) => local.once("close", () => resolve()))
    proxy.close()
    await localClosed
    finish({
      close: () => {
        closed++
      },
      addEventListener: () => {},
    } as unknown as WebSocket)
    await Bun.sleep(10)
    expect(closed).toBeGreaterThan(0)
  } finally {
    local.destroy()
    proxy.close()
  }
})
