-- Preserve the shipped local/vm CHECK and all existing bots.
ALTER TABLE bots ADD COLUMN cloud_target INTEGER NOT NULL DEFAULT 0 CHECK(cloud_target IN (0,1));
CREATE TABLE cloud_machines (bot_id TEXT PRIMARY KEY REFERENCES bots(id), base_url TEXT NOT NULL, account_id TEXT NOT NULL, machine_id TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 0);
CREATE TABLE cloud_runs (run_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id));
UPDATE schema_meta SET value = '9' WHERE key = 'schema_version';
