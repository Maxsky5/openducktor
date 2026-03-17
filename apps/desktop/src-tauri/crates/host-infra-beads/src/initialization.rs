use anyhow::{anyhow, Context, Result};
#[cfg(test)]
use serde_json::Value;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::constants::CUSTOM_STATUS_VALUES;
use crate::store::BeadsTaskStore;

impl BeadsTaskStore {
    pub(crate) fn repo_key(repo_path: &Path) -> String {
        fs::canonicalize(repo_path)
            .unwrap_or_else(|_| repo_path.to_path_buf())
            .to_string_lossy()
            .to_string()
    }

    pub(crate) fn repo_lock(&self, repo_key: &str) -> Result<Arc<Mutex<()>>> {
        let mut lock_map = self
            .init_locks
            .lock()
            .map_err(|_| anyhow!("Beads init lock poisoned"))?;
        Ok(lock_map
            .entry(repo_key.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone())
    }

    pub(crate) fn is_repo_cached_initialized(&self, repo_key: &str) -> Result<bool> {
        let cache = self
            .initialized_repos
            .lock()
            .map_err(|_| anyhow!("Beads init cache lock poisoned"))?;
        Ok(cache.contains(repo_key))
    }

    pub(crate) fn mark_repo_initialized(&self, repo_key: &str) -> Result<()> {
        let mut cache = self
            .initialized_repos
            .lock()
            .map_err(|_| anyhow!("Beads init cache lock poisoned"))?;
        cache.insert(repo_key.to_string());
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn verify_repo_initialized(
        &self,
        repo_path: &Path,
        beads_dir: &Path,
    ) -> Result<(bool, String)> {
        let beads_dir_env = beads_dir.to_string_lossy().to_string();
        let (ok, stdout, stderr) = self.command_runner.run_allow_failure_with_env(
            "bd",
            &["where", "--json"],
            Some(repo_path),
            &[("BEADS_DIR", beads_dir_env.as_str())],
        )?;

        if !ok {
            let error = if stderr.trim().is_empty() {
                "bd where failed".to_string()
            } else {
                stderr.trim().to_string()
            };
            return Ok((false, error));
        }

        let payload: Value =
            serde_json::from_str(&stdout).context("Failed to parse `bd where --json` output")?;
        if payload.get("path").and_then(Value::as_str).is_some() {
            return Ok((true, String::new()));
        }

        Ok((false, "bd where returned malformed payload".to_string()))
    }

    pub(crate) fn ensure_custom_statuses(&self, repo_path: &Path) -> Result<()> {
        self.run_bd(
            repo_path,
            &["config", "set", "status.custom", CUSTOM_STATUS_VALUES],
        )
        .with_context(|| {
            format!(
                "Failed to configure custom statuses in {}",
                repo_path.display()
            )
        })?;
        Ok(())
    }

    pub(crate) fn ensure_dolt_server_running(&self, repo_path: &Path) -> Result<()> {
        self.run_bd(repo_path, &["dolt", "start"])
            .with_context(|| format!("Failed to start Dolt server for {}", repo_path.display()))?;
        Ok(())
    }
}
