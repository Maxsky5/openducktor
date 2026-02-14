use anyhow::{anyhow, Context, Result};
use host_domain::{
    CreateTaskInput, SpecDocument, TaskCard, TaskPhase, TaskStatus, TaskStore, UpdateTaskPatch,
};
use host_infra_system::{
    compute_repo_slug, resolve_central_beads_dir, run_command_allow_failure_with_env,
    run_command_with_env,
};
use serde::Deserialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Debug, Default)]
pub struct BeadsTaskStore {
    init_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    initialized_repos: Mutex<HashSet<String>>,
}

impl BeadsTaskStore {
    pub fn new() -> Self {
        Self {
            init_locks: Mutex::new(HashMap::new()),
            initialized_repos: Mutex::new(HashSet::new()),
        }
    }

    fn run_bd_json(&self, repo_path: &Path, args: &[String]) -> Result<Value> {
        let beads_dir = resolve_central_beads_dir(repo_path)?;
        let beads_dir_env = beads_dir.to_string_lossy().to_string();
        let mut final_args: Vec<&str> = Vec::with_capacity(args.len() + 2);
        // Avoid daemon startup latency on every CLI invocation.
        final_args.push("--no-daemon");
        final_args.extend(args.iter().map(|entry| entry.as_str()));
        final_args.push("--json");
        let output = run_command_with_env(
            "bd",
            &final_args,
            Some(repo_path),
            &[("BEADS_DIR", beads_dir_env.as_str())],
        )?;
        let json: Value = serde_json::from_str(&output).with_context(|| {
            format!(
                "Failed to parse bd JSON output for command `bd {}`. Output: {}",
                final_args.join(" "),
                output
            )
        })?;
        Ok(json)
    }

    fn show_task(&self, repo_path: &Path, task_id: &str) -> Result<TaskCard> {
        let args = vec!["show".to_string(), task_id.to_string()];
        let value = self.run_bd_json(repo_path, &args)?;

        let issue = value
            .as_array()
            .and_then(|entries| entries.first())
            .ok_or_else(|| anyhow!("bd show returned empty payload for task {task_id}"))?;

        parse_task_card(issue)
    }

