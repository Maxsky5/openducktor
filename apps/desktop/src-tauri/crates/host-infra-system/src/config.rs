use anyhow::{anyhow, Context, Result};
use host_domain::WorkspaceRecord;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookSet {
    #[serde(default)]
    pub pre_start: Vec<String>,
    #[serde(default)]
    pub post_complete: Vec<String>,
}

impl Default for HookSet {
    fn default() -> Self {
        Self {
            pre_start: Vec::new(),
            post_complete: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelDefault {
    pub provider_id: String,
    pub model_id: String,
    #[serde(default)]
    pub variant: Option<String>,
    #[serde(default)]
    pub opencode_agent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefaults {
    #[serde(default)]
    pub spec: Option<AgentModelDefault>,
    #[serde(default)]
    pub planner: Option<AgentModelDefault>,
    #[serde(default)]
    pub build: Option<AgentModelDefault>,
    #[serde(default)]
    pub qa: Option<AgentModelDefault>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoConfig {
    pub worktree_base_path: Option<String>,
    #[serde(default = "default_branch_prefix")]
    pub branch_prefix: String,
    #[serde(default)]
    pub trusted_hooks: bool,
    #[serde(default)]
    pub hooks: HookSet,
    #[serde(default)]
    pub agent_defaults: AgentDefaults,
}

fn default_branch_prefix() -> String {
    "obp".to_string()
}

fn default_task_metadata_namespace() -> String {
    "openducktor".to_string()
}

fn normalize_optional_non_empty(value: Option<String>) -> Option<String> {
    value.and_then(|entry| {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_hook_commands(commands: &mut Vec<String>) {
    *commands = std::mem::take(commands)
        .into_iter()
        .filter_map(|command| {
            let trimmed = command.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .collect();
}

fn normalize_agent_model_default(value: &mut Option<AgentModelDefault>) {
    let Some(entry) = value.as_mut() else {
        return;
    };

    entry.provider_id = entry.provider_id.trim().to_string();
    entry.model_id = entry.model_id.trim().to_string();
    entry.variant = normalize_optional_non_empty(entry.variant.take());
    entry.opencode_agent = normalize_optional_non_empty(entry.opencode_agent.take());

    if entry.provider_id.is_empty() || entry.model_id.is_empty() {
        *value = None;
    }
}

fn normalize_repo_config(repo: &mut RepoConfig) {
    repo.worktree_base_path = normalize_optional_non_empty(repo.worktree_base_path.take());
    let branch_prefix = repo.branch_prefix.trim();
    repo.branch_prefix = if branch_prefix.is_empty() {
        default_branch_prefix()
    } else {
        branch_prefix.to_string()
    };
    normalize_hook_commands(&mut repo.hooks.pre_start);
    normalize_hook_commands(&mut repo.hooks.post_complete);
    normalize_agent_model_default(&mut repo.agent_defaults.spec);
    normalize_agent_model_default(&mut repo.agent_defaults.planner);
    normalize_agent_model_default(&mut repo.agent_defaults.build);
    normalize_agent_model_default(&mut repo.agent_defaults.qa);
}

fn normalize_global_config(config: &mut GlobalConfig) {
    let namespace = config.task_metadata_namespace.trim();
    config.task_metadata_namespace = if namespace.is_empty() {
        default_task_metadata_namespace()
    } else {
        namespace.to_string()
    };
    for repo in config.repos.values_mut() {
        normalize_repo_config(repo);
    }
}

/// Canonicalizes a workspace path key for use as a HashMap key.
/// This resolves symlinks and normalizes to absolute path to prevent
/// duplicate entries for the same logical repository.
fn canonicalize_workspace_key(repo_path: &str) -> Result<String> {
    let path = Path::new(repo_path);
    // If the path doesn't exist, we can't canonicalize it
    // Return the original path as-is for non-existent paths (e.g., stale config entries)
    if !path.exists() {
        return Ok(repo_path.to_string());
    }
    // Canonicalize resolves symlinks and normalizes the path
    let canonical = fs::canonicalize(path)
        .with_context(|| format!("Failed to canonicalize path: {}", repo_path))?;
    Ok(canonical.to_string_lossy().to_string())
}

/// Migrates the repos HashMap keys to canonical form.
/// Returns a new HashMap with canonical keys, merging entries that resolve to the same path.
fn migrate_repos_to_canonical_keys(
    repos: &mut HashMap<String, RepoConfig>,
) -> HashMap<String, RepoConfig> {
    let mut canonical_repos: HashMap<String, RepoConfig> = HashMap::new();

    // Collect all entries first to avoid borrowing issues
    let entries: Vec<(String, RepoConfig)> = repos
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();

    // Sort entries lexicographically for deterministic processing
    let mut entries: Vec<(String, RepoConfig)> = entries;
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    for (original_key, repo_config) in entries {
        match canonicalize_workspace_key(&original_key) {
            Ok(canonical_key) => {
                // Deterministic collision resolution:
                // 1. If this canonical key doesn't exist, insert it
                // 2. If it exists, only replace if original_key IS the canonical form
                //    (i.e., original_key == canonical_key means this is the "true" entry)
                // 3. Otherwise keep existing entry (first one wins, but now deterministic)
                let should_insert = match canonical_repos.get(&canonical_key) {
                    None => true,
                    Some(_) => original_key == canonical_key,
                };
                if should_insert {
                    canonical_repos.insert(canonical_key, repo_config);
                }
            }
            Err(_) => {
                // If canonicalization fails, keep the original key
                canonical_repos.insert(original_key, repo_config);
            }
        }
    }

    canonical_repos
}

fn has_configured_worktree(repo: &RepoConfig) -> bool {
    repo.worktree_base_path.is_some()
}

impl Default for RepoConfig {
    fn default() -> Self {
        Self {
            worktree_base_path: None,
            branch_prefix: default_branch_prefix(),
            trusted_hooks: false,
            hooks: HookSet::default(),
            agent_defaults: AgentDefaults::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftGuardrails {
    #[serde(default = "default_cpu")]
    pub cpu_high_watermark_percent: u8,
    #[serde(default = "default_mem")]
    pub min_free_memory_mb: u32,
    #[serde(default = "default_backoff")]
    pub backoff_seconds: u16,
}

const fn default_cpu() -> u8 {
    85
}
const fn default_mem() -> u32 {
    2048
}
const fn default_backoff() -> u16 {
    30
}

impl Default for SoftGuardrails {
    fn default() -> Self {
        Self {
            cpu_high_watermark_percent: default_cpu(),
            min_free_memory_mb: default_mem(),
            backoff_seconds: default_backoff(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerConfig {
    #[serde(default)]
    pub soft_guardrails: SoftGuardrails,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalConfig {
    pub version: u8,
    pub active_repo: Option<String>,
    #[serde(default = "default_task_metadata_namespace")]
    pub task_metadata_namespace: String,
    #[serde(default)]
    pub repos: HashMap<String, RepoConfig>,
    #[serde(default)]
    pub recent_repos: Vec<String>,
    #[serde(default)]
    pub scheduler: SchedulerConfig,
}

impl Default for GlobalConfig {
    fn default() -> Self {
        Self {
            version: 1,
            active_repo: None,
            task_metadata_namespace: default_task_metadata_namespace(),
            repos: HashMap::new(),
            recent_repos: Vec::new(),
            scheduler: SchedulerConfig::default(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct AppConfigStore {
    path: PathBuf,
}

impl Default for AppConfigStore {
    fn default() -> Self {
        Self::new().expect("failed to initialize config store")
    }
}

impl AppConfigStore {
    pub fn new() -> Result<Self> {
        let home =
            dirs::home_dir().ok_or_else(|| anyhow!("Unable to resolve user home directory"))?;
        let path = home.join(".openducktor").join("config.json");
        Ok(Self { path })
    }

    pub fn from_path(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> Result<GlobalConfig> {
        if !self.path.exists() {
            return Ok(GlobalConfig::default());
        }

        let data = fs::read_to_string(&self.path)
            .with_context(|| format!("Failed reading config file {}", self.path.display()))?;
        let mut parsed: GlobalConfig = serde_json::from_str(&data)
            .with_context(|| format!("Failed parsing config file {}", self.path.display()))?;
        normalize_global_config(&mut parsed);

        // Migrate repo keys to canonical form
        let canonical_repos = migrate_repos_to_canonical_keys(&mut parsed.repos);
        parsed.repos = canonical_repos;

        // Also migrate active_repo to canonical key if it exists
        if let Some(active) = &parsed.active_repo {
            if let Ok(canonical_active) = canonicalize_workspace_key(active) {
                // Only update if the canonical key exists in repos
                if parsed.repos.contains_key(&canonical_active) {
                    parsed.active_repo = Some(canonical_active);
                }
            }
        }

        // Migrate recent_repos to canonical keys
        let mut canonical_recent: Vec<String> = Vec::new();
        for recent in &parsed.recent_repos {
            match canonicalize_workspace_key(recent) {
                Ok(canonical_recent_key) => {
                    if parsed.repos.contains_key(&canonical_recent_key)
                        && !canonical_recent.contains(&canonical_recent_key)
                    {
                        canonical_recent.push(canonical_recent_key);
                    }
                }
                Err(_) => {
                    // Keep original if canonicalization fails
                    if !canonical_recent.contains(recent) {
                        canonical_recent.push(recent.clone());
                    }
                }
            }
        }
        parsed.recent_repos = canonical_recent;

        Ok(parsed)
    }

    pub fn task_metadata_namespace(&self) -> Result<String> {
        let config = self.load()?;
        let trimmed = config.task_metadata_namespace.trim();
        if trimmed.is_empty() {
            Ok(default_task_metadata_namespace())
        } else {
            Ok(trimmed.to_string())
        }
    }

    pub fn save(&self, config: &GlobalConfig) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).with_context(|| {
                format!("Failed creating config directory {}", parent.display())
            })?;
        }
        let mut normalized = config.clone();
        normalize_global_config(&mut normalized);
        let payload = serde_json::to_string_pretty(&normalized)?;
        fs::write(&self.path, payload)
            .with_context(|| format!("Failed writing config file {}", self.path.display()))?;
        Ok(())
    }

    pub fn list_workspaces(&self) -> Result<Vec<WorkspaceRecord>> {
        let config = self.load()?;
        let mut records: Vec<WorkspaceRecord> = config
            .repos
            .iter()
            .map(|(path, repo)| WorkspaceRecord {
                path: path.clone(),
                is_active: config.active_repo.as_deref() == Some(path.as_str()),
                has_config: has_configured_worktree(repo),
                configured_worktree_base_path: repo.worktree_base_path.clone(),
            })
            .collect();

        records.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(records)
    }

    pub fn add_workspace(&self, repo_path: &str) -> Result<WorkspaceRecord> {
        let path = Path::new(repo_path);
        if !path.exists() {
            return Err(anyhow!("Workspace path does not exist: {repo_path}"));
        }
        if !path.join(".git").exists() {
            return Err(anyhow!("Workspace is not a git repository: {repo_path}"));
        }

        // Canonicalize the path for use as a key
        let canonical_path = canonicalize_workspace_key(repo_path)?;

        let mut config = self.load()?;
        config
            .repos
            .entry(canonical_path.clone())
            .or_insert_with(RepoConfig::default);
        config.active_repo = Some(canonical_path.clone());
        touch_recent(&mut config.recent_repos, &canonical_path);
        self.save(&config)?;

        Ok(WorkspaceRecord {
            path: canonical_path.clone(),
            is_active: true,
            has_config: config
                .repos
                .get(&canonical_path)
                .map(has_configured_worktree)
                .unwrap_or(false),
            configured_worktree_base_path: config
                .repos
                .get(&canonical_path)
                .and_then(|repo| repo.worktree_base_path.clone()),
        })
    }

    pub fn select_workspace(&self, repo_path: &str) -> Result<WorkspaceRecord> {
        // Canonicalize the path for consistent key lookup
        let canonical_path = canonicalize_workspace_key(repo_path).unwrap_or_else(|_| repo_path.to_string());
        
        let mut config = self.load()?;
        if !config.repos.contains_key(&canonical_path) {
            return Err(anyhow!("Workspace not found in config: {repo_path}"));
        }
        config.active_repo = Some(canonical_path.clone());
        touch_recent(&mut config.recent_repos, &canonical_path);
        self.save(&config)?;

        let repo = config
            .repos
            .get(&canonical_path)
            .ok_or_else(|| anyhow!("Workspace disappeared from config"))?;
        Ok(WorkspaceRecord {
            path: canonical_path,
            is_active: true,
            has_config: has_configured_worktree(repo),
            configured_worktree_base_path: repo.worktree_base_path.clone(),
        })
    }

    pub fn update_repo_config(
        &self,
        repo_path: &str,
        mut repo_config: RepoConfig,
    ) -> Result<WorkspaceRecord> {
        normalize_repo_config(&mut repo_config);

        // Canonicalize the path for consistent key lookup
        let canonical_path = canonicalize_workspace_key(repo_path).unwrap_or_else(|_| repo_path.to_string());
        
        let mut config = self.load()?;
        config
            .repos
            .insert(canonical_path.clone(), repo_config.clone());
        if config.active_repo.is_none() {
            config.active_repo = Some(canonical_path.clone());
        }
        touch_recent(&mut config.recent_repos, &canonical_path);
        self.save(&config)?;

        Ok(WorkspaceRecord {
            path: canonical_path.clone(),
            is_active: config.active_repo.as_deref() == Some(&canonical_path),
            has_config: has_configured_worktree(&repo_config),
            configured_worktree_base_path: repo_config.worktree_base_path,
        })
    }

    pub fn repo_config(&self, repo_path: &str) -> Result<RepoConfig> {
        // Canonicalize the path for consistent key lookup
        let canonical_path = canonicalize_workspace_key(repo_path).unwrap_or_else(|_| repo_path.to_string());
        
        let config = self.load()?;
        config
            .repos
            .get(&canonical_path)
            .cloned()
            .ok_or_else(|| anyhow!("Repository is not configured in {}", self.path.display()))
    }

    pub fn repo_config_optional(&self, repo_path: &str) -> Result<Option<RepoConfig>> {
        // Canonicalize the path for consistent key lookup
        let canonical_path = canonicalize_workspace_key(repo_path).unwrap_or_else(|_| repo_path.to_string());
        
        let config = self.load()?;
        Ok(config.repos.get(&canonical_path).cloned())
    }

    pub fn set_repo_trust_hooks(&self, repo_path: &str, trusted: bool) -> Result<WorkspaceRecord> {
        // Canonicalize the path for consistent key lookup
        let canonical_path = canonicalize_workspace_key(repo_path).unwrap_or_else(|_| repo_path.to_string());
        
        let mut config = self.load()?;
        let (has_config, configured_worktree_base_path) = {
            let repo = config
                .repos
                .get_mut(&canonical_path)
                .ok_or_else(|| anyhow!("Repository is not configured"))?;
            repo.trusted_hooks = trusted;
            (
                has_configured_worktree(repo),
                repo.worktree_base_path.clone(),
            )
        };
        self.save(&config)?;

        Ok(WorkspaceRecord {
            path: canonical_path.clone(),
            is_active: config.active_repo.as_deref() == Some(&canonical_path),
            has_config,
            configured_worktree_base_path,
        })
    }
}

fn touch_recent(recent: &mut Vec<String>, repo_path: &str) {
    recent.retain(|entry| entry != repo_path);
    recent.insert(0, repo_path.to_string());
    recent.truncate(20);
}

#[cfg(test)]
mod tests {
    use super::{touch_recent, AppConfigStore, GlobalConfig, RepoConfig};
    use serde_json::json;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_path(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir().join(format!("openducktor-{name}-{nonce}"))
    }

    fn test_store(name: &str) -> (AppConfigStore, PathBuf) {
        let root = unique_temp_path(name);
        let path = root.join("config.json");
        (AppConfigStore { path }, root)
    }

    fn fake_git_workspace(path: &Path) {
        fs::create_dir_all(path.join(".git")).expect("git directory should be created");
    }

    #[test]
    fn load_missing_returns_default_config() {
        let (store, root) = test_store("load-default");
        let config = store.load().expect("load default");
        assert_eq!(config.version, 1);
        assert_eq!(config.task_metadata_namespace, "openducktor");
        assert!(config.repos.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn task_metadata_namespace_defaults_when_blank() {
        let (store, root) = test_store("namespace-default");
        let config = GlobalConfig {
            task_metadata_namespace: "   ".to_string(),
            ..GlobalConfig::default()
        };
        store.save(&config).expect("save config");

        let namespace = store.task_metadata_namespace().expect("namespace");
        assert_eq!(namespace, "openducktor");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn task_metadata_namespace_trims_non_empty_value() {
        let (store, root) = test_store("namespace-trim");
        let config = GlobalConfig {
            task_metadata_namespace: "  custom-ns  ".to_string(),
            ..GlobalConfig::default()
        };
        store.save(&config).expect("save config");

        let namespace = store.task_metadata_namespace().expect("namespace");
        assert_eq!(namespace, "custom-ns");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_add_select_and_update_persist_state() {
        let (store, root) = test_store("workspace-flow");
        let repo_a = root.join("repo-a");
        let repo_b = root.join("repo-b");
        fs::create_dir_all(repo_a.join(".git")).expect("repo a");
        fs::create_dir_all(repo_b.join(".git")).expect("repo b");

        let repo_a_str = repo_a.to_string_lossy().to_string();
        let repo_b_str = repo_b.to_string_lossy().to_string();
        // Canonical form (resolved absolute path)
        let repo_a_canonical = fs::canonicalize(&repo_a).unwrap().to_string_lossy().to_string();

        let added = store.add_workspace(&repo_a_str).expect("add workspace");
        assert!(added.is_active);
        // Path should now be in canonical form
        assert_eq!(added.path, repo_a_canonical);

        store.add_workspace(&repo_b_str).expect("add second");
        let selected = store.select_workspace(&repo_a_str).expect("select");
        assert!(selected.is_active);
        assert_eq!(selected.path, repo_a_canonical);

        let updated = store
            .update_repo_config(
                &repo_a_str,
                RepoConfig {
                    worktree_base_path: Some("/tmp/worktrees".to_string()),
                    branch_prefix: "duck".to_string(),
                    trusted_hooks: true,
                    hooks: Default::default(),
                    agent_defaults: Default::default(),
                },
            )
            .expect("update config");
        assert!(updated.has_config);
        assert_eq!(
            updated.configured_worktree_base_path.as_deref(),
            Some("/tmp/worktrees")
        );

        let workspaces = store.list_workspaces().expect("list workspaces");
        assert_eq!(workspaces.len(), 2);
        // Paths should be in canonical form
        assert_eq!(workspaces[0].path, repo_a_canonical);
        assert!(workspaces[0].is_active);

        let loaded = store.load().expect("load final");
        assert_eq!(
            loaded.recent_repos.first().map(String::as_str),
            Some(repo_a_canonical.as_str())
        );
        assert_eq!(
            loaded
                .repos
                .get(&repo_a_canonical)
                .and_then(|entry| entry.worktree_base_path.as_deref()),
            Some("/tmp/worktrees")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn add_workspace_rejects_missing_and_non_git_paths() {
        let (store, root) = test_store("workspace-invalid");
        let missing = root.join("missing");
        let missing_error = store
            .add_workspace(missing.to_string_lossy().as_ref())
            .expect_err("missing path should fail");
        assert!(missing_error.to_string().contains("does not exist"));

        let non_git = root.join("plain-folder");
        fs::create_dir_all(&non_git).expect("plain folder should be created");
        let non_git_error = store
            .add_workspace(non_git.to_string_lossy().as_ref())
            .expect_err("non-git path should fail");
        assert!(non_git_error.to_string().contains("not a git repository"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn select_and_repo_config_accessors_report_missing_entries() {
        let (store, root) = test_store("workspace-missing-config");
        let missing_repo = root.join("missing-repo");
        let missing_repo_str = missing_repo.to_string_lossy().to_string();

        let select_error = store
            .select_workspace(missing_repo_str.as_str())
            .expect_err("missing workspace select should fail");
        assert!(select_error
            .to_string()
            .contains("Workspace not found in config"));

        let config_error = store
            .repo_config(missing_repo_str.as_str())
            .expect_err("repo config should fail when missing");
        assert!(config_error
            .to_string()
            .contains("Repository is not configured"));

        let optional = store
            .repo_config_optional(missing_repo_str.as_str())
            .expect("optional lookup should succeed");
        assert!(optional.is_none());

        let trust_error = store
            .set_repo_trust_hooks(missing_repo_str.as_str(), true)
            .expect_err("set trust should fail when repo missing");
        assert!(trust_error
            .to_string()
            .contains("Repository is not configured"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn update_repo_config_sets_active_repo_and_trust_roundtrip() {
        let (store, root) = test_store("repo-config-roundtrip");
        let repo = root.join("repo-main");
        fake_git_workspace(&repo);
        let repo_str = repo.to_string_lossy().to_string();

        let updated = store
            .update_repo_config(
                repo_str.as_str(),
                RepoConfig {
                    worktree_base_path: Some(root.join("worktrees").to_string_lossy().to_string()),
                    branch_prefix: "duck".to_string(),
                    trusted_hooks: false,
                    hooks: Default::default(),
                    agent_defaults: Default::default(),
                },
            )
            .expect("repo config update should succeed");
        assert!(updated.is_active, "first update should mark repo active");
        assert!(updated.has_config);

        let trusted = store
            .set_repo_trust_hooks(repo_str.as_str(), true)
            .expect("set trust should succeed");
        assert!(trusted.is_active);
        assert!(trusted.has_config);
        assert!(trusted.configured_worktree_base_path.is_some());

        let repo_config = store
            .repo_config(repo_str.as_str())
            .expect("repo config should exist");
        assert!(repo_config.trusted_hooks);

        let optional = store
            .repo_config_optional(repo_str.as_str())
            .expect("optional lookup should succeed");
        assert!(optional.is_some());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn update_repo_config_normalizes_blank_worktree_path() {
        let (store, root) = test_store("normalize-worktree");
        let repo = root.join("repo");
        fs::create_dir_all(repo.join(".git")).expect("repo");
        let repo_str = repo.to_string_lossy().to_string();

        store.add_workspace(&repo_str).expect("add workspace");
        let updated = store
            .update_repo_config(
                &repo_str,
                RepoConfig {
                    worktree_base_path: Some("   ".to_string()),
                    branch_prefix: "duck".to_string(),
                    trusted_hooks: false,
                    hooks: Default::default(),
                    agent_defaults: Default::default(),
                },
            )
            .expect("update config");

        assert!(!updated.has_config);
        assert!(updated.configured_worktree_base_path.is_none());

        let loaded = store.repo_config(&repo_str).expect("load repo config");
        assert!(loaded.worktree_base_path.is_none());
        assert_eq!(loaded.branch_prefix, "duck");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn save_and_load_report_io_and_parse_errors() {
        let (store, root) = test_store("config-io-errors");

        fs::create_dir_all(&root).expect("temp root should exist");
        fs::write(store.path(), "{ invalid json").expect("invalid config should write");
        let parse_error = store.load().expect_err("invalid json should fail parsing");
        assert!(parse_error
            .to_string()
            .contains("Failed parsing config file"));

        let blocked_parent = root.join("not-a-directory");
        fs::write(&blocked_parent, "file").expect("blocking file should write");
        let blocked_store = AppConfigStore::from_path(blocked_parent.join("config.json"));
        let save_error = blocked_store
            .save(&GlobalConfig::default())
            .expect_err("save should fail when parent is a file");
        assert!(save_error
            .to_string()
            .contains("Failed creating config directory"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn app_config_store_constructors_expose_expected_paths() {
        let store = AppConfigStore::new().expect("new store should resolve home path");
        let resolved = store.path().to_string_lossy().to_string();
        assert!(
            resolved.ends_with("/.openducktor/config.json"),
            "unexpected config path: {resolved}"
        );

        let custom_path = unique_temp_path("custom-path").join("custom-config.json");
        let from_path = AppConfigStore::from_path(custom_path.clone());
        assert_eq!(from_path.path(), custom_path.as_path());
    }

    #[test]
    fn load_normalizes_legacy_blank_repo_config_values() {
        let (store, root) = test_store("normalize-legacy");
        let repo = root.join("repo");
        let repo_str = repo.to_string_lossy().to_string();

        fs::create_dir_all(store.path.parent().expect("config parent")).expect("create config dir");
        let mut repos = serde_json::Map::new();
        repos.insert(
            repo_str.clone(),
            json!({
                "worktreeBasePath": "",
                "branchPrefix": "   ",
                "trustedHooks": false,
                "hooks": {
                    "preStart": ["  echo pre  ", "   "],
                    "postComplete": ["  echo post  "]
                },
                "agentDefaults": {
                    "spec": {
                        "providerId": " openai ",
                        "modelId": " gpt-5 ",
                        "variant": "  ",
                        "opencodeAgent": "  "
                    }
                }
            }),
        );
        let payload = json!({
            "version": 1,
            "activeRepo": repo_str,
            "taskMetadataNamespace": "   ",
            "repos": repos,
            "recentRepos": [],
            "scheduler": {
                "softGuardrails": {
                    "cpuHighWatermarkPercent": 85,
                    "minFreeMemoryMb": 2048,
                    "backoffSeconds": 30
                }
            }
        });
        fs::write(
            &store.path,
            serde_json::to_string_pretty(&payload).expect("serialize payload"),
        )
        .expect("write config");

        let workspaces = store.list_workspaces().expect("list workspaces");
        assert_eq!(workspaces.len(), 1);
        assert!(!workspaces[0].has_config);
        assert!(workspaces[0].configured_worktree_base_path.is_none());

        let repo_config = store
            .repo_config(workspaces[0].path.as_str())
            .expect("repo config");
        assert!(repo_config.worktree_base_path.is_none());
        assert_eq!(repo_config.branch_prefix, "obp");
        assert_eq!(repo_config.hooks.pre_start, vec!["echo pre".to_string()]);
        assert_eq!(
            repo_config.hooks.post_complete,
            vec!["echo post".to_string()]
        );

        let spec = repo_config.agent_defaults.spec.expect("spec default");
        assert_eq!(spec.provider_id, "openai");
        assert_eq!(spec.model_id, "gpt-5");
        assert!(spec.variant.is_none());
        assert!(spec.opencode_agent.is_none());

        let namespace = store.task_metadata_namespace().expect("namespace");
        assert_eq!(namespace, "openducktor");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn touch_recent_keeps_latest_first_and_caps_size() {
        let mut recent = (0..25)
            .map(|index| format!("/tmp/repo-{index}"))
            .collect::<Vec<_>>();
        touch_recent(&mut recent, "/tmp/repo-3");

        assert_eq!(recent.first().map(String::as_str), Some("/tmp/repo-3"));
        assert_eq!(recent.len(), 20);
        assert_eq!(
            recent
                .iter()
                .filter(|entry| entry.as_str() == "/tmp/repo-3")
                .count(),
            1
        );
    }
}
