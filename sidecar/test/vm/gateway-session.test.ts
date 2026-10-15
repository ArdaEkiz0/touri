import { expect, test } from "bun:test"
import type { CloudClient } from "../../src/cloud/client"
import { httpGateway } from "../../src/cloud/gateway"
import { authorizeGatewayRequest, gatewayCookieName } from "../../src/vm/gateway-session"
import { capabilityListener } from "../../src/vm/local-transport"

const CAP = "a".repeat(64)
const decide = (target: string, cookie: string | null = null, fetchSite: string | null = null) =>
  authorizeGatewayRequest({ target, capability: CAP, port: 4100, cookie, fetchSite })

test("A08 gateway session: capability path, session bootstrap and cookie routing decisions", () => {
  expect(decide(`/touri/${CAP}`)).toEqual({ action: "forward", route: "/" })
  expect(decide(`/touri/${CAP}?x=1`)).toEqual({ action: "forward", route: "/?x=1" })
  expect(decide(`/touri/${CAP}/app/a.js?v=2`)).toEqual({ action: "forward", route: "/app/a.js?v=2" })
  expect(decide("/app/a.js")).toEqual({ action: "deny" })
  const session = decide(`/touri/${CAP}/__touri/session?next=%2Fdashboard%3Ftab%3D1`)
  expect(session).toMatchObject({ action: "session", location: "/dashboard?tab=1" })
  expect(session.action === "session" && session.setCookie).toBe(
    `${gatewayCookieName(4100)}=${CAP}; Path=/; HttpOnly; SameSite=Strict`,
  )
  for (const next of ["//evil.example", "https://evil.example", "/a\r\nSet-Cookie:x=1", "/\\evil", "/a b"])
    expect(decide(`/touri/${CAP}/__touri/session?next=${encodeURIComponent(next)}`)).toEqual({ action: "deny" })
  const cookie = `other=1; ${gatewayCookieName(4100)}=${CAP}`
  expect(decide("/assets/a.js", cookie)).toEqual({ action: "forward", route: "/assets/a.js" })
  expect(decide("/assets/a.js", cookie, "same-origin")).toEqual({ action: "forward", route: "/assets/a.js" })
  expect(decide("/assets/a.js", cookie, "same-site")).toEqual({ action: "deny" })
  expect(decide("/assets/a.js", cookie, "cross-site")).toEqual({ action: "deny" })
  expect(decide("/assets/a.js", `${gatewayCookieName(4100)}=${"b".repeat(64)}`)).toEqual({ action: "deny" })
  expect(decide("/assets/a.js", `${gatewayCookieName(4101)}=${CAP}`)).toEqual({ action: "deny" })
})

test("A08 C-04 cloud HTTP gateway serves root-relative assets after a session bootstrap and nothing without it", async () => {
  const seen: string[] = []
  const upstream = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (request) => {
      seen.push(new URL(request.url).pathname)
      return new Response("asset", { headers: { "Content-Type": "text/plain" } })
    },
  })
  const client = {
    endpoint: (value: string) => `http://127.0.0.1:${upstream.port}${value}`,
    access: async () => "test-only",
  } as unknown as CloudClient
  const proxy = httpGateway(client, "/forward/3000", {
    generation: 1,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  })
  const base = `http://127.0.0.1:${proxy.hostPort}`
  try {
    expect((await fetch(`${base}/assets/app.js`)).status).toBe(403)
    const boot = await fetch(`${proxy.url}/__touri/session?next=/index.html`, { redirect: "manual" })
    expect(boot.status).toBe(302)
    expect(boot.headers.get("location")).toBe("/index.html")
    const cookie = (boot.headers.get("set-cookie") ?? "").split(";")[0] ?? ""
    expect(cookie).toStartWith(gatewayCookieName(proxy.hostPort))
    expect(boot.headers.get("set-cookie")).toContain("HttpOnly")
    expect(boot.headers.get("set-cookie")).toContain("SameSite=Strict")
    expect(seen).toEqual([])
    const asset = await fetch(`${base}/assets/app.js`, { headers: { Cookie: cookie } })
    expect(asset.status).toBe(200)
    expect(seen).toEqual(["/forward/3000/assets/app.js"])
    for (const headers of [
      { Cookie: cookie, Host: "rebind.example" },
      { Cookie: cookie, Origin: "https://evil.example" },
      { Cookie: cookie, "Sec-Fetch-Site": "same-site" },
      { Cookie: `${gatewayCookieName(proxy.hostPort)}=${"0".repeat(64)}` },
    ])
      expect((await fetch(`${base}/assets/app.js`, { headers })).status).toBe(403)
    expect(seen).toHaveLength(1)
  } finally {
    proxy.close()
    upstream.stop(true)
  }
})

test("A08 guest forward listener bootstraps a cookie, strips it before the guest and rejects everything else", async () => {
  const forwarded: string[] = []
  const listener = await capabilityListener((socket, initial) => {
    forwarded.push(initial?.toString("latin1") ?? "")
    socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
  })
  const base = `http://127.0.0.1:${listener.hostPort}`
  try {
    expect((await fetch(`${base}/assets/a.js`)).status).toBe(403)
    expect(
      (await fetch(`${base}/`, { headers: { Cookie: `${gatewayCookieName(listener.hostPort)}=${"c".repeat(64)}` } }))
        .status,
    ).toBe(403)
    const boot = await fetch(`${listener.url}/__touri/session?next=/`, { redirect: "manual" })
    expect(boot.status).toBe(302)
    expect(boot.headers.get("location")).toBe("/")
    const cookie = (boot.headers.get("set-cookie") ?? "").split(";")[0] ?? ""
    expect(forwarded).toEqual([])
    const asset = await fetch(`${base}/assets/a.js`, { headers: { Cookie: `app=1; ${cookie}` } })
    expect(asset.status).toBe(200)
    expect(forwarded).toHaveLength(1)
    expect(forwarded[0]).toStartWith("GET /assets/a.js HTTP/1.1")
    expect(forwarded[0]?.toLowerCase()).toContain("cookie: app=1")
    expect(forwarded[0]).not.toContain("touri_cap_")
    expect(
      (await fetch(`${base}/assets/a.js`, { headers: { Cookie: cookie, "Sec-Fetch-Site": "cross-site" } })).status,
    ).toBe(403)
    expect(
      (await fetch(`${base}/assets/a.js`, { headers: { Cookie: cookie, Origin: "https://evil.example" } })).status,
    ).toBe(403)
    expect((await fetch(`${listener.url}/x`)).status).toBe(200)
  } finally {
    listener.close()
  }
})
