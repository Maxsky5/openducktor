use anyhow::{Context, Result};
use host_infra_system::{
    read_shared_dolt_server_state, resolve_repo_beads_attachment_dir,
    resolve_repo_beads_attachment_root, SHARED_DOLT_SERVER_HOST, SHARED_DOLT_SERVER_USER,
};
use std::fs;
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
        Ok(working_dir)
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
