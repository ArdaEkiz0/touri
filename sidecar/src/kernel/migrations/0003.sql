-- Persist procedural avatar identity independently from bot names and runtime moods.
ALTER TABLE bots ADD COLUMN avatar_shape TEXT;
ALTER TABLE bots ADD COLUMN avatar_seed TEXT;
INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('avatar_identity_version', '1');
