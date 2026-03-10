use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct UploadRequest {
    pub vault_id: String,
    pub device_id: String,
    pub path: String,
    pub content_b64: String,
    pub hash: String,
    pub payload_hash: Option<String>,
    pub content_format: Option<String>,
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
    pub content_format: String,
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
pub struct DeviceItem {
    pub device_id: String,
    pub first_seen_at: String,
    pub last_seen_at: String,
}

#[derive(Debug, Serialize)]
pub struct DevicesResponse {
    pub devices: Vec<DeviceItem>,
}
