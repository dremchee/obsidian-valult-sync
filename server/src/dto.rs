use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum ContentFormat {
    #[serde(rename = "plain")]
    Plain,
    #[serde(rename = "e2ee-envelope-v1")]
    E2eeEnvelopeV1,
}

#[derive(Debug, Deserialize)]
pub struct UploadRequest {
    pub vault_id: String,
    pub device_id: String,
    pub path: String,
    pub content_b64: String,
    pub hash: String,
    pub payload_hash: String,
    pub content_format: ContentFormat,
    pub base_version: i64,
}

#[derive(Debug, Deserialize)]
pub struct DeleteRequest {
    pub vault_id: String,
    pub device_id: String,
    pub path: String,
    pub base_version: i64,
}

#[derive(Debug, Serialize)]
pub struct MutationResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_version: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct FileResponse {
    pub path: String,
    pub hash: String,
    pub version: i64,
    pub deleted: bool,
    pub content_b64: Option<String>,
    pub content_format: ContentFormat,
}

#[derive(Debug, Serialize)]
pub struct ChangeItem {
    pub seq: i64,
    pub device_id: String,
    pub path: String,
    pub version: i64,
    pub deleted: bool,
}

#[derive(Debug, Serialize)]
pub struct ChangesResponse {
    pub changes: Vec<ChangeItem>,
    pub latest_seq: i64,
}

#[derive(Debug, Serialize)]
pub struct RealtimeEvent {
    pub latest_seq: i64,
}

#[derive(Debug, Serialize)]
pub struct FileVersionItem {
    pub version: i64,
    pub hash: String,
    pub payload_hash: String,
    pub content_format: ContentFormat,
    pub deleted: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct FileHistoryResponse {
    pub path: String,
    pub versions: Vec<FileVersionItem>,
}

#[derive(Debug, Serialize)]
pub struct DeviceItem {
    pub device_id: String,
    pub first_seen_at: String,
    pub last_seen_at: String,
}

#[derive(Debug, Serialize)]
pub struct DevicesResponse {
    pub devices: Vec<DeviceItem>,
}

#[derive(Debug, Deserialize)]
pub struct CreateVaultRequest {
    pub vault_id: String,
    #[serde(default)]
    pub e2ee_fingerprint: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RestoreFileRequest {
    pub vault_id: String,
    pub device_id: String,
    pub path: String,
    pub target_version: i64,
    pub base_version: i64,
}

#[derive(Debug, Serialize)]
pub struct VaultItem {
    pub vault_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub device_count: i64,
    pub e2ee_fingerprint: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct VaultsResponse {
    pub vaults: Vec<VaultItem>,
}

#[derive(Debug, Serialize)]
pub struct SnapshotFileItem {
    pub path: String,
    pub hash: String,
    pub version: i64,
    pub deleted: bool,
    pub content_format: ContentFormat,
}

#[derive(Debug, Serialize)]
pub struct VaultSnapshotResponse {
    pub latest_seq: i64,
    pub files: Vec<SnapshotFileItem>,
}

#[derive(Debug, Serialize)]
pub struct CreateVaultResponse {
    pub ok: bool,
    pub created: bool,
    pub vault: VaultItem,
}
