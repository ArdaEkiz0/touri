import { afterEach, expect, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ApiRoutes, Bot, Kernel } from "@touri/contracts"
import { createKernel, type KernelRuntime } from "../../src/kernel"
import { init as initStore } from "../../src/store"
import { init as initVm } from "../../src/vm/module"
import { providerLoginAccount, storedProviderLoginSource, VAULT_READ_DEADLINE_MS } from "../../src/vm/provider-login"

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "touri-login-timeout-"))
  // Exercise the real HTTP handler and route registry without opening a listener.
  const server = { port: 12345, stop: () => {}, requestIP: () => null } as unknown as ReturnType<typeof Bun.serve>
  const serve = spyOn(Bun, "serve").mockReturnValue(server)
  let runtime: KernelRuntime
  let options: { fetch: (request: Request, bunServer: typeof server) => Promise<Response>; idleTimeout?: number }
  try {
    runtime = createKernel({
      appData: root,
      web: {
        hostname: "localhost",
        port: 0,
        intercept: async () => null,
        host: () => (async () => ({ success: true, value: {} })) as Kernel["callHost"],
      },
    })
    options = serve.mock.calls[0]?.[0] as typeof options
  } finally {
    serve.mockRestore()
  }
  cleanups.push(async () => {
    runtime.emitHostNotification({ method: "app.willQuit", params: {} })
    await runtime.kernel.services.use("vm.shutdown")?.()
    runtime.stop()
    rmSync(root, { recursive: true, force: true })
  })
  const request = (path: string, method = "GET", body?: unknown) =>
    options.fetch(
      new Request(`http://localhost/api/v1${path}`, {
        method,
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      }),
      server,
    )
  return { runtime, request, idleTimeout: options.idleTimeout }
}

test("a stalled vault returns the route's transport message and saving can recover", async () => {
  const { runtime, request } = fixture()
  await initStore(runtime.kernel)
  const headless = process.env.TOURI_HEADLESS
  try {
    process.env.TOURI_HEADLESS = "1"
    await initVm(runtime.kernel)
  } finally {
    if (headless === undefined) delete process.env.TOURI_HEADLESS
    else process.env.TOURI_HEADLESS = headless
  }
  const created = await request("/bots", "POST", { name: "Login timeout", provider: "claude" })
  expect(created.status).toBe(201)
  const { bot } = (await created.json()) as { bot: Bot }
  runtime.kernel.callHost = (() => new Promise(() => {})) as Kernel["callHost"]
  const started = performance.now()
  const response = await request(`/bots/${bot.id}/provider-login`)
  expect(response.status).toBe(200)
  expect(performance.now() - started).toBeLessThan(8000)
  const status = (await response.json()) as ApiRoutes["GET /bots/:id/provider-login"]["res"]
  expect(status).toMatchObject({ ready: false, source: "missing", health: "transport" })
  expect(status.message).toContain("O cofre de segredos não respondeu")
  expect(storedProviderLoginSource(runtime.kernel, bot)).toBeNull()

  const vault = new Map<string, string>()
  runtime.kernel.callHost = (async (method, params) => {
    const { account, value } = params as { account: string; value?: string }
    if (method === "keychain.set" && value) vault.set(account, value)
    return { success: true, value: method === "keychain.get" ? { value: vault.get(account) ?? null } : {} }
  }) as Kernel["callHost"]
  expect((await request(`/bots/${bot.id}/provider-login`, "PUT", { value: "fixture-login-token" })).status).toBe(200)
  expect(vault.get(providerLoginAccount(bot.id, "claude"))).toBe("fixture-login-token")
  const recovered = await request(`/bots/${bot.id}/provider-login`)
  expect(await recovered.json()).toMatchObject({ ready: true, source: "token", health: "ready" })
}, 10000)

test("the HTTP idle timeout covers both vault reads during initial source discovery", () => {
  const { idleTimeout } = fixture()
  expect(idleTimeout).toBeGreaterThan(10)
  expect((idleTimeout ?? 0) * 1000).toBeGreaterThan(2 * VAULT_READ_DEADLINE_MS)
})
