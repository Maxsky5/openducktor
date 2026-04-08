use anyhow::{anyhow, Context, Result};
use host_domain::TaskCard;
use host_infra_system::{
    read_shared_dolt_server_state, resolve_repo_beads_attachment_dir,
    resolve_repo_beads_attachment_root, SHARED_DOLT_SERVER_HOST, SHARED_DOLT_SERVER_USER,
};
use serde_json::Value;
use std::fs;
use std::path::Path;

use crate::model::RawIssue;
use crate::store::BeadsTaskStore;

impl BeadsTaskStore {
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

    pub(crate) fn build_bd_env(
        &self,
        repo_path: &Path,
        require_server: bool,
    ) -> Result<Vec<(String, String)>> {
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
            None if !self.command_runner.uses_real_processes() => {
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
            None if require_server => {
                return Err(anyhow!(
                    "Shared Dolt server state is missing for {}; reinitialize the repo store",
                    repo_path.display()
                ));
            }
            None => {}
        }

        Ok(env)
    }

    pub(crate) fn run_bd(&self, repo_path: &Path, args: &[&str]) -> Result<String> {
        let final_args = args.to_vec();
        let repo_key = Self::repo_key(repo_path);
        let require_server = self.is_repo_cached_initialized(&repo_key)?;
        let env = self.build_bd_env(repo_path, require_server)?;
        let env_refs = env
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect::<Vec<_>>();
        let working_dir = self.ensure_beads_working_dir(repo_path)?;

        self.command_runner
            .run_with_env("bd", &final_args, Some(&working_dir), &env_refs)
    }

    pub(crate) fn run_bd_json(&self, repo_path: &Path, args: &[&str]) -> Result<Value> {
        let mut final_args = Vec::with_capacity(args.len() + 1);
        if let Some(delimiter_index) = args.iter().position(|arg| *arg == "--") {
            final_args.extend(&args[..delimiter_index]);
            final_args.push("--json");
            final_args.push("--");
            final_args.extend(&args[(delimiter_index + 1)..]);
        } else {
            final_args.extend(args);
            final_args.push("--json");
        }
        let repo_key = Self::repo_key(repo_path);
        let require_server = self.is_repo_cached_initialized(&repo_key)?;
        let env = self.build_bd_env(repo_path, require_server)?;
        let env_refs = env
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect::<Vec<_>>();
        let working_dir = self.ensure_beads_working_dir(repo_path)?;

        let output =
            self.command_runner
                .run_with_env("bd", &final_args, Some(&working_dir), &env_refs)?;

        let command = args.first().copied().unwrap_or("unknown");
        serde_json::from_str(&output)
            .with_context(|| format!("Failed to parse bd JSON output from `bd {command}`"))
    }

    pub(crate) fn show_raw_issue(&self, repo_path: &Path, task_id: &str) -> Result<RawIssue> {
        let value = self.run_bd_json(repo_path, &["show", "--id", task_id])?;
        let issue_value = value
            .as_array()
            .and_then(|entries| entries.first())
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;
        serde_json::from_value(issue_value.clone()).context("Failed to decode bd show payload")
    }

    pub(crate) fn show_task(&self, repo_path: &Path, task_id: &str) -> Result<TaskCard> {
        let raw = self.show_raw_issue(repo_path, task_id)?;
        let metadata_namespace = self.current_metadata_namespace();
        self.parse_task_card(raw, &metadata_namespace)
    }
}
