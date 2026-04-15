use super::migrate::canonicalize_repo_path;
use super::normalize::{
    normalize_global_config, normalize_hook_set, normalize_repo_config, normalize_runtime_config,
};
use super::persistence::{
    load_config_or_default, resolve_default_path, save_config,
    should_enforce_private_parent_permissions,
};
use super::types::{repo_script_fingerprint, GlobalConfig, HookSet, RepoConfig, RuntimeConfig};
use crate::beads::adopt_legacy_workspace_namespace;
use crate::{parse_user_path, resolve_default_worktree_base_dir_for_workspace};
use anyhow::{anyhow, Context, Result};
use host_domain::{RuntimeRegistry, WorkspaceRecord};
use std::fs;
use std::path::{Path, PathBuf};

fn path_buf_to_utf8(path: PathBuf, context: &str) -> Result<String> {
    path.into_os_string().into_string().map_err(|value| {
        anyhow!(
            "{context}: path contains non-UTF-8 data ({})",
            PathBuf::from(value).display()
        )
    })
}

fn validate_git_repo_path(repo_path: &str) -> Result<String> {
    let path = Path::new(repo_path);
    if !path.exists() {
        return Err(anyhow!("Workspace path does not exist: {repo_path}"));
    }
    if !path.join(".git").exists() {
        return Err(anyhow!("Workspace is not a git repository: {repo_path}"));
    }
    canonicalize_repo_path(repo_path)
}

fn default_worktree_base_path(repo_path: &str, workspace_id: &str) -> Result<String> {
    path_buf_to_utf8(
        resolve_default_worktree_base_dir_for_workspace(workspace_id)?,
        &format!(
            "Failed converting default worktree base path to UTF-8 for {repo_path}. Ensure HOME is set or configure workspaces.{workspace_id}.worktreeBasePath"
        ),
    )
}

fn effective_worktree_base_path(repo: &RepoConfig) -> Result<String> {
    match repo.worktree_base_path.as_ref() {
        Some(configured_path) => path_buf_to_utf8(
            parse_user_path(configured_path)?,
            &format!(
                "Failed converting configured worktree base path to UTF-8 for {}",
                repo.repo_path
            ),
        ),
        None => default_worktree_base_path(&repo.repo_path, &repo.workspace_id),
    }
}

