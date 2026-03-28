use chrono::Utc;
use sqlx::Row;

use crate::{
    dto::{CreateVaultRequest, CreateVaultResponse, DeviceItem, DevicesResponse, VaultItem, VaultsResponse},
    error::AppError,
    models::{DeviceRecord, VaultRecord},
    state::AppState,
    storage,
};

pub async fn get_devices(state: &AppState, vault_id: String) -> Result<DevicesResponse, AppError> {
    let vault_id = storage::validate_vault_id(&vault_id)?;
    let rows = sqlx::query(
        r#"
        SELECT device_id, first_seen_at, last_seen_at
        FROM devices
        WHERE vault_id = ?1
        ORDER BY device_id ASC
        "#,
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
        SELECT vaults.vault_id, vaults.created_at, vaults.updated_at, COUNT(devices.device_id) AS device_count
        FROM vaults
        LEFT JOIN devices ON devices.vault_id = vaults.vault_id
        GROUP BY vaults.vault_id, vaults.created_at, vaults.updated_at
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
    let now = Utc::now().to_rfc3339();
    let existing = get_vault_record(state.pool(), &vault_id).await?;

    sqlx::query(
        r#"
        INSERT INTO vaults (vault_id, created_at, updated_at)
        VALUES (?1, ?2, ?2)
        ON CONFLICT(vault_id) DO UPDATE SET updated_at = excluded.updated_at
        "#,
    )
    .bind(&vault_id)
    .bind(&now)
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

async fn get_vault_record(
    pool: &sqlx::SqlitePool,
    vault_id: &str,
) -> Result<Option<VaultRecord>, AppError> {
    let row = sqlx::query(
        r#"
        SELECT vaults.vault_id, vaults.created_at, vaults.updated_at, COUNT(devices.device_id) AS device_count
        FROM vaults
        LEFT JOIN devices ON devices.vault_id = vaults.vault_id
        WHERE vaults.vault_id = ?1
        GROUP BY vaults.vault_id, vaults.created_at, vaults.updated_at
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
        device_count: row.get("device_count"),
    }))
}

fn vault_record_to_dto(record: VaultRecord) -> VaultItem {
    VaultItem {
        vault_id: record.vault_id,
        created_at: record.created_at,
        updated_at: record.updated_at,
        device_count: record.device_count,
    }
}
