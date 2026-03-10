ALTER TABLE files RENAME TO files_old;

CREATE TABLE files (
  vault_id TEXT NOT NULL,
  path TEXT NOT NULL,
  hash TEXT NOT NULL,
  version INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (vault_id, path)
);

INSERT INTO files (vault_id, path, hash, version, deleted, updated_at)
SELECT 'default', path, hash, version, deleted, updated_at
FROM files_old;

DROP TABLE files_old;

ALTER TABLE changes RENAME TO changes_old;

CREATE TABLE changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  vault_id TEXT NOT NULL,
  path TEXT NOT NULL,
  version INTEGER NOT NULL,
  deleted INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO changes (seq, vault_id, path, version, deleted, updated_at)
SELECT seq, 'default', path, version, deleted, updated_at
FROM changes_old;

DROP TABLE changes_old;

CREATE INDEX idx_changes_seq ON changes(seq);
CREATE INDEX idx_changes_vault_seq ON changes(vault_id, seq);
CREATE INDEX idx_changes_vault_path ON changes(vault_id, path);