    fn repo_key(repo_path: &Path) -> String {
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

    fn verify_repo_initialized(
        &self,
        repo_path: &Path,
        beads_dir: &Path,
    ) -> Result<(bool, String)> {
        let beads_dir_env = beads_dir.to_string_lossy().to_string();
        let (ok, stdout, stderr) = run_command_allow_failure_with_env(
            "bd",
            &["--no-daemon", "where", "--json"],
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

        let payload: Value = serde_json::from_str(&stdout)
            .with_context(|| format!("Failed to parse `bd where --json` output: {stdout}"))?;
        if payload
            .get("path")
            .and_then(|value| value.as_str())
            .is_some()
        {
            return Ok((true, String::new()));
        }

        Ok((false, "bd where returned malformed payload".to_string()))
    }
}

impl TaskStore for BeadsTaskStore {
    fn ensure_repo_initialized(&self, repo_path: &Path) -> Result<()> {
        let repo_key = Self::repo_key(repo_path);
        let lock = self.repo_lock(&repo_key)?;
        let _guard = lock
            .lock()
            .map_err(|_| anyhow!("Beads repo lock poisoned"))?;

        let beads_dir = resolve_central_beads_dir(repo_path)?;
        let database_path = beads_dir.join("beads.db");
        if self.is_repo_cached_initialized(&repo_key)? && database_path.exists() {
            return Ok(());
        }

        eprintln!(
            "[openblueprint][beads] ensure repo={} dir={}",
            repo_path.display(),
            beads_dir.display()
        );
        let (is_ready, reason) = self.verify_repo_initialized(repo_path, &beads_dir)?;
        if is_ready {
            self.mark_repo_initialized(&repo_key)?;
            return Ok(());
        }

        let slug = compute_repo_slug(repo_path);
        eprintln!(
            "[openblueprint][beads] init-attempt repo={} dir={} prefix={}",
            repo_path.display(),
            beads_dir.display(),
            slug
        );
        let beads_dir_env = beads_dir.to_string_lossy().to_string();
        let (ok, _stdout, stderr) = run_command_allow_failure_with_env(
            "bd",
            &[
                "--no-daemon",
                "init",
                "--quiet",
                "--skip-hooks",
                "--skip-merge-driver",
                "--prefix",
                slug.as_str(),
            ],
            Some(repo_path),
            &[("BEADS_DIR", beads_dir_env.as_str())],
        )?;

        if !ok {
            let details = if stderr.trim().is_empty() {
                reason
            } else {
                stderr.trim().to_string()
            };
            eprintln!(
                "[openblueprint][beads] init-failed repo={} dir={} error={}",
                repo_path.display(),
                beads_dir.display(),
                details
            );
            return Err(anyhow!(
                "Failed to initialize Beads at {}: {}",
                beads_dir.display(),
                details
            ));
        }

        let (is_ready_after, reason_after) = self.verify_repo_initialized(repo_path, &beads_dir)?;
        if !is_ready_after {
            eprintln!(
                "[openblueprint][beads] init-invalid repo={} dir={} error={}",
                repo_path.display(),
                beads_dir.display(),
                reason_after
            );
            return Err(anyhow!(
                "Beads init completed but store is not ready at {}: {}",
                beads_dir.display(),
                reason_after
            ));
        }

        eprintln!(
            "[openblueprint][beads] init-success repo={} dir={}",
            repo_path.display(),
            beads_dir.display()
        );
        self.mark_repo_initialized(&repo_key)?;

        Ok(())
    }

    fn list_tasks(&self, repo_path: &Path) -> Result<Vec<TaskCard>> {
        let args = vec![
            "list".to_string(),
            "--all".to_string(),
            "-n".to_string(),
            "500".to_string(),
        ];
        let value = self.run_bd_json(repo_path, &args)?;

        let tasks = value
            .as_array()
            .ok_or_else(|| anyhow!("bd list did not return an array"))?
            .iter()
            .filter_map(|entry| parse_task_card(entry).ok())
            .filter(|task| task.issue_type != "event" && task.issue_type != "gate")
            .collect();

        Ok(tasks)
    }

    fn create_task(&self, repo_path: &Path, input: CreateTaskInput) -> Result<TaskCard> {
        let args = vec![
            "create".to_string(),
            input.title,
            "--type".to_string(),
            "task".to_string(),
        ];

        let value = self.run_bd_json(repo_path, &args)?;
        let created = parse_task_card(&value)?;

        // Default new tasks to backlog phase.
        let _ = self.set_phase(
            repo_path,
            &created.id,
            TaskPhase::Backlog,
            Some("Task created in OpenBlueprint"),
        );

        self.show_task(repo_path, &created.id)
    }

    fn update_task(
        &self,
        repo_path: &Path,
        task_id: &str,
        patch: UpdateTaskPatch,
    ) -> Result<TaskCard> {
        let mut args = vec!["update".to_string(), task_id.to_string()];

        if let Some(title) = patch.title {
            args.push("--title".to_string());
            args.push(title);
        }

        if let Some(description) = patch.description {
            args.push("--description".to_string());
            args.push(description);
        }

        if let Some(status) = patch.status {
            args.push("--status".to_string());
            args.push(status.as_cli_value().to_string());
        }

        self.run_bd_json(repo_path, &args)?;
        self.show_task(repo_path, task_id)
    }

    fn set_phase(
        &self,
        repo_path: &Path,
        task_id: &str,
        phase: TaskPhase,
        reason: Option<&str>,
    ) -> Result<TaskCard> {
        let mut args = vec![
            "set-state".to_string(),
            task_id.to_string(),
            format!("phase={}", phase.as_cli_value()),
        ];

        if let Some(reason) = reason {
            args.push("--reason".to_string());
            args.push(reason.to_string());
        }

        self.run_bd_json(repo_path, &args)?;
        self.show_task(repo_path, task_id)
    }

    fn get_spec_markdown(&self, repo_path: &Path, task_id: &str) -> Result<SpecDocument> {
        let task = self.show_task(repo_path, task_id)?;
        Ok(SpecDocument {
            markdown: task.description,
            updated_at: task.updated_at,
        })
    }

    fn set_spec_markdown(
        &self,
        repo_path: &Path,
        task_id: &str,
        markdown: &str,
    ) -> Result<SpecDocument> {
        let patch = UpdateTaskPatch {
            title: None,
            description: Some(markdown.to_string()),
            status: None,
        };
        let updated = self.update_task(repo_path, task_id, patch)?;
        Ok(SpecDocument {
            markdown: updated.description,
            updated_at: updated.updated_at,
        })
    }
}

#[derive(Debug, Deserialize)]
struct RawIssue {
    id: String,
    title: String,
    #[serde(default)]
    description: String,
    status: String,
    #[serde(default)]
    priority: i32,
    #[serde(default)]
    issue_type: String,
    #[serde(default)]
    labels: Vec<String>,
    updated_at: String,
    created_at: String,
}

fn parse_task_card(value: &Value) -> Result<TaskCard> {
    let issue: RawIssue = serde_json::from_value(value.clone())?;

    let status = match issue.status.as_str() {
        "open" => TaskStatus::Open,
        "in_progress" => TaskStatus::InProgress,
        "blocked" => TaskStatus::Blocked,
        "closed" => TaskStatus::Closed,
        other => return Err(anyhow!("Unknown task status from bd: {other}")),
    };

    let phase = TaskPhase::from_label(&issue.labels);

    Ok(TaskCard {
        id: issue.id,
        title: issue.title,
        description: issue.description,
        status,
        phase,
        priority: issue.priority,
        issue_type: issue.issue_type,
        labels: issue.labels,
        updated_at: issue.updated_at,
        created_at: issue.created_at,
    })
}
