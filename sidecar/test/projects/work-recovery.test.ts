import type { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { createProjectStore } from "../../src/projects/repository"
import { createSupervisor } from "../../src/projects/supervisor"
import { createWorkState } from "../../src/runtime/work-state"
import { createHarness } from "./harness"

const UNSCOPED = "unscoped"

type Harness = Awaited<ReturnType<typeof createHarness>>

const createProject = async (harness: Harness): Promise<{ id: string }> => {
  const response = await harness.request("/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: harness.projectPath }),
  })
  const body = (await response.json()) as { project: { id: string } }
  return body.project
}

const kinds = (database: Database): Array<string> =>
  (database.query("SELECT kind FROM work_journal ORDER BY seq").all() as Array<{ kind: string }>).map((row) => row.kind)

test("managed start journals intent, identity and result around the spawn", async () => {
  const harness = await createHarness()
  try {
    const database = harness.runtime.kernel.db as Database
    const project = await createProject(harness)
    await harness.tool("process_define", { name: "web", command: "sleep 30" }, project.id)
    const started = await harness.tool("process_start", { name: "web", waitMs: 5000 }, project.id)
    expect(started.success).toBe(true)
    expect(kinds(database)).toEqual(["intent", "identity", "identity"])
    await harness.tool("process_stop", { name: "web" }, project.id)
    await Bun.sleep(200)
    const work = createWorkState({ database })
    const [effect] = work.rebuild({ turnId: UNSCOPED })
    expect(effect).toMatchObject({ state: "finished", status: "stopped", threadId: "thread-test", description: "web" })
    expect(effect?.pid).not.toBeNull()
    expect(effect?.processRunId).not.toBeNull()
  } finally {
    await harness.close()
  }
}, 30_000)

test("a failed intent append prevents the spawn", async () => {
  const harness = await createHarness()
  try {
    const database = harness.runtime.kernel.db as Database
    const project = await createProject(harness)
    const marker = join(harness.projectPath, "spawned.txt")
    await harness.tool("process_define", { name: "marker", command: `touch ${marker}; sleep 30` }, project.id)
    database.exec(
      "CREATE TRIGGER fail_intent BEFORE INSERT ON work_journal BEGIN SELECT RAISE(ABORT, 'disk full'); END",
    )
    const started = await harness.tool("process_start", { name: "marker", waitMs: 5000 }, project.id)
    expect(started).toMatchObject({ success: false, errorCode: "PROCESS_START_FAILED" })
    await Bun.sleep(300)
    expect(existsSync(marker)).toBe(false)
    expect(database.query("SELECT COUNT(*) AS n FROM work_journal").get()).toEqual({ n: 0 })
  } finally {
    await harness.close()
  }
}, 30_000)

test("restart recovery marks unobservable effects uncertain, warns in the thread and blocks automatic starts", async () => {
  const harness = await createHarness()
  try {
    const kernel = harness.runtime.kernel
    const database = kernel.db as Database
    const project = await createProject(harness)
    await harness.tool("process_define", { name: "api", command: "sleep 30" }, project.id)
    const store = createProjectStore({ kernel })
    const spec = store.getProcessSpecByName({ projectId: project.id, name: "api" })
    if (!spec) throw new Error("spec missing")
    const crashed = createWorkState({ database })
    crashed.beginEffect({
      turnId: "turn-9",
      threadId: "thread-test",
      key: spec.id,
      description: "api",
      effectId: "lost",
    })
    const supervisor = createSupervisor({ kernel, store, recoverBefore: Date.now() + 1000 })
    await supervisor.cleanupOrphans()
    await supervisor.cleanupOrphans()
    const journal = database.query("SELECT COUNT(*) AS n FROM work_journal WHERE kind = 'uncertain'").get()
    expect(journal).toEqual({ n: 1 })
    const notices = database
      .query("SELECT text FROM messages WHERE thread_id = 'thread-test' AND kind = 'notice'")
      .all() as Array<{ text: string }>
    expect(notices.map((notice) => notice.text)).toEqual([
      "Não foi possível confirmar se o processo api chegou a iniciar; verifique antes de repetir.",
    ])
    const blocked = await supervisor.start({
      project:
        store.getProject(project.id) ??
        (() => {
          throw new Error("project missing")
        })(),
      spec,
      waitMs: 5000,
      scope: { turnId: null, threadId: null, automatic: true },
    })
    expect(blocked).toMatchObject({ success: false, errorCode: "PROCESS_START_FAILED" })
    expect(createWorkState({ database }).isBlocked({ key: spec.id })).toBe(true)
    const explicit = await supervisor.start({
      project:
        store.getProject(project.id) ??
        (() => {
          throw new Error("project missing")
        })(),
      spec,
      waitMs: 5000,
    })
    expect(explicit.success).toBe(true)
    expect(createWorkState({ database }).isBlocked({ key: spec.id })).toBe(false)
    await supervisor.stopAll()
  } finally {
    await harness.close()
  }
}, 30_000)
