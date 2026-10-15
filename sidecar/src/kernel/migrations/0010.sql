CREATE TABLE rejections (
  thread_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  generation INTEGER NOT NULL,
  record_json TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY(thread_id, seq)
);

-- Expand terminal dispositions without changing historical call identifiers or results.
ALTER TABLE tool_resolutions RENAME TO tool_resolutions_previous;
CREATE TABLE tool_resolutions (
  run_id TEXT NOT NULL REFERENCES runs(id),
  call_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  part_json TEXT NOT NULL,
  resolution TEXT NOT NULL CHECK (resolution IN (
    'running','succeeded','failed','canceled','interrupted','unknown',
    'cancelled_by_user','interrupted_by_restart','completed_unobserved'
  )),
  resolved_at INTEGER,
  PRIMARY KEY(run_id, call_id)
);
INSERT INTO tool_resolutions SELECT * FROM tool_resolutions_previous;
DROP TABLE tool_resolutions_previous;
CREATE INDEX tool_resolutions_thread ON tool_resolutions(thread_id);
INSERT INTO schema_meta(key, value) VALUES ('transcript_recovery_version', '1');
UPDATE schema_meta SET value = '10' WHERE key = 'schema_version';
