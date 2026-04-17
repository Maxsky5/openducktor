use super::types::{
    AgentDefaults, AutopilotSettings, ChatSettings, GlobalGitConfig, KanbanSettings,
    PromptOverrides, RepoConfig, RepoGitConfig,
};
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

const CURRENT_GLOBAL_CONFIG_VERSION: u8 = 2;

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LegacyGlobalConfigV1 {
    pub version: u8,
    pub active_repo: Option<String>,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub git: GlobalGitConfig,
    #[serde(default)]
    pub chat: ChatSettings,
    #[serde(default)]
    pub kanban: KanbanSettings,
    #[serde(default)]
    pub autopilot: AutopilotSettings,
    #[serde(default)]
    pub global_prompt_overrides: PromptOverrides,
    #[serde(default)]
    pub repos: HashMap<String, LegacyRepoConfigV1>,
    #[serde(default)]
    pub recent_repos: Vec<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LegacyRepoConfigV1 {
    pub default_runtime_kind: String,
    pub worktree_base_path: Option<String>,
    #[serde(default = "default_branch_prefix")]
    pub branch_prefix: String,
    #[serde(default = "default_target_branch")]
    pub default_target_branch: super::types::GitTargetBranch,
    #[serde(default)]
    pub git: RepoGitConfig,
    #[serde(default)]
    pub trusted_hooks: bool,
    #[serde(default)]
    pub trusted_hooks_fingerprint: Option<String>,
    #[serde(default)]
    pub hooks: super::types::HookSet,
    #[serde(default)]
    pub dev_servers: Vec<super::types::RepoDevServerScript>,
    #[serde(default)]
    pub worktree_file_copies: Vec<String>,
    #[serde(default)]
    pub prompt_overrides: PromptOverrides,
    #[serde(default)]
    pub agent_defaults: AgentDefaults,
}

impl From<LegacyRepoConfigV1> for RepoConfig {
    fn from(value: LegacyRepoConfigV1) -> Self {
        Self {
            workspace_id: String::new(),
            workspace_name: String::new(),
            repo_path: String::new(),
            default_runtime_kind: value.default_runtime_kind,
            worktree_base_path: value.worktree_base_path,
            branch_prefix: value.branch_prefix,
            default_target_branch: value.default_target_branch,
            git: value.git,
            trusted_hooks: value.trusted_hooks,
            trusted_hooks_fingerprint: value.trusted_hooks_fingerprint,
            hooks: value.hooks,
            dev_servers: value.dev_servers,
            worktree_file_copies: value.worktree_file_copies,
            prompt_overrides: value.prompt_overrides,
            agent_defaults: value.agent_defaults,
        }
    }
}

pub(super) fn current_global_config_version() -> u8 {
    CURRENT_GLOBAL_CONFIG_VERSION
}

pub(super) fn default_theme() -> String {
    "light".to_string()
}

pub(super) fn default_branch_prefix() -> String {
    super::types::default_branch_prefix()
}

pub(super) fn default_target_branch() -> super::types::GitTargetBranch {
    super::types::default_target_branch()
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

/// Migrates legacy repo entries to canonical repository paths.
/// Returns a new HashMap keyed by canonical repo path, merging entries that resolve to the same path.
/// When collisions occur (multiple path variants resolve to the same canonical path),
/// prefers the entry referenced by active_repo to preserve the user's current configuration.
pub(super) fn migrate_legacy_repos_to_canonical_paths(
    repos: &mut HashMap<String, LegacyRepoConfigV1>,
    active_repo: Option<&String>,
) -> HashMap<String, LegacyRepoConfigV1> {
    let mut canonical_repos: HashMap<String, LegacyRepoConfigV1> = HashMap::new();
    // Track which canonical keys came from active_repo for collision resolution.
    let mut from_active_repo: HashMap<String, bool> = HashMap::new();

    // Collect all entries first to avoid borrowing issues.
    let entries: Vec<(String, LegacyRepoConfigV1)> =
        repos.iter().map(|(k, v)| (k.clone(), v.clone())).collect();

    // Sort entries lexicographically for deterministic processing.
    let mut entries: Vec<(String, LegacyRepoConfigV1)> = entries;
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    for (original_key, repo_config) in entries {
        match canonicalize_repo_path(&original_key) {
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
