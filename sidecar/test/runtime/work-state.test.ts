import type { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase, SCHEMA_VERSION } from "../../src/kernel/db"
import { uncertainEffectText } from "../../src/runtime/work-notice"
import {
  createWorkState,
  type WorkEffect,
  type WorkObservation,
  type WorkRecordKind,
  type WorkStateHooks,
} from "../../src/runtime/work-state"

const TURN = "turn-1"
const CRASH = "simulated crash"

const withDatabase = async (run: (args: { database: Database; filename: string }) => Promise<void> | void) => {
  const root = mkdtempSync(join(tmpdir(), "touri-work-state-"))
  const filename = join(root, "touri.db")
  const database = openDatabase({ filename })
  try {
    await run({ database, filename })
  } finally {
    database.close()
    rmSync(root, { recursive: true, force: true })
  }
}

const crashAfter = (kind: WorkRecordKind): WorkStateHooks => ({
  afterAppend: (record) => {
    if (record.kind === kind) throw new Error(CRASH)
  },
})

const unobservable: (effect: WorkEffect) => WorkObservation = () => ({ kind: "unobservable", reason: "gone" })

const begin = (work: ReturnType<typeof createWorkState>, effectId: string) =>
  work.beginEffect({ turnId: TURN, threadId: "thread-1", key: "proc-web", description: "web", effectId })

test("crash before spawn: intent without identity is uncertain after recovery and blocks automatic repeat", async () => {
  await withDatabase(({ database }) => {
    const crashing = createWorkState({ database, hooks: crashAfter("intent") })
    expect(begin(crashing, "e1")).toMatchObject({ success: false, error: CRASH })
    const work = createWorkState({ database })
    const recovered = work.recover({ observe: unobservable })
    expect(recovered.uncertain.map((effect) => effect.effectId)).toEqual(["e1"])
    expect(work.rebuild({ turnId: TURN })[0]).toMatchObject({ state: "uncertain", pid: null })
    expect(uncertainEffectText(recovered.uncertain[0] as WorkEffect)).toBe(
      "Não foi possível confirmar se o processo web chegou a iniciar; verifique antes de repetir.",
    )
    expect(work.isBlocked({ key: "proc-web" })).toBe(true)
    expect(work.acknowledgeKey({ key: "proc-web" })).toEqual({ success: true })
    expect(work.isBlocked({ key: "proc-web" })).toBe(false)
  })
})

test("crash after spawn: identity without a run row is uncertain, never re-spawned", async () => {
  await withDatabase(({ database }) => {
    const first = createWorkState({ database })
    begin(first, "e1")
    const crashing = createWorkState({ database, hooks: crashAfter("identity") })
    crashing.recordIdentity({ effectId: "e1", turnId: TURN, pid: 4242, pgid: 4242 })
    const work = createWorkState({ database })
    const recovered = work.recover({ observe: unobservable })
    expect(recovered.uncertain).toHaveLength(1)
    expect(work.rebuild({ turnId: TURN })[0]).toMatchObject({ state: "uncertain", pid: 4242, reason: "gone" })
    expect(uncertainEffectText(recovered.uncertain[0] as WorkEffect)).toContain("terminou; verifique antes de repetir")
  })
})

test("crash after result append: the result survives and nothing becomes uncertain", async () => {
  await withDatabase(({ database }) => {
    const work = createWorkState({ database })
    begin(work, "e1")
    work.recordIdentity({ effectId: "e1", turnId: TURN, pid: 10 })
    const crashing = createWorkState({ database, hooks: crashAfter("result") })
    expect(crashing.recordResult({ effectId: "e1", turnId: TURN, status: "exited", exitCode: 0 }).success).toBe(false)
    const recovered = createWorkState({ database }).recover({ observe: unobservable })
    expect(recovered).toMatchObject({ uncertain: [], finished: 0, truncated: 0 })
    expect(work.rebuild({ turnId: TURN })[0]).toMatchObject({ state: "finished", status: "exited", exitCode: 0 })
    expect(work.isBlocked({ key: "proc-web" })).toBe(false)
  })
})

test("recovery finishes an open effect when the outcome is observable", async () => {
  await withDatabase(({ database }) => {
    const work = createWorkState({ database })
    begin(work, "e1")
    work.recordIdentity({ effectId: "e1", turnId: TURN, pid: 10, processRunId: "run-1" })
    const recovered = work.recover({ observe: () => ({ kind: "finished", status: "stopped", exitCode: null }) })
    expect(recovered).toMatchObject({ uncertain: [], finished: 1 })
    expect(work.rebuild({ turnId: TURN })[0]).toMatchObject({ state: "finished", status: "stopped" })
  })
})

