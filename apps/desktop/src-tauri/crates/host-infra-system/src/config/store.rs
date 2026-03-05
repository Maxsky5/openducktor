use super::migrate::{canonicalize_workspace_key, migrate_repos_to_canonical_keys};
use super::normalize::{normalize_global_config, normalize_repo_config, normalize_runtime_config};
use super::types::{hook_set_fingerprint, GlobalConfig, HookSet, RepoConfig, RuntimeConfig};
use anyhow::{anyhow, Context, Result};
use host_domain::WorkspaceRecord;
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::{ffi::OsString, fs::OpenOptions, io::ErrorKind, io::Write, time::SystemTime};

#[cfg(unix)]
const CONFIG_DIR_MODE: u32 = 0o700;
#[cfg(unix)]
const CONFIG_FILE_MODE: u32 = 0o600;

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

fn resolve_default_path(file_name: &str) -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("Unable to resolve user home directory"))?;
    Ok(home.join(".openducktor").join(file_name))
}

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
        let enforce_private_parent_permissions = resolve_default_path(USER_SETTINGS_FILENAME)
            .map(|default_path| default_path == path)
            .unwrap_or(false);
        Self {
            path,
            enforce_private_parent_permissions,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> Result<GlobalConfig> {
        if !self.path.exists() {
            return Ok(GlobalConfig::default());
        }

        validate_config_access(&self.path, self.enforce_private_parent_permissions)?;

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

    pub fn save(&self, config: &GlobalConfig) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).with_context(|| {
                format!("Failed creating config directory {}", parent.display())
            })?;
            enforce_directory_permissions(parent, self.enforce_private_parent_permissions)?;
        }
        let mut normalized = config.clone();
        normalize_global_config(&mut normalized);
        let payload = serde_json::to_string_pretty(&normalized)?;
        write_config_file(&self.path, payload.as_bytes())?;
        validate_config_access(&self.path, self.enforce_private_parent_permissions)?;
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
        let enforce_private_parent_permissions = resolve_default_path(RUNTIME_SETTINGS_FILENAME)
            .map(|default_path| default_path == path)
            .unwrap_or(false);
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
        if !self.path.exists() {
            return Ok(RuntimeConfig::default());
        }

        validate_config_access(&self.path, self.enforce_private_parent_permissions)?;

        let data = fs::read_to_string(&self.path)
            .with_context(|| format!("Failed reading config file {}", self.path.display()))?;
        let mut parsed: RuntimeConfig = serde_json::from_str(&data)
            .with_context(|| format!("Failed parsing config file {}", self.path.display()))?;
        normalize_runtime_config(&mut parsed);
        Ok(parsed)
    }

    pub fn save(&self, config: &RuntimeConfig) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).with_context(|| {
                format!("Failed creating config directory {}", parent.display())
            })?;
            enforce_directory_permissions(parent, self.enforce_private_parent_permissions)?;
        }
        let mut normalized = config.clone();
        normalize_runtime_config(&mut normalized);
        let payload = serde_json::to_string_pretty(&normalized)?;
        write_config_file(&self.path, payload.as_bytes())?;
        validate_config_access(&self.path, self.enforce_private_parent_permissions)?;
        Ok(())
    }
}

pub(crate) fn touch_recent(recent: &mut Vec<String>, repo_path: &str) {
    recent.retain(|entry| entry != repo_path);
    recent.insert(0, repo_path.to_string());
    recent.truncate(20);
}

fn write_config_file(path: &Path, contents: &[u8]) -> Result<()> {
    #[cfg(unix)]
    {
        return write_config_file_atomic(path, contents);
    }

    #[cfg(not(unix))]
    {
        fs::write(path, contents)
            .with_context(|| format!("Failed writing config file {}", path.display()))?;
        Ok(())
    }
}

