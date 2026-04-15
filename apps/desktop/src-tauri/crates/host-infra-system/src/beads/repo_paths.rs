use anyhow::{Context, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::env;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use crate::{config::resolve_openducktor_base_dir, parse_user_path};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoBeadsPaths {
    pub repo_id: String,
    pub attachment_root: PathBuf,
    pub attachment_dir: PathBuf,
    pub database_name: String,
    pub live_database_dir: PathBuf,
}

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
    let digest = format!("{:x}", hasher.finalize());
    let short_hash = &digest[..8];

    Ok(format!("{slug}-{short_hash}"))
}

pub fn compute_beads_database_name(repo_path: &Path) -> Result<String> {
    let resolved_repo_path = canonical_or_absolute(repo_path)?;
    let slug = sanitize_database_identifier(&compute_repo_slug(&resolved_repo_path));
    let digest = Sha256::digest(resolved_repo_path.to_string_lossy().as_bytes());
    build_database_name(slug.as_str(), &digest)
}

pub fn compute_beads_database_name_for_workspace(workspace_id: &str) -> Result<String> {
    let slug = sanitize_database_identifier(workspace_id.trim());
    let digest = Sha256::digest(workspace_id.trim().as_bytes());
    build_database_name(slug.as_str(), &digest)
}

fn build_database_name(slug: &str, digest: &impl fmt::LowerHex) -> Result<String> {
    let hash_suffix = format!("{digest:x}");
    let hash_suffix = &hash_suffix[..12];
    let max_slug_len = 64usize.saturating_sub("odt__".len() + hash_suffix.len());
    let truncated_slug = if slug.len() > max_slug_len {
        &slug[..max_slug_len]
    } else {
        slug
    };

    Ok(format!("odt_{truncated_slug}_{hash_suffix}"))
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

pub fn resolve_repo_beads_paths(repo_path: &Path) -> Result<RepoBeadsPaths> {
    let repo_id = compute_repo_id(repo_path)?;
    let attachment_root = resolve_beads_root()?.join(&repo_id);
    let attachment_dir = attachment_root.join(".beads");
    let database_name = compute_beads_database_name(repo_path)?;
    let live_database_dir = resolve_shared_dolt_root()?.join(&database_name);

    Ok(RepoBeadsPaths {
        repo_id,
        attachment_root,
        attachment_dir,
        database_name,
        live_database_dir,
    })
}

pub fn resolve_workspace_beads_paths(workspace_id: &str) -> Result<RepoBeadsPaths> {
    let repo_id = compute_workspace_repo_id(workspace_id);
    let attachment_root = resolve_beads_root()?.join(&repo_id);
    let attachment_dir = attachment_root.join(".beads");
    let database_name = compute_beads_database_name_for_workspace(workspace_id)?;
    let live_database_dir = resolve_shared_dolt_root()?.join(&database_name);

    Ok(RepoBeadsPaths {
        repo_id,
        attachment_root,
        attachment_dir,
        database_name,
        live_database_dir,
    })
}

pub(crate) fn adopt_legacy_workspace_namespace(repo_path: &Path, workspace_id: &str) -> Result<()> {
    let legacy_paths = resolve_repo_beads_paths(repo_path)?;
    let workspace_paths = resolve_workspace_beads_paths(workspace_id)?;
    let legacy_worktree_dir = resolve_default_worktree_base_dir(repo_path)?;
    let workspace_worktree_dir = resolve_default_worktree_base_dir_for_workspace(workspace_id)?;

    ensure_adoption_target_available(
        "Beads attachment root",
        &legacy_paths.attachment_root,
        &workspace_paths.attachment_root,
    )?;
    ensure_adoption_target_available(
        "shared Dolt database directory",
        &legacy_paths.live_database_dir,
        &workspace_paths.live_database_dir,
    )?;
    ensure_adoption_target_available(
        "default worktree directory",
        &legacy_worktree_dir,
        &workspace_worktree_dir,
    )?;

    let moved_attachment = adopt_directory_if_present(
        "Beads attachment root",
        &legacy_paths.attachment_root,
        &workspace_paths.attachment_root,
    )?;
    let moved_database = adopt_directory_if_present(
        "shared Dolt database directory",
        &legacy_paths.live_database_dir,
        &workspace_paths.live_database_dir,
    )?;
    adopt_directory_if_present(
        "default worktree directory",
        &legacy_worktree_dir,
        &workspace_worktree_dir,
    )?;

    if moved_attachment || moved_database {
        rewrite_attachment_metadata_database(
            &workspace_paths.attachment_dir,
            workspace_paths.database_name.as_str(),
        )?;
    }

    Ok(())
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

fn resolve_repo_scoped_openducktor_dir(repo_path: &Path, namespace: &str) -> Result<PathBuf> {
    let base_dir = resolve_openducktor_base_dir()?;
    let repo_id = compute_repo_id(repo_path)?;
    Ok(base_dir.join(namespace).join(repo_id))
}

fn ensure_adoption_target_available(label: &str, source: &Path, target: &Path) -> Result<()> {
    if source == target || !source.exists() || !target.exists() {
        return Ok(());
    }

    Err(anyhow::anyhow!(
        "Cannot adopt legacy {label}: both legacy source {} and workspace target {} exist",
        source.display(),
        target.display()
    ))
}

fn adopt_directory_if_present(label: &str, source: &Path, target: &Path) -> Result<bool> {
    if source == target || !source.exists() {
        return Ok(false);
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "Failed creating parent directory for adopted {label} at {}",
                parent.display()
            )
        })?;
    }

    fs::rename(source, target).with_context(|| {
        format!(
            "Failed adopting legacy {label} from {} to {}",
            source.display(),
            target.display()
        )
    })?;

    Ok(true)
}

fn rewrite_attachment_metadata_database(beads_dir: &Path, database_name: &str) -> Result<()> {
    let metadata_path = beads_dir.join("metadata.json");
    if !metadata_path.exists() {
        return Ok(());
    }

    let metadata = fs::read_to_string(&metadata_path).with_context(|| {
        format!(
            "Failed reading attachment metadata {}",
            metadata_path.display()
        )
    })?;
    let mut payload: Value = serde_json::from_str(&metadata).with_context(|| {
        format!(
            "Failed parsing attachment metadata {} while adopting legacy Beads namespace",
            metadata_path.display()
        )
    })?;
    let object = payload.as_object_mut().ok_or_else(|| {
        anyhow::anyhow!(
            "Failed adopting legacy Beads namespace: attachment metadata {} is not a JSON object",
            metadata_path.display()
        )
    })?;
    object.insert(
        "dolt_database".to_string(),
        Value::String(database_name.to_string()),
    );

    fs::write(&metadata_path, serde_json::to_string(&payload)?).with_context(|| {
        format!(
            "Failed rewriting attachment metadata {} for adopted workspace database {}",
            metadata_path.display(),
            database_name
        )
    })?;

    Ok(())
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
