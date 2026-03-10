#[derive(Debug, Clone)]
pub struct FileRecord {
    pub vault_id: String,
    pub path: String,
    pub hash: String,
    pub version: i64,
    pub deleted: bool,
}

#[derive(Debug, Clone)]
pub struct ChangeRecord {
    pub seq: i64,
    pub vault_id: String,
    pub path: String,
    pub version: i64,
    pub deleted: bool,
}
