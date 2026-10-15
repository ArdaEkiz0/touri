import type { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Provider, StoreApi, Thread } from "@touri/contracts"
import { createKernel } from "../../src/kernel"
import { init as initMcp, stop as stopMcp } from "../../src/mcp"
import { createApprovalPromptHandler } from "../../src/runtime"
import { createRuntimeEngine } from "../../src/runtime/engine"
import { init as initStore } from "../../src/store"

const enabled = process.env.TOURI_E2E_REAL_CLI === "1"

const waitForTerminal = async (run: { status: string }): Promise<void> => {
  const deadline = Date.now() + 120_000
  while (!["succeeded", "failed", "canceled", "interrupted"].includes(run.status)) {
    if (Date.now() >= deadline) throw new Error("real CLI smoke timed out")
    await Bun.sleep(100)
  }
}

const insertUserMessage = (store: StoreApi, thread: Thread, text: string, id: string) => {
  const result = store.insertMessage({
    message: {
      id,
      threadId: thread.id,
      parentId: thread.activeLeafId,
      role: "user",
      kind: "text",
      status: "complete",
      runId: null,
      text,
      parts: [{ type: "text", text }],
      sender: null,
      source: "local",
    },
  })
  if (!result.success) throw new Error(result.error)
  return result.message
}

const runSmoke = async (provider: Provider): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), `touri-real-cli-${provider}-`))
  const runtime = createKernel({ appData: root })
  const timestamp = Date.now()
  const botId = `bot-real-${provider}`
  const threadId = `thread-real-${provider}`
  mkdirSync(join(root, "bots", botId), { recursive: true, mode: 0o700 })
  const database = runtime.kernel.db as Database
  database
    .query(
      "INSERT INTO bots (id, name, instructions, instructions_hash, provider, home_dir, cwd, main_thread_id, created_at, updated_at) VALUES (?, ?, 'Remember the conversation.', 'smoke', ?, ?, ?, ?, ?, ?)",
    )
    .run(botId, `real-${provider}`, provider, join(root, "bots", botId), process.cwd(), threadId, timestamp, timestamp)
  database
    .query("INSERT INTO threads (id, bot_id, kind, title, created_at, updated_at) VALUES (?, ?, 'main', ?, ?, ?)")
    .run(threadId, botId, `real ${provider}`, timestamp, timestamp)

  const shim = join(root, "sidecar-shim")
  writeFileSync(
    shim,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} run ${JSON.stringify(join(import.meta.dir, "../../src/main.ts"))} "$@"\n`,
    { mode: 0o700 },
  )
  runtime.kernel.paths.sidecarBinary = shim
  let engine: ReturnType<typeof createRuntimeEngine> | null = null
  try {
    await initStore(runtime.kernel)
    await initMcp(runtime.kernel)
    const store = runtime.kernel.services.use("store.api")
    if (!store) throw new Error("store service was not initialized")
    engine = createRuntimeEngine({
      kernel: runtime.kernel,
      environment: { PATH: process.env.PATH ?? "", SHELL: process.env.SHELL ?? "/bin/zsh" },
    })

    runtime.kernel.services.provide("runtime.activeRun", (args) => engine?.activeRun(args) ?? null)
    runtime.kernel.registerTools({
      tools: [{ name: "approval_prompt", group: "core", handler: createApprovalPromptHandler(engine) }],
    })
    const firstMessage = insertUserMessage(
      store,
      store.getThread({ threadId }) as Thread,
      "reply with the word pong",
      "real-user-1",
    )
    const first = engine.enqueue({ threadId, requestMessageId: firstMessage.id, trigger: "user" })
    if (!first.success) throw new Error(first.error)
    await waitForTerminal(first.run)
    if (first.run.status !== "succeeded") throw new Error(first.run.errorMessage ?? `real ${provider} turn failed`)
    expect(first.run.status).toBe("succeeded")
    const firstReply = store
      .activePath({ threadId })
      .filter((message) => message.role === "assistant")
      .at(-1)
    expect(firstReply?.text.toLowerCase()).toContain("pong")

    const secondMessage = insertUserMessage(
      store,
      store.getThread({ threadId }) as Thread,
      "what word did I ask you to reply with?",
      "real-user-2",
    )
    const second = engine.enqueue({ threadId, requestMessageId: secondMessage.id, trigger: "user" })
    if (!second.success) throw new Error(second.error)
    await waitForTerminal(second.run)
    expect(second.run.status).toBe("succeeded")
    const secondReply = store
      .activePath({ threadId })
      .filter((message) => message.role === "assistant")
      .at(-1)
    expect(secondReply?.text.toLowerCase()).toContain("pong")
  } finally {
    if (engine) await engine.shutdown()
    await stopMcp({ kernel: runtime.kernel })
    runtime.stop()
    rmSync(root, { recursive: true, force: true })
  }
}

for (const provider of ["codex", "claude"] as const) {
  test.skipIf(!enabled || Bun.which(provider) === null)(
    `real ${provider} CLI remembers a second turn`,
    async () => {
      await runSmoke(provider)
    },
    180_000,
  )
}
