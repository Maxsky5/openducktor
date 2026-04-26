use anyhow::{Context, Result};
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use crate::{config::resolve_openducktor_base_dir, parse_user_path};

pub fn compute_repo_slug(repo_path: &Path) -> String {
    let candidate = repo_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("repo");
    sanitize_slug(candidate)
}

pub fn compute_workspace_repo_id(workspace_id: &str) -> String {
    workspace_id.trim().to_string()
}

pub fn compute_repo_id(repo_path: &Path) -> Result<String> {
    let resolved = canonical_or_absolute(repo_path)?;
    let canonical_string = resolved.to_string_lossy().to_string();
    let slug = compute_repo_slug(&resolved);

    let mut hasher = Sha256::new();
    hasher.update(canonical_string.as_bytes());
    let digest = hex_encode(hasher.finalize().as_ref());
    let short_hash = &digest[..8];

    Ok(format!("{slug}-{short_hash}"))
}

pub fn compute_beads_database_name(repo_path: &Path) -> Result<String> {
    let resolved_repo_path = canonical_or_absolute(repo_path)?;
    let slug = sanitize_database_identifier(&compute_repo_slug(&resolved_repo_path));
    let digest = Sha256::digest(resolved_repo_path.to_string_lossy().as_bytes());
    build_database_name(slug.as_str(), digest.as_ref())
}

pub fn compute_beads_database_name_for_workspace(workspace_id: &str) -> Result<String> {
    let slug = sanitize_database_identifier(workspace_id.trim());
    let digest = Sha256::digest(workspace_id.trim().as_bytes());
    build_database_name(slug.as_str(), digest.as_ref())
}

fn build_database_name(slug: &str, digest: &[u8]) -> Result<String> {
    let hash_suffix = hex_encode(digest);
    let hash_suffix = &hash_suffix[..12];
    let max_slug_len = 64usize.saturating_sub("odt__".len() + hash_suffix.len());
    let truncated_slug = if slug.len() > max_slug_len {
        &slug[..max_slug_len]
    } else {
        slug
    };

    Ok(format!("odt_{truncated_slug}_{hash_suffix}"))
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn resolve_beads_root() -> Result<PathBuf> {
    Ok(resolve_openducktor_base_dir()?.join("beads"))
}

pub fn resolve_shared_server_root() -> Result<PathBuf> {
    Ok(resolve_beads_root()?.join("shared-server"))
}

pub fn resolve_shared_dolt_root() -> Result<PathBuf> {
    Ok(resolve_shared_server_root()?.join("dolt"))
}

pub fn resolve_dolt_config_dir() -> Result<PathBuf> {
    Ok(resolve_shared_server_root()?.join(".doltcfg"))
}

pub fn resolve_dolt_config_file() -> Result<PathBuf> {
    Ok(resolve_shared_server_root()?.join("dolt-config.yaml"))
}

pub fn resolve_server_state_file() -> Result<PathBuf> {
    Ok(resolve_shared_server_root()?.join("server.json"))
}

pub fn resolve_server_lock_file() -> Result<PathBuf> {
    Ok(resolve_shared_server_root()?.join("server.lock"))
}

pub fn resolve_repo_beads_attachment_root(repo_path: &Path) -> Result<PathBuf> {
    Ok(resolve_beads_root()?.join(compute_repo_id(repo_path)?))
}

pub fn resolve_workspace_beads_attachment_root(workspace_id: &str) -> Result<PathBuf> {
    Ok(resolve_beads_root()?.join(compute_workspace_repo_id(workspace_id)))
}

pub fn resolve_repo_beads_attachment_dir(repo_path: &Path) -> Result<PathBuf> {
    Ok(resolve_repo_beads_attachment_root(repo_path)?.join(".beads"))
}

pub fn resolve_workspace_beads_attachment_dir(workspace_id: &str) -> Result<PathBuf> {
    Ok(resolve_workspace_beads_attachment_root(workspace_id)?.join(".beads"))
}

pub fn resolve_repo_live_database_dir(repo_path: &Path) -> Result<PathBuf> {
    Ok(resolve_shared_dolt_root()?.join(compute_beads_database_name(repo_path)?))
}

pub fn resolve_workspace_live_database_dir(workspace_id: &str) -> Result<PathBuf> {
    Ok(resolve_shared_dolt_root()?.join(compute_beads_database_name_for_workspace(workspace_id)?))
}

pub fn resolve_default_worktree_base_dir(repo_path: &Path) -> Result<PathBuf> {
    resolve_repo_scoped_openducktor_dir(repo_path, "worktrees")
}

pub fn resolve_default_worktree_base_dir_for_workspace(workspace_id: &str) -> Result<PathBuf> {
    let base_dir = resolve_openducktor_base_dir()?;
    Ok(base_dir
        .join("worktrees")
        .join(compute_workspace_repo_id(workspace_id)))
}

pub fn resolve_effective_worktree_base_dir(
    repo_path: &Path,
    configured_worktree_base_path: Option<&str>,
) -> Result<PathBuf> {
    match configured_worktree_base_path {
        Some(configured_path) => parse_user_path(configured_path),
        None => resolve_default_worktree_base_dir(repo_path),
    }
}

pub fn resolve_effective_worktree_base_dir_for_workspace(
    workspace_id: &str,
    configured_worktree_base_path: Option<&str>,
) -> Result<PathBuf> {
    match configured_worktree_base_path {
        Some(configured_path) => parse_user_path(configured_path),
        None => resolve_default_worktree_base_dir_for_workspace(workspace_id),
    }
}

fn resolve_repo_scoped_openducktor_dir(repo_path: &Path, namespace: &str) -> Result<PathBuf> {
    let base_dir = resolve_openducktor_base_dir()?;
    let repo_id = compute_repo_id(repo_path)?;
    Ok(base_dir.join(namespace).join(repo_id))
}

pub(crate) fn canonical_or_absolute(path: &Path) -> Result<PathBuf> {
    canonical_or_absolute_from(
        path,
        &env::current_dir().context("Unable to resolve current working directory")?,
    )
}

fn canonical_or_absolute_from(path: &Path, base_dir: &Path) -> Result<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        base_dir.join(path)
    };

    Ok(fs::canonicalize(&absolute).unwrap_or(absolute))
}

fn sanitize_slug(input: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;

    for character in input.chars() {
        let lower = character.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() {
            slug.push(lower);
            last_dash = false;
            continue;
        }

        if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }

    while slug.starts_with('-') {
        slug.remove(0);
    }
    while slug.ends_with('-') {
        slug.pop();
    }

    if slug.is_empty() {
        "repo".to_string()
    } else {
        slug
    }
}

fn sanitize_database_identifier(input: &str) -> String {
    let sanitized = input
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>();
    let trimmed = sanitized.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "repo".to_string()
    } else {
        trimmed
    }
}
