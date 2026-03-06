use super::migrate::{canonicalize_workspace_key, migrate_repos_to_canonical_keys};
use super::normalize::{normalize_global_config, normalize_repo_config, normalize_runtime_config};
use super::persistence::{
    load_config_or_default, resolve_default_path, save_config,
    should_enforce_private_parent_permissions,
};
use super::types::{hook_set_fingerprint, GlobalConfig, HookSet, RepoConfig, RuntimeConfig};
use anyhow::{anyhow, Result};
use host_domain::WorkspaceRecord;
use std::path::{Path, PathBuf};

fn has_configured_worktree(repo: &RepoConfig) -> bool {
    repo.worktree_base_path.is_some()
}

#[derive(Debug, Clone)]
pub struct AppConfigStore {
    pub(super) path: PathBuf,
    pub(super) enforce_private_parent_permissions: bool,
}

#[derive(Debug, Clone)]
pub struct RuntimeConfigStore {
    pub(super) path: PathBuf,
    pub(super) enforce_private_parent_permissions: bool,
}

const USER_SETTINGS_FILENAME: &str = "config.json";
const RUNTIME_SETTINGS_FILENAME: &str = "runtime-config.json";

impl Default for AppConfigStore {
    fn default() -> Self {
        Self::new().expect("failed to initialize config store")
    }
}

impl AppConfigStore {
    pub fn new() -> Result<Self> {
        Ok(Self {
            path: resolve_default_path(USER_SETTINGS_FILENAME)?,
            enforce_private_parent_permissions: true,
        })
    }

