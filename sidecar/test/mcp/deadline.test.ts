import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolRegistration } from "@touri/contracts"
import { createKernel } from "../../src/kernel"
import type { McpCallerContext } from "../../src/mcp/auth"
import { createToolRouter } from "../../src/mcp/router"

test("a handler that exceeds its catalog deadline is aborted and returns DEADLINE_EXCEEDED", async () => {
  const root = mkdtempSync(join(tmpdir(), "touri-wp4-deadline-"))
  const runtime = createKernel({ appData: root })
  const registrations = new Map<string, ToolRegistration>([
    [
      "history_search",
      {
        name: "history_search",
        group: "core",
        handler: async () => await new Promise<never>(() => undefined),
      },
    ],
  ])
  const caller: McpCallerContext = {
    botId: "bot-deadline",
    threadId: "thread-deadline",
    projectId: "project-deadline",
    cwd: runtime.kernel.paths.appData,
    provider: "codex",
    browserEnabled: true,
    computerUse: false,
  }
  try {
    const pending = createToolRouter({ kernel: runtime.kernel, registrations, defaultDeadlineMs: 1 }).call({
      id: 1,
      name: "history_search",
      args: { query: "deadline" },
      caller,
      signal: new AbortController().signal,
    })
    const result = await pending
    expect(result).toEqual({
      success: false,
      errorCode: "DEADLINE_EXCEEDED",
      error: "Tool exceeded its 1ms deadline",
    })
  } finally {
    runtime.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test("a disconnected caller cannot start a tool and an in-flight handler receives cancellation", async () => {
  const root = mkdtempSync(join(tmpdir(), "touri-mcp-cancel-"))
  const runtime = createKernel({ appData: root })
  const controller = new AbortController()
  const caller: McpCallerContext = {
    botId: "bot-cancel",
    threadId: "thread-cancel",
    projectId: null,
    cwd: root,
    provider: "codex",
    browserEnabled: false,
    computerUse: false,
  }
  let invoked = 0
  let aborted = false
  const router = createToolRouter({
    kernel: runtime.kernel,
    registrations: new Map([
      [
        "history_search",
        {
          name: "history_search",
          group: "core",
          handler: async ({ ctx }) => {
            invoked++
            ctx.signal.addEventListener(
              "abort",
              () => {
                aborted = true
              },
              { once: true },
            )
            return new Promise<never>(() => {})
          },
        },
      ],
    ]),
  })
  try {
    const input = { id: 1, name: "history_search", args: { query: "test" }, caller, signal: controller.signal }
    const pending = router.call(input)
    await Bun.sleep(1)
    controller.abort()
    expect(await pending).toMatchObject({ success: false, errorCode: "CLIENT_DISCONNECTED" })
    expect(aborted).toBe(true)
    expect(await router.call(input)).toMatchObject({ success: false, errorCode: "CLIENT_DISCONNECTED" })
    expect(invoked).toBe(1)
  } finally {
    runtime.stop()
    rmSync(root, { recursive: true, force: true })
  }
})
