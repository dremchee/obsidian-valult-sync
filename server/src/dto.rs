use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct UploadRequest {
    pub vault_id: String,
    pub device_id: String,
    pub path: String,
    pub content_b64: String,
    pub hash: String,
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
