import type { Database } from "bun:sqlite"

export type LegacyLocalIdArgs = { database: Database; origin: string; kind: string; sourceId: string }

const LEDGER_KINDS: readonly string[] = ["bot", "thread", "routine", "routine_run"]

const ledgerId = ({ database, origin, kind, sourceId }: LegacyLocalIdArgs): string | null => {
  const row = database
    .query(
      "SELECT r.local_id FROM import_records r JOIN imports i ON i.id = r.import_id WHERE r.source = 'legacy' AND r.source_kind = ? AND r.source_id = ? AND i.origin = ?",
    )
    .get(kind, sourceId, origin) as { local_id: string } | null

  return row?.local_id ?? null
}

const parsePair = (sourceId: string): [string, string] | null => {
  try {
    const value = JSON.parse(sourceId) as unknown

    return Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "string"
      ? [value[0], value[1]]
      : null
  } catch {
    return null
  }
}

const importedThread = (database: Database, origin: string, threadId: string): boolean =>
  !!database
    .query(
      "SELECT 1 FROM import_records r JOIN imports i ON i.id = r.import_id WHERE r.source = 'legacy' AND r.source_kind = 'thread' AND r.local_id = ? AND i.origin = ?",
    )
    .get(threadId, origin)

const legacyRun = ({ database, origin, sourceId }: LegacyLocalIdArgs): string | null => {
  const id = `legacy-${sourceId}`
  const row = database.query("SELECT thread_id FROM runs WHERE id = ? AND trigger = 'import'").get(id) as {
    thread_id: string
  } | null

  return row && importedThread(database, origin, row.thread_id) ? id : null
}

const legacySession = ({ database, origin, sourceId }: LegacyLocalIdArgs): string | null => {
  const pair = parsePair(sourceId)
  const id = pair ? `legacy-codex-${pair[0]}` : null
  const row = id
    ? (database.query("SELECT thread_id FROM provider_sessions WHERE id = ?").get(id) as { thread_id: string } | null)
    : null

  return id && row && importedThread(database, origin, row.thread_id) ? id : null
}

const legacyMessage = (args: LegacyLocalIdArgs): string | null => {
  const pair = parsePair(args.sourceId)

  return pair ? ledgerId({ ...args, sourceId: `${pair[0]}:${pair[1]}` }) : null
}

/**
 * Local ID an earlier, unscoped import already gave a source object, proven by the
 * import ledger entry of the same origin. Anything without that proof is never
 * adopted, so a crafted source cannot claim an existing local object.
 */
export const legacyLocalId = (args: LegacyLocalIdArgs): string | null => {
  if (LEDGER_KINDS.includes(args.kind)) return ledgerId(args)
  if (args.kind === "message") return legacyMessage(args)
  if (args.kind === "run") return legacyRun(args)
  if (args.kind === "codex_session") return legacySession(args)

  return null
}
