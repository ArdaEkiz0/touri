import { expect, test } from "bun:test"
import {
  collectNetworkChecks,
  type NetworkProbes,
  networkProbes,
  providerTargets,
  withinDeadline,
} from "../../src/doctor/network"

const signal = (): AbortSignal => new AbortController().signal
const probes: NetworkProbes = { dns: async () => undefined, tls: async () => undefined, http: async () => 200 }

test("network stages distinguish expected unauthenticated responses from provider failures", async () => {
  const checks = await collectNetworkChecks(signal(), {
    ...probes,
    http: async (url) => (url.includes("anthropic") ? 401 : url.includes("openai") ? 503 : 429),
  })
  expect(checks).toHaveLength(9)
  expect(checks.find((item) => item.id === "network-anthropic-http")).toMatchObject({
    status: "pass",
    ok: true,
    fix: null,
  })
  expect(checks.find((item) => item.id === "network-openai-http")).toMatchObject({ status: "fail", ok: false })
  expect(checks.find((item) => item.id === "network-openrouter-http")).toMatchObject({ status: "warn", ok: false })
  expect(checks.every((item) => item.label && typeof item.durationMs === "number")).toBe(true)
  expect(checks.filter((item) => !item.ok).every((item) => item.fix?.startsWith("curl "))).toBe(true)
})

test("DNS and TLS failures are independent and never expose raw exception messages", async () => {
  const checks = await collectNetworkChecks(signal(), {
    ...probes,
    dns: async (host) => {
      if (host === "api.anthropic.com") throw new Error("secret-dns-value")
    },
    tls: async (host) => {
      if (host === "api.openai.com") throw new Error("secret-certificate-value")
    },
  })
  expect(checks.find((item) => item.id === "network-anthropic-dns")?.status).toBe("fail")
  expect(checks.find((item) => item.id === "network-anthropic-tls")?.status).toBe("pass")
  expect(checks.find((item) => item.id === "network-openai-tls")?.status).toBe("fail")
  expect(checks.find((item) => item.id === "network-openrouter-http")?.status).toBe("pass")
  expect(JSON.stringify(checks)).not.toContain("secret-")
})

test("blocked and redirected HTTP responses do not report successful API access", async () => {
  for (const [code, expected] of [
    [403, "warn"],
    [302, "fail"],
    [404, "fail"],
  ] as const) {
    const checks = await collectNetworkChecks(signal(), { ...probes, http: async () => code })
    expect(
      checks.filter((item) => item.id.endsWith("-http")).every((item) => item.status === expected && !item.ok),
    ).toBe(true)
  }
})

test("a probe that ignores cancellation still has a deadline", async () => {
  const checks = await collectNetworkChecks(signal(), { ...probes, dns: () => new Promise(() => undefined) }, 10)
  expect(checks.filter((item) => item.id.endsWith("-dns")).every((item) => item.status === "fail")).toBe(true)
  expect(checks.filter((item) => item.id.endsWith("-http")).every((item) => item.status === "pass")).toBe(true)
})

test("shutdown cancels in-flight network probes rather than publishing failure results", async () => {
  const controller = new AbortController()
  const pending = collectNetworkChecks(controller.signal, { ...probes, dns: () => new Promise(() => undefined) }, 1000)
  controller.abort()
  await expect(pending).rejects.toThrow()
  await expect(withinDeadline(async () => undefined, controller.signal, 1000)).rejects.toThrow()
})

test("HTTP transport sends only a credential-free GET, refuses redirects and discards the body", async () => {
  const original = globalThis.fetch
  const requests: Array<{ url: string; init: RequestInit | undefined }> = []
  let canceled = 0
  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init })
      return new Response(
        new ReadableStream({
          cancel: () => {
            canceled += 1
          },
        }),
        { status: 401 },
      )
    }) as typeof fetch
    for (const target of providerTargets)
      expect(await networkProbes.http(`https://${target.host}${target.path}`, signal())).toBe(401)
    expect(canceled).toBe(3)
    for (const request of requests) {
      expect(request.init).toMatchObject({ method: "GET", redirect: "manual", credentials: "omit" })
      expect(request.init?.headers).toBeUndefined()
      expect(request.init?.body).toBeUndefined()
      expect(request.url).not.toContain("?")
    }
  } finally {
    globalThis.fetch = original
  }
})
