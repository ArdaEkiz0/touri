import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolResult } from "@touri/contracts"
import { createBrowserEngine } from "../../src/browser/engine"
import { createChromeLauncher } from "../../src/browser/launcher"
import { createKernel } from "../../src/kernel"
import { startBrowserFixtureServer } from "./fixture-server"
import { assertNoTestChrome, forceHeadlessBrowserTests, hasSystemChrome } from "./test-helper"

setDefaultTimeout(40000)

const realSuite = hasSystemChrome ? describe : describe.skip

realSuite("R14 browser_type clear:true against real Chrome", () => {
  let root = ""
  let base = ""
  let runtime: ReturnType<typeof createKernel>
  let engine: ReturnType<typeof createBrowserEngine>
  let server: ReturnType<typeof startBrowserFixtureServer>
  const botId = "bot-r14"
  const threadId = "thread-r14"

  beforeAll(async () => {
    forceHeadlessBrowserTests()
    root = mkdtempSync(join(tmpdir(), "touri-r14-browser-"))
    mkdirSync(join(root, "run"), { recursive: true })
    runtime = createKernel({ appData: root })
    const database = runtime.kernel.db as { run: (sql: string, ...args: Array<unknown>) => unknown }
    const now = Date.now()
    mkdirSync(join(root, "bots", botId), { recursive: true })
    database.run(
      "INSERT INTO bots (id,name,provider,home_dir,created_at,updated_at) VALUES (?, ?, 'codex', ?, ?, ?)",
      botId,
      botId,
      join(root, "bots", botId),
      now,
      now,
    )
    database.run(
      "INSERT INTO threads (id,bot_id,kind,title,created_at,updated_at) VALUES (?, ?, 'main', ?, ?, ?)",
      threadId,
      botId,
      threadId,
      now,
      now,
    )
    server = startBrowserFixtureServer()
    base = `http://127.0.0.1:${server.port}`
    engine = createBrowserEngine({
      kernel: runtime.kernel,
      launcher: createChromeLauncher({ kernel: runtime.kernel }),
    })
  })

  afterAll(async () => {
    try {
      await engine.shutdown()
      await assertNoTestChrome({ profile: join(root, "browser", "profiles", "default") })
    } finally {
      runtime.stop()
      server.stop(true)
      rmSync(root, { recursive: true, force: true })
    }
  })

  const signal = (): AbortSignal => new AbortController().signal
  const evaluate = async (tabId: string, expression: string): Promise<unknown> =>
    ((await engine.evaluate({ tabId, botId, expression, signal: signal() })) as { structured?: unknown }).structured
  const typeInto = (tabId: string, selector: string, text: string): Promise<ToolResult> =>
    engine.type({
      tabId,
      botId,
      target: { kind: "css", selector },
      text,
      clear: true,
      submit: false,
      timeoutMs: 10000,
      signal: signal(),
    })
  const openFields = async (): Promise<string> => {
    const result = await engine.open({
      url: `${base}/clear-fields`,
      ctx: { botId, threadId, projectId: null, cwd: root, runId: null, signal: signal() },
      timeoutMs: 20000,
    })
    return ((result as { structured?: unknown }).structured as { tabId: string }).tabId
  }

  test("replaces the value of a plain input", async () => {
    const tabId = await openFields()
    expect((await typeInto(tabId, "#plain", "new@example.com")).success).toBe(true)
    expect(await evaluate(tabId, "document.querySelector('#plain').value")).toBe("new@example.com")
  })

  test("replaces the value of a React-controlled input and its state", async () => {
    const tabId = await openFields()
    expect((await typeInto(tabId, "#controlled", "fresh@example.com")).success).toBe(true)
    expect(await evaluate(tabId, "document.querySelector('#controlled').value")).toBe("fresh@example.com")
    expect(await evaluate(tabId, "window.controlledState.v")).toBe("fresh@example.com")
  })

  test("replaces the text of a textarea", async () => {
    const tabId = await openFields()
    expect((await typeInto(tabId, "#area", "replacement")).success).toBe(true)
    expect(await evaluate(tabId, "document.querySelector('#area').value")).toBe("replacement")
  })

  test("replaces the text of a contenteditable", async () => {
    const tabId = await openFields()
    expect((await typeInto(tabId, "#editable", "rich new")).success).toBe(true)
    expect(await evaluate(tabId, "document.querySelector('#editable').textContent")).toBe("rich new")
  })

  test("clearing with an empty replacement leaves the field empty", async () => {
    const tabId = await openFields()
    expect((await typeInto(tabId, "#plain", "")).success).toBe(true)
    expect(await evaluate(tabId, "document.querySelector('#plain').value")).toBe("")
  })
})
