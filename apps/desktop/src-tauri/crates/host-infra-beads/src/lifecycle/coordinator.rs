use anyhow::{anyhow, Result};
use host_infra_system::resolve_repo_beads_attachment_dir;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::command_runner::CommandRunner;

use super::{LifecycleError, RepoReadiness};

struct RepoInitializingGuard<'a> {
    lifecycle: &'a BeadsLifecycle,
    repo_key: String,
}

impl<'a> RepoInitializingGuard<'a> {
    fn new(lifecycle: &'a BeadsLifecycle, repo_key: &str) -> Result<Self> {
        lifecycle.mark_repo_initializing(repo_key)?;
        Ok(Self {
            lifecycle,
            repo_key: repo_key.to_string(),
        })
    }
}

impl Drop for RepoInitializingGuard<'_> {
    fn drop(&mut self) {
        let _ = self.lifecycle.clear_repo_initializing(&self.repo_key);
    }
}

pub(crate) struct BeadsLifecycle {
    command_runner: Arc<dyn CommandRunner>,
    init_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    initializing_repos: Mutex<HashSet<String>>,
    initialized_repos: Mutex<HashSet<String>>,
}

impl BeadsLifecycle {
    pub(crate) fn new(command_runner: Arc<dyn CommandRunner>) -> Self {
        Self {
            command_runner,
            init_locks: Mutex::new(HashMap::new()),
            initializing_repos: Mutex::new(HashSet::new()),
            initialized_repos: Mutex::new(HashSet::new()),
        }
    }

    pub(crate) fn command_runner(&self) -> &dyn CommandRunner {
        self.command_runner.as_ref()
    }

    pub(crate) fn repo_key(repo_path: &Path) -> String {
        fs::canonicalize(repo_path)
            .unwrap_or_else(|_| repo_path.to_path_buf())
            .to_string_lossy()
            .to_string()
    }

    fn repo_lock(&self, repo_key: &str) -> Result<Arc<Mutex<()>>> {
        let mut lock_map = self
            .init_locks
            .lock()
            .map_err(|_| anyhow!("Beads init lock poisoned"))?;
        Ok(lock_map
            .entry(repo_key.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone())
    }

    fn is_repo_cached_initialized(&self, repo_key: &str) -> Result<bool> {
        let cache = self
            .initialized_repos
            .lock()
            .map_err(|_| anyhow!("Beads init cache lock poisoned"))?;
        Ok(cache.contains(repo_key))
    }

    pub(crate) fn is_repo_initializing(&self, repo_key: &str) -> Result<bool> {
        let initializing = self
            .initializing_repos
            .lock()
            .map_err(|_| anyhow!("Beads init state lock poisoned"))?;
        Ok(initializing.contains(repo_key))
    }

    fn mark_repo_initializing(&self, repo_key: &str) -> Result<()> {
        let mut initializing = self
            .initializing_repos
            .lock()
            .map_err(|_| anyhow!("Beads init state lock poisoned"))?;
        initializing.insert(repo_key.to_string());
        Ok(())
    }

    fn clear_repo_initializing(&self, repo_key: &str) -> Result<()> {
        let mut initializing = self
            .initializing_repos
            .lock()
            .map_err(|_| anyhow!("Beads init state lock poisoned"))?;
        initializing.remove(repo_key);
        Ok(())
    }

    fn mark_repo_initialized(&self, repo_key: &str) -> Result<()> {
        let mut cache = self
            .initialized_repos
            .lock()
            .map_err(|_| anyhow!("Beads init cache lock poisoned"))?;
        cache.insert(repo_key.to_string());
        Ok(())
    }

    pub(crate) fn ensure_repo_initialized(&self, repo_path: &Path) -> Result<()> {
        let repo_key = Self::repo_key(repo_path);
        let lock = self.repo_lock(&repo_key)?;
        let _guard = lock
            .lock()
            .map_err(|_| anyhow!("Beads repo lock poisoned"))?;
        let cached_initialized = self.is_repo_cached_initialized(&repo_key)?;
        let initializing_guard = if cached_initialized {
            None
        } else {
            Some(RepoInitializingGuard::new(self, &repo_key)?)
        };

        (|| {
            let beads_dir = resolve_repo_beads_attachment_dir(repo_path)?;

            self.ensure_dolt_server_running(repo_path)?;

            let readiness = self.verify_repo_initialized(repo_path, &beads_dir)?;

            if cached_initialized && matches!(readiness, RepoReadiness::Ready) {
                return Ok(());
            }

            let _initializing_guard = if cached_initialized {
                Some(RepoInitializingGuard::new(self, &repo_key)?)
            } else {
                initializing_guard
            };

            match readiness {
                RepoReadiness::Ready => {}
                RepoReadiness::MissingAttachment => {
                    self.ensure_new_store_is_ready(repo_path, &beads_dir)?;
                }
                RepoReadiness::MissingSharedDatabase { .. } => {
                    self.materialize_shared_database_from_attachment(repo_path, &beads_dir)?;
                    self.ensure_repo_ready_after_recovery(
                        repo_path,
                        &beads_dir,
                        "shared database restore",
                    )?;
                }
                RepoReadiness::AttachmentVerificationFailed { .. } => {
                    self.repair_repo_store(repo_path)?;
                    self.ensure_repo_ready_after_recovery(repo_path, &beads_dir, "repair")?;
                }
                RepoReadiness::BrokenAttachmentContract { reason } => {
                    return Err(LifecycleError::AttachmentContractInvalid {
                        beads_dir: beads_dir.to_path_buf(),
                        reason,
                    }
                    .into());
                }
                RepoReadiness::SharedDoltUnavailable { reason } => {
                    return Err(LifecycleError::SharedDoltUnavailable {
                        repo_path: repo_path.to_path_buf(),
                        reason,
                    }
                    .into());
                }
            }

            self.ensure_custom_statuses(repo_path)?;
            self.mark_repo_initialized(&repo_key)?;
            Ok(())
        })()
    }
}
