DROP TABLE IF EXISTS file_versions;
DROP TABLE IF EXISTS changes;
DROP TABLE IF EXISTS files;

ALTER TABLE vaults RENAME TO vaults_old;

CREATE TABLE vaults (
  vault_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO vaults (vault_id, created_at, updated_at)
SELECT vault_id, created_at, updated_at
FROM vaults_old;

DROP TABLE vaults_old;

CREATE INDEX idx_vaults_updated_at ON vaults(updated_at DESC);
