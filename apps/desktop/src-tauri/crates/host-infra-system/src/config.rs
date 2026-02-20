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
        let parsed: GlobalConfig = serde_json::from_str(&data)
            .with_context(|| format!("Failed parsing config file {}", self.path.display()))?;
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
        let payload = serde_json::to_string_pretty(config)?;
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
                has_config: repo.worktree_base_path.is_some(),
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

        let mut config = self.load()?;
        config
            .repos
            .entry(repo_path.to_string())
            .or_insert_with(RepoConfig::default);
        config.active_repo = Some(repo_path.to_string());
        touch_recent(&mut config.recent_repos, repo_path);
        self.save(&config)?;

        Ok(WorkspaceRecord {
            path: repo_path.to_string(),
            is_active: true,
            has_config: config
                .repos
                .get(repo_path)
                .and_then(|repo| repo.worktree_base_path.as_ref())
                .is_some(),
            configured_worktree_base_path: config
                .repos
                .get(repo_path)
                .and_then(|repo| repo.worktree_base_path.clone()),
        })
    }

    pub fn select_workspace(&self, repo_path: &str) -> Result<WorkspaceRecord> {
        let mut config = self.load()?;
        if !config.repos.contains_key(repo_path) {
            return Err(anyhow!("Workspace not found in config: {repo_path}"));
        }
        config.active_repo = Some(repo_path.to_string());
        touch_recent(&mut config.recent_repos, repo_path);
        self.save(&config)?;

        let repo = config
            .repos
            .get(repo_path)
            .ok_or_else(|| anyhow!("Workspace disappeared from config"))?;
        Ok(WorkspaceRecord {
            path: repo_path.to_string(),
            is_active: true,
            has_config: repo.worktree_base_path.is_some(),
            configured_worktree_base_path: repo.worktree_base_path.clone(),
        })
    }

    pub fn update_repo_config(
        &self,
        repo_path: &str,
        repo_config: RepoConfig,
    ) -> Result<WorkspaceRecord> {
        let mut config = self.load()?;
        config
            .repos
            .insert(repo_path.to_string(), repo_config.clone());
        if config.active_repo.is_none() {
            config.active_repo = Some(repo_path.to_string());
        }
        touch_recent(&mut config.recent_repos, repo_path);
        self.save(&config)?;

        Ok(WorkspaceRecord {
            path: repo_path.to_string(),
            is_active: config.active_repo.as_deref() == Some(repo_path),
            has_config: repo_config.worktree_base_path.is_some(),
            configured_worktree_base_path: repo_config.worktree_base_path,
        })
    }

    pub fn repo_config(&self, repo_path: &str) -> Result<RepoConfig> {
        let config = self.load()?;
        config
            .repos
            .get(repo_path)
            .cloned()
            .ok_or_else(|| anyhow!("Repository is not configured in {}", self.path.display()))
    }

    pub fn repo_config_optional(&self, repo_path: &str) -> Result<Option<RepoConfig>> {
        let config = self.load()?;
        Ok(config.repos.get(repo_path).cloned())
    }

    pub fn set_repo_trust_hooks(&self, repo_path: &str, trusted: bool) -> Result<WorkspaceRecord> {
        let mut config = self.load()?;
        let (has_config, configured_worktree_base_path) = {
            let repo = config
                .repos
                .get_mut(repo_path)
                .ok_or_else(|| anyhow!("Repository is not configured"))?;
            repo.trusted_hooks = trusted;
            (
                repo.worktree_base_path.is_some(),
                repo.worktree_base_path.clone(),
            )
        };
        self.save(&config)?;

        Ok(WorkspaceRecord {
            path: repo_path.to_string(),
            is_active: config.active_repo.as_deref() == Some(repo_path),
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

        let added = store.add_workspace(&repo_a_str).expect("add workspace");
        assert!(added.is_active);
        assert_eq!(added.path, repo_a_str);

        store.add_workspace(&repo_b_str).expect("add second");
        let selected = store.select_workspace(&repo_a_str).expect("select");
        assert!(selected.is_active);

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
        assert_eq!(workspaces[0].path, repo_a_str);
        assert!(workspaces[0].is_active);

        let loaded = store.load().expect("load final");
        assert_eq!(
            loaded.recent_repos.first().map(String::as_str),
            Some(repo_a_str.as_str())
        );
        assert_eq!(
            loaded
                .repos
                .get(&repo_a_str)
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
        assert!(select_error.to_string().contains("Workspace not found in config"));

        let config_error = store
            .repo_config(missing_repo_str.as_str())
            .expect_err("repo config should fail when missing");
        assert!(config_error.to_string().contains("Repository is not configured"));

        let optional = store
            .repo_config_optional(missing_repo_str.as_str())
            .expect("optional lookup should succeed");
        assert!(optional.is_none());

        let trust_error = store
            .set_repo_trust_hooks(missing_repo_str.as_str(), true)
            .expect_err("set trust should fail when repo missing");
        assert!(trust_error.to_string().contains("Repository is not configured"));
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
    fn save_and_load_report_io_and_parse_errors() {
        let (store, root) = test_store("config-io-errors");

        fs::create_dir_all(&root).expect("temp root should exist");
        fs::write(store.path(), "{ invalid json").expect("invalid config should write");
        let parse_error = store.load().expect_err("invalid json should fail parsing");
        assert!(parse_error.to_string().contains("Failed parsing config file"));

        let blocked_parent = root.join("not-a-directory");
        fs::write(&blocked_parent, "file").expect("blocking file should write");
        let blocked_store = AppConfigStore::from_path(blocked_parent.join("config.json"));
        let save_error = blocked_store
            .save(&GlobalConfig::default())
            .expect_err("save should fail when parent is a file");
        assert!(save_error.to_string().contains("Failed creating config directory"));
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
