use super::migrate::{canonicalize_workspace_key, migrate_repos_to_canonical_keys};
use super::normalize::{normalize_global_config, normalize_repo_config};
use super::types::{
    hook_set_fingerprint, GlobalConfig, HookSet, OpencodeStartupReadinessConfig, RepoConfig,
};
use anyhow::{anyhow, Context, Result};
use host_domain::WorkspaceRecord;
use std::fs;
use std::path::{Path, PathBuf};

fn has_configured_worktree(repo: &RepoConfig) -> bool {
    repo.worktree_base_path.is_some()
}

#[derive(Debug, Clone)]
pub struct AppConfigStore {
    pub(super) path: PathBuf,
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

        // Migrate repo keys to canonical form.
        // Pass active_repo to prefer the user's current configuration on collision.
        let canonical_repos =
            migrate_repos_to_canonical_keys(&mut parsed.repos, parsed.active_repo.as_ref());
        parsed.repos = canonical_repos;

        // Also migrate active_repo to canonical key if it exists.
        if let Some(active) = &parsed.active_repo {
            if let Ok(canonical_active) = canonicalize_workspace_key(active) {
                if parsed.repos.contains_key(&canonical_active) {
                    parsed.active_repo = Some(canonical_active);
                }
            }
        }

        // Migrate recent_repos to canonical keys.
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
                    if !canonical_recent.contains(recent) {
                        canonical_recent.push(recent.clone());
                    }
                }
            }
        }
        parsed.recent_repos = canonical_recent;

        Ok(parsed)
    }

    pub fn opencode_startup_readiness(&self) -> Result<OpencodeStartupReadinessConfig> {
        Ok(self.load()?.opencode_startup)
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
        let canonical_path =
            canonicalize_workspace_key(repo_path).unwrap_or_else(|_| repo_path.to_string());

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

        let canonical_path =
            canonicalize_workspace_key(repo_path).unwrap_or_else(|_| repo_path.to_string());

        let mut config = self.load()?;
        if !config.repos.contains_key(&canonical_path) {
            return Err(anyhow!(
                "Workspace not found in config: {repo_path}. Add/select the workspace before updating configuration."
            ));
        }
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

    pub fn update_repo_hooks(
        &self,
        repo_path: &str,
        mut hooks: HookSet,
    ) -> Result<WorkspaceRecord> {
        let canonical_path =
            canonicalize_workspace_key(repo_path).unwrap_or_else(|_| repo_path.to_string());
        let mut normalized_repo = RepoConfig {
            hooks,
            ..RepoConfig::default()
        };
        normalize_repo_config(&mut normalized_repo);
        hooks = normalized_repo.hooks;

        let mut config = self.load()?;
        let (has_config, configured_worktree_base_path) = {
            let repo = config
                .repos
                .get_mut(&canonical_path)
                .ok_or_else(|| anyhow!("Repository is not configured"))?;
            let previous_hooks = repo.hooks.clone();
            repo.hooks = hooks;
            if repo.hooks != previous_hooks {
                repo.trusted_hooks = false;
                repo.trusted_hooks_fingerprint = None;
            } else if repo.trusted_hooks {
                repo.trusted_hooks_fingerprint = Some(hook_set_fingerprint(&repo.hooks));
            }
            (
                has_configured_worktree(repo),
                repo.worktree_base_path.clone(),
            )
        };
        touch_recent(&mut config.recent_repos, &canonical_path);
        self.save(&config)?;

        Ok(WorkspaceRecord {
            path: canonical_path.clone(),
            is_active: config.active_repo.as_deref() == Some(&canonical_path),
            has_config,
            configured_worktree_base_path,
        })
    }

    pub fn repo_config(&self, repo_path: &str) -> Result<RepoConfig> {
        let canonical_path =
            canonicalize_workspace_key(repo_path).unwrap_or_else(|_| repo_path.to_string());

        let config = self.load()?;
        config
            .repos
            .get(&canonical_path)
            .cloned()
            .ok_or_else(|| anyhow!("Repository is not configured in {}", self.path.display()))
    }

    pub fn repo_config_optional(&self, repo_path: &str) -> Result<Option<RepoConfig>> {
        let canonical_path =
            canonicalize_workspace_key(repo_path).unwrap_or_else(|_| repo_path.to_string());

        let config = self.load()?;
        Ok(config.repos.get(&canonical_path).cloned())
    }

    pub fn set_repo_trust_hooks(
        &self,
        repo_path: &str,
        trusted: bool,
        trusted_fingerprint: Option<String>,
    ) -> Result<WorkspaceRecord> {
        let canonical_path =
            canonicalize_workspace_key(repo_path).unwrap_or_else(|_| repo_path.to_string());

        let mut config = self.load()?;
        let (has_config, configured_worktree_base_path) = {
            let repo = config
                .repos
                .get_mut(&canonical_path)
                .ok_or_else(|| anyhow!("Repository is not configured"))?;
            repo.trusted_hooks = trusted;
            repo.trusted_hooks_fingerprint = if trusted { trusted_fingerprint } else { None };
            (
                has_configured_worktree(repo),
                repo.worktree_base_path.clone(),
            )
        };
        touch_recent(&mut config.recent_repos, &canonical_path);
        self.save(&config)?;

        Ok(WorkspaceRecord {
            path: canonical_path.clone(),
            is_active: config.active_repo.as_deref() == Some(&canonical_path),
            has_config,
            configured_worktree_base_path,
        })
    }

    pub fn get_theme(&self) -> Result<String> {
        Ok(self.load()?.theme)
    }

    pub fn set_theme(&self, theme: &str) -> Result<()> {
        let mut config = self.load()?;
        config.theme = theme.to_string();
        self.save(&config)
    }
}

pub(crate) fn touch_recent(recent: &mut Vec<String>, repo_path: &str) {
    recent.retain(|entry| entry != repo_path);
    recent.insert(0, repo_path.to_string());
    recent.truncate(20);
}
