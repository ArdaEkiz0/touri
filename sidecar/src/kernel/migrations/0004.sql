ALTER TABLE bots ADD COLUMN machine TEXT NOT NULL DEFAULT 'local' CHECK(machine IN ('local','vm'));
ALTER TABLE bots ADD COLUMN machine_idle_minutes INTEGER NOT NULL DEFAULT 15 CHECK(machine_idle_minutes BETWEEN 1 AND 1440);
ALTER TABLE bots ADD COLUMN vm_provider_login INTEGER NOT NULL DEFAULT 0 CHECK(vm_provider_login IN (0,1));
ALTER TABLE bots ADD COLUMN host_computer_use INTEGER NOT NULL DEFAULT 0 CHECK(host_computer_use IN (0,1));
CREATE TABLE bot_machines (bot_id TEXT PRIMARY KEY REFERENCES bots(id), vm_id TEXT NOT NULL UNIQUE, volume TEXT NOT NULL, project_id TEXT, created_ms REAL, start_ms REAL);
ALTER TABLE processes ADD COLUMN vm_bot_id TEXT REFERENCES bots(id);
UPDATE schema_meta SET value = '4' WHERE key = 'schema_version';