test("failed root publication leaves the prior root authoritative", async () => {
  await withDatabase(({ database }) => {
    const work = createWorkState({ database })
    begin(work, "e1")
    const prior = work.publishRoot({ turnId: TURN })
    expect(prior).toMatchObject({ success: true, changed: true, root: { version: 1, effectCount: 1 } })
    work.recordIdentity({ effectId: "e1", turnId: TURN, pid: 7 })
    const failing = createWorkState({
      database,
      hooks: {
        beforePublishRoot: () => {
          throw new Error(CRASH)
        },
      },
    })
    expect(failing.publishRoot({ turnId: TURN })).toMatchObject({ success: false, error: CRASH })
    expect(work.authoritativeRoot({ turnId: TURN })?.version).toBe(1)
    expect(work.authoritativeRoot({ turnId: TURN })?.root).toBe(prior.success ? prior.root.root : "")
    expect(work.verifyRoot({ turnId: TURN })).toBe(false)
    const next = work.publishRoot({ turnId: TURN })
    expect(next).toMatchObject({ success: true, changed: true, root: { version: 2 } })
    expect(work.verifyRoot({ turnId: TURN })).toBe(true)
    expect(work.publishRoot({ turnId: TURN })).toMatchObject({ success: true, changed: false, root: { version: 2 } })
  })
})

test("a torn tail is ignored by rebuild and truncated by recovery", async () => {
  await withDatabase(({ database }) => {
    const work = createWorkState({ database })
    begin(work, "e1")
    work.recordIdentity({ effectId: "e1", turnId: TURN, pid: 9, processRunId: "run-1" })
    const valid = database.query("SELECT COUNT(*) AS n FROM work_journal").get() as { n: number }
    database
      .query(
        "INSERT INTO work_journal (turn_id, effect_id, kind, payload, prev_checksum, checksum, at) VALUES (?, 'e1', 'result', '{\"status\":\"ex', 'bad', 'bad', 1)",
      )
      .run(TURN)
    database
      .query(
        "INSERT INTO work_journal (turn_id, effect_id, kind, payload, prev_checksum, checksum, at) VALUES (?, 'e1', 'result', '{\"status\":\"exited\",\"exitCode\":0}', 'bad', 'bad', 1)",
      )
      .run(TURN)
    expect(work.rebuild({ turnId: TURN })[0]).toMatchObject({ state: "running", status: null })
    const recovered = work.recover({ observe: unobservable })
    expect(recovered.truncated).toBe(2)
    expect(recovered.uncertain).toHaveLength(1)
    expect(database.query("SELECT COUNT(*) AS n FROM work_journal").get()).toEqual({ n: valid.n + 1 })
    expect(work.recordResult({ effectId: "e1", turnId: TURN, status: "exited", exitCode: 0 }).success).toBe(true)
    expect(work.rebuild({ turnId: TURN })[0]).toMatchObject({ state: "finished" })
  })
})

test("duplicate replay of an intent and of recovery creates no second effect", async () => {
  await withDatabase(({ database }) => {
    const work = createWorkState({ database })
    const spawns: Array<string> = []
    const spawnOnce = (effectId: string): void => {
      const intent = begin(work, effectId)
      if (intent.success && intent.fresh) spawns.push(effectId)
    }
    spawnOnce("e1")
    spawnOnce("e1")
    expect(spawns).toEqual(["e1"])
    const first = work.recover({ observe: unobservable })
    const rows = database.query("SELECT COUNT(*) AS n FROM work_journal").get()
    const second = work.recover({ observe: unobservable })
    expect(first.uncertain).toHaveLength(1)
    expect(second).toMatchObject({ uncertain: [], finished: 0, truncated: 0 })
    expect(database.query("SELECT COUNT(*) AS n FROM work_journal").get()).toEqual(rows)
    spawnOnce("e1")
    expect(spawns).toEqual(["e1"])
  })
})

test("schema 11 database upgrades to the work journal and preserves data", async () => {
  await withDatabase(({ database, filename }) => {
    database.exec(`INSERT INTO bots(id,name,provider,home_dir,created_at,updated_at) VALUES ('b','Teste','codex','/tmp',1,1);
      INSERT INTO threads(id,bot_id,title,created_at,updated_at) VALUES ('t','b','Conversa',1,1);`)
    database.exec(
      "DROP TABLE work_journal; DROP TABLE work_roots; UPDATE schema_meta SET value='11' WHERE key='schema_version'",
    )
    database.close()
    const upgraded = openDatabase({ filename })
    try {
      expect(upgraded.query("SELECT value FROM schema_meta WHERE key='schema_version'").get()).toEqual({
        value: String(SCHEMA_VERSION),
      })
      expect(upgraded.query("SELECT id, title FROM threads").all()).toEqual([{ id: "t", title: "Conversa" }])
      const work = createWorkState({ database: upgraded })
      expect(begin(work, "e1")).toMatchObject({ success: true, fresh: true })
      expect(upgraded.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" })
    } finally {
      upgraded.close()
    }
  })
})

test("recovery leaves effects created after the boot cutoff alone", async () => {
  await withDatabase(({ database }) => {
    const work = createWorkState({ database, now: () => 2000 })
    begin(work, "e1")
    expect(work.recover({ observe: unobservable, before: 1000 })).toMatchObject({ uncertain: [], finished: 0 })
    expect(work.rebuild({ turnId: TURN })[0]).toMatchObject({ state: "intent" })
    expect(work.recover({ observe: unobservable, before: 3000 }).uncertain).toHaveLength(1)
  })
})
