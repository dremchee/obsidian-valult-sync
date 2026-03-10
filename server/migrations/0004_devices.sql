CREATE TABLE devices (
  vault_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (vault_id, device_id)
);

INSERT INTO devices (vault_id, device_id, first_seen_at, last_seen_at)
SELECT
  vault_id,
  device_id,
  MIN(updated_at) AS first_seen_at,
  MAX(updated_at) AS last_seen_at
FROM changes
GROUP BY vault_id, device_id;

CREATE INDEX idx_devices_vault_last_seen ON devices(vault_id, last_seen_at DESC);