    pub fn from_path(path: PathBuf) -> Self {
        let enforce_private_parent_permissions =
            should_enforce_private_parent_permissions(&path, USER_SETTINGS_FILENAME);
        Self {
            path,
            enforce_private_parent_permissions,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> Result<GlobalConfig> {
        load_config_or_default(
            &self.path,
            self.enforce_private_parent_permissions,
            normalize_global_config,
            migrate_loaded_global_config,
        )
    }

    pub fn save(&self, config: &GlobalConfig) -> Result<()> {
        save_config(
            &self.path,
            self.enforce_private_parent_permissions,
            config,
            normalize_global_config,
        )
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

        let workspace_key = canonicalize_workspace_key(repo_path)?;
        self.update_workspace(workspace_key, |config, workspace_key| {
            config
                .repos
                .entry(workspace_key.to_string())
                .or_insert_with(RepoConfig::default);
            config.active_repo = Some(workspace_key.to_string());
            Ok(())
        })
    }

    pub fn select_workspace(&self, repo_path: &str) -> Result<WorkspaceRecord> {
        let workspace_key = workspace_lookup_key(repo_path);
        self.update_workspace(workspace_key, |config, workspace_key| {
            if !config.repos.contains_key(workspace_key) {
                return Err(anyhow!("Workspace not found in config: {repo_path}"));
            }
            config.active_repo = Some(workspace_key.to_string());
            Ok(())
        })
    }

    pub fn update_repo_config(
        &self,
        repo_path: &str,
        mut repo_config: RepoConfig,
    ) -> Result<WorkspaceRecord> {
        normalize_repo_config(&mut repo_config);

        let workspace_key = workspace_lookup_key(repo_path);
        self.update_workspace(workspace_key, move |config, workspace_key| {
            if !config.repos.contains_key(workspace_key) {
                return Err(anyhow!(
                    "Workspace not found in config: {repo_path}. Add/select the workspace before updating configuration."
                ));
            }
            config.repos.insert(workspace_key.to_string(), repo_config);
            if config.active_repo.is_none() {
                config.active_repo = Some(workspace_key.to_string());
            }
            Ok(())
        })
    }

    pub fn update_repo_hooks(
        &self,
        repo_path: &str,
        mut hooks: HookSet,
    ) -> Result<WorkspaceRecord> {
        let workspace_key = workspace_lookup_key(repo_path);
        let mut normalized_repo = RepoConfig {
            hooks,
            ..RepoConfig::default()
        };
        normalize_repo_config(&mut normalized_repo);
        hooks = normalized_repo.hooks;

        self.update_workspace(workspace_key, move |config, workspace_key| {
            let repo = config
                .repos
                .get_mut(workspace_key)
                .ok_or_else(|| anyhow!("Repository is not configured"))?;
            let previous_hooks = repo.hooks.clone();
            repo.hooks = hooks;
            if repo.hooks != previous_hooks {
                repo.trusted_hooks = false;
                repo.trusted_hooks_fingerprint = None;
            } else if repo.trusted_hooks {
                repo.trusted_hooks_fingerprint = Some(hook_set_fingerprint(&repo.hooks));
            }
            Ok(())
        })
    }

    pub fn repo_config(&self, repo_path: &str) -> Result<RepoConfig> {
        let workspace_key = workspace_lookup_key(repo_path);

        let config = self.load()?;
        config
            .repos
            .get(&workspace_key)
            .cloned()
            .ok_or_else(|| anyhow!("Repository is not configured in {}", self.path.display()))
    }

    pub fn repo_config_optional(&self, repo_path: &str) -> Result<Option<RepoConfig>> {
        let workspace_key = workspace_lookup_key(repo_path);

        let config = self.load()?;
        Ok(config.repos.get(&workspace_key).cloned())
    }

    pub fn set_repo_trust_hooks(
        &self,
        repo_path: &str,
        trusted: bool,
        trusted_fingerprint: Option<String>,
    ) -> Result<WorkspaceRecord> {
        let workspace_key = workspace_lookup_key(repo_path);
        self.update_workspace(workspace_key, move |config, workspace_key| {
            let repo = config
                .repos
                .get_mut(workspace_key)
                .ok_or_else(|| anyhow!("Repository is not configured"))?;
            repo.trusted_hooks = trusted;
            repo.trusted_hooks_fingerprint = if trusted { trusted_fingerprint } else { None };
            Ok(())
        })
    }

    pub fn get_theme(&self) -> Result<String> {
        Ok(self.load()?.theme)
    }

    pub fn set_theme(&self, theme: &str) -> Result<()> {
        self.update_config(|config| {
            config.theme = theme.to_string();
            Ok(())
        })
    }

    fn update_config<T>(&self, update: impl FnOnce(&mut GlobalConfig) -> Result<T>) -> Result<T> {
        let mut config = self.load()?;
        let output = update(&mut config)?;
        self.save(&config)?;
        Ok(output)
    }

    fn update_workspace(
        &self,
        workspace_key: String,
        update: impl FnOnce(&mut GlobalConfig, &str) -> Result<()>,
    ) -> Result<WorkspaceRecord> {
        self.update_config(|config| {
            update(config, &workspace_key)?;
            touch_recent(&mut config.recent_repos, &workspace_key);
            workspace_record(config, &workspace_key)
        })
    }
}

impl Default for RuntimeConfigStore {
    fn default() -> Self {
        Self::new().expect("failed to initialize runtime config store")
    }
}

impl RuntimeConfigStore {
    pub fn new() -> Result<Self> {
        Ok(Self {
            path: resolve_default_path(RUNTIME_SETTINGS_FILENAME)?,
            enforce_private_parent_permissions: true,
        })
    }

    pub fn from_path(path: PathBuf) -> Self {
        let enforce_private_parent_permissions =
            should_enforce_private_parent_permissions(&path, RUNTIME_SETTINGS_FILENAME);
        Self {
            path,
            enforce_private_parent_permissions,
        }
    }

    pub fn from_user_settings_store(config_store: &AppConfigStore) -> Self {
        let runtime_path = config_store
            .path
            .parent()
            .map_or_else(PathBuf::new, Path::to_path_buf)
            .join(RUNTIME_SETTINGS_FILENAME);
        Self {
            path: runtime_path,
            enforce_private_parent_permissions: config_store.enforce_private_parent_permissions,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> Result<RuntimeConfig> {
        load_config_or_default(
            &self.path,
            self.enforce_private_parent_permissions,
            normalize_runtime_config,
            |_| {},
        )
    }

    pub fn save(&self, config: &RuntimeConfig) -> Result<()> {
        save_config(
            &self.path,
            self.enforce_private_parent_permissions,
            config,
            normalize_runtime_config,
        )
    }
}

pub(crate) fn touch_recent(recent: &mut Vec<String>, repo_path: &str) {
    recent.retain(|entry| entry != repo_path);
    recent.insert(0, repo_path.to_string());
    recent.truncate(20);
}

fn migrate_loaded_global_config(config: &mut GlobalConfig) {
    // Pass active_repo to prefer the user's current configuration on collision.
    let canonical_repos =
        migrate_repos_to_canonical_keys(&mut config.repos, config.active_repo.as_ref());
    config.repos = canonical_repos;

    if let Some(active) = &config.active_repo {
        if let Ok(canonical_active) = canonicalize_workspace_key(active) {
            if config.repos.contains_key(&canonical_active) {
                config.active_repo = Some(canonical_active);
            }
        }
    }

    let mut canonical_recent: Vec<String> = Vec::new();
    for recent in &config.recent_repos {
        match canonicalize_workspace_key(recent) {
            Ok(canonical_recent_key) => {
                if config.repos.contains_key(&canonical_recent_key)
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
    config.recent_repos = canonical_recent;
}

fn workspace_lookup_key(repo_path: &str) -> String {
    canonicalize_workspace_key(repo_path).unwrap_or_else(|_| repo_path.to_string())
}

fn workspace_record(config: &GlobalConfig, workspace_key: &str) -> Result<WorkspaceRecord> {
    let repo = config
        .repos
        .get(workspace_key)
        .ok_or_else(|| anyhow!("Workspace disappeared from config"))?;
    Ok(WorkspaceRecord {
        path: workspace_key.to_string(),
        is_active: config.active_repo.as_deref() == Some(workspace_key),
        has_config: has_configured_worktree(repo),
        configured_worktree_base_path: repo.worktree_base_path.clone(),
    })
}
