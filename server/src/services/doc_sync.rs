use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::Utc;
use loro::{ExportMode, LoroDoc};
use sha2::{Digest, Sha256};
use sqlx::Row;

use crate::{
    dto::{
        ChangesResponse, DocumentHistoryResponse, DocumentSnapshotResponse,
        DocumentVersionItem, MutationResponse, RestoreDocumentRequest,
    },
    error::AppError,
    models::{DocumentChangeRecord, DocumentRecord, DocumentVersionRecord},
    state::AppState,
    storage,
};

pub async fn push_document(
    state: &AppState,
    request: crate::dto::DocumentPushRequest,
) -> Result<MutationResponse, AppError> {
    let data = STANDARD
        .decode(request.content_b64.as_bytes())
        .map_err(|_| AppError::InvalidBase64)?;

    let hash = sha256_hex(&data);
    if hash != request.hash {
        return Err(AppError::HashMismatch);
    }

    let vault_id = storage::validate_vault_id(&request.vault_id)?;
    let device_id = storage::validate_device_id(&request.device_id)?;
    let safe_path = storage::validate_relative_path(&request.path)?;
    let now = Utc::now().to_rfc3339();
    touch_vault(state.pool(), &vault_id, &now).await?;
    touch_device(state.pool(), &vault_id, &device_id, &now).await?;

    let current = get_document_record(state.pool(), &vault_id, &safe_path).await?;
    let current_version = current.as_ref().map(|record| record.version).unwrap_or(0);
    let current_deleted = current.as_ref().map(|record| record.deleted).unwrap_or(false);

    let (merged_bytes, deleted) = if request.deleted {
        (data.clone(), true)
    } else {
        let merged_bytes = merge_plain_document(current.as_ref().map(|record| record.content_b64.as_str()), &data)?;
        (merged_bytes, false)
    };

    let new_version = current_version + 1;
    let merged_hash = sha256_hex(&merged_bytes);
    let content_b64 = STANDARD.encode(&merged_bytes);

    sqlx::query(
        r#"
        INSERT INTO documents (vault_id, path, content_b64, hash, version, deleted, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(vault_id, path) DO UPDATE SET
          content_b64 = excluded.content_b64,
          hash = excluded.hash,
          version = excluded.version,
          deleted = excluded.deleted,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&vault_id)
    .bind(&safe_path)
    .bind(&content_b64)
    .bind(&merged_hash)
    .bind(new_version)
    .bind(if deleted { 1 } else { 0 })
    .bind(&now)
    .execute(state.pool())
    .await
    .map_err(AppError::internal)?;

    store_document_version(
        state,
        &vault_id,
        &safe_path,
        new_version,
        &content_b64,
        &merged_hash,
        deleted,
        &now,
    )
    .await?;

    let change_result = sqlx::query(
        "INSERT INTO document_changes (vault_id, device_id, path, version, deleted, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(&vault_id)
    .bind(&device_id)
    .bind(&safe_path)
    .bind(new_version)
    .bind(if deleted { 1 } else { 0 })
    .bind(&now)
    .execute(state.pool())
    .await
    .map_err(AppError::internal)?;
    state.notify_vault_event(&vault_id, change_result.last_insert_rowid());

    tracing::info!(
        vault_id = %vault_id,
        device_id = %device_id,
        path = %safe_path,
        version = new_version,
        deleted = deleted,
        "pushed document"
    );

    let _ = current_deleted;

    Ok(MutationResponse {
        ok: true,
        version: Some(new_version),
        conflict: None,
        server_version: None,
    })
}

pub async fn get_document_snapshot(
    state: &AppState,
    vault_id: String,
    path: String,
) -> Result<DocumentSnapshotResponse, AppError> {
    let vault_id = storage::validate_vault_id(&vault_id)?;
    let safe_path = storage::validate_relative_path(&path)?;
    let record = get_document_record(state.pool(), &vault_id, &safe_path)
        .await?
        .ok_or(AppError::NotFound)?;

    Ok(DocumentSnapshotResponse {
        path: record.path,
        version: record.version,
        deleted: record.deleted,
        content_b64: record.content_b64,
        hash: record.hash,
    })
}

pub async fn get_document_changes(
    state: &AppState,
    vault_id: String,
    since: i64,
) -> Result<ChangesResponse, AppError> {
    let vault_id = storage::validate_vault_id(&vault_id)?;
    let rows = sqlx::query(
        "SELECT seq, vault_id, device_id, path, version, deleted FROM document_changes WHERE vault_id = ?1 AND seq > ?2 ORDER BY seq ASC",
    )
    .bind(&vault_id)
    .bind(since)
    .fetch_all(state.pool())
    .await
    .map_err(AppError::internal)?;

    let changes = rows
        .into_iter()
        .map(|row| DocumentChangeRecord {
            seq: row.get("seq"),
            vault_id: row.get("vault_id"),
            device_id: row.get("device_id"),
            path: row.get("path"),
            version: row.get("version"),
            deleted: row.get::<i64, _>("deleted") != 0,
        })
        .map(|record| crate::dto::ChangeItem {
            seq: record.seq,
            device_id: record.device_id,
            path: record.path,
            version: record.version,
            deleted: record.deleted,
        })
        .collect();

    let latest_seq = get_latest_seq(state, vault_id).await?;

    Ok(ChangesResponse {
        changes,
        latest_seq,
    })
}

pub async fn get_latest_seq(state: &AppState, vault_id: String) -> Result<i64, AppError> {
    let latest_seq = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(MAX(seq), 0) FROM document_changes WHERE vault_id = ?1",
    )
    .bind(&vault_id)
    .fetch_one(state.pool())
    .await
    .map_err(AppError::internal)?;

    Ok(latest_seq)
}

pub async fn get_document_history(
    state: &AppState,
    vault_id: String,
    path: String,
) -> Result<DocumentHistoryResponse, AppError> {
    let vault_id = storage::validate_vault_id(&vault_id)?;
    let safe_path = storage::validate_relative_path(&path)?;
    let rows = sqlx::query(
        r#"
        SELECT vault_id, path, version, content_b64, hash, deleted, created_at
        FROM document_versions
        WHERE vault_id = ?1 AND path = ?2
        ORDER BY version DESC
        "#,
    )
    .bind(&vault_id)
    .bind(&safe_path)
    .fetch_all(state.pool())
    .await
    .map_err(AppError::internal)?;

    let versions = rows
        .into_iter()
        .map(|row| DocumentVersionRecord {
            vault_id: row.get("vault_id"),
            path: row.get("path"),
            version: row.get("version"),
            content_b64: row.get("content_b64"),
            hash: row.get("hash"),
            deleted: row.get::<i64, _>("deleted") != 0,
            created_at: row.get("created_at"),
        })
        .map(|record| -> Result<DocumentVersionItem, AppError> {
            Ok(DocumentVersionItem {
                version: record.version,
                hash: record.hash.clone(),
                snapshot_b64: record.content_b64.clone(),
                deleted: record.deleted,
                created_at: record.created_at,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    if versions.is_empty() {
        return Err(AppError::NotFound);
    }

    Ok(DocumentHistoryResponse {
        path: safe_path,
        versions,
    })
}

pub async fn restore_document(
    state: &AppState,
    request: RestoreDocumentRequest,
) -> Result<MutationResponse, AppError> {
    let vault_id = storage::validate_vault_id(&request.vault_id)?;
    let device_id = storage::validate_device_id(&request.device_id)?;
    let safe_path = storage::validate_relative_path(&request.path)?;
    let now = Utc::now().to_rfc3339();
    touch_vault(state.pool(), &vault_id, &now).await?;
    touch_device(state.pool(), &vault_id, &device_id, &now).await?;

    let current = get_document_record(state.pool(), &vault_id, &safe_path)
        .await?
        .ok_or(AppError::NotFound)?;
    let target = get_document_version_record(state.pool(), &vault_id, &safe_path, request.target_version)
        .await?
        .ok_or(AppError::NotFound)?;

    let new_version = current.version + 1;
    sqlx::query(
        r#"
        INSERT INTO documents (vault_id, path, content_b64, hash, version, deleted, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(vault_id, path) DO UPDATE SET
          content_b64 = excluded.content_b64,
          hash = excluded.hash,
          version = excluded.version,
          deleted = excluded.deleted,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&vault_id)
    .bind(&safe_path)
    .bind(&target.content_b64)
    .bind(&target.hash)
    .bind(new_version)
    .bind(if target.deleted { 1 } else { 0 })
    .bind(&now)
    .execute(state.pool())
    .await
    .map_err(AppError::internal)?;

    store_document_version(
        state,
        &vault_id,
        &safe_path,
        new_version,
        &target.content_b64,
        &target.hash,
        target.deleted,
        &now,
    )
    .await?;

    let change_result = sqlx::query(
        "INSERT INTO document_changes (vault_id, device_id, path, version, deleted, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(&vault_id)
    .bind(&device_id)
    .bind(&safe_path)
    .bind(new_version)
    .bind(if target.deleted { 1 } else { 0 })
    .bind(&now)
    .execute(state.pool())
    .await
    .map_err(AppError::internal)?;
    state.notify_vault_event(&vault_id, change_result.last_insert_rowid());

    Ok(MutationResponse {
        ok: true,
        version: Some(new_version),
        conflict: None,
        server_version: None,
    })
}

async fn get_document_record(
    pool: &sqlx::SqlitePool,
    vault_id: &str,
    path: &str,
) -> Result<Option<DocumentRecord>, AppError> {
    let row = sqlx::query(
        r#"
        SELECT vault_id, path, content_b64, hash, version, deleted, updated_at
        FROM documents
        WHERE vault_id = ?1 AND path = ?2
        "#,
    )
    .bind(vault_id)
    .bind(path)
    .fetch_optional(pool)
    .await
    .map_err(AppError::internal)?;

    Ok(row.map(|row| DocumentRecord {
        vault_id: row.get("vault_id"),
        path: row.get("path"),
        content_b64: row.get("content_b64"),
        hash: row.get("hash"),
        version: row.get("version"),
        deleted: row.get::<i64, _>("deleted") != 0,
        updated_at: row.get("updated_at"),
    }))
}

async fn get_document_version_record(
    pool: &sqlx::SqlitePool,
    vault_id: &str,
    path: &str,
    version: i64,
) -> Result<Option<DocumentVersionRecord>, AppError> {
    let row = sqlx::query(
        r#"
        SELECT vault_id, path, version, content_b64, hash, deleted, created_at
        FROM document_versions
        WHERE vault_id = ?1 AND path = ?2 AND version = ?3
        "#,
    )
    .bind(vault_id)
    .bind(path)
    .bind(version)
    .fetch_optional(pool)
    .await
    .map_err(AppError::internal)?;

    Ok(row.map(|row| DocumentVersionRecord {
        vault_id: row.get("vault_id"),
        path: row.get("path"),
        version: row.get("version"),
        content_b64: row.get("content_b64"),
        hash: row.get("hash"),
        deleted: row.get::<i64, _>("deleted") != 0,
        created_at: row.get("created_at"),
    }))
}

async fn store_document_version(
    state: &AppState,
    vault_id: &str,
    path: &str,
    version: i64,
    content_b64: &str,
    hash: &str,
    deleted: bool,
    created_at: &str,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT INTO document_versions (vault_id, path, version, content_b64, hash, deleted, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        "#,
    )
    .bind(vault_id)
    .bind(path)
    .bind(version)
    .bind(content_b64)
    .bind(hash)
    .bind(if deleted { 1 } else { 0 })
    .bind(created_at)
    .execute(state.pool())
    .await
    .map_err(AppError::internal)?;

    Ok(())
}

async fn touch_vault(pool: &sqlx::SqlitePool, vault_id: &str, now: &str) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT INTO vaults (vault_id, created_at, updated_at)
        VALUES (?1, ?2, ?2)
        ON CONFLICT(vault_id) DO UPDATE SET updated_at = excluded.updated_at
        "#,
    )
    .bind(vault_id)
    .bind(now)
    .execute(pool)
    .await
    .map_err(AppError::internal)?;

    Ok(())
}

async fn touch_device(
    pool: &sqlx::SqlitePool,
    vault_id: &str,
    device_id: &str,
    now: &str,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT INTO devices (vault_id, device_id, first_seen_at, last_seen_at)
        VALUES (?1, ?2, ?3, ?3)
        ON CONFLICT(vault_id, device_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
        "#,
    )
    .bind(vault_id)
    .bind(device_id)
    .bind(now)
    .execute(pool)
    .await
    .map_err(AppError::internal)?;

    Ok(())
}

fn merge_plain_document(
    current_snapshot_b64: Option<&str>,
    incoming_snapshot: &[u8],
) -> Result<Vec<u8>, AppError> {
    let server_doc = if let Some(current) = current_snapshot_b64 {
        let current_bytes = STANDARD
            .decode(current.as_bytes())
            .map_err(|_| AppError::InvalidBase64)?;
        LoroDoc::from_snapshot(&current_bytes).map_err(AppError::internal)?
    } else {
        LoroDoc::new()
    };

    server_doc
        .import(incoming_snapshot)
        .map_err(AppError::internal)?;
    let snapshot = server_doc
        .export(ExportMode::Snapshot)
        .map_err(AppError::internal)?;
    Ok(snapshot)
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}
