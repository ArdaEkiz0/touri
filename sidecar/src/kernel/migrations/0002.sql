-- Notifications (attention items and informational messages) plus the ordered log that backs the resumable SSE stream.
CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,
  level       TEXT NOT NULL,
  bot_id      TEXT,
  thread_id   TEXT,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  request_id  TEXT,
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER,
  resolution  TEXT
);
CREATE INDEX IF NOT EXISTS notifications_created ON notifications(created_at);
CREATE INDEX IF NOT EXISTS notifications_request ON notifications(request_id);
CREATE INDEX IF NOT EXISTS notifications_thread ON notifications(thread_id, resolved_at);

CREATE TABLE IF NOT EXISTS notification_log (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  type            TEXT NOT NULL CHECK (type IN ('notify','resolved')),
  notification_id INTEGER NOT NULL,
  at              INTEGER NOT NULL
);
