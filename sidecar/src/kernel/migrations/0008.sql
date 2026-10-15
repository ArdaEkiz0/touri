-- Original multi-bot rooms. Existing bot conversations and sessions are unchanged.
CREATE TABLE bot_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  avatar_shape TEXT NOT NULL,
  avatar_seed TEXT NOT NULL,
  coordinator_bot_id TEXT REFERENCES bots(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE group_members (
  group_id TEXT NOT NULL REFERENCES bot_groups(id) ON DELETE CASCADE,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (group_id, bot_id),
  UNIQUE (group_id, position)
);
ALTER TABLE threads ADD COLUMN group_id TEXT REFERENCES bot_groups(id);
ALTER TABLE threads ADD COLUMN group_thread_id TEXT REFERENCES threads(id);
CREATE UNIQUE INDEX group_bot_session ON threads(group_thread_id, bot_id) WHERE group_thread_id IS NOT NULL;
CREATE INDEX group_threads ON threads(group_id, group_thread_id);
CREATE TABLE group_turns (
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  group_id TEXT NOT NULL REFERENCES bot_groups(id),
  recipients_json TEXT NOT NULL
);
CREATE TABLE group_run_links (
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  turn_id TEXT NOT NULL REFERENCES group_turns(run_id),
  depth INTEGER NOT NULL
);
CREATE TABLE group_message_links (
  message_id TEXT NOT NULL,
  source_thread_id TEXT NOT NULL REFERENCES threads(id),
  visible_message_id TEXT NOT NULL,
  PRIMARY KEY (source_thread_id, message_id)
);
INSERT INTO schema_meta(key, value) VALUES ('groups_version', '1');
UPDATE schema_meta SET value = '8' WHERE key = 'schema_version';