fn ensure_repo_path_available(
    config: &GlobalConfig,
    repo_path: &str,
    current_workspace_id: Option<&str>,
) -> Result<()> {
    let conflict = config.workspaces.iter().find(|(workspace_id, workspace)| {
        workspace.repo_path == repo_path && current_workspace_id != Some(workspace_id.as_str())
    });

    if let Some((workspace_id, _)) = conflict {
        return Err(anyhow!(
            "Repository path is already registered to workspace {workspace_id}: {repo_path}"
        ));
    }

    Ok(())
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
    pub(super) runtime_registry: RuntimeRegistry,
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

    pub fn update_global_git_config(&self, git: super::types::GlobalGitConfig) -> Result<()> {
        self.update_config(|config| {
            config.git = git;
            Ok(())
        })
    }

    pub fn list_workspaces(&self) -> Result<Vec<WorkspaceRecord>> {
        let config = self.load()?;
        let mut records: Vec<WorkspaceRecord> = config
            .workspaces
            .iter()
            .map(|(workspace_id, repo)| workspace_record_from_repo(&config, workspace_id, repo))
            .collect::<Result<Vec<_>>>()?;

        records.sort_by(|a, b| {
            a.workspace_name
                .cmp(&b.workspace_name)
                .then_with(|| a.workspace_id.cmp(&b.workspace_id))
        });
        Ok(records)
    }

    pub fn add_workspace(
        &self,
        workspace_id: &str,
        workspace_name: &str,
        repo_path: &str,
    ) -> Result<WorkspaceRecord> {
        let canonical_repo_path = validate_git_repo_path(repo_path)?;
        let mut repo_config = RepoConfig {
            workspace_id: workspace_id.to_string(),
            workspace_name: workspace_name.to_string(),
            repo_path: canonical_repo_path,
            ..RepoConfig::default()
        };
        normalize_repo_config(&mut repo_config)?;

        let workspace_id = repo_config.workspace_id.clone();
        self.update_workspace(workspace_id, move |config, workspace_id| {
            if config.workspaces.contains_key(workspace_id) {
                return Err(anyhow!(
                    "Workspace already exists in config: {workspace_id}"
                ));
            }
            ensure_repo_path_available(config, &repo_config.repo_path, None)?;
            config
                .workspaces
                .insert(workspace_id.to_string(), repo_config);
            config.active_workspace = Some(workspace_id.to_string());
            Ok(())
        })
    }

    pub fn select_workspace(&self, workspace_id: &str) -> Result<WorkspaceRecord> {
        self.update_workspace(workspace_id.to_string(), |config, workspace_id| {
            if !config.workspaces.contains_key(workspace_id) {
                return Err(anyhow!("Workspace not found in config: {workspace_id}"));
            }
            config.active_workspace = Some(workspace_id.to_string());
            Ok(())
        })
    }

    pub fn update_repo_config(
        &self,
        workspace_id: &str,
        mut repo_config: RepoConfig,
    ) -> Result<WorkspaceRecord> {
        repo_config.workspace_id = workspace_id.to_string();
        repo_config.repo_path = validate_git_repo_path(&repo_config.repo_path)?;
        normalize_repo_config(&mut repo_config)?;

        let workspace_id = repo_config.workspace_id.clone();
        self.update_workspace(workspace_id, move |config, workspace_id| {
            if !config.workspaces.contains_key(workspace_id) {
                return Err(anyhow!(
                    "Workspace not found in config: {workspace_id}. Add/select the workspace before updating configuration."
                ));
            }
            ensure_repo_path_available(config, &repo_config.repo_path, Some(workspace_id))?;
            config.workspaces.insert(workspace_id.to_string(), repo_config);
            if config.active_workspace.is_none() {
                config.active_workspace = Some(workspace_id.to_string());
            }
            Ok(())
        })
    }

    pub fn update_repo_hooks(&self, workspace_id: &str, hooks: HookSet) -> Result<WorkspaceRecord> {
        let hooks = normalize_hook_set(hooks);

        self.update_workspace(workspace_id.to_string(), move |config, workspace_id| {
            let repo = config
                .workspaces
                .get_mut(workspace_id)
                .ok_or_else(|| anyhow!("Workspace is not configured"))?;
            let previous_hooks = repo.hooks.clone();
            repo.hooks = hooks;
            if repo.hooks != previous_hooks {
                repo.trusted_hooks = false;
                repo.trusted_hooks_fingerprint = None;
            } else if repo.trusted_hooks {
                repo.trusted_hooks_fingerprint =
                    Some(repo_script_fingerprint(&repo.hooks, &repo.dev_servers));
            }
            Ok(())
        })
    }

    pub fn repo_config(&self, workspace_id: &str) -> Result<RepoConfig> {
        let config = self.load()?;
        config
            .workspaces
            .get(workspace_id)
            .cloned()
            .ok_or_else(|| anyhow!("Workspace is not configured in {}", self.path.display()))
    }

    pub fn repo_config_optional(&self, workspace_id: &str) -> Result<Option<RepoConfig>> {
        let config = self.load()?;
        Ok(config.workspaces.get(workspace_id).cloned())
    }

    pub fn find_workspace_by_repo_path(&self, repo_path: &str) -> Result<Option<WorkspaceRecord>> {
        let config = self.load()?;
        let canonical_repo_path = canonicalize_repo_path(repo_path)?;
        config
            .workspaces
            .iter()
            .find(|(_, workspace)| workspace.repo_path == canonical_repo_path)
            .map(|(workspace_id, repo)| workspace_record_from_repo(&config, workspace_id, repo))
            .transpose()
    }

    pub fn repo_config_by_repo_path(&self, repo_path: &str) -> Result<RepoConfig> {
        self.repo_config_optional_by_repo_path(repo_path)?
            .ok_or_else(|| anyhow!("Workspace is not configured in {}", self.path.display()))
    }

    pub fn repo_config_optional_by_repo_path(&self, repo_path: &str) -> Result<Option<RepoConfig>> {
        let canonical_repo_path = canonicalize_repo_path(repo_path)?;
        let config = self.load()?;
        Ok(config
            .workspaces
            .values()
            .find(|workspace| workspace.repo_path == canonical_repo_path)
            .cloned())
    }

    pub fn set_repo_trust_hooks(
        &self,
        workspace_id: &str,
        trusted: bool,
        trusted_fingerprint: Option<String>,
    ) -> Result<WorkspaceRecord> {
        self.update_workspace(workspace_id.to_string(), move |config, workspace_id| {
            let repo = config
                .workspaces
                .get_mut(workspace_id)
                .ok_or_else(|| anyhow!("Workspace is not configured"))?;
            repo.trusted_hooks = trusted;
            repo.trusted_hooks_fingerprint = if trusted { trusted_fingerprint } else { None };
            Ok(())
        })
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
        workspace_id: String,
        update: impl FnOnce(&mut GlobalConfig, &str) -> Result<()>,
    ) -> Result<WorkspaceRecord> {
        self.update_config(|config| {
            update(config, &workspace_id)?;
            touch_recent(&mut config.recent_workspaces, &workspace_id);
            workspace_record(config, &workspace_id)
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
        Self::new_with_runtime_registry(host_domain::builtin_runtime_registry().clone())
    }

    pub fn new_with_runtime_registry(runtime_registry: RuntimeRegistry) -> Result<Self> {
        Ok(Self {
            path: resolve_default_path(RUNTIME_SETTINGS_FILENAME)?,
            enforce_private_parent_permissions: true,
            runtime_registry,
        })
    }

    pub fn from_path(path: PathBuf) -> Self {
        Self::from_path_with_runtime_registry(path, host_domain::builtin_runtime_registry().clone())
    }

    pub fn from_path_with_runtime_registry(
        path: PathBuf,
        runtime_registry: RuntimeRegistry,
    ) -> Self {
        let enforce_private_parent_permissions =
            should_enforce_private_parent_permissions(&path, RUNTIME_SETTINGS_FILENAME);
        Self {
            path,
            enforce_private_parent_permissions,
            runtime_registry,
        }
    }

    pub fn from_user_settings_store(config_store: &AppConfigStore) -> Self {
        Self::from_user_settings_store_with_runtime_registry(
            config_store,
            host_domain::builtin_runtime_registry().clone(),
        )
    }

    pub fn from_user_settings_store_with_runtime_registry(
        config_store: &AppConfigStore,
        runtime_registry: RuntimeRegistry,
    ) -> Self {
        let runtime_path = config_store
            .path
            .parent()
            .map_or_else(PathBuf::new, Path::to_path_buf)
            .join(RUNTIME_SETTINGS_FILENAME);
        Self {
            path: runtime_path,
            enforce_private_parent_permissions: config_store.enforce_private_parent_permissions,
            runtime_registry,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> Result<RuntimeConfig> {
        if !self.path.exists() {
            return Ok(RuntimeConfig::from_runtime_registry(&self.runtime_registry));
        }

        super::security::validate_config_access(
            &self.path,
            self.enforce_private_parent_permissions,
        )?;

        let data = fs::read_to_string(&self.path)
            .with_context(|| format!("Failed reading config file {}", self.path.display()))?;
        let mut parsed: RuntimeConfig = serde_json::from_str(&data)
            .with_context(|| format!("Failed parsing config file {}", self.path.display()))?;
        normalize_runtime_config(&mut parsed, &self.runtime_registry)
            .with_context(|| format!("Failed normalizing config file {}", self.path.display()))?;
        Ok(parsed)
    }

    pub fn save(&self, config: &RuntimeConfig) -> Result<()> {
        save_config(
            &self.path,
            self.enforce_private_parent_permissions,
            config,
            |value| normalize_runtime_config(value, &self.runtime_registry),
        )
    }
}

pub(crate) fn touch_recent(recent: &mut Vec<String>, workspace_id: &str) {
    recent.retain(|entry| entry != workspace_id);
    recent.insert(0, workspace_id.to_string());
    recent.truncate(20);
}

fn migrate_loaded_global_config(config: &mut GlobalConfig) -> Result<()> {
    for repo in config.workspaces.values_mut() {
        if let Ok(canonical_repo_path) = canonicalize_repo_path(&repo.repo_path) {
            repo.repo_path = canonical_repo_path;
        }

        adopt_legacy_workspace_namespace(Path::new(&repo.repo_path), &repo.workspace_id)
            .with_context(|| {
                format!(
                    "Failed adopting legacy durable namespace for workspace {} ({})",
                    repo.workspace_id, repo.repo_path
                )
            })?;
    }

    Ok(())
}

fn workspace_record(config: &GlobalConfig, workspace_id: &str) -> Result<WorkspaceRecord> {
    let repo = config
        .workspaces
        .get(workspace_id)
        .ok_or_else(|| anyhow!("Workspace disappeared from config"))?;
    workspace_record_from_repo(config, workspace_id, repo)
}

fn workspace_record_from_repo(
    config: &GlobalConfig,
    workspace_id: &str,
    repo: &RepoConfig,
) -> Result<WorkspaceRecord> {
    let default_worktree_base_path = match default_worktree_base_path(&repo.repo_path, workspace_id) {
        Ok(path) => Some(path),
        Err(_error) if repo.worktree_base_path.is_some() => None,
        Err(error) => {
            return Err(error).with_context(|| {
                format!(
                    "Failed resolving default worktree base path for workspace {}. Ensure HOME is set or configure workspaces.{}.worktreeBasePath",
                    workspace_id,
                    workspace_id
                )
            })
        }
    };
    let effective_worktree_base_path = effective_worktree_base_path(repo)?;
    Ok(WorkspaceRecord {
        workspace_id: repo.workspace_id.clone(),
        workspace_name: repo.workspace_name.clone(),
        repo_path: repo.repo_path.clone(),
        is_active: config.active_workspace.as_deref() == Some(workspace_id),
        has_config: true,
        configured_worktree_base_path: repo.worktree_base_path.clone(),
        default_worktree_base_path,
        effective_worktree_base_path: Some(effective_worktree_base_path),
    })
}
