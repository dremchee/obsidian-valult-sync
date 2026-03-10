use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::Utc;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};

use crate::{
    dto::{
        ChangeItem, ChangesResponse, DeleteRequest, DeviceItem, DevicesResponse, FileResponse,
        MutationResponse, UploadRequest,
    },
    error::AppError,
    models::{ChangeRecord, DeviceRecord, FileRecord},
    state::AppState,
    storage,
};

pub async fn upload(state: &AppState, request: UploadRequest) -> Result<MutationResponse, AppError> {
    let data = STANDARD
        .decode(request.content_b64.as_bytes())
        .map_err(|_| AppError::InvalidBase64)?;

    let content_hash = sha256_hex(&data);
    if content_hash != request.hash {
        return Err(AppError::HashMismatch);
    }

    let vault_id = storage::validate_vault_id(&request.vault_id)?;
    let device_id = storage::validate_device_id(&request.device_id)?;
    let safe_path = storage::validate_relative_path(&request.path)?;
    let now = Utc::now().to_rfc3339();
    touch_device(state.pool(), &vault_id, &device_id, &now).await?;
    let current = get_file_record(state.pool(), &vault_id, &safe_path).await?;
    let current_version = current.as_ref().map(|record| record.version).unwrap_or(0);

    if request.base_version != current_version {
        return Ok(MutationResponse {
            ok: false,
            version: None,
            conflict: Some(true),
            server_version: Some(current_version),
        });
    }

    storage::write_file(state.storage_root(), &vault_id, &safe_path, &data)
        .await
        .map_err(AppError::internal)?;

    let new_version = current_version + 1;

    sqlx::query(
        r#"
        INSERT INTO files (vault_id, path, hash, version, deleted, updated_at)
        VALUES (?1, ?2, ?3, ?4, 0, ?5)
        ON CONFLICT(vault_id, path) DO UPDATE SET
          hash = excluded.hash,
          version = excluded.version,
          deleted = excluded.deleted,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&vault_id)
    .bind(&safe_path)
    .bind(&request.hash)
    .bind(new_version)
    .bind(&now)
    .execute(state.pool())
    .await
    .map_err(AppError::internal)?;

    tracing::info!(
        vault_id = %vault_id,
        device_id = %device_id,
        path = %safe_path,
        version = new_version,
        "uploaded file"
    );

    sqlx::query(
        "INSERT INTO changes (vault_id, device_id, path, version, deleted, updated_at) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
    )
    .bind(&vault_id)
    .bind(&device_id)
    .bind(&safe_path)
    .bind(new_version)
    .bind(now)
    .execute(state.pool())
    .await
    .map_err(AppError::internal)?;

    Ok(MutationResponse {
        ok: true,
        version: Some(new_version),
        conflict: None,
        server_version: None,
    })
}

pub async fn delete(state: &AppState, request: DeleteRequest) -> Result<MutationResponse, AppError> {
    let vault_id = storage::validate_vault_id(&request.vault_id)?;
    let device_id = storage::validate_device_id(&request.device_id)?;
    let safe_path = storage::validate_relative_path(&request.path)?;
    let now = Utc::now().to_rfc3339();
    touch_device(state.pool(), &vault_id, &device_id, &now).await?;
    let current = get_file_record(state.pool(), &vault_id, &safe_path)
        .await?
        .ok_or(AppError::NotFound)?;

    if request.base_version != current.version {
        return Ok(MutationResponse {
            ok: false,
            version: None,
            conflict: Some(true),
            server_version: Some(current.version),
        });
    }

    let new_version = current.version + 1;

    storage::delete_file(state.storage_root(), &vault_id, &safe_path)
        .await
        .map_err(AppError::internal)?;

    sqlx::query(
        r#"
        UPDATE files
        SET hash = '', version = ?2, deleted = 1, updated_at = ?3
        WHERE vault_id = ?1 AND path = ?4
        "#,
    )
    .bind(&vault_id)
    .bind(new_version)
    .bind(&now)
    .bind(&safe_path)
    .execute(state.pool())
    .await
    .map_err(AppError::internal)?;

    tracing::info!(
        vault_id = %vault_id,
        device_id = %device_id,
        path = %safe_path,
        version = new_version,
        "deleted file"
    );

    sqlx::query(
        "INSERT INTO changes (vault_id, device_id, path, version, deleted, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
    )
    .bind(&vault_id)
    .bind(&device_id)
    .bind(&safe_path)
    .bind(new_version)
    .bind(now)
    .execute(state.pool())
    .await
    .map_err(AppError::internal)?;

    Ok(MutationResponse {
        ok: true,
        version: Some(new_version),
        conflict: None,
        server_version: None,
    })
}

