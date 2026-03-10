use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::Utc;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};

use crate::{
    dto::{ChangeItem, ChangesResponse, DeleteRequest, FileResponse, MutationResponse, UploadRequest},
    error::AppError,
    models::{ChangeRecord, FileRecord},
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

    let safe_path = storage::validate_relative_path(&request.path)?;
    let current = get_file_record(state.pool(), &safe_path).await?;
    let current_version = current.as_ref().map(|record| record.version).unwrap_or(0);

    if request.base_version != current_version {
        return Ok(MutationResponse {
            ok: false,
            version: None,
            conflict: Some(true),
            server_version: Some(current_version),
        });
    }

    storage::write_file(state.storage_root(), &safe_path, &data)
        .await
        .map_err(AppError::internal)?;

    let new_version = current_version + 1;
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        r#"
        INSERT INTO files (path, hash, version, deleted, updated_at)
        VALUES (?1, ?2, ?3, 0, ?4)
        ON CONFLICT(path) DO UPDATE SET
          hash = excluded.hash,
          version = excluded.version,
          deleted = excluded.deleted,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&safe_path)
    .bind(&request.hash)
    .bind(new_version)
    .bind(&now)
    .execute(state.pool())
    .await
    .map_err(AppError::internal)?;

    sqlx::query(
        "INSERT INTO changes (path, version, deleted, updated_at) VALUES (?1, ?2, 0, ?3)",
    )
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
    let safe_path = storage::validate_relative_path(&request.path)?;
    let current = get_file_record(state.pool(), &safe_path)
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
    let now = Utc::now().to_rfc3339();

    storage::delete_file(state.storage_root(), &safe_path)
        .await
        .map_err(AppError::internal)?;

    sqlx::query(
        r#"
        UPDATE files
        SET hash = '', version = ?2, deleted = 1, updated_at = ?3
        WHERE path = ?1
        "#,
    )
    .bind(&safe_path)
    .bind(new_version)
    .bind(&now)
    .execute(state.pool())
    .await
    .map_err(AppError::internal)?;

    sqlx::query(
        "INSERT INTO changes (path, version, deleted, updated_at) VALUES (?1, ?2, 1, ?3)",
    )
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

pub async fn get_file(state: &AppState, path: String) -> Result<FileResponse, AppError> {
    let safe_path = storage::validate_relative_path(&path)?;
    let record = get_file_record(state.pool(), &safe_path)
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

    let data = storage::read_file(state.storage_root(), &safe_path)
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

pub async fn get_changes(state: &AppState, since: i64) -> Result<ChangesResponse, AppError> {
    let rows = sqlx::query(
        "SELECT seq, path, version, deleted FROM changes WHERE seq > ?1 ORDER BY seq ASC",
    )
    .bind(since)
    .fetch_all(state.pool())
    .await
    .map_err(AppError::internal)?;

    let changes = rows
        .into_iter()
        .map(|row| ChangeRecord {
            seq: row.get("seq"),
            path: row.get("path"),
            version: row.get("version"),
            deleted: row.get::<i64, _>("deleted") != 0,
        })
        .map(|record| ChangeItem {
            seq: record.seq,
            path: record.path,
            version: record.version,
            deleted: record.deleted,
        })
        .collect();

    let latest_seq = sqlx::query_scalar::<_, i64>("SELECT COALESCE(MAX(seq), 0) FROM changes")
        .fetch_one(state.pool())
        .await
        .map_err(AppError::internal)?;

    Ok(ChangesResponse { changes, latest_seq })
}

async fn get_file_record(pool: &SqlitePool, path: &str) -> Result<Option<FileRecord>, AppError> {
    let row = sqlx::query("SELECT path, hash, version, deleted FROM files WHERE path = ?1")
        .bind(path)
        .fetch_optional(pool)
        .await
        .map_err(AppError::internal)?;

    Ok(row.map(|row| FileRecord {
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
