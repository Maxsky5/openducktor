#[cfg(unix)]
use super::security::CONFIG_FILE_MODE;
use super::security::{enforce_directory_permissions, validate_config_access};
use anyhow::{anyhow, Context, Result};
use serde::{de::DeserializeOwned, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::{
    ffi::OsString, fs::OpenOptions, io::ErrorKind, io::Write, os::unix::fs::OpenOptionsExt,
    time::SystemTime,
};

#[cfg(unix)]
const MAX_TEMP_FILE_ATTEMPTS: u8 = 8;

pub(super) fn resolve_default_path(file_name: &str) -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("Unable to resolve user home directory"))?;
    Ok(home.join(".openducktor").join(file_name))
}

pub(super) fn should_enforce_private_parent_permissions(path: &Path, file_name: &str) -> bool {
    resolve_default_path(file_name)
        .map(|default_path| default_path == path)
        .unwrap_or(false)
}

pub(super) fn load_config_or_default<T, Normalize, PostLoad>(
    path: &Path,
    enforce_private_parent_permissions: bool,
    normalize: Normalize,
    post_load: PostLoad,
) -> Result<T>
where
    T: DeserializeOwned + Default,
    Normalize: FnOnce(&mut T) -> Result<()>,
    PostLoad: FnOnce(&mut T),
{
    if !path.exists() {
        return Ok(T::default());
    }

    validate_config_access(path, enforce_private_parent_permissions)?;

    let data = fs::read_to_string(path)
        .with_context(|| format!("Failed reading config file {}", path.display()))?;
    let mut parsed: T = serde_json::from_str(&data)
        .with_context(|| format!("Failed parsing config file {}", path.display()))?;
    normalize(&mut parsed)
        .with_context(|| format!("Failed normalizing config file {}", path.display()))?;
    post_load(&mut parsed);
    Ok(parsed)
}

pub(super) fn save_config<T, Normalize>(
    path: &Path,
    enforce_private_parent_permissions: bool,
    config: &T,
    normalize: Normalize,
) -> Result<()>
where
    T: Serialize + Clone,
    Normalize: FnOnce(&mut T) -> Result<()>,
{
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("Failed creating config directory {}", parent.display()))?;
        enforce_directory_permissions(parent, enforce_private_parent_permissions)?;
    }

    let mut normalized = config.clone();
    normalize(&mut normalized)
        .with_context(|| format!("Failed normalizing config file {}", path.display()))?;
    let payload = serde_json::to_string_pretty(&normalized)?;
    write_config_file(path, payload.as_bytes())?;
    validate_config_access(path, enforce_private_parent_permissions)?;
    Ok(())
}

fn write_config_file(path: &Path, contents: &[u8]) -> Result<()> {
    #[cfg(unix)]
    {
        write_config_file_atomic(path, contents)
    }

    #[cfg(not(unix))]
    {
        fs::write(path, contents)
            .with_context(|| format!("Failed writing config file {}", path.display()))?;
        Ok(())
    }
}

#[cfg(unix)]
fn write_config_file_atomic(path: &Path, contents: &[u8]) -> Result<()> {
    for attempt in 0..MAX_TEMP_FILE_ATTEMPTS {
        let temp_path = create_temporary_config_path(path, attempt)?;
        match OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(CONFIG_FILE_MODE)
            .open(&temp_path)
        {
            Ok(mut file) => {
                let write_result = (|| -> Result<()> {
                    file.write_all(contents).with_context(|| {
                        format!("Failed writing config temp file {}", temp_path.display())
                    })?;
                    file.sync_all().with_context(|| {
                        format!("Failed syncing config temp file {}", temp_path.display())
                    })?;
                    drop(file);
                    fs::rename(&temp_path, path).with_context(|| {
                        format!(
                            "Failed atomically replacing config file {} with {}",
                            path.display(),
                            temp_path.display()
                        )
                    })?;
                    Ok(())
                })();

                if let Err(error) = write_result {
                    if let Err(cleanup_error) = fs::remove_file(&temp_path) {
                        if cleanup_error.kind() != ErrorKind::NotFound {
                            return Err(error).with_context(|| {
                                format!(
                                    "Failed cleaning up config temp file {} after write failure: {}",
                                    temp_path.display(),
                                    cleanup_error
                                )
                            });
                        }
                    }
                    return Err(error);
                }

                return Ok(());
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(error).with_context(|| {
                    format!("Failed opening config temp file {}", temp_path.display())
                });
            }
        }
    }

    Err(anyhow!(
        "Failed creating unique temp file for config write at {} after {} attempts",
        path.display(),
        MAX_TEMP_FILE_ATTEMPTS
    ))
}

#[cfg(unix)]
fn create_temporary_config_path(path: &Path, attempt: u8) -> Result<PathBuf> {
    let parent = path.parent().ok_or_else(|| {
        anyhow!(
            "Config file path {} is invalid: missing parent directory",
            path.display()
        )
    })?;
    let file_name = path.file_name().ok_or_else(|| {
        anyhow!(
            "Config file path {} is invalid: missing file name",
            path.display()
        )
    })?;
    let nanos = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| anyhow!("System clock error while building temp config path: {error}"))?
        .as_nanos();
    let mut temp_name = OsString::from(".");
    temp_name.push(file_name);
    temp_name.push(format!(".tmp-{}-{nanos}-{attempt}", std::process::id()));
    Ok(parent.join(temp_name))
}
