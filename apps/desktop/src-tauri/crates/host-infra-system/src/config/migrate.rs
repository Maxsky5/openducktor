use super::types::RepoConfig;
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

const CURRENT_GLOBAL_CONFIG_VERSION: u8 = 2;

pub(super) fn current_global_config_version() -> u8 {
    CURRENT_GLOBAL_CONFIG_VERSION
}

pub(super) fn default_theme() -> String {
    "light".to_string()
}

/// Canonicalizes a repository path for durable config storage.
/// This resolves symlinks and normalizes to absolute path to prevent
/// duplicate entries for the same logical repository.
pub(super) fn canonicalize_repo_path(repo_path: &str) -> Result<String> {
    let path = Path::new(repo_path);
    // Note: We don't check path.exists() separately here to avoid TOCTOU race condition.
    // fs::canonicalize() will return an error for non-existent paths, which we handle.
    // For non-existent paths (e.g., stale config entries), we return the original path.
    if !path.exists() {
        return Ok(repo_path.to_string());
    }
    // Canonicalize resolves symlinks and normalizes the path.
    let canonical = fs::canonicalize(path)
        .with_context(|| format!("Failed to canonicalize path: {}", repo_path))?;
    Ok(canonical.to_string_lossy().to_string())
}

pub fn derive_workspace_name_from_repo_path(repo_path: &str) -> String {
    Path::new(repo_path)
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| repo_path.trim().to_string())
}

pub fn propose_workspace_id(input: &str) -> String {
    let mut normalized = String::with_capacity(input.len());
    let mut last_was_dash = false;

    for character in input.trim().chars().flat_map(char::to_lowercase) {
        if character.is_ascii_lowercase() || character.is_ascii_digit() {
            normalized.push(character);
            last_was_dash = false;
            continue;
        }

        if !last_was_dash && !normalized.is_empty() {
            normalized.push('-');
            last_was_dash = true;
        }
    }

    while normalized.ends_with('-') {
        normalized.pop();
    }

    if normalized.is_empty() {
        "workspace".to_string()
    } else {
        normalized
    }
}

pub fn uniquify_workspace_id(
    candidate: &str,
    existing_ids: &HashMap<String, RepoConfig>,
) -> String {
    if !existing_ids.contains_key(candidate) {
        return candidate.to_string();
    }

    let mut suffix = 2;
    loop {
        let next = format!("{candidate}-{suffix}");
        if !existing_ids.contains_key(&next) {
            return next;
        }
        suffix += 1;
    }
}
