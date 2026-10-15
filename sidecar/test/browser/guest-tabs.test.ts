import { expect, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Bot } from "@touri/contracts"
import { createBrowserEngine } from "../../src/browser/engine"
import type { CdpClient } from "../../src/browser/types"
import { createKernel } from "../../src/kernel"
import { init as initStore } from "../../src/store"

test("guest browser_list_tabs discovers manually opened pages and refreshes titles without duplicates", async () => {
  const root = mkdtempSync(join(tmpdir(), "touri-guest-tabs-"))
  const runtime = createKernel({ appData: root })
  await initStore(runtime.kernel)
  const response = await fetch(`http://127.0.0.1:${runtime.handshake.port}/api/v1/bots`, {
    method: "POST",
    headers: { Authorization: "Bearer dev-ui-token", "x-touri-client": "guest-tabs-test" },
    body: JSON.stringify({ name: "Guest", provider: "codex", machine: "local" }),
  })
  const { bot } = (await response.json()) as { bot: Bot }
  const botId = bot.id
  let pages = [{ targetId: "manual", type: "page", title: "Página da VM", url: "https://example.test/" }]
  const client: CdpClient = {
    call: async <T>(method: string) =>
      (method === "Target.getTargets"
        ? { targetInfos: pages }
        : method === "Target.attachToTarget"
          ? { sessionId: "manual-session" }
          : {}) as T,
    subscribe: () => () => {},
    close: async () => {},
    isClosed: () => false,
  }
  const engine = createBrowserEngine({
    kernel: runtime.kernel,
    profile: `vm:${botId}`,
    discoverBotId: botId,
    launcher: { start: async () => ({ client }), stop: async () => {} },
  })
  const clock = spyOn(Date, "now")
  try {
    await engine.list({ botId })
    expect(engine.tabsForBot(botId)).toHaveLength(1)
    expect(engine.tabsForBot(botId)[0]).toMatchObject({
      title: "Página da VM",
      url: "https://example.test/",
      ownerBotId: botId,
    })
    pages = [{ targetId: "manual", type: "page", title: "Título atualizado", url: "https://example.test/" }]
    clock.mockReturnValue(Date.now() + 31 * 60_000)
    await engine.list({ botId })
    expect(engine.tabsForBot(botId)).toHaveLength(1)
    expect(engine.tabsForBot(botId)[0]?.title).toBe("Título atualizado")
    pages = []
    await engine.list({ botId })
    expect(engine.tabsForBot(botId)).toEqual([])
  } finally {
    clock.mockRestore()
    await engine.shutdown()
    runtime.stop()
    rmSync(root, { recursive: true, force: true })
  }
})
