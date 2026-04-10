use anyhow::{anyhow, Result};
use host_infra_system::resolve_repo_beads_attachment_dir;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::command_runner::CommandRunner;

pub(crate) struct BeadsLifecycle {
    command_runner: Arc<dyn CommandRunner>,
    init_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    initialized_repos: Mutex<HashSet<String>>,
}

impl BeadsLifecycle {
    pub(crate) fn new(command_runner: Arc<dyn CommandRunner>) -> Self {
        Self {
            command_runner,
            init_locks: Mutex::new(HashMap::new()),
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

        let beads_dir = resolve_repo_beads_attachment_dir(repo_path)?;
        let store_exists = beads_store_footprint_exists(&beads_dir);

        self.ensure_dolt_server_running(repo_path)?;

        let (is_ready, reason) = if store_exists {
            self.verify_repo_initialized(repo_path, &beads_dir)?
        } else {
            (false, "bd init failed".to_string())
        };

        if self.is_repo_cached_initialized(&repo_key)? && store_exists && is_ready {
            return Ok(());
        }

        if !is_ready {
            if store_exists {
                self.ensure_existing_store_is_ready(repo_path, &beads_dir, &reason)?;
            } else {
                self.ensure_new_store_is_ready(repo_path, &beads_dir, &reason)?;
            }
        }

        self.ensure_custom_statuses(repo_path)?;
        self.mark_repo_initialized(&repo_key)?;
        Ok(())
    }

    fn ensure_existing_store_is_ready(
        &self,
        repo_path: &Path,
        beads_dir: &Path,
        reason: &str,
    ) -> Result<()> {
        let attempted_restore = Self::reason_requires_shared_database_seed(reason);
        if attempted_restore {
            self.materialize_shared_database_from_attachment(repo_path, beads_dir)?;
        } else {
            self.repair_repo_store(repo_path)?;
        }

        let (is_ready_after_repair, reason_after_repair) =
            self.verify_repo_initialized(repo_path, beads_dir)?;
        if !is_ready_after_repair {
            let recovery_step = if attempted_restore {
                "shared database restore"
            } else {
                "repair"
            };
            return Err(anyhow!(
                "Beads {recovery_step} completed but store is still not ready at {}: {}",
                beads_dir.display(),
                reason_after_repair
            ));
        }
        Ok(())
    }
}

fn beads_store_footprint_exists(beads_dir: &Path) -> bool {
    beads_dir.join("metadata.json").exists() || beads_dir.join("beads.db").exists()
}
