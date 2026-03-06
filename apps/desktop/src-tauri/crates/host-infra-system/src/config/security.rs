use anyhow::{anyhow, Context, Result};
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::Path;

#[cfg(unix)]
pub(super) const CONFIG_DIR_MODE: u32 = 0o700;
#[cfg(unix)]
pub(super) const CONFIG_FILE_MODE: u32 = 0o600;

pub(super) fn validate_config_access(
    path: &Path,
    enforce_private_parent_permissions: bool,
) -> Result<()> {
    #[cfg(unix)]
    {
        let parent = path.parent().ok_or_else(|| {
            anyhow!(
                "Config file path {} is invalid: missing parent directory",
                path.display()
            )
        })?;
        let expected_uid = current_effective_uid();
        if enforce_private_parent_permissions {
            validate_private_directory(parent, expected_uid)?;
        }
        validate_private_file(path, expected_uid)?;
    }
    Ok(())
}

pub(super) fn enforce_directory_permissions(
    path: &Path,
    enforce_private_parent_permissions: bool,
) -> Result<()> {
    #[cfg(unix)]
    {
        if enforce_private_parent_permissions {
            fs::set_permissions(path, fs::Permissions::from_mode(CONFIG_DIR_MODE)).with_context(
                || {
                    format!(
                        "Failed setting secure permissions on config directory {}",
                        path.display()
                    )
                },
            )?;
        }
    }
    Ok(())
}

#[cfg(unix)]
fn current_effective_uid() -> u32 {
    // SAFETY: geteuid has no preconditions and does not dereference pointers.
    unsafe { libc::geteuid() as u32 }
}

#[cfg(unix)]
fn validate_private_directory(path: &Path, expected_uid: u32) -> Result<()> {
    let metadata = fs::metadata(path).with_context(|| {
        format!(
            "Failed reading config directory metadata {}",
            path.display()
        )
    })?;
    let mode = metadata.mode() & 0o777;
    let owner_uid = metadata.uid();
    if owner_uid != expected_uid {
        return Err(anyhow!(
            "Config directory {} must be owned by the current user (uid {}). Found uid {}. Run `chown -R $(whoami) {}`.",
            path.display(),
            expected_uid,
            owner_uid,
            path.display()
        ));
    }
    if mode != CONFIG_DIR_MODE {
        return Err(anyhow!(
            "Config directory {} has unsupported mode {:04o}. Expected 0700 exactly. Run `chmod 700 {}`.",
            path.display(),
            mode,
            path.display()
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn validate_private_file(path: &Path, expected_uid: u32) -> Result<()> {
    let metadata = fs::metadata(path)
        .with_context(|| format!("Failed reading config file metadata {}", path.display()))?;
    let mode = metadata.mode() & 0o777;
    let owner_uid = metadata.uid();
    if owner_uid != expected_uid {
        return Err(anyhow!(
            "Config file {} must be owned by the current user (uid {}). Found uid {}. Run `chown $(whoami) {}`.",
            path.display(),
            expected_uid,
            owner_uid,
            path.display()
        ));
    }
    if mode != CONFIG_FILE_MODE {
        return Err(anyhow!(
            "Config file {} has unsupported mode {:04o}. Expected 0600 exactly. Run `chmod 600 {}`.",
            path.display(),
            mode,
            path.display()
        ));
    }
    Ok(())
}
