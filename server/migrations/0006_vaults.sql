CREATE TABLE vaults (
  vault_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO vaults (vault_id, created_at, updated_at)
SELECT vault_id, MIN(updated_at) AS created_at, MAX(updated_at) AS updated_at
FROM (
  SELECT vault_id, updated_at FROM files
  UNION ALL
  SELECT vault_id, updated_at FROM changes
  UNION ALL
  SELECT vault_id, first_seen_at AS updated_at FROM devices
  UNION ALL
  SELECT vault_id, last_seen_at AS updated_at FROM devices
)
GROUP BY vault_id;

CREATE INDEX idx_vaults_updated_at ON vaults(updated_at DESC);
