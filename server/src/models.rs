#[derive(Debug, Clone)]
pub struct FileRecord {
    pub vault_id: String,
    pub path: String,
    pub hash: String,
    pub payload_hash: String,
    pub content_format: String,
    pub version: i64,
    pub deleted: bool,
}

#[derive(Debug, Clone)]
pub struct ChangeRecord {
    pub seq: i64,
    pub vault_id: String,
    pub device_id: String,
    pub path: String,
    pub version: i64,
    pub deleted: bool,
}

#[derive(Debug, Clone)]
pub struct DeviceRecord {
    pub device_id: String,
    pub first_seen_at: String,
    pub last_seen_at: String,
}

#[derive(Debug, Clone)]
pub struct VaultRecord {
    pub vault_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub device_count: i64,
    pub e2ee_fingerprint: Option<String>,
}

#[derive(Debug, Clone)]
pub struct FileVersionRecord {
    pub vault_id: String,
    pub path: String,
    pub version: i64,
    pub hash: String,
    pub payload_hash: String,
    pub content_format: String,
    pub deleted: bool,
    pub created_at: String,
}
