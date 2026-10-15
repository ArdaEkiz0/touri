-- Additive migration: keep message trees, runs, FTS and imported identifiers intact.
ALTER TABLE threads ADD COLUMN generation INTEGER NOT NULL DEFAULT 1;
ALTER TABLE threads ADD COLUMN updated_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN generation INTEGER NOT NULL DEFAULT 1;
ALTER TABLE messages ADD COLUMN updated_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN client_nonce TEXT;
ALTER TABLE messages ADD COLUMN delivery_status TEXT CHECK (delivery_status IN ('queued','sent','acked','failed'));
ALTER TABLE messages ADD COLUMN delivery_deadline INTEGER;

CREATE TABLE transcript_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  generation INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  at INTEGER NOT NULL,
  UNIQUE(thread_id, seq)
);
-- These bounds are opened only inside the compactor's transaction and reset before commit.
CREATE TABLE transcript_maintenance (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  delete_before_id INTEGER NOT NULL DEFAULT 0,
  ui_delete_before_seq INTEGER NOT NULL DEFAULT 0,
  projection_write INTEGER NOT NULL DEFAULT 0
);
INSERT INTO transcript_maintenance(id) VALUES (1);
CREATE TABLE transcript_retention (
  thread_id TEXT PRIMARY KEY,
  through_seq INTEGER NOT NULL
);
CREATE INDEX transcript_delta_message ON transcript_entries(thread_id, json_extract(event_json, '$.messageId'), seq)
  WHERE json_extract(event_json, '$.type') = 'message.delta';
CREATE TRIGGER transcript_no_update BEFORE UPDATE ON transcript_entries BEGIN
  SELECT RAISE(ABORT, 'Transcript entries are immutable');
END;
CREATE TRIGGER transcript_no_delete BEFORE DELETE ON transcript_entries
WHEN OLD.id > (SELECT delete_before_id FROM transcript_maintenance WHERE id = 1) BEGIN
  SELECT RAISE(ABORT, 'Transcript entries are immutable');
END;

CREATE TABLE ui_event_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  event_json TEXT NOT NULL
);
CREATE TRIGGER ui_event_no_update BEFORE UPDATE ON ui_event_log BEGIN
  SELECT RAISE(ABORT, 'Event entries are immutable');
END;
CREATE TRIGGER ui_event_no_delete BEFORE DELETE ON ui_event_log
WHEN OLD.seq > (SELECT ui_delete_before_seq FROM transcript_maintenance WHERE id = 1) BEGIN
  SELECT RAISE(ABORT, 'Event entries are immutable');
END;

CREATE TABLE send_journal (
  thread_id TEXT NOT NULL REFERENCES threads(id),
  client_nonce TEXT NOT NULL,
  request_json TEXT NOT NULL,
  message_id TEXT NOT NULL,
  deadline INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','sent','acked','failed')),
  run_id TEXT REFERENCES runs(id),
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(thread_id, client_nonce)
);
CREATE INDEX send_journal_pending ON send_journal(status, created_at);

CREATE TABLE tool_resolutions (
  run_id TEXT NOT NULL REFERENCES runs(id),
  call_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  part_json TEXT NOT NULL,
  resolution TEXT NOT NULL CHECK (resolution IN ('running','succeeded','failed','canceled','interrupted','unknown')),
  resolved_at INTEGER,
  PRIMARY KEY(run_id, call_id)
);

WITH ordered AS (
  SELECT thread_id, id, ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY created_at, rowid) AS n FROM messages
)
UPDATE messages SET seq = ordered.n, updated_seq = ordered.n
FROM ordered WHERE messages.thread_id = ordered.thread_id AND messages.id = ordered.id;
UPDATE threads SET updated_seq = COALESCE((SELECT MAX(seq) FROM messages WHERE thread_id = threads.id), 0);

CREATE VIEW transcript_message_events AS
SELECT thread_id, id, updated_seq, generation, updated_at,
  json_object('message', json_object(
    'id', id, 'threadId', thread_id, 'parentId', parent_id, 'role', role,
    'kind', kind, 'status', status, 'runId', run_id, 'text', text,
    'parts', json(parts_json), 'sender', json(sender_json), 'source', source,
    'createdAt', created_at, 'updatedAt', updated_at,
    'seq', seq, 'generation', generation, 'updatedSeq', updated_seq,
    'delivery', CASE WHEN client_nonce IS NULL THEN NULL ELSE json_object(
      'clientNonce', client_nonce, 'status', delivery_status, 'deadline', delivery_deadline
    ) END
  )) AS payload
FROM messages;

INSERT INTO transcript_entries(thread_id, seq, generation, event_json, at)
SELECT thread_id, updated_seq, generation, json_set(payload, '$.type', 'message.created'), updated_at
FROM transcript_message_events ORDER BY thread_id, updated_seq;

CREATE TRIGGER messages_transcript_insert AFTER INSERT ON messages BEGIN
  UPDATE threads SET updated_seq = updated_seq + 1 WHERE id = NEW.thread_id;
  UPDATE messages SET seq = (SELECT updated_seq FROM threads WHERE id = NEW.thread_id),
    updated_seq = (SELECT updated_seq FROM threads WHERE id = NEW.thread_id),
    generation = (SELECT generation FROM threads WHERE id = NEW.thread_id)
    WHERE thread_id = NEW.thread_id AND id = NEW.id;
  INSERT INTO transcript_entries(thread_id, seq, generation, event_json, at)
    SELECT thread_id, updated_seq, generation, json_set(payload, '$.type', 'message.created'), updated_at
    FROM transcript_message_events WHERE thread_id = NEW.thread_id AND id = NEW.id;
END;

CREATE TRIGGER messages_transcript_update
AFTER UPDATE OF parent_id, role, kind, status, run_id, text, parts_json, sender_json, source, client_nonce, delivery_status, delivery_deadline ON messages
WHEN (SELECT projection_write FROM transcript_maintenance WHERE id = 1) = 0
BEGIN
  UPDATE threads SET updated_seq = updated_seq + 1 WHERE id = NEW.thread_id;
  UPDATE messages SET updated_seq = (SELECT updated_seq FROM threads WHERE id = NEW.thread_id),
    generation = (SELECT generation FROM threads WHERE id = NEW.thread_id)
    WHERE thread_id = NEW.thread_id AND id = NEW.id;
  INSERT INTO transcript_entries(thread_id, seq, generation, event_json, at)
    SELECT thread_id, updated_seq, generation, json_set(payload, '$.type', 'message.updated'), updated_at
    FROM transcript_message_events WHERE thread_id = NEW.thread_id AND id = NEW.id;
END;

CREATE TRIGGER run_transcript_generation AFTER UPDATE OF status ON runs
WHEN NEW.status = 'starting' AND OLD.status = 'queued'
BEGIN
  UPDATE threads SET generation = generation + 1 WHERE id = NEW.thread_id;
END;
INSERT INTO schema_meta(key, value) VALUES ('transcript_version', '1');
INSERT INTO schema_meta(key, value) VALUES ('transcript_event_checkpoint', '0');
INSERT INTO schema_meta(key, value) VALUES ('ui_event_floor_seq', '0');
UPDATE schema_meta SET value = '7' WHERE key = 'schema_version';
