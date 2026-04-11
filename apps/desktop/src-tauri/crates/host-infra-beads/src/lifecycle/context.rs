use anyhow::{Context, Result};
use host_infra_system::{
    read_shared_dolt_server_state, resolve_repo_beads_attachment_dir,
    resolve_repo_beads_attachment_root, SHARED_DOLT_SERVER_HOST, SHARED_DOLT_SERVER_USER,
};
use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use super::{BeadsLifecycle, LifecycleError};

impl BeadsLifecycle {
    pub(crate) fn beads_working_dir(&self, repo_path: &Path) -> Result<std::path::PathBuf> {
        resolve_repo_beads_attachment_root(repo_path)
    }

    pub(crate) fn ensure_beads_working_dir(&self, repo_path: &Path) -> Result<std::path::PathBuf> {
        let working_dir = self.beads_working_dir(repo_path)?;
        fs::create_dir_all(&working_dir).with_context(|| {
            format!(
                "Failed to create Beads attachment root {}",
                working_dir.display()
            )
        })?;
        self.ensure_existing_attachment_runs_without_git_ops(repo_path)?;
        Ok(working_dir)
    }

    fn ensure_existing_attachment_runs_without_git_ops(&self, repo_path: &Path) -> Result<()> {
        let beads_dir = resolve_repo_beads_attachment_dir(repo_path)?;
        let metadata_path = beads_dir.join("metadata.json");
        if !metadata_path.is_file() {
            return Ok(());
        }

        let config_path = beads_dir.join("config.yaml");
        let existing = match fs::read_to_string(&config_path) {
            Ok(value) => Some(value),
            Err(error) if error.kind() == ErrorKind::NotFound => None,
            Err(error) => {
                return Err(error).with_context(|| {
                    format!("Failed reading Beads tool config {}", config_path.display())
                });
            }
        };

        let updated = match existing.as_deref() {
            Some(current) => ensure_no_git_ops_config(current),
            None => "no-git-ops: true\n".to_string(),
        };

        if existing.as_deref() == Some(updated.as_str()) {
            return Ok(());
        }

        fs::write(&config_path, updated).with_context(|| {
            format!(
                "Failed writing Beads tool config to keep git ops disabled at {}",
                config_path.display()
            )
        })?;
        Ok(())
    }

    pub(crate) fn build_bd_env(&self, repo_path: &Path) -> Result<Vec<(String, String)>> {
        let beads_dir = resolve_repo_beads_attachment_dir(repo_path)?;
        let mut env = vec![(
            "BEADS_DIR".to_string(),
            beads_dir.to_string_lossy().to_string(),
        )];
        let server_state = read_shared_dolt_server_state()?;

        match server_state {
            Some(server_state) => {
                env.push(("BEADS_DOLT_SERVER_MODE".to_string(), "1".to_string()));
                env.push((
                    "BEADS_DOLT_SERVER_HOST".to_string(),
                    SHARED_DOLT_SERVER_HOST.to_string(),
                ));
                env.push((
                    "BEADS_DOLT_SERVER_PORT".to_string(),
                    server_state.port.to_string(),
                ));
                env.push((
                    "BEADS_DOLT_SERVER_USER".to_string(),
                    SHARED_DOLT_SERVER_USER.to_string(),
                ));
            }
            None if !self.command_runner().uses_real_processes() => {
                env.push(("BEADS_DOLT_SERVER_MODE".to_string(), "1".to_string()));
                env.push((
                    "BEADS_DOLT_SERVER_HOST".to_string(),
                    SHARED_DOLT_SERVER_HOST.to_string(),
                ));
                env.push(("BEADS_DOLT_SERVER_PORT".to_string(), "3307".to_string()));
                env.push((
                    "BEADS_DOLT_SERVER_USER".to_string(),
                    SHARED_DOLT_SERVER_USER.to_string(),
                ));
            }
            None => {
                return Err(LifecycleError::SharedDoltStateMissing {
                    repo_path: repo_path.to_path_buf(),
                }
                .into());
            }
        }

        Ok(env)
    }
}

fn ensure_no_git_ops_config(config: &str) -> String {
    let mut replaced = false;
    let mut lines = Vec::new();
    for line in config.lines() {
        if line.trim_start().starts_with("no-git-ops:") {
            if !replaced {
                lines.push("no-git-ops: true".to_string());
                replaced = true;
            }
            continue;
        }
        lines.push(line.to_string());
    }

    if !replaced {
        if !lines.is_empty() && !lines.last().is_some_and(|line| line.is_empty()) {
            lines.push(String::new());
        }
        lines.push("no-git-ops: true".to_string());
    }

    let mut normalized = lines.join("\n");
    normalized.push('\n');
    normalized
}
