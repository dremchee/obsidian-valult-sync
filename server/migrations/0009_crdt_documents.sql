CREATE TABLE documents (
  vault_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content_b64 TEXT NOT NULL,
  hash TEXT NOT NULL,
  version INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (vault_id, path)
);

CREATE TABLE document_versions (
  vault_id TEXT NOT NULL,
  path TEXT NOT NULL,
  version INTEGER NOT NULL,
  content_b64 TEXT NOT NULL,
  hash TEXT NOT NULL,
  deleted INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (vault_id, path, version)
);

CREATE TABLE document_changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  vault_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  path TEXT NOT NULL,
  version INTEGER NOT NULL,
  deleted INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_document_changes_seq ON document_changes(seq);
CREATE INDEX idx_document_changes_vault_seq ON document_changes(vault_id, seq);
CREATE INDEX idx_document_changes_vault_path ON document_changes(vault_id, path);
