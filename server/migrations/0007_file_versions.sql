CREATE TABLE file_versions (
  vault_id TEXT NOT NULL,
  path TEXT NOT NULL,
  version INTEGER NOT NULL,
  hash TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  content_format TEXT NOT NULL DEFAULT 'plain',
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (vault_id, path, version)
);

CREATE INDEX idx_file_versions_lookup
  ON file_versions(vault_id, path, version DESC);
