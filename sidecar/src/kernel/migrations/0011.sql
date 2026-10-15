CREATE TABLE IF NOT EXISTS problem_reports (
  id TEXT NOT NULL,
  date INTEGER NOT NULL,
  title TEXT NOT NULL,
  destination TEXT NOT NULL CHECK (destination IN ('zip', 'github', 'cloud')),
  PRIMARY KEY (id, destination)
);
CREATE INDEX IF NOT EXISTS problem_reports_date ON problem_reports(date DESC);
UPDATE schema_meta SET value = '11' WHERE key = 'schema_version';
