import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Bot, ToolContext } from "@touri/contracts"
import { createRoutedBrowserEngine } from "../../src/browser/vm-router"
import { createKernel } from "../../src/kernel"
import { init as initStore } from "../../src/store"
import { createAppleContainerProvider } from "../../src/vm/apple-container"
import { createVmRuntime } from "../../src/vm/runtime"
import { appleContainerAvailable } from "./integration-available"
import { attemptVnc } from "./vnc-client"

const PROFILE = "/var/lib/touri-browser/profile"
const FIXTURE_PORT = 18080
const fixtureUrl = (name: string): string => `http://127.0.0.1:${FIXTURE_PORT}/${name}.html`
const FIXTURE_PAGES: Record<string, string> = {
  ok: "<title>ok</title><h1>hello</h1>",
  again: "<title>again</title>",
  never: "<title>never</title>",
  back: "<title>back</title>",
}
const FIXTURE_SERVER = `mkdir -p /tmp/fixture && cd /tmp/fixture && ${Object.entries(FIXTURE_PAGES)
  .map(([name, html]) => `printf '%s' '${html}' > ${name}.html`)
  .join(" && ")} && (setsid python3 -m http.server ${FIXTURE_PORT} --bind 127.0.0.1 >/dev/null 2>&1 < /dev/null &)`
const FOREIGN_LOCK = `rm -f ${PROFILE}/Singleton*; ln -s foreign-host-512 ${PROFILE}/SingletonLock; ln -s /tmp/org.chromium.Chromium.gone/SingletonSocket ${PROFILE}/SingletonSocket; ln -s 15953753038487500518 ${PROFILE}/SingletonCookie`

test.skipIf(!appleContainerAvailable)(
  "real VM: browser_open recovers from a stale foreign-host profile lock and reports a coded cause when Chromium cannot start",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "touri-browser-vm-"))
    const kernel = createKernel({ appData: root })
    await initStore(kernel.kernel)
    const provider = createAppleContainerProvider()
    const runtime = createVmRuntime({ kernel: kernel.kernel, provider })
    kernel.kernel.services.provide("vm.runtime", runtime.service)
    const engine = createRoutedBrowserEngine(kernel.kernel, "system-chrome")
    let bot: Bot | undefined
    try {
      const response = await fetch(`http://127.0.0.1:${kernel.handshake.port}/api/v1/bots`, {
        method: "POST",
        headers: {
          Authorization: "Bearer dev-ui-token",
          "x-touri-client": "browser-vm",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Disposable browser VM", provider: "codex", machine: "vm", computerUse: true }),
      })
      bot = ((await response.json()) as { bot: Bot }).bot
      const botId = bot.id
      const ctx: ToolContext = {
        botId,
        threadId: bot.mainThreadId ?? "",
        runId: null,
        projectId: null,
        cwd: root,
        signal: new AbortController().signal,
      }
      const open = (url: string, timeoutMs = 20_000) => engine.open({ url, ctx, timeoutMs })
      const release = await runtime.service.acquire({ botId })
      const id = runtime.service.states()[0]?.connection?.machineId ?? ""
      const guest = async (command: string) => provider.exec({ id, user: "0", command: "sh", args: ["-c", command] })
      expect((await guest(FIXTURE_SERVER)).success).toBe(true)
      await Bun.sleep(1000)
      const first = await open(fixtureUrl("ok"))
      expect(first.success).toBe(true)
      expect((await guest(`pkill -u 1001 -x chromium; sleep 1; ${FOREIGN_LOCK}`)).success).toBe(true)
      const started = Date.now()
      const recovered = await open(fixtureUrl("again"))
      expect(recovered.success).toBe(true)
      expect(Date.now() - started).toBeLessThan(20_000)
      const connection = await runtime.service.desktopConnection({ botId })
      expect(
        await attemptVnc(
          connection.url.startsWith("unix:") ? connection.url : connection.hostPort,
          connection.password,
        ),
      ).toBe(true)
      expect((await guest(`pkill -u 1001 -x chromium; sleep 1; chmod 000 /usr/lib/chromium/chromium`)).success).toBe(
        true,
      )
      const broken = Date.now()
      const failure = await open(fixtureUrl("never"), 20_000)
      await guest("chmod 755 /usr/lib/chromium/chromium")
      expect(Date.now() - broken).toBeLessThan(21_000)
      expect(failure.success).toBe(false)
      const text = JSON.stringify(failure)
      expect(text).toContain("O navegador da VM")
      expect(text).toMatch(/BROWSER_START_FAILED|DEADLINE_EXCEEDED/)
      await release()
      const after = await open(fixtureUrl("back"))
      expect(after.success).toBe(true)
    } finally {
      if (bot) await runtime.service.destroy({ botId: bot.id, deleteVolumes: true })
      await engine.shutdown()
      await runtime.dispose()
      await provider.stopBuilder?.()
      kernel.stop()
      rmSync(root, { recursive: true, force: true })
    }
  },
  240000,
)
