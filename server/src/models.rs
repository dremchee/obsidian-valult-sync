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
}

#[derive(Debug, Clone)]
pub struct DocumentRecord {
    pub vault_id: String,
    pub path: String,
    pub content_b64: String,
    pub hash: String,
    pub version: i64,
    pub deleted: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct DocumentVersionRecord {
    pub vault_id: String,
    pub path: String,
    pub version: i64,
    pub content_b64: String,
    pub hash: String,
    pub deleted: bool,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct DocumentChangeRecord {
    pub seq: i64,
    pub vault_id: String,
    pub device_id: String,
    pub path: String,
    pub version: i64,
    pub deleted: bool,
}
