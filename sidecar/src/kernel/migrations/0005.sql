ALTER TABLE bots ADD COLUMN role_line TEXT;
INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('bot_role_version', '1');
UPDATE schema_meta SET value = '5' WHERE key = 'schema_version';
