use anyhow::{anyhow, Context, Result};
use host_domain::TaskCard;
use host_infra_system::resolve_central_beads_dir;
use serde_json::Value;
use std::path::Path;

use crate::model::RawIssue;
use crate::store::BeadsTaskStore;

impl BeadsTaskStore {
    pub(crate) fn run_bd(&self, repo_path: &Path, args: &[&str]) -> Result<String> {
        let beads_dir = resolve_central_beads_dir(repo_path)?;
        let beads_dir_env = beads_dir.to_string_lossy().to_string();
        let final_args = args.to_vec();

        self.command_runner.run_with_env(
            "bd",
            &final_args,
            Some(repo_path),
            &[("BEADS_DIR", beads_dir_env.as_str())],
        )
    }

    pub(crate) fn run_bd_json(&self, repo_path: &Path, args: &[&str]) -> Result<Value> {
        let beads_dir = resolve_central_beads_dir(repo_path)?;
        let beads_dir_env = beads_dir.to_string_lossy().to_string();
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

        let output = self.command_runner.run_with_env(
            "bd",
            &final_args,
            Some(repo_path),
            &[("BEADS_DIR", beads_dir_env.as_str())],
        )?;

        let command = args.first().copied().unwrap_or("unknown");
        serde_json::from_str(&output)
            .with_context(|| format!("Failed to parse bd JSON output from `bd {command}`"))
    }

    pub(crate) fn show_raw_issue(&self, repo_path: &Path, task_id: &str) -> Result<RawIssue> {
        let value = self.run_bd_json(repo_path, &["show", "--id", task_id])?;
        let issue_value = value
            .as_array()
            .and_then(|entries| entries.first())
            .ok_or_else(|| anyhow!("bd show returned empty payload for task {task_id}"))?;
        serde_json::from_value(issue_value.clone()).context("Failed to decode bd show payload")
    }

    pub(crate) fn show_task(&self, repo_path: &Path, task_id: &str) -> Result<TaskCard> {
        let raw = self.show_raw_issue(repo_path, task_id)?;
        let metadata_namespace = self.current_metadata_namespace();
        self.parse_task_card(raw, &metadata_namespace)
    }
}
