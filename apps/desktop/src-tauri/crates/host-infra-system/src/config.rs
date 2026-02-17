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
        let path = home.join(".openblueprint").join("config.json");
        Ok(Self { path })
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
