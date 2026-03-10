CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  version INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  version INTEGER NOT NULL,
  deleted INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_changes_seq ON changes(seq);
CREATE INDEX IF NOT EXISTS idx_changes_path ON changes(path);
