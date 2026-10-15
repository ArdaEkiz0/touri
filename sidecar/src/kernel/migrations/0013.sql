CREATE TABLE IF NOT EXISTS work_journal (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_id TEXT NOT NULL,
  effect_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('intent', 'identity', 'result', 'uncertain', 'acknowledged')),
  payload TEXT NOT NULL,
  prev_checksum TEXT NOT NULL,
  checksum TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS work_journal_turn ON work_journal(turn_id, seq);
CREATE INDEX IF NOT EXISTS work_journal_effect ON work_journal(effect_id, seq);
CREATE TABLE IF NOT EXISTS work_roots (
  turn_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  root TEXT NOT NULL,
  effect_count INTEGER NOT NULL,
  manifest TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  PRIMARY KEY (turn_id, version)
);
UPDATE schema_meta SET value = '13' WHERE key = 'schema_version';