pub async fn get_file(state: &AppState, vault_id: String, path: String) -> Result<FileResponse, AppError> {
    let vault_id = storage::validate_vault_id(&vault_id)?;
    let safe_path = storage::validate_relative_path(&path)?;
    let record = get_file_record(state.pool(), &vault_id, &safe_path)
        .await?
        .ok_or(AppError::NotFound)?;

    if record.deleted {
        return Ok(FileResponse {
            path: record.path,
            hash: record.hash,
            version: record.version,
            deleted: true,
            content_b64: None,
        });
    }

    let data = storage::read_file(state.storage_root(), &vault_id, &safe_path)
        .await
        .map_err(AppError::internal)?;

    Ok(FileResponse {
        path: record.path,
        hash: record.hash,
        version: record.version,
        deleted: false,
        content_b64: Some(STANDARD.encode(data)),
    })
}

pub async fn get_changes(state: &AppState, vault_id: String, since: i64) -> Result<ChangesResponse, AppError> {
    let vault_id = storage::validate_vault_id(&vault_id)?;
    let rows = sqlx::query(
        "SELECT seq, vault_id, device_id, path, version, deleted FROM changes WHERE vault_id = ?1 AND seq > ?2 ORDER BY seq ASC",
    )
    .bind(&vault_id)
    .bind(since)
    .fetch_all(state.pool())
    .await
    .map_err(AppError::internal)?;

    let changes = rows
        .into_iter()
        .map(|row| ChangeRecord {
            seq: row.get("seq"),
            vault_id: row.get("vault_id"),
            device_id: row.get("device_id"),
            path: row.get("path"),
            version: row.get("version"),
            deleted: row.get::<i64, _>("deleted") != 0,
        })
        .map(|record| ChangeItem {
            seq: record.seq,
            device_id: record.device_id,
            path: record.path,
            version: record.version,
            deleted: record.deleted,
        })
        .collect();

    let latest_seq = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(MAX(seq), 0) FROM changes WHERE vault_id = ?1",
    )
        .bind(&vault_id)
        .fetch_one(state.pool())
        .await
        .map_err(AppError::internal)?;

    Ok(ChangesResponse { changes, latest_seq })
}

pub async fn get_devices(state: &AppState, vault_id: String) -> Result<DevicesResponse, AppError> {
    let vault_id = storage::validate_vault_id(&vault_id)?;
    let rows = sqlx::query(
        "SELECT vault_id, device_id, first_seen_at, last_seen_at FROM devices WHERE vault_id = ?1 ORDER BY last_seen_at DESC, device_id ASC",
    )
    .bind(&vault_id)
    .fetch_all(state.pool())
    .await
    .map_err(AppError::internal)?;

    let devices = rows
        .into_iter()
        .map(|row| DeviceRecord {
            device_id: row.get("device_id"),
            first_seen_at: row.get("first_seen_at"),
            last_seen_at: row.get("last_seen_at"),
        })
        .map(|record| DeviceItem {
            device_id: record.device_id,
            first_seen_at: record.first_seen_at,
            last_seen_at: record.last_seen_at,
        })
        .collect();

    Ok(DevicesResponse { devices })
}

async fn get_file_record(pool: &SqlitePool, vault_id: &str, path: &str) -> Result<Option<FileRecord>, AppError> {
    let row = sqlx::query(
        "SELECT vault_id, path, hash, version, deleted FROM files WHERE vault_id = ?1 AND path = ?2",
    )
        .bind(vault_id)
        .bind(path)
        .fetch_optional(pool)
        .await
        .map_err(AppError::internal)?;

    Ok(row.map(|row| FileRecord {
        vault_id: row.get("vault_id"),
        path: row.get("path"),
        hash: row.get("hash"),
        version: row.get("version"),
        deleted: row.get::<i64, _>("deleted") != 0,
    }))
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

async fn touch_device(
    pool: &SqlitePool,
    vault_id: &str,
    device_id: &str,
    now: &str,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT INTO devices (vault_id, device_id, first_seen_at, last_seen_at)
        VALUES (?1, ?2, ?3, ?3)
        ON CONFLICT(vault_id, device_id) DO UPDATE SET
          last_seen_at = excluded.last_seen_at
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
