use anyhow::{anyhow, Context, Result};
use host_infra_system::{
    compute_beads_database_name, compute_repo_slug, ensure_shared_dolt_server_running,
    resolve_shared_dolt_root, restore_shared_dolt_database_from_backup,
};
use std::path::Path;

use crate::constants::CUSTOM_STATUS_VALUES;

use super::{BeadsLifecycle, LifecycleError, RepoReadiness};

impl BeadsLifecycle {
    pub(crate) fn repair_repo_store(&self, repo_path: &Path) -> Result<()> {
        let env = self.build_bd_env(repo_path)?;
        let env_refs = env
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect::<Vec<_>>();
        let working_dir = self.ensure_beads_working_dir(repo_path)?;
        self.command_runner()
            .run_with_env(
                "bd",
                &["doctor", "--fix", "--yes"],
                Some(&working_dir),
                &env_refs,
            )
            .with_context(|| {
                format!(
                    "Failed to repair Beads store attachment for {}",
                    repo_path.display()
                )
            })?;
        Ok(())
    }

    pub(crate) fn ensure_custom_statuses(&self, repo_path: &Path) -> Result<()> {
        let env = self.build_bd_env(repo_path)?;
        let env_refs = env
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect::<Vec<_>>();
        let working_dir = self.ensure_beads_working_dir(repo_path)?;
        self.command_runner()
            .run_with_env(
                "bd",
                &["config", "set", "status.custom", CUSTOM_STATUS_VALUES],
                Some(&working_dir),
                &env_refs,
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
        if !self.command_runner().uses_real_processes() {
            return Ok(());
        }

        ensure_shared_dolt_server_running(std::process::id()).with_context(|| {
            format!(
                "Failed to ensure shared Dolt server is running for {}",
                repo_path.display()
            )
        })?;
        Ok(())
    }

    pub(crate) fn materialize_shared_database_from_attachment(
        &self,
        repo_path: &Path,
        beads_dir: &Path,
    ) -> Result<()> {
        let backup_dir = beads_dir.join("backup");
        if !backup_dir.is_dir() {
            return Err(LifecycleError::MissingAttachmentBackup {
                beads_dir: beads_dir.to_path_buf(),
                backup_dir,
            }
            .into());
        }

        let database_name = compute_beads_database_name(repo_path)?;
        if self.command_runner().uses_real_processes() {
            restore_shared_dolt_database_from_backup(
                std::process::id(),
                database_name.as_str(),
                &backup_dir,
            )?;
        } else {
            let shared_dolt_root = resolve_shared_dolt_root()?;
            let backup_url = format!("file://{}", backup_dir.display());
            self.command_runner().run_with_env(
                "dolt",
                &[
                    "backup",
                    "restore",
                    backup_url.as_str(),
                    database_name.as_str(),
                ],
                Some(&shared_dolt_root),
                &[],
            )?;
        }

        Ok(())
    }

    pub(crate) fn ensure_new_store_is_ready(
        &self,
        repo_path: &Path,
        beads_dir: &Path,
    ) -> Result<()> {
        let slug = compute_repo_slug(repo_path);
        let database_name = compute_beads_database_name(repo_path)?;
        let env = self.build_bd_env(repo_path)?;
        let env_refs = env
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect::<Vec<_>>();
        let server_port = env
            .iter()
            .find_map(|(key, value)| (key == "BEADS_DOLT_SERVER_PORT").then_some(value.as_str()))
            .ok_or_else(|| anyhow!("Missing BEADS_DOLT_SERVER_PORT while initializing repo"))?;
        let working_dir = self.ensure_beads_working_dir(repo_path)?;
        let (ok, _stdout, stderr) = self.command_runner().run_allow_failure_with_env(
            "bd",
            &[
                "init",
                "--server",
                "--server-host",
                "127.0.0.1",
                "--server-port",
                server_port,
                "--server-user",
                "root",
                "--quiet",
                "--skip-hooks",
                "--skip-agents",
                "--prefix",
                slug.as_str(),
                "--database",
                database_name.as_str(),
            ],
            Some(&working_dir),
            &env_refs,
        )?;

        if !ok {
            let details = if stderr.trim().is_empty() {
                "Beads attachment is missing".to_string()
            } else {
                stderr.trim().to_string()
            };
            return Err(LifecycleError::InitFailed {
                beads_dir: beads_dir.to_path_buf(),
                details,
            }
            .into());
        }

        self.ensure_repo_ready_after_recovery(repo_path, beads_dir, "init")
    }

    pub(crate) fn ensure_repo_ready_after_recovery(
        &self,
        repo_path: &Path,
        beads_dir: &Path,
        recovery_step: &'static str,
    ) -> Result<()> {
        match self.verify_repo_initialized(repo_path, beads_dir) {
            Ok(RepoReadiness::Ready) => Ok(()),
            Ok(readiness) => Err(LifecycleError::StoreStillNotReady {
                beads_dir: beads_dir.to_path_buf(),
                recovery_step,
                reason: readiness.description(),
            }
            .into()),
            Err(error) => Err(LifecycleError::StoreStillNotReady {
                beads_dir: beads_dir.to_path_buf(),
                recovery_step,
                reason: error.to_string(),
            }
            .into()),
        }
    }
}
