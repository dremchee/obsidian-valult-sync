use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::Utc;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};

use crate::{
    dto::{
        ChangeItem, ChangesResponse, ContentFormat, CreateVaultRequest, CreateVaultResponse,
        DeleteRequest, DeviceItem, DevicesResponse, FileHistoryResponse, FileResponse,
        FileVersionItem, MutationResponse, RestoreFileRequest, UploadRequest, VaultItem,
        VaultsResponse,
    },
    error::AppError,
    models::{ChangeRecord, DeviceRecord, FileRecord, FileVersionRecord, VaultRecord},
    state::AppState,
    storage,
};

pub async fn upload(state: &AppState, request: UploadRequest) -> Result<MutationResponse, AppError> {
    let data = STANDARD
        .decode(request.content_b64.as_bytes())
        .map_err(|_| AppError::InvalidBase64)?;

    let payload_hash = sha256_hex(&data);
    if payload_hash != request.payload_hash {
        return Err(AppError::HashMismatch);
    }

    let vault_id = storage::validate_vault_id(&request.vault_id)?;
    let device_id = storage::validate_device_id(&request.device_id)?;
    let safe_path = storage::validate_relative_path(&request.path)?;
    let now = Utc::now().to_rfc3339();
    touch_vault(state.pool(), &vault_id, &now).await?;
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
    store_file_version(
        state,
        &vault_id,
        &safe_path,
        new_version,
        &request.hash,
        &request.payload_hash,
        request.content_format,
        false,
        &now,
        Some(&data),
    )
    .await?;

    sqlx::query(
        r#"
        INSERT INTO files (vault_id, path, hash, payload_hash, content_format, version, deleted, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)
        ON CONFLICT(vault_id, path) DO UPDATE SET
          hash = excluded.hash,
          payload_hash = excluded.payload_hash,
          content_format = excluded.content_format,
          version = excluded.version,
          deleted = excluded.deleted,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&vault_id)
    .bind(&safe_path)
    .bind(&request.hash)
    .bind(&request.payload_hash)
    .bind(content_format_to_db(request.content_format))
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

    let change_result = sqlx::query(
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
    state.notify_vault_event(&vault_id, change_result.last_insert_rowid());

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
    touch_vault(state.pool(), &vault_id, &now).await?;
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
    store_file_version(
        state,
        &vault_id,
        &safe_path,
        new_version,
        "",
        "",
        ContentFormat::Plain,
        true,
        &now,
        None,
    )
    .await?;

    sqlx::query(
        r#"
        UPDATE files
        SET hash = '', payload_hash = '', version = ?2, deleted = 1, updated_at = ?3
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

    let change_result = sqlx::query(
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
    state.notify_vault_event(&vault_id, change_result.last_insert_rowid());

    Ok(MutationResponse {
        ok: true,
        version: Some(new_version),
        conflict: None,
        server_version: None,
    })
}

pub async fn get_file_history(
    state: &AppState,
    vault_id: String,
    path: String,
) -> Result<FileHistoryResponse, AppError> {
    let vault_id = storage::validate_vault_id(&vault_id)?;
    let safe_path = storage::validate_relative_path(&path)?;
    let rows = sqlx::query(
        r#"
        SELECT vault_id, path, version, hash, payload_hash, content_format, deleted, created_at
        FROM file_versions
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
        .map(|row| FileVersionRecord {
            vault_id: row.get("vault_id"),
            path: row.get("path"),
            version: row.get("version"),
            hash: row.get("hash"),
            payload_hash: row.get("payload_hash"),
            content_format: row.get("content_format"),
            deleted: row.get::<i64, _>("deleted") != 0,
            created_at: row.get("created_at"),
        })
        .map(|record| FileVersionItem {
            version: record.version,
            hash: record.hash,
            payload_hash: record.payload_hash,
            content_format: content_format_from_db(&record.content_format).unwrap_or(ContentFormat::Plain),
            deleted: record.deleted,
            created_at: record.created_at,
        })
        .collect::<Vec<_>>();

    if versions.is_empty() {
        return Err(AppError::NotFound);
    }

    Ok(FileHistoryResponse {
        path: safe_path,
        versions,
    })
}

pub async fn restore_file(
    state: &AppState,
    request: RestoreFileRequest,
) -> Result<MutationResponse, AppError> {
    let vault_id = storage::validate_vault_id(&request.vault_id)?;
    let device_id = storage::validate_device_id(&request.device_id)?;
    let safe_path = storage::validate_relative_path(&request.path)?;
    let now = Utc::now().to_rfc3339();
    touch_vault(state.pool(), &vault_id, &now).await?;
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

    let record = get_file_version_record(state.pool(), &vault_id, &safe_path, request.target_version)
        .await?
        .ok_or(AppError::NotFound)?;

    let new_version = current.version + 1;

    if record.deleted {
        storage::delete_file(state.storage_root(), &vault_id, &safe_path)
            .await
            .map_err(AppError::internal)?;
    } else {
        let data = storage::read_file_version(state.storage_root(), &vault_id, &safe_path, record.version)
            .await
            .map_err(AppError::internal)?;
        storage::write_file(state.storage_root(), &vault_id, &safe_path, &data)
            .await
            .map_err(AppError::internal)?;
        store_file_version(
            state,
            &vault_id,
            &safe_path,
            new_version,
            &record.hash,
            &record.payload_hash,
            content_format_from_db(&record.content_format)?,
            false,
            &now,
            Some(&data),
        )
        .await?;
    }

    if record.deleted {
        store_file_version(
            state,
            &vault_id,
            &safe_path,
            new_version,
            "",
            "",
            ContentFormat::Plain,
            true,
            &now,
            None,
        )
        .await?;
    }

    sqlx::query(
        r#"
        INSERT INTO files (vault_id, path, hash, payload_hash, content_format, version, deleted, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(vault_id, path) DO UPDATE SET
          hash = excluded.hash,
          payload_hash = excluded.payload_hash,
          content_format = excluded.content_format,
          version = excluded.version,
          deleted = excluded.deleted,
          updated_at = excluded.updated_at
        "#,
    )
    .bind(&vault_id)
    .bind(&safe_path)
    .bind(if record.deleted { "" } else { record.hash.as_str() })
    .bind(if record.deleted { "" } else { record.payload_hash.as_str() })
    .bind(if record.deleted { "plain" } else { record.content_format.as_str() })
    .bind(new_version)
    .bind(if record.deleted { 1 } else { 0 })
    .bind(&now)
    .execute(state.pool())
    .await
    .map_err(AppError::internal)?;

    let change_result = sqlx::query(
        "INSERT INTO changes (vault_id, device_id, path, version, deleted, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(&vault_id)
    .bind(&device_id)
    .bind(&safe_path)
    .bind(new_version)
    .bind(if record.deleted { 1 } else { 0 })
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
            content_format: content_format_from_db(&record.content_format)?,
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
        content_format: content_format_from_db(&record.content_format)?,
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

    let latest_seq = get_latest_seq(state, vault_id).await?;

    Ok(ChangesResponse { changes, latest_seq })
}

pub async fn get_latest_seq(state: &AppState, vault_id: String) -> Result<i64, AppError> {
    let latest_seq = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(MAX(seq), 0) FROM changes WHERE vault_id = ?1",
    )
    .bind(&vault_id)
    .fetch_one(state.pool())
    .await
    .map_err(AppError::internal)?;

    Ok(latest_seq)
}

async fn store_file_version(
    state: &AppState,
    vault_id: &str,
    safe_path: &str,
    version: i64,
    hash: &str,
    payload_hash: &str,
    content_format: ContentFormat,
    deleted: bool,
    created_at: &str,
    data: Option<&[u8]>,
) -> Result<(), AppError> {
    if let Some(bytes) = data {
        storage::write_file_version(state.storage_root(), vault_id, safe_path, version, bytes)
            .await
            .map_err(AppError::internal)?;
    }

    sqlx::query(
        r#"
        INSERT INTO file_versions (vault_id, path, version, hash, payload_hash, content_format, deleted, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
    )
    .bind(vault_id)
    .bind(safe_path)
    .bind(version)
    .bind(hash)
    .bind(payload_hash)
    .bind(content_format_to_db(content_format))
    .bind(if deleted { 1 } else { 0 })
    .bind(created_at)
    .execute(state.pool())
    .await
    .map_err(AppError::internal)?;

    Ok(())
}

async fn get_file_version_record(
    pool: &SqlitePool,
    vault_id: &str,
    path: &str,
    version: i64,
) -> Result<Option<FileVersionRecord>, AppError> {
    let row = sqlx::query(
        r#"
        SELECT vault_id, path, version, hash, payload_hash, content_format, deleted, created_at
        FROM file_versions
        WHERE vault_id = ?1 AND path = ?2 AND version = ?3
        "#,
    )
    .bind(vault_id)
    .bind(path)
    .bind(version)
    .fetch_optional(pool)
    .await
    .map_err(AppError::internal)?;

    Ok(row.map(|row| FileVersionRecord {
        vault_id: row.get("vault_id"),
        path: row.get("path"),
        version: row.get("version"),
        hash: row.get("hash"),
        payload_hash: row.get("payload_hash"),
        content_format: row.get("content_format"),
        deleted: row.get::<i64, _>("deleted") != 0,
        created_at: row.get("created_at"),
    }))
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

pub async fn get_vaults(state: &AppState) -> Result<VaultsResponse, AppError> {
    let rows = sqlx::query(
        r#"
        SELECT vaults.vault_id, vaults.created_at, vaults.updated_at, vaults.e2ee_fingerprint, COUNT(devices.device_id) AS device_count
        FROM vaults
        LEFT JOIN devices ON devices.vault_id = vaults.vault_id
        GROUP BY vaults.vault_id, vaults.created_at, vaults.updated_at, vaults.e2ee_fingerprint
        ORDER BY vaults.updated_at DESC, vaults.vault_id ASC
        "#,
    )
    .fetch_all(state.pool())
    .await
    .map_err(AppError::internal)?;

    let vaults = rows
        .into_iter()
        .map(|row| VaultRecord {
            vault_id: row.get("vault_id"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
            e2ee_fingerprint: row.get("e2ee_fingerprint"),
            device_count: row.get("device_count"),
        })
        .map(vault_record_to_dto)
        .collect();

    Ok(VaultsResponse { vaults })
}

pub async fn create_vault(
    state: &AppState,
    request: CreateVaultRequest,
) -> Result<CreateVaultResponse, AppError> {
    let vault_id = storage::validate_vault_id(&request.vault_id)?;
    let e2ee_fingerprint = request
        .e2ee_fingerprint
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let now = Utc::now().to_rfc3339();
    let existing = get_vault_record(state.pool(), &vault_id).await?;

    sqlx::query(
        r#"
        INSERT INTO vaults (vault_id, created_at, updated_at, e2ee_fingerprint)
        VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(vault_id) DO UPDATE SET
          updated_at = excluded.updated_at,
          e2ee_fingerprint = COALESCE(vaults.e2ee_fingerprint, excluded.e2ee_fingerprint)
        "#,
    )
    .bind(&vault_id)
    .bind(&now)
    .bind(&now)
    .bind(&e2ee_fingerprint)
    .execute(state.pool())
    .await
    .map_err(AppError::internal)?;

    let vault = get_vault_record(state.pool(), &vault_id)
        .await?
        .ok_or_else(|| AppError::internal("created vault is missing"))?;

    Ok(CreateVaultResponse {
        ok: true,
        created: existing.is_none(),
        vault: vault_record_to_dto(vault),
    })
}

async fn get_file_record(pool: &SqlitePool, vault_id: &str, path: &str) -> Result<Option<FileRecord>, AppError> {
    let row = sqlx::query(
        "SELECT vault_id, path, hash, payload_hash, content_format, version, deleted FROM files WHERE vault_id = ?1 AND path = ?2",
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
        payload_hash: row.get("payload_hash"),
        content_format: row.get("content_format"),
        version: row.get("version"),
        deleted: row.get::<i64, _>("deleted") != 0,
    }))
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

fn content_format_to_db(value: ContentFormat) -> &'static str {
    match value {
        ContentFormat::Plain => "plain",
        ContentFormat::E2eeEnvelopeV1 => "e2ee-envelope-v1",
    }
}

fn content_format_from_db(value: &str) -> Result<ContentFormat, AppError> {
    match value {
        "plain" => Ok(ContentFormat::Plain),
        "e2ee-envelope-v1" => Ok(ContentFormat::E2eeEnvelopeV1),
        _ => Err(AppError::InvalidPayload("content_format is invalid".to_string())),
    }
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

async fn touch_vault(pool: &SqlitePool, vault_id: &str, now: &str) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT INTO vaults (vault_id, created_at, updated_at)
        VALUES (?1, ?2, ?2)
        ON CONFLICT(vault_id) DO UPDATE SET
          updated_at = excluded.updated_at
        "#,
    )
    .bind(vault_id)
    .bind(now)
    .execute(pool)
    .await
    .map_err(AppError::internal)?;

    Ok(())
}

async fn get_vault_record(pool: &SqlitePool, vault_id: &str) -> Result<Option<VaultRecord>, AppError> {
    let row = sqlx::query(
        r#"
        SELECT vaults.vault_id, vaults.created_at, vaults.updated_at, vaults.e2ee_fingerprint, COUNT(devices.device_id) AS device_count
        FROM vaults
        LEFT JOIN devices ON devices.vault_id = vaults.vault_id
        WHERE vaults.vault_id = ?1
        GROUP BY vaults.vault_id, vaults.created_at, vaults.updated_at, vaults.e2ee_fingerprint
        "#,
    )
    .bind(vault_id)
    .fetch_optional(pool)
    .await
    .map_err(AppError::internal)?;

    Ok(row.map(|row| VaultRecord {
        vault_id: row.get("vault_id"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        e2ee_fingerprint: row.get("e2ee_fingerprint"),
        device_count: row.get("device_count"),
    }))
}

fn vault_record_to_dto(record: VaultRecord) -> VaultItem {
    VaultItem {
        vault_id: record.vault_id,
        created_at: record.created_at,
        updated_at: record.updated_at,
        device_count: record.device_count,
        e2ee_fingerprint: record.e2ee_fingerprint,
    }
}
