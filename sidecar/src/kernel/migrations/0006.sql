CREATE TABLE IF NOT EXISTS bot_mcp_servers (
  bot_id TEXT NOT NULL REFERENCES bots(id),
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  PRIMARY KEY (bot_id, name)
);
UPDATE schema_meta SET value = '6' WHERE key = 'schema_version';
