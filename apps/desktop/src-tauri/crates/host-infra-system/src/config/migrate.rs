use super::types::RepoConfig;
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

/// Canonicalizes a workspace path key for use as a HashMap key.
/// This resolves symlinks and normalizes to absolute path to prevent
/// duplicate entries for the same logical repository.
pub(super) fn canonicalize_workspace_key(repo_path: &str) -> Result<String> {
    let path = Path::new(repo_path);
    // Note: We don't check path.exists() separately here to avoid TOCTOU race condition.
    // fs::canonicalize() will return an error for non-existent paths, which we handle.
    // For non-existent paths (e.g., stale config entries), we return the original path.
    if !path.exists() {
        return Ok(repo_path.to_string());
    }
    // Canonicalize resolves symlinks and normalizes the path.
    let canonical =
        fs::canonicalize(path).with_context(|| format!("Failed to canonicalize path: {}", repo_path))?;
    Ok(canonical.to_string_lossy().to_string())
}

/// Migrates the repos HashMap keys to canonical form.
/// Returns a new HashMap with canonical keys, merging entries that resolve to the same path.
/// When collisions occur (multiple path variants resolve to the same canonical path),
/// prefers the entry referenced by active_repo to preserve the user's current configuration.
pub(super) fn migrate_repos_to_canonical_keys(
    repos: &mut HashMap<String, RepoConfig>,
    active_repo: Option<&String>,
) -> HashMap<String, RepoConfig> {
    let mut canonical_repos: HashMap<String, RepoConfig> = HashMap::new();
    // Track which canonical keys came from active_repo for collision resolution.
    let mut from_active_repo: HashMap<String, bool> = HashMap::new();

    // Collect all entries first to avoid borrowing issues.
    let entries: Vec<(String, RepoConfig)> =
        repos.iter().map(|(k, v)| (k.clone(), v.clone())).collect();

    // Sort entries lexicographically for deterministic processing.
    let mut entries: Vec<(String, RepoConfig)> = entries;
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    for (original_key, repo_config) in entries {
        match canonicalize_workspace_key(&original_key) {
            Ok(canonical_key) => {
                // Deterministic collision resolution:
                // 1. If this canonical key doesn't exist, insert it.
                // 2. If it exists, prefer the entry that matches active_repo.
                // 3. Otherwise prefer the entry where original_key == canonical_key (the "true" entry).
                let is_from_active = active_repo.is_some_and(|active| active == &original_key);

                let should_insert = match canonical_repos.get(&canonical_key) {
                    None => true,
                    Some(_) => {
                        if is_from_active {
                            true
                        } else if from_active_repo.get(&canonical_key) == Some(&true) {
                            false
                        } else {
                            original_key == canonical_key
                        }
                    }
                };

                if should_insert {
                    canonical_repos.insert(canonical_key.clone(), repo_config);
                    from_active_repo.insert(canonical_key, is_from_active);
                }
            }
            Err(_) => {
                // If canonicalization fails, keep the original key.
                canonical_repos.insert(original_key.clone(), repo_config);
                from_active_repo.insert(
                    original_key.clone(),
                    active_repo.is_some_and(|active| active == &original_key),
                );
            }
        }
    }

    canonical_repos
}
