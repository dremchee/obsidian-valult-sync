use std::{
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use tokio::fs;

use crate::error::AppError;

pub fn validate_relative_path(path: &str) -> Result<String, AppError> {
    let candidate = Path::new(path);
    if candidate.as_os_str().is_empty() || candidate.is_absolute() {
        return Err(AppError::InvalidPath);
    }

    let mut normalized = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::InvalidPath);
            }
        }
    }

    let normalized = normalized.to_string_lossy().replace('\\', "/");
    if normalized.is_empty() {
        return Err(AppError::InvalidPath);
    }

    Ok(normalized)
}

pub fn validate_vault_id(vault_id: &str) -> Result<String, AppError> {
    let trimmed = vault_id.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidVaultId);
    }

    if trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        Ok(trimmed.to_string())
    } else {
        Err(AppError::InvalidVaultId)
    }
}

pub fn validate_device_id(device_id: &str) -> Result<String, AppError> {
    let trimmed = device_id.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidDeviceId);
    }

    if trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        Ok(trimmed.to_string())
    } else {
        Err(AppError::InvalidDeviceId)
    }
}

pub async fn write_file(
    storage_root: &Path,
    vault_id: &str,
    relative_path: &str,
    data: &[u8],
) -> Result<()> {
    let target = resolve_path(storage_root, vault_id, relative_path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .await
            .context("failed to create storage directory")?;
    }

    let temp_name = format!(
        ".{}.tmp-{}",
        target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("sync"),
        unique_suffix()
    );
    let temp_path = target.with_file_name(temp_name);

    fs::write(&temp_path, data)
        .await
        .context("failed to write temporary file")?;
    fs::rename(&temp_path, &target)
        .await
        .context("failed to atomically replace file")?;

    Ok(())
}

pub async fn read_file(
    storage_root: &Path,
    vault_id: &str,
    relative_path: &str,
) -> Result<Vec<u8>> {
    let path = resolve_path(storage_root, vault_id, relative_path)?;
    fs::read(path).await.context("failed to read file")
}

pub async fn delete_file(storage_root: &Path, vault_id: &str, relative_path: &str) -> Result<()> {
    let path = resolve_path(storage_root, vault_id, relative_path)?;
    match fs::remove_file(path).await {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).context("failed to delete file"),
    }
}

pub async fn rename_file(
    storage_root: &Path,
    vault_id: &str,
    from_relative_path: &str,
    to_relative_path: &str,
) -> Result<()> {
    let from_path = resolve_path(storage_root, vault_id, from_relative_path)?;
    let to_path = resolve_path(storage_root, vault_id, to_relative_path)?;
    if let Some(parent) = to_path.parent() {
        fs::create_dir_all(parent)
            .await
            .context("failed to create target directory")?;
    }

    fs::rename(&from_path, &to_path)
        .await
        .context("failed to atomically rename file")?;

    Ok(())
}

pub async fn write_file_version(
    storage_root: &Path,
    vault_id: &str,
    relative_path: &str,
    version: i64,
    data: &[u8],
) -> Result<()> {
    let target = resolve_version_path(storage_root, vault_id, relative_path, version)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .await
            .context("failed to create history directory")?;
    }

    let temp_name = format!(
        ".{}.tmp-{}",
        target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("history"),
        unique_suffix()
    );
    let temp_path = target.with_file_name(temp_name);

    fs::write(&temp_path, data)
        .await
        .context("failed to write temporary history file")?;
    fs::rename(&temp_path, &target)
        .await
        .context("failed to atomically replace history file")?;

    Ok(())
}

pub async fn read_file_version(
    storage_root: &Path,
    vault_id: &str,
    relative_path: &str,
    version: i64,
) -> Result<Vec<u8>> {
    let path = resolve_version_path(storage_root, vault_id, relative_path, version)?;
    fs::read(path).await.context("failed to read history file")
}

fn resolve_path(storage_root: &Path, vault_id: &str, relative_path: &str) -> Result<PathBuf> {
    let path = storage_root.join(vault_id).join(relative_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).context("failed to create parent directory")?;
    }
    Ok(path)
}

fn resolve_version_path(
    storage_root: &Path,
    vault_id: &str,
    relative_path: &str,
    version: i64,
) -> Result<PathBuf> {
    let normalized_relative_path = validate_relative_path(relative_path)?;
    let history_root = storage_root.join(vault_id).join(".history");
    let path = history_root
        .join(normalized_relative_path)
        .join(format!("{version}.bin"));
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).context("failed to create history parent directory")?;
    }
    Ok(path)
}

fn unique_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}