#[cfg(unix)]
fn write_config_file_atomic(path: &Path, contents: &[u8]) -> Result<()> {
    for attempt in 0..8_u8 {
        let temp_path = create_temporary_config_path(path, attempt)?;
        match OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(CONFIG_FILE_MODE)
            .open(&temp_path)
        {
            Ok(mut file) => {
                let write_result = (|| -> Result<()> {
                    file.write_all(contents).with_context(|| {
                        format!("Failed writing config temp file {}", temp_path.display())
                    })?;
                    file.sync_all().with_context(|| {
                        format!("Failed syncing config temp file {}", temp_path.display())
                    })?;
                    drop(file);
                    fs::rename(&temp_path, path).with_context(|| {
                        format!(
                            "Failed atomically replacing config file {} with {}",
                            path.display(),
                            temp_path.display()
                        )
                    })?;
                    Ok(())
                })();

                if let Err(error) = write_result {
                    if temp_path.exists() {
                        fs::remove_file(&temp_path).with_context(|| {
                            format!(
                                "Failed cleaning up config temp file {} after write failure",
                                temp_path.display()
                            )
                        })?;
                    }
                    return Err(error);
                }

                return Ok(());
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(error).with_context(|| {
                    format!("Failed opening config temp file {}", temp_path.display())
                });
            }
        }
    }

    Err(anyhow!(
        "Failed creating unique temp file for config write at {} after 8 attempts",
        path.display()
    ))
}

#[cfg(unix)]
fn create_temporary_config_path(path: &Path, attempt: u8) -> Result<PathBuf> {
    let parent = path.parent().ok_or_else(|| {
        anyhow!(
            "Config file path {} is invalid: missing parent directory",
            path.display()
        )
    })?;
    let file_name = path.file_name().ok_or_else(|| {
        anyhow!(
            "Config file path {} is invalid: missing file name",
            path.display()
        )
    })?;
    let nanos = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| anyhow!("System clock error while building temp config path: {error}"))?
        .as_nanos();
    let mut temp_name = OsString::from(".");
    temp_name.push(file_name);
    temp_name.push(format!(".tmp-{}-{nanos}-{attempt}", std::process::id()));
    Ok(parent.join(temp_name))
}

fn validate_config_access(path: &Path, enforce_private_parent_permissions: bool) -> Result<()> {
    #[cfg(unix)]
    {
        let parent = path.parent().ok_or_else(|| {
            anyhow!(
                "Config file path {} is invalid: missing parent directory",
                path.display()
            )
        })?;
        let expected_uid = current_effective_uid();
        if enforce_private_parent_permissions {
            validate_private_directory(parent, expected_uid)?;
        }
        validate_private_file(path, expected_uid)?;
    }
    Ok(())
}

fn enforce_directory_permissions(
    path: &Path,
    enforce_private_parent_permissions: bool,
) -> Result<()> {
    #[cfg(unix)]
    {
        if enforce_private_parent_permissions {
            fs::set_permissions(path, fs::Permissions::from_mode(CONFIG_DIR_MODE)).with_context(
                || {
                    format!(
                        "Failed setting secure permissions on config directory {}",
                        path.display()
                    )
                },
            )?;
        }
    }
    Ok(())
}

#[cfg(unix)]
fn current_effective_uid() -> u32 {
    // SAFETY: geteuid has no preconditions and does not dereference pointers.
    unsafe { libc::geteuid() as u32 }
}

#[cfg(unix)]
fn validate_private_directory(path: &Path, expected_uid: u32) -> Result<()> {
    let metadata = fs::metadata(path).with_context(|| {
        format!(
            "Failed reading config directory metadata {}",
            path.display()
        )
    })?;
    let mode = metadata.mode() & 0o777;
    let owner_uid = metadata.uid();
    if owner_uid != expected_uid {
        return Err(anyhow!(
            "Config directory {} must be owned by the current user (uid {}). Found uid {}. Run `chown -R $(whoami) {}`.",
            path.display(),
            expected_uid,
            owner_uid,
            path.display()
        ));
    }
    if mode != CONFIG_DIR_MODE {
        return Err(anyhow!(
            "Config directory {} has unsupported mode {:04o}. Expected 0700 exactly. Run `chmod 700 {}`.",
            path.display(),
            mode,
            path.display()
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn validate_private_file(path: &Path, expected_uid: u32) -> Result<()> {
    let metadata = fs::metadata(path)
        .with_context(|| format!("Failed reading config file metadata {}", path.display()))?;
    let mode = metadata.mode() & 0o777;
    let owner_uid = metadata.uid();
    if owner_uid != expected_uid {
        return Err(anyhow!(
            "Config file {} must be owned by the current user (uid {}). Found uid {}. Run `chown $(whoami) {}`.",
            path.display(),
            expected_uid,
            owner_uid,
            path.display()
        ));
    }
    if mode != CONFIG_FILE_MODE {
        return Err(anyhow!(
            "Config file {} has unsupported mode {:04o}. Expected 0600 exactly. Run `chmod 600 {}`.",
            path.display(),
            mode,
            path.display()
        ));
    }
    Ok(())
}
