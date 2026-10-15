-- Renames the importer source label stored in data (the legacy app importer).
-- Applied after legacySourceRebuild has rebuilt the tables whose CHECK constraints
-- accepted the previous label; every non-local label is the one importer.
UPDATE import_records
  SET source = CASE WHEN source LIKE '%identity%' THEN 'legacy-identity-v1' ELSE 'legacy' END
  WHERE source NOT IN ('legacy', 'legacy-identity-v1');
UPDATE imports SET source = 'legacy' WHERE source <> 'legacy';
DELETE FROM settings WHERE key LIKE 'imports.%.expiry.cursor' AND key <> 'imports.legacy.expiry.cursor';
INSERT OR REPLACE INTO schema_meta(key,value) VALUES ('legacy_source_version','1'), ('schema_version','14');
