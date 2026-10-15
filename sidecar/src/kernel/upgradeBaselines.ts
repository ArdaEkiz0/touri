import type { Database } from "bun:sqlite"

export type UpgradeBaselinesArgs = { database: Database; now?: () => number }

const MARKER = "security_upgrade_baselines"

type BotRow = { id: string; access: string; machine: string }
type ProcessRow = { id: string; project_id: string }
type CandidateRow = { id: string }

const insertSetting = (database: Database, key: string, value: unknown, at: number): void => {
  database
    .query("INSERT OR IGNORE INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)")
    .run(key, JSON.stringify(value), at)
}

const trustMemory = (database: Database, at: number): void => {
  const bots = database
    .query("SELECT id, access, CASE WHEN cloud_target = 1 THEN 'cloud' ELSE machine END AS machine FROM bots")
    .all() as BotRow[]
  for (const bot of bots)
    insertSetting(
      database,
      `memory-trust:${bot.id}`,
      { access: bot.access, machine: bot.machine, review: false, hash: "" },
      at,
    )
}

const ownerCandidates = (database: Database, projectId: string): CandidateRow[] =>
  database
    .query(
      "SELECT id FROM bots WHERE project_id = ? AND archived_at IS NULL AND machine = 'local' AND cloud_target = 0 AND access != 'read-only'",
    )
    .all(projectId) as CandidateRow[]

const assignProcessOwners = (database: Database, at: number): void => {
  const orphans = database
    .query(
      "SELECT id, project_id FROM processes WHERE created_by = 'agent' AND vm_bot_id IS NULL AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'process-owner:' || processes.id)",
    )
    .all() as ProcessRow[]
  for (const process of orphans) {
    const candidates = ownerCandidates(database, process.project_id)
    const [only] = candidates
    if (only && candidates.length === 1)
      insertSetting(database, `process-owner:${process.id}`, { botId: only.id, machine: "local" }, at)
  }
}

/**
 * One-time, persisted decisions for data that exists before the security hardening.
 *
 * - Memory a bot already used at its current access and machine is the trusted
 *   baseline; only later privilege increases quarantine it.
 * - A process an agent defined with exactly one eligible local bot in its project is
 *   owned by that bot. Ambiguous ones stay unowned and need an explicit user edit.
 *
 * Fresh installs have no bots, so they only record the marker.
 */
export const applyUpgradeBaselines = ({ database, now = Date.now }: UpgradeBaselinesArgs): void => {
  database.transaction(() => {
    if (database.query("SELECT 1 FROM schema_meta WHERE key = ?").get(MARKER)) return
    const at = now()
    trustMemory(database, at)
    assignProcessOwners(database, at)
    database.query("INSERT OR IGNORE INTO schema_meta(key, value) VALUES (?, '1')").run(MARKER)
  })()
}
