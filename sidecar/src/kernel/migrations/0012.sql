-- Applied with foreign_keys OFF outside the atomic rebuild transaction.
CREATE TABLE bots_opencode (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  title             TEXT,
  description       TEXT,
  color             TEXT,
  avatar_path       TEXT,
  instructions      TEXT NOT NULL DEFAULT '',     -- SOUL; mirrored to <botHome>/SOUL.md
  instructions_hash TEXT NOT NULL DEFAULT '',
  provider          TEXT NOT NULL CHECK (provider IN ('codex','claude','opencode')),
  model             TEXT,                         -- NULL = CLI default
  reasoning_effort  TEXT CHECK (reasoning_effort IN ('low','medium','high','xhigh')),
  access            TEXT NOT NULL DEFAULT 'workspace-write'
                    CHECK (access IN ('read-only','workspace-write','full')),
  approvals         TEXT NOT NULL DEFAULT 'on-request'
                    CHECK (approvals IN ('never','on-request')),
  project_id        TEXT REFERENCES projects(id) ON DELETE SET NULL,
  cwd               TEXT,                         -- absolute; NULL = project.path, else bot home
  home_dir          TEXT NOT NULL,                -- <appData>/bots/<id>
  main_thread_id    TEXT,                         -- set after the main thread is created
  browser_enabled   INTEGER NOT NULL DEFAULT 1,
  computer_use      INTEGER NOT NULL DEFAULT 0,   -- per-bot opt-in, default off
  notifications     TEXT NOT NULL DEFAULT 'failures' CHECK (notifications IN ('all','failures','none')),
  section           TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  paused            INTEGER NOT NULL DEFAULT 0,
  source            TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local','legacy')),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  archived_at       INTEGER,
  avatar_shape TEXT,
  avatar_seed TEXT,
  machine TEXT NOT NULL DEFAULT 'local' CHECK(machine IN ('local','vm')),
  machine_idle_minutes INTEGER NOT NULL DEFAULT 15 CHECK(machine_idle_minutes BETWEEN 1 AND 1440),
  vm_provider_login INTEGER NOT NULL DEFAULT 0 CHECK(vm_provider_login IN (0,1)),
  host_computer_use INTEGER NOT NULL DEFAULT 0 CHECK(host_computer_use IN (0,1)),
  role_line TEXT,
  cloud_target INTEGER NOT NULL DEFAULT 0 CHECK(cloud_target IN (0,1))
);
INSERT INTO bots_opencode (id, name, title, description, color, avatar_path, instructions, instructions_hash, provider, model, reasoning_effort, access, approvals, project_id, cwd, home_dir, main_thread_id, browser_enabled, computer_use, notifications, section, sort_order, paused, source, created_at, updated_at, archived_at, avatar_shape, avatar_seed, machine, machine_idle_minutes, vm_provider_login, host_computer_use, role_line, cloud_target)
  SELECT id, name, title, description, color, avatar_path, instructions, instructions_hash, provider, model, reasoning_effort, access, approvals, project_id, cwd, home_dir, main_thread_id, browser_enabled, computer_use, notifications, section, sort_order, paused, source, created_at, updated_at, archived_at, avatar_shape, avatar_seed, machine, machine_idle_minutes, vm_provider_login, host_computer_use, role_line, cloud_target FROM bots;
DROP TABLE bots;
ALTER TABLE bots_opencode RENAME TO bots;
CREATE TABLE provider_sessions_opencode (
  id                  TEXT PRIMARY KEY,
  thread_id           TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL CHECK (provider IN ('codex','claude','opencode')),
  external_session_id TEXT NOT NULL,              -- codex threadId / claude session_id
  rollout_path        TEXT,                       -- codex rollout file when resuming by path
  fingerprint         TEXT NOT NULL,              -- SessionFingerprint hash
  state               TEXT NOT NULL CHECK (state IN ('active','replaced','failed')),
  model               TEXT,
  created_at          INTEGER NOT NULL,
  last_used_at        INTEGER NOT NULL
);
INSERT INTO provider_sessions_opencode (id, thread_id, provider, external_session_id, rollout_path, fingerprint, state, model, created_at, last_used_at)
  SELECT id, thread_id, provider, external_session_id, rollout_path, fingerprint, state, model, created_at, last_used_at FROM provider_sessions;
DROP TABLE provider_sessions;
ALTER TABLE provider_sessions_opencode RENAME TO provider_sessions;
CREATE UNIQUE INDEX provider_sessions_active ON provider_sessions(thread_id, provider) WHERE state = 'active';
INSERT OR REPLACE INTO schema_meta(key,value) VALUES ('opencode_provider_version','1'), ('schema_version','12');
