ALTER TABLE changes RENAME TO changes_old;

CREATE TABLE changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  vault_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  path TEXT NOT NULL,
  version INTEGER NOT NULL,
  deleted INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO changes (seq, vault_id, device_id, path, version, deleted, updated_at)
SELECT seq, vault_id, 'unknown', path, version, deleted, updated_at
FROM changes_old;

DROP TABLE changes_old;

CREATE INDEX idx_changes_seq ON changes(seq);
CREATE INDEX idx_changes_vault_seq ON changes(vault_id, seq);
CREATE INDEX idx_changes_vault_path ON changes(vault_id, path);
