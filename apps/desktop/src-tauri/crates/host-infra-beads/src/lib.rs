use anyhow::{anyhow, Context, Result};
use host_domain::{
    now_rfc3339, AgentSessionDocument, CreateTaskInput, QaReportDocument, QaVerdict, SpecDocument,
    TaskCard, TaskDocumentPresence, TaskDocumentSummary, TaskStatus, TaskStore, UpdateTaskPatch,
};
use host_infra_system::{
    compute_repo_slug, resolve_central_beads_dir, run_command_allow_failure_with_env,
    run_command_with_env,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

const DEFAULT_METADATA_NAMESPACE: &str = "openducktor";
const CUSTOM_STATUS_VALUES: &str = "spec_ready,ready_for_dev,ai_review,human_review";

trait CommandRunner: Send + Sync {
    fn run_with_env(
        &self,
        program: &str,
        args: &[&str],
        cwd: Option<&Path>,
        env: &[(&str, &str)],
    ) -> Result<String>;

    fn run_allow_failure_with_env(
        &self,
        program: &str,
        args: &[&str],
        cwd: Option<&Path>,
        env: &[(&str, &str)],
    ) -> Result<(bool, String, String)>;
}

#[derive(Debug, Default)]
struct ProcessCommandRunner;

impl CommandRunner for ProcessCommandRunner {
    fn run_with_env(
        &self,
        program: &str,
        args: &[&str],
        cwd: Option<&Path>,
        env: &[(&str, &str)],
    ) -> Result<String> {
        run_command_with_env(program, args, cwd, env)
    }

    fn run_allow_failure_with_env(
        &self,
        program: &str,
        args: &[&str],
        cwd: Option<&Path>,
        env: &[(&str, &str)],
    ) -> Result<(bool, String, String)> {
        run_command_allow_failure_with_env(program, args, cwd, env)
    }
}

pub struct BeadsTaskStore {
    command_runner: Arc<dyn CommandRunner>,
    metadata_namespace: String,
    init_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    initialized_repos: Mutex<HashSet<String>>,
}

impl fmt::Debug for BeadsTaskStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BeadsTaskStore")
            .field("metadata_namespace", &self.metadata_namespace)
            .finish_non_exhaustive()
    }
}

impl Default for BeadsTaskStore {
    fn default() -> Self {
        Self::new()
    }
}

impl BeadsTaskStore {
    pub fn new() -> Self {
        Self::with_metadata_namespace_and_runner(
            DEFAULT_METADATA_NAMESPACE,
            Arc::new(ProcessCommandRunner),
        )
    }

    pub fn with_metadata_namespace(namespace: &str) -> Self {
        Self::with_metadata_namespace_and_runner(namespace, Arc::new(ProcessCommandRunner))
    }

    fn with_metadata_namespace_and_runner(
        namespace: &str,
        command_runner: Arc<dyn CommandRunner>,
    ) -> Self {
        let trimmed = namespace.trim();
        let metadata_namespace = if trimmed.is_empty() {
            DEFAULT_METADATA_NAMESPACE.to_string()
        } else {
            trimmed.to_string()
        };

        Self {
            command_runner,
            metadata_namespace,
            init_locks: Mutex::new(HashMap::new()),
            initialized_repos: Mutex::new(HashSet::new()),
        }
    }

    #[cfg(test)]
    fn with_test_runner(namespace: &str, command_runner: Arc<dyn CommandRunner>) -> Self {
        Self::with_metadata_namespace_and_runner(namespace, command_runner)
    }

    fn run_bd(&self, repo_path: &Path, args: &[&str]) -> Result<String> {
        let beads_dir = resolve_central_beads_dir(repo_path)?;
        let beads_dir_env = beads_dir.to_string_lossy().to_string();
        let mut final_args = Vec::with_capacity(args.len() + 1);
        final_args.push("--no-daemon");
        final_args.extend(args);

        self.command_runner.run_with_env(
            "bd",
            &final_args,
            Some(repo_path),
            &[("BEADS_DIR", beads_dir_env.as_str())],
        )
    }

    fn run_bd_json(&self, repo_path: &Path, args: &[&str]) -> Result<Value> {
        let beads_dir = resolve_central_beads_dir(repo_path)?;
        let beads_dir_env = beads_dir.to_string_lossy().to_string();
        let mut final_args = Vec::with_capacity(args.len() + 2);
        final_args.push("--no-daemon");
        final_args.extend(args);
        final_args.push("--json");

        let output = self.command_runner.run_with_env(
            "bd",
            &final_args,
            Some(repo_path),
            &[("BEADS_DIR", beads_dir_env.as_str())],
        )?;

        serde_json::from_str(&output).with_context(|| {
            format!(
                "Failed to parse bd JSON output for command `bd {}`. Output: {}",
                final_args.join(" "),
                output
            )
        })
    }

    fn show_raw_issue(&self, repo_path: &Path, task_id: &str) -> Result<RawIssue> {
        let value = self.run_bd_json(repo_path, &["show", task_id])?;
        let issue_value = value
            .as_array()
            .and_then(|entries| entries.first())
            .ok_or_else(|| anyhow!("bd show returned empty payload for task {task_id}"))?;
        serde_json::from_value(issue_value.clone()).context("Failed to decode bd show payload")
    }

    fn show_task(&self, repo_path: &Path, task_id: &str) -> Result<TaskCard> {
        let raw = self.show_raw_issue(repo_path, task_id)?;
        self.parse_task_card(raw)
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
        let (ok, stdout, stderr) = self.command_runner.run_allow_failure_with_env(
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
        if payload.get("path").and_then(Value::as_str).is_some() {
            return Ok((true, String::new()));
        }

        Ok((false, "bd where returned malformed payload".to_string()))
    }

    fn ensure_custom_statuses(&self, repo_path: &Path) -> Result<()> {
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

    fn parse_task_card(&self, issue: RawIssue) -> Result<TaskCard> {
        let status = TaskStatus::from_cli_value(&issue.status)
            .ok_or_else(|| anyhow!("Unknown task status from bd: {}", issue.status))?;

        let metadata_root = parse_metadata_root(issue.metadata);
        let namespace = metadata_namespace(&metadata_root, &self.metadata_namespace);
        let ai_review_enabled = namespace
            .and_then(metadata_bool_qa_required)
            .unwrap_or_else(|| default_ai_review_enabled(&issue.issue_type));
        let document_summary = metadata_document_summary(namespace);

        let normalized_issue_type = if issue.issue_type == "event" || issue.issue_type == "gate" {
            issue.issue_type.clone()
        } else {
            normalize_issue_type(&issue.issue_type).to_string()
        };

        let parent_id = issue.parent.or_else(|| {
            issue.dependencies.iter().find_map(|dependency| {
                if dependency.dependency_type != "parent-child" {
                    return None;
                }
                dependency
                    .depends_on_id
                    .clone()
                    .or_else(|| dependency.id.clone())
            })
        });

        Ok(TaskCard {
            id: issue.id,
            title: issue.title,
            description: issue.description,
            acceptance_criteria: issue.acceptance_criteria,
            notes: issue.notes,
            status,
            priority: issue.priority,
            issue_type: normalized_issue_type,
            ai_review_enabled,
            available_actions: Vec::new(),
            labels: normalize_labels(issue.labels),
            assignee: issue.owner,
            parent_id,
            subtask_ids: Vec::new(),
            document_summary,
            updated_at: issue.updated_at,
            created_at: issue.created_at,
        })
    }

    fn write_metadata(
        &self,
        repo_path: &Path,
        task_id: &str,
        metadata: &Map<String, Value>,
    ) -> Result<()> {
        let payload = serde_json::to_string(&Value::Object(metadata.clone()))?;
        self.run_bd_json(
            repo_path,
            &["update", task_id, "--metadata", payload.as_str()],
        )?;
        Ok(())
    }

    fn load_namespace(
        &self,
        repo_path: &Path,
        task_id: &str,
    ) -> Result<(RawIssue, Map<String, Value>, Map<String, Value>)> {
        let issue = self.show_raw_issue(repo_path, task_id)?;
        let mut root = parse_metadata_root(issue.metadata.clone());

        let namespace = root
            .entry(self.metadata_namespace.clone())
            .or_insert_with(|| Value::Object(Map::new()));
        if !namespace.is_object() {
            *namespace = Value::Object(Map::new());
        }

        let namespace_map = namespace
            .as_object()
            .cloned()
            .ok_or_else(|| anyhow!("Invalid metadata namespace payload"))?;

        Ok((issue, root, namespace_map))
    }

    fn persist_namespace(
        &self,
        repo_path: &Path,
        task_id: &str,
        root: &mut Map<String, Value>,
        namespace_map: Map<String, Value>,
    ) -> Result<()> {
        root.insert(
            self.metadata_namespace.clone(),
            Value::Object(namespace_map),
        );
        self.write_metadata(repo_path, task_id, root)
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

        let (is_ready, reason) = self.verify_repo_initialized(repo_path, &beads_dir)?;
        if !is_ready {
            let slug = compute_repo_slug(repo_path);
            let beads_dir_env = beads_dir.to_string_lossy().to_string();
            let (ok, _stdout, stderr) = self.command_runner.run_allow_failure_with_env(
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
                return Err(anyhow!(
                    "Failed to initialize Beads at {}: {}",
                    beads_dir.display(),
                    details
                ));
            }

            let (is_ready_after, reason_after) =
                self.verify_repo_initialized(repo_path, &beads_dir)?;
            if !is_ready_after {
                return Err(anyhow!(
                    "Beads init completed but store is not ready at {}: {}",
                    beads_dir.display(),
                    reason_after
                ));
            }
        }

        self.ensure_custom_statuses(repo_path)?;
        self.mark_repo_initialized(&repo_key)?;
        Ok(())
    }

    fn list_tasks(&self, repo_path: &Path) -> Result<Vec<TaskCard>> {
        let value = self.run_bd_json(repo_path, &["list", "--all", "-n", "500"])?;

        let mut tasks = value
            .as_array()
            .ok_or_else(|| anyhow!("bd list did not return an array"))?
            .iter()
            .map(|entry| {
                let issue: RawIssue = serde_json::from_value(entry.clone())
                    .context("Failed to decode task from bd list")?;
                self.parse_task_card(issue)
            })
            .collect::<Result<Vec<TaskCard>>>()?;

        tasks = tasks
            .into_iter()
            .filter(|task| task.issue_type != "event" && task.issue_type != "gate")
            .collect::<Vec<_>>();

        let mut subtasks_by_parent: HashMap<String, Vec<String>> = HashMap::new();
        for task in &tasks {
            if let Some(parent_id) = &task.parent_id {
                subtasks_by_parent
                    .entry(parent_id.clone())
                    .or_default()
                    .push(task.id.clone());
            }
        }

        for task in &mut tasks {
            let mut subtasks = subtasks_by_parent.remove(&task.id).unwrap_or_default();
            subtasks.sort();
            task.subtask_ids = subtasks;
        }

        Ok(tasks)
    }

    fn create_task(&self, repo_path: &Path, input: CreateTaskInput) -> Result<TaskCard> {
        let mut args = vec![
            "create".to_string(),
            input.title,
            "--type".to_string(),
            input.issue_type,
            "--priority".to_string(),
            input.priority.to_string(),
        ];

        if let Some(description) = normalize_text_option(input.description) {
            args.push("--description".to_string());
            args.push(description);
        }

        if let Some(acceptance_criteria) = normalize_text_option(input.acceptance_criteria) {
            args.push("--acceptance".to_string());
            args.push(acceptance_criteria);
        }

        let labels = normalize_labels(input.labels.unwrap_or_default());
        if !labels.is_empty() {
            args.push("--labels".to_string());
            args.push(labels.join(","));
        }

        if let Some(parent_id) = normalize_text_option(input.parent_id) {
            args.push("--parent".to_string());
            args.push(parent_id);
        }

        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        let value = self.run_bd_json(repo_path, &arg_refs)?;
        let raw: RawIssue =
            serde_json::from_value(value).context("Failed to decode created issue")?;
        let created_id = raw.id.clone();

        let mut metadata_root = parse_metadata_root(raw.metadata);
        let mut namespace_map = metadata_namespace(&metadata_root, &self.metadata_namespace)
            .cloned()
            .unwrap_or_default();

        namespace_map.insert(
            "qaRequired".to_string(),
            Value::Bool(input.ai_review_enabled.unwrap_or(true)),
        );

        self.persist_namespace(repo_path, &created_id, &mut metadata_root, namespace_map)?;

        self.show_task(repo_path, &created_id)
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

        if let Some(acceptance_criteria) = patch.acceptance_criteria {
            args.push("--acceptance".to_string());
            args.push(acceptance_criteria);
        }

        if let Some(notes) = patch.notes {
            args.push("--notes".to_string());
            args.push(notes);
        }

        if let Some(status) = patch.status {
            args.push("--status".to_string());
            args.push(status.as_cli_value().to_string());
        }

        if let Some(priority) = patch.priority {
            args.push("--priority".to_string());
            args.push(priority.to_string());
        }

        if let Some(issue_type) = patch.issue_type {
            args.push("--type".to_string());
            args.push(issue_type);
        }

        if let Some(assignee) = patch.assignee {
            args.push("--assignee".to_string());
            args.push(assignee);
        }

        if let Some(parent_id) = patch.parent_id {
            args.push("--parent".to_string());
            args.push(parent_id.trim().to_string());
        }

        if let Some(labels) = patch.labels {
            args.push("--set-labels".to_string());
            args.push(normalize_labels(labels).join(","));
        }

        if args.len() > 2 {
            let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
            self.run_bd_json(repo_path, &arg_refs)?;
        }

        if let Some(ai_review_enabled) = patch.ai_review_enabled {
            let (_issue, mut root, mut namespace_map) = self.load_namespace(repo_path, task_id)?;
            namespace_map.insert("qaRequired".to_string(), Value::Bool(ai_review_enabled));
            self.persist_namespace(repo_path, task_id, &mut root, namespace_map)?;
        }

        self.show_task(repo_path, task_id)
    }

    fn delete_task(&self, repo_path: &Path, task_id: &str, delete_subtasks: bool) -> Result<bool> {
        let mut args = vec![
            "delete",
            task_id,
            "--force",
            "--reason",
            "Deleted from OpenDucktor",
        ];
        if delete_subtasks {
            args.push("--cascade");
        }

        self.run_bd(repo_path, &args)?;
        Ok(true)
    }

    fn get_spec(&self, repo_path: &Path, task_id: &str) -> Result<SpecDocument> {
        let issue = self.show_raw_issue(repo_path, task_id)?;
        let metadata_root = parse_metadata_root(issue.metadata.clone());
        let entries = metadata_namespace(&metadata_root, &self.metadata_namespace)
            .and_then(|ns| ns.get("documents"))
            .and_then(|docs| docs.get("spec"))
            .and_then(parse_markdown_entries);
        let latest = entries.as_ref().and_then(|list| list.last());

        Ok(SpecDocument {
            markdown: latest
                .map(|entry| entry.markdown.clone())
                .unwrap_or_default(),
            updated_at: latest.map(|entry| entry.updated_at.clone()),
        })
    }

    fn set_spec(&self, repo_path: &Path, task_id: &str, markdown: &str) -> Result<SpecDocument> {
        let (_issue, mut root, mut namespace_map) = self.load_namespace(repo_path, task_id)?;
        let mut documents_map = namespace_map
            .get("documents")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        let next_revision = documents_map
            .get("spec")
            .and_then(parse_markdown_entries)
            .and_then(|entries| entries.last().map(|entry| entry.revision + 1))
            .unwrap_or(1);

        let timestamp = now_rfc3339();
        let entry = MarkdownEntry {
            markdown: markdown.trim().to_string(),
            updated_at: timestamp.clone(),
            updated_by: "planner-agent".to_string(),
            source_tool: "set_spec".to_string(),
            revision: next_revision,
        };

        documents_map.insert(
            "spec".to_string(),
            Value::Array(vec![serde_json::to_value(&entry)?]),
        );
        namespace_map.insert("documents".to_string(), Value::Object(documents_map));

        self.persist_namespace(repo_path, task_id, &mut root, namespace_map)?;

        Ok(SpecDocument {
            markdown: entry.markdown,
            updated_at: Some(timestamp),
        })
    }

    fn get_plan(&self, repo_path: &Path, task_id: &str) -> Result<SpecDocument> {
        let issue = self.show_raw_issue(repo_path, task_id)?;
        let metadata_root = parse_metadata_root(issue.metadata.clone());
        let entries = metadata_namespace(&metadata_root, &self.metadata_namespace)
            .and_then(|ns| ns.get("documents"))
            .and_then(|docs| docs.get("implementationPlan"))
            .and_then(parse_markdown_entries);
        let latest = entries.as_ref().and_then(|list| list.last());

        Ok(SpecDocument {
            markdown: latest
                .map(|entry| entry.markdown.clone())
                .unwrap_or_default(),
            updated_at: latest.map(|entry| entry.updated_at.clone()),
        })
    }

    fn set_plan(&self, repo_path: &Path, task_id: &str, markdown: &str) -> Result<SpecDocument> {
        let (_issue, mut root, mut namespace_map) = self.load_namespace(repo_path, task_id)?;
        let mut documents_map = namespace_map
            .get("documents")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        let next_revision = documents_map
            .get("implementationPlan")
            .and_then(parse_markdown_entries)
            .and_then(|entries| entries.last().map(|entry| entry.revision + 1))
            .unwrap_or(1);

        let timestamp = now_rfc3339();
        let entry = MarkdownEntry {
            markdown: markdown.trim().to_string(),
            updated_at: timestamp.clone(),
            updated_by: "planner-agent".to_string(),
            source_tool: "set_plan".to_string(),
            revision: next_revision,
        };

        documents_map.insert(
            "implementationPlan".to_string(),
            Value::Array(vec![serde_json::to_value(&entry)?]),
        );
        namespace_map.insert("documents".to_string(), Value::Object(documents_map));

        self.persist_namespace(repo_path, task_id, &mut root, namespace_map)?;

        Ok(SpecDocument {
            markdown: entry.markdown,
            updated_at: Some(timestamp),
        })
    }

    fn get_latest_qa_report(
        &self,
        repo_path: &Path,
        task_id: &str,
    ) -> Result<Option<QaReportDocument>> {
        let issue = self.show_raw_issue(repo_path, task_id)?;
        let metadata_root = parse_metadata_root(issue.metadata);
        let namespace = metadata_namespace(&metadata_root, &self.metadata_namespace);
        let Some(entries) = namespace
            .and_then(|ns| ns.get("documents"))
            .and_then(|docs| docs.get("qaReports"))
            .and_then(parse_qa_entries)
        else {
            return Ok(None);
        };

        Ok(entries.last().map(|entry| QaReportDocument {
            markdown: entry.markdown.clone(),
            verdict: entry.verdict.clone(),
            updated_at: entry.updated_at.clone(),
            revision: entry.revision,
        }))
    }

    fn append_qa_report(
        &self,
        repo_path: &Path,
        task_id: &str,
        markdown: &str,
        verdict: QaVerdict,
    ) -> Result<QaReportDocument> {
        let (_issue, mut root, mut namespace_map) = self.load_namespace(repo_path, task_id)?;
        let mut documents_map = namespace_map
            .get("documents")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        let mut entries = documents_map
            .get("qaReports")
            .and_then(parse_qa_entries)
            .unwrap_or_default();
        let next_revision = entries.last().map(|entry| entry.revision + 1).unwrap_or(1);

        let timestamp = now_rfc3339();
        let entry = QaEntry {
            markdown: markdown.trim().to_string(),
            verdict: verdict.clone(),
            updated_at: timestamp.clone(),
            updated_by: "qa-agent".to_string(),
            source_tool: match verdict {
                QaVerdict::Approved => "qa_approved".to_string(),
                QaVerdict::Rejected => "qa_rejected".to_string(),
            },
            revision: next_revision,
        };

        entries.push(entry.clone());
        documents_map.insert(
            "qaReports".to_string(),
            Value::Array(
                entries
                    .iter()
                    .map(serde_json::to_value)
                    .collect::<std::result::Result<Vec<_>, _>>()?,
            ),
        );
        namespace_map.insert("documents".to_string(), Value::Object(documents_map));

        self.persist_namespace(repo_path, task_id, &mut root, namespace_map)?;
        Ok(QaReportDocument {
            markdown: entry.markdown,
            verdict: entry.verdict,
            updated_at: timestamp,
            revision: entry.revision,
        })
    }

    fn list_agent_sessions(
        &self,
        repo_path: &Path,
        task_id: &str,
    ) -> Result<Vec<AgentSessionDocument>> {
        let issue = self.show_raw_issue(repo_path, task_id)?;
        let metadata_root = parse_metadata_root(issue.metadata);
        let mut entries = metadata_namespace(&metadata_root, &self.metadata_namespace)
            .and_then(|ns| ns.get("agentSessions"))
            .and_then(parse_agent_sessions)
            .unwrap_or_default();

        entries.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        Ok(entries)
    }

    fn upsert_agent_session(
        &self,
        repo_path: &Path,
        task_id: &str,
        session: AgentSessionDocument,
    ) -> Result<()> {
        let (_issue, mut root, mut namespace_map) = self.load_namespace(repo_path, task_id)?;
        let mut sessions = namespace_map
            .get("agentSessions")
            .and_then(parse_agent_sessions)
            .unwrap_or_default();

        if let Some(existing_index) = sessions
            .iter()
            .position(|entry| entry.session_id == session.session_id)
        {
            sessions[existing_index] = session;
        } else {
            sessions.push(session);
        }

        sessions.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        sessions.truncate(100);

        namespace_map.insert(
            "agentSessions".to_string(),
            Value::Array(
                sessions
                    .iter()
                    .map(serde_json::to_value)
                    .collect::<std::result::Result<Vec<_>, _>>()?,
            ),
        );

        self.persist_namespace(repo_path, task_id, &mut root, namespace_map)?;
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
struct RawIssue {
    id: String,
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    acceptance_criteria: String,
    #[serde(default)]
    notes: String,
    status: String,
    #[serde(default)]
    priority: i32,
    #[serde(default)]
    issue_type: String,
    #[serde(default)]
    labels: Vec<String>,
    #[serde(default)]
    owner: Option<String>,
    #[serde(default)]
    parent: Option<String>,
    #[serde(default)]
    dependencies: Vec<RawDependency>,
    #[serde(default)]
    metadata: Option<Value>,
    updated_at: String,
    created_at: String,
}

#[derive(Debug, Deserialize)]
struct RawDependency {
    #[serde(rename = "type", alias = "dependency_type", default)]
    dependency_type: String,
    #[serde(default)]
    depends_on_id: Option<String>,
    #[serde(default)]
    id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownEntry {
    markdown: String,
    updated_at: String,
    updated_by: String,
    source_tool: String,
    revision: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QaEntry {
    markdown: String,
    verdict: QaVerdict,
    updated_at: String,
    updated_by: String,
    source_tool: String,
    revision: u32,
}

fn parse_metadata_root(metadata: Option<Value>) -> Map<String, Value> {
    match metadata {
        Some(Value::Object(map)) => map,
        _ => Map::new(),
    }
}

fn metadata_namespace<'a>(
    metadata: &'a Map<String, Value>,
    namespace: &str,
) -> Option<&'a Map<String, Value>> {
    metadata.get(namespace).and_then(Value::as_object)
}

fn metadata_bool_qa_required(namespace: &Map<String, Value>) -> Option<bool> {
    namespace.get("qaRequired").and_then(Value::as_bool)
}

fn markdown_document_presence(entries: Option<Vec<MarkdownEntry>>) -> TaskDocumentPresence {
    let latest = entries.as_ref().and_then(|list| list.last());
    match latest {
        Some(entry) if !entry.markdown.trim().is_empty() => TaskDocumentPresence {
            has: true,
            updated_at: Some(entry.updated_at.clone()),
        },
        _ => TaskDocumentPresence::default(),
    }
}

fn qa_document_presence(entries: Option<Vec<QaEntry>>) -> TaskDocumentPresence {
    let latest = entries.as_ref().and_then(|list| list.last());
    match latest {
        Some(entry) if !entry.markdown.trim().is_empty() => TaskDocumentPresence {
            has: true,
            updated_at: Some(entry.updated_at.clone()),
        },
        _ => TaskDocumentPresence::default(),
    }
}

fn metadata_document_summary(namespace: Option<&Map<String, Value>>) -> TaskDocumentSummary {
    let documents = namespace
        .and_then(|entry| entry.get("documents"))
        .and_then(Value::as_object);

    let spec = markdown_document_presence(
        documents
            .and_then(|docs| docs.get("spec"))
            .and_then(parse_markdown_entries),
    );
    let plan = markdown_document_presence(
        documents
            .and_then(|docs| docs.get("implementationPlan"))
            .and_then(parse_markdown_entries),
    );
    let qa_report = qa_document_presence(
        documents
            .and_then(|docs| docs.get("qaReports"))
            .and_then(parse_qa_entries),
    );

    TaskDocumentSummary {
        spec,
        plan,
        qa_report,
    }
}

fn parse_markdown_entries(value: &Value) -> Option<Vec<MarkdownEntry>> {
    let entries = value
        .as_array()?
        .iter()
        .filter_map(|entry| serde_json::from_value::<MarkdownEntry>(entry.clone()).ok())
        .collect::<Vec<_>>();
    Some(entries)
}

fn parse_qa_entries(value: &Value) -> Option<Vec<QaEntry>> {
    let entries = value
        .as_array()?
        .iter()
        .filter_map(|entry| serde_json::from_value::<QaEntry>(entry.clone()).ok())
        .collect::<Vec<_>>();
    Some(entries)
}

fn parse_agent_sessions(value: &Value) -> Option<Vec<AgentSessionDocument>> {
    let entries = value
        .as_array()?
        .iter()
        .filter_map(|entry| serde_json::from_value::<AgentSessionDocument>(entry.clone()).ok())
        .collect::<Vec<_>>();
    Some(entries)
}

fn normalize_labels(labels: Vec<String>) -> Vec<String> {
    let mut normalized: Vec<String> = labels
        .into_iter()
        .map(|label| label.trim().to_string())
        .filter(|label| !label.is_empty())
        .collect();
    normalized.sort();
    normalized.dedup();
    normalized
}

fn normalize_text_option(value: Option<String>) -> Option<String> {
    value.and_then(|entry| {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_issue_type(issue_type: &str) -> &'static str {
    match issue_type {
        "epic" => "epic",
        "feature" => "feature",
        "bug" => "bug",
        _ => "task",
    }
}

fn default_ai_review_enabled(issue_type: &str) -> bool {
    matches!(
        normalize_issue_type(issue_type),
        "epic" | "feature" | "task" | "bug"
    )
}

#[cfg(test)]
mod tests {
    use super::{
        default_ai_review_enabled, metadata_bool_qa_required, metadata_namespace,
        normalize_issue_type, normalize_labels, normalize_text_option, parse_agent_sessions,
        parse_markdown_entries, parse_metadata_root, parse_qa_entries, BeadsTaskStore,
        CommandRunner, CUSTOM_STATUS_VALUES,
        ProcessCommandRunner,
    };
    use anyhow::{anyhow, Result};
    use host_domain::{
        AgentSessionDocument, CreateTaskInput, QaVerdict, TaskStatus, TaskStore, UpdateTaskPatch,
    };
    use host_infra_system::{compute_repo_slug, resolve_central_beads_dir};
    use serde_json::{json, Value};
    use std::collections::VecDeque;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[derive(Debug, Clone, PartialEq, Eq)]
    enum CallKind {
        WithEnv,
        AllowFailureWithEnv,
    }

    #[derive(Debug, Clone)]
    enum MockStep {
        WithEnv(std::result::Result<String, String>),
        AllowFailureWithEnv(std::result::Result<(bool, String, String), String>),
    }

    #[derive(Debug, Clone)]
    struct RecordedCall {
        kind: CallKind,
        program: String,
        args: Vec<String>,
        cwd: Option<PathBuf>,
        env: Vec<(String, String)>,
    }

    #[derive(Debug, Default)]
    struct MockCommandRunner {
        steps: Mutex<VecDeque<MockStep>>,
        calls: Mutex<Vec<RecordedCall>>,
    }

    impl MockCommandRunner {
        fn with_steps(steps: Vec<MockStep>) -> Arc<Self> {
            Arc::new(Self {
                steps: Mutex::new(VecDeque::from(steps)),
                calls: Mutex::new(Vec::new()),
            })
        }

        fn take_calls(&self) -> Vec<RecordedCall> {
            self.calls
                .lock()
                .expect("calls lock poisoned")
                .drain(..)
                .collect()
        }

        fn remaining_steps(&self) -> usize {
            self.steps.lock().expect("steps lock poisoned").len()
        }

        fn pop_step(&self, expected_kind: CallKind) -> MockStep {
            let step = self
                .steps
                .lock()
                .expect("steps lock poisoned")
                .pop_front()
                .expect("unexpected command invocation");
            match (&step, &expected_kind) {
                (MockStep::WithEnv(_), CallKind::WithEnv)
                | (MockStep::AllowFailureWithEnv(_), CallKind::AllowFailureWithEnv) => step,
                _ => panic!(
                    "unexpected command invocation kind, expected {:?}, got {:?}",
                    expected_kind, step
                ),
            }
        }

        fn record_call(
            &self,
            kind: CallKind,
            program: &str,
            args: &[&str],
            cwd: Option<&Path>,
            env: &[(&str, &str)],
        ) {
            self.calls
                .lock()
                .expect("calls lock poisoned")
                .push(RecordedCall {
                    kind,
                    program: program.to_string(),
                    args: args.iter().map(|entry| (*entry).to_string()).collect(),
                    cwd: cwd.map(Path::to_path_buf),
                    env: env
                        .iter()
                        .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
                        .collect(),
                });
        }
    }

    impl CommandRunner for MockCommandRunner {
        fn run_with_env(
            &self,
            program: &str,
            args: &[&str],
            cwd: Option<&Path>,
            env: &[(&str, &str)],
        ) -> Result<String> {
            self.record_call(CallKind::WithEnv, program, args, cwd, env);
            match self.pop_step(CallKind::WithEnv) {
                MockStep::WithEnv(result) => result.map_err(|message| anyhow!(message)),
                MockStep::AllowFailureWithEnv(_) => {
                    unreachable!("call kind already checked")
                }
            }
        }

        fn run_allow_failure_with_env(
            &self,
            program: &str,
            args: &[&str],
            cwd: Option<&Path>,
            env: &[(&str, &str)],
        ) -> Result<(bool, String, String)> {
            self.record_call(CallKind::AllowFailureWithEnv, program, args, cwd, env);
            match self.pop_step(CallKind::AllowFailureWithEnv) {
                MockStep::AllowFailureWithEnv(result) => {
                    result.map_err(|message| anyhow!(message))
                }
                MockStep::WithEnv(_) => unreachable!("call kind already checked"),
            }
        }
    }

    struct RepoFixture {
        path: PathBuf,
    }

    impl RepoFixture {
        fn new(label: &str) -> Self {
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock went backwards")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "odt-beads-test-{}-{}-{}",
                label,
                std::process::id(),
                timestamp
            ));
            fs::create_dir_all(&path).expect("failed creating temp repo fixture");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for RepoFixture {
        fn drop(&mut self) {
            if let Ok(beads_dir) = resolve_central_beads_dir(&self.path) {
                if let Some(parent) = beads_dir.parent() {
                    let _ = fs::remove_dir_all(parent);
                }
            }
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn issue_value(
        id: &str,
        status: &str,
        issue_type: &str,
        parent: Option<&str>,
        dependencies: Value,
        metadata: Option<Value>,
    ) -> Value {
        json!({
            "id": id,
            "title": format!("Task {id}"),
            "description": "",
            "acceptance_criteria": "",
            "notes": "",
            "status": status,
            "priority": 2,
            "issue_type": issue_type,
            "labels": ["backend"],
            "owner": null,
            "parent": parent,
            "dependencies": dependencies,
            "metadata": metadata,
            "updated_at": "2026-02-20T12:00:00Z",
            "created_at": "2026-02-20T11:00:00Z"
        })
    }

    fn metadata_from_call(call: &RecordedCall) -> Value {
        let index = call
            .args
            .iter()
            .position(|entry| entry == "--metadata")
            .expect("expected --metadata argument");
        serde_json::from_str(
            call.args
                .get(index + 1)
                .expect("expected metadata payload after --metadata"),
        )
        .expect("metadata payload must be valid JSON")
    }

    fn assert_beads_env(call: &RecordedCall) {
        let beads_dir_entry = call
            .env
            .iter()
            .find(|(key, _)| key == "BEADS_DIR")
            .expect("expected BEADS_DIR env entry");
        assert!(!beads_dir_entry.1.trim().is_empty(), "BEADS_DIR must be set");
    }

    fn make_session(session_id: &str, started_at: &str, status: &str) -> AgentSessionDocument {
        AgentSessionDocument {
            session_id: session_id.to_string(),
            external_session_id: format!("external-{session_id}"),
            task_id: "task-1".to_string(),
            role: "build".to_string(),
            scenario: "build_default".to_string(),
            status: status.to_string(),
            started_at: started_at.to_string(),
            updated_at: started_at.to_string(),
            ended_at: None,
            runtime_id: Some("runtime-1".to_string()),
            run_id: None,
            base_url: "http://127.0.0.1:4173".to_string(),
            working_directory: "/repo".to_string(),
            selected_model: None,
        }
    }

    #[test]
    fn metadata_namespace_roundtrip() {
        let root = parse_metadata_root(Some(json!({
            "openducktor": {
                "qaRequired": true
            },
            "other": {
                "keep": true
            }
        })));

        let namespace = metadata_namespace(&root, "openducktor").expect("namespace missing");
        assert_eq!(metadata_bool_qa_required(namespace), Some(true));
        assert!(root.contains_key("other"));
    }

    #[test]
    fn normalize_helpers_keep_payloads_stable() {
        let labels = normalize_labels(vec![
            "backend".to_string(),
            " backend ".to_string(),
            "".to_string(),
            "api".to_string(),
        ]);
        assert_eq!(labels, vec!["api".to_string(), "backend".to_string()]);

        assert_eq!(
            normalize_text_option(Some("  value  ".to_string())),
            Some("value".to_string())
        );
        assert_eq!(normalize_text_option(Some("   ".to_string())), None);
    }

    #[test]
    fn process_command_runner_executes_commands_with_and_without_failure() -> Result<()> {
        let runner = ProcessCommandRunner;
        let output = runner.run_with_env(
            "sh",
            &["-lc", "printf '%s' \"$ODT_BEADS_RUNNER_TEST\""],
            None,
            &[("ODT_BEADS_RUNNER_TEST", "ok")],
        )?;
        assert_eq!(output, "ok");

        let (ok, stdout, stderr) = runner.run_allow_failure_with_env(
            "sh",
            &["-lc", "echo stdout; echo stderr >&2; exit 9"],
            None,
            &[],
        )?;
        assert!(!ok);
        assert_eq!(stdout, "stdout");
        assert_eq!(stderr, "stderr");
        Ok(())
    }

    #[test]
    fn beads_store_constructors_and_debug_are_stable() {
        let default_store = BeadsTaskStore::new();
        let blank_namespace_store = BeadsTaskStore::with_metadata_namespace("   ");
        let custom_namespace_store = BeadsTaskStore::with_metadata_namespace("custom");

        let default_debug = format!("{default_store:?}");
        let blank_debug = format!("{blank_namespace_store:?}");
        let custom_debug = format!("{custom_namespace_store:?}");

        assert!(default_debug.contains("BeadsTaskStore"));
        assert!(blank_debug.contains("openducktor"));
        assert!(custom_debug.contains("custom"));
    }

    #[test]
    fn issue_type_and_ai_review_defaults_are_normalized() {
        assert_eq!(normalize_issue_type("feature"), "feature");
        assert_eq!(normalize_issue_type("unknown-type"), "task");
        assert!(default_ai_review_enabled("epic"));
        assert!(default_ai_review_enabled("unknown-type"));
    }

    #[test]
    fn markdown_and_qa_entry_parsers_filter_invalid_entries() {
        let markdown_entries = parse_markdown_entries(&json!([
            {
                "markdown": "# Spec",
                "updatedAt": "2026-02-17T12:34:56Z",
                "updatedBy": "planner-agent",
                "sourceTool": "set_spec",
                "revision": 1
            },
            {
                "markdown": 42
            }
        ]))
        .expect("markdown entries");
        assert_eq!(markdown_entries.len(), 1);
        assert_eq!(markdown_entries[0].revision, 1);

        let qa_entries = parse_qa_entries(&json!([
            {
                "markdown": "# QA",
                "verdict": "approved",
                "updatedAt": "2026-02-17T13:10:00Z",
                "updatedBy": "qa-agent",
                "sourceTool": "qa_approved",
                "revision": 2
            },
            {
                "verdict": "rejected"
            }
        ]))
        .expect("qa entries");
        assert_eq!(qa_entries.len(), 1);
        assert_eq!(qa_entries[0].revision, 2);

        let sessions = parse_agent_sessions(&json!([
            {
                "sessionId": "obp-session-1",
                "externalSessionId": "session-opencode-1",
                "taskId": "task-1",
                "role": "spec",
                "scenario": "spec_initial",
                "status": "idle",
                "startedAt": "2026-02-18T17:20:00Z",
                "updatedAt": "2026-02-18T17:21:00Z",
                "endedAt": null,
                "runtimeId": "runtime-1",
                "runId": null,
                "baseUrl": "http://127.0.0.1:4173",
                "workingDirectory": "/repo",
                "selectedModel": {
                    "providerId": "openai",
                    "modelId": "gpt-5",
                    "variant": "high",
                    "opencodeAgent": "architect"
                }
            },
            {
                "sessionId": 123
            }
        ]))
        .expect("agent sessions");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "obp-session-1");
        assert_eq!(sessions[0].external_session_id, "session-opencode-1");
    }

    #[test]
    fn ensure_repo_initialized_skips_init_when_store_is_ready() -> Result<()> {
        let repo = RepoFixture::new("init-ready");
        let runner = MockCommandRunner::with_steps(vec![
            MockStep::AllowFailureWithEnv(Ok((
                true,
                r#"{"path":"/tmp/central/.beads"}"#.to_string(),
                String::new(),
            ))),
            MockStep::WithEnv(Ok("ok".to_string())),
        ]);
        let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

        store.ensure_repo_initialized(repo.path())?;
        assert_eq!(runner.remaining_steps(), 0);

        let calls = runner.take_calls();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].kind, CallKind::AllowFailureWithEnv);
        assert_eq!(
            calls[0].args,
            vec!["--no-daemon", "where", "--json"]
                .into_iter()
                .map(str::to_string)
                .collect::<Vec<_>>()
        );
        assert_eq!(calls[1].kind, CallKind::WithEnv);
        assert_eq!(
            calls[1].args,
            vec![
                "--no-daemon",
                "config",
                "set",
                "status.custom",
                CUSTOM_STATUS_VALUES
            ]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
        );
        assert_eq!(calls[0].program, "bd");
        assert_eq!(calls[0].cwd.as_deref(), Some(repo.path()));
        assert_beads_env(&calls[0]);
        assert_beads_env(&calls[1]);
        Ok(())
    }

    #[test]
    fn ensure_repo_initialized_runs_init_then_uses_cache_when_database_exists() -> Result<()> {
        let repo = RepoFixture::new("init-path");
        let runner = MockCommandRunner::with_steps(vec![
            MockStep::AllowFailureWithEnv(Ok((false, String::new(), "not initialized".to_string()))),
            MockStep::AllowFailureWithEnv(Ok((true, String::new(), String::new()))),
            MockStep::AllowFailureWithEnv(Ok((
                true,
                r#"{"path":"/tmp/central/.beads"}"#.to_string(),
                String::new(),
            ))),
            MockStep::WithEnv(Ok("ok".to_string())),
        ]);
        let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

        store.ensure_repo_initialized(repo.path())?;

        let beads_dir = resolve_central_beads_dir(repo.path())?;
        fs::create_dir_all(&beads_dir)?;
        fs::write(beads_dir.join("beads.db"), "cached").expect("beads.db should be writable");

        store.ensure_repo_initialized(repo.path())?;
        assert_eq!(runner.remaining_steps(), 0);

        let calls = runner.take_calls();
        assert_eq!(calls.len(), 4);
        let expected_slug = compute_repo_slug(repo.path());
        assert_eq!(
            calls[1].args,
            vec![
                "--no-daemon",
                "init",
                "--quiet",
                "--skip-hooks",
                "--skip-merge-driver",
                "--prefix",
                expected_slug.as_str(),
            ]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
        );
        assert_beads_env(&calls[1]);
        Ok(())
    }

    #[test]
    fn ensure_repo_initialized_returns_error_when_init_fails() {
        let repo = RepoFixture::new("init-fails");
        let runner = MockCommandRunner::with_steps(vec![
            MockStep::AllowFailureWithEnv(Ok((false, String::new(), "where failed".to_string()))),
            MockStep::AllowFailureWithEnv(Ok((
                false,
                String::new(),
                "permission denied".to_string(),
            ))),
        ]);
        let store = BeadsTaskStore::with_test_runner("openducktor", runner);

        let error = store
            .ensure_repo_initialized(repo.path())
            .expect_err("init should fail");
        assert!(error.to_string().contains("Failed to initialize Beads"));
        assert!(error.to_string().contains("permission denied"));
    }

    #[test]
    fn ensure_repo_initialized_errors_when_verification_is_still_not_ready() {
        let repo = RepoFixture::new("init-malformed");
        let runner = MockCommandRunner::with_steps(vec![
            MockStep::AllowFailureWithEnv(Ok((false, String::new(), "missing".to_string()))),
            MockStep::AllowFailureWithEnv(Ok((true, String::new(), String::new()))),
            MockStep::AllowFailureWithEnv(Ok((true, "{}".to_string(), String::new()))),
        ]);
        let store = BeadsTaskStore::with_test_runner("openducktor", runner);

        let error = store
            .ensure_repo_initialized(repo.path())
            .expect_err("init should fail when store remains unready");
        assert!(error.to_string().contains("store is not ready"));
    }

    #[test]
    fn list_tasks_filters_events_and_populates_subtask_ids() -> Result<()> {
        let repo = RepoFixture::new("list-tasks");
        let payload = json!([
            issue_value(
                "task-parent",
                "open",
                "epic",
                None,
                json!([]),
                Some(json!({
                    "openducktor": {
                        "qaRequired": true,
                        "documents": {
                            "spec": [
                                {
                                    "markdown": "# Spec",
                                    "updatedAt": "2026-02-20T09:00:00Z",
                                    "updatedBy": "planner-agent",
                                    "sourceTool": "set_spec",
                                    "revision": 1
                                }
                            ],
                            "qaReports": [
                                {
                                    "markdown": "QA approved",
                                    "verdict": "approved",
                                    "updatedAt": "2026-02-20T10:00:00Z",
                                    "updatedBy": "qa-agent",
                                    "sourceTool": "qa_approved",
                                    "revision": 1
                                }
                            ]
                        }
                    }
                }))
            ),
            issue_value(
                "task-child",
                "in_progress",
                "task",
                None,
                json!([{"type":"parent-child","depends_on_id":"task-parent"}]),
                None
            ),
            issue_value("task-event", "open", "event", None, json!([]), None),
            issue_value("task-gate", "open", "gate", None, json!([]), None)
        ]);
        let runner = MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(payload.to_string()))]);
        let store = BeadsTaskStore::with_test_runner("openducktor", runner);

        let tasks = store.list_tasks(repo.path())?;
        assert_eq!(tasks.len(), 2);

        let parent = tasks
            .iter()
            .find(|task| task.id == "task-parent")
            .expect("parent task missing");
        assert_eq!(parent.subtask_ids, vec!["task-child".to_string()]);
        assert!(parent.document_summary.spec.has);
        assert_eq!(
            parent.document_summary.spec.updated_at.as_deref(),
            Some("2026-02-20T09:00:00Z")
        );
        assert!(!parent.document_summary.plan.has);
        assert!(parent.document_summary.qa_report.has);
        assert_eq!(
            parent.document_summary.qa_report.updated_at.as_deref(),
            Some("2026-02-20T10:00:00Z")
        );

        let child = tasks
            .iter()
            .find(|task| task.id == "task-child")
            .expect("child task missing");
        assert_eq!(child.parent_id.as_deref(), Some("task-parent"));
        assert!(!child.document_summary.spec.has);
        assert!(!child.document_summary.plan.has);
        assert!(!child.document_summary.qa_report.has);
        Ok(())
    }

    #[test]
    fn create_task_normalizes_payload_and_persists_qa_flag() -> Result<()> {
        let repo = RepoFixture::new("create-task");
        let created = issue_value("task-1", "open", "feature", None, json!([]), None);
        let shown = issue_value(
            "task-1",
            "open",
            "feature",
            Some("epic-1"),
            json!([]),
            Some(json!({"openducktor": {"qaRequired": false}})),
        );
        let runner = MockCommandRunner::with_steps(vec![
            MockStep::WithEnv(Ok(created.to_string())),
            MockStep::WithEnv(Ok("{}".to_string())),
            MockStep::WithEnv(Ok(json!([shown]).to_string())),
        ]);
        let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

        let task = store.create_task(
            repo.path(),
            CreateTaskInput {
                title: "Build API".to_string(),
                issue_type: "feature".to_string(),
                priority: 3,
                description: Some("  expose endpoint ".to_string()),
                acceptance_criteria: Some("  green tests ".to_string()),
                labels: Some(vec![
                    "backend".to_string(),
                    "api".to_string(),
                    "backend".to_string(),
                    "".to_string(),
                ]),
                ai_review_enabled: Some(false),
                parent_id: Some(" epic-1 ".to_string()),
            },
        )?;

        assert_eq!(task.id, "task-1");
        assert!(!task.ai_review_enabled);

        let calls = runner.take_calls();
        assert_eq!(calls.len(), 3);
        assert_eq!(calls[0].program, "bd");
        assert_eq!(
            calls[0].args,
            vec![
                "--no-daemon",
                "create",
                "Build API",
                "--type",
                "feature",
                "--priority",
                "3",
                "--description",
                "expose endpoint",
                "--acceptance",
                "green tests",
                "--labels",
                "api,backend",
                "--parent",
                "epic-1",
                "--json",
            ]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
        );
        let metadata_root = metadata_from_call(&calls[1]);
        assert_eq!(metadata_root["openducktor"]["qaRequired"], Value::Bool(false));
        Ok(())
    }

    #[test]
    fn update_task_updates_cli_fields_and_qa_metadata() -> Result<()> {
        let repo = RepoFixture::new("update-task");
        let current = issue_value(
            "task-1",
            "open",
            "task",
            None,
            json!([]),
            Some(json!({"openducktor": {}})),
        );
        let updated = issue_value(
            "task-1",
            "blocked",
            "feature",
            Some("parent-1"),
            json!([]),
            Some(json!({"openducktor": {"qaRequired": false}})),
        );
        let runner = MockCommandRunner::with_steps(vec![
            MockStep::WithEnv(Ok("{}".to_string())),
            MockStep::WithEnv(Ok(json!([current]).to_string())),
            MockStep::WithEnv(Ok("{}".to_string())),
            MockStep::WithEnv(Ok(json!([updated]).to_string())),
        ]);
        let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

        let task = store.update_task(
            repo.path(),
            "task-1",
            UpdateTaskPatch {
                title: Some("Renamed".to_string()),
                description: Some("Updated description".to_string()),
                acceptance_criteria: Some("Updated acceptance".to_string()),
                notes: Some("Updated notes".to_string()),
                status: Some(TaskStatus::Blocked),
                priority: Some(1),
                issue_type: Some("feature".to_string()),
                ai_review_enabled: Some(false),
                labels: Some(vec![
                    "backend".to_string(),
                    "api".to_string(),
                    "backend".to_string(),
                ]),
                assignee: Some("alice".to_string()),
                parent_id: Some(" parent-1 ".to_string()),
            },
        )?;

        assert_eq!(task.status, TaskStatus::Blocked);
        assert_eq!(task.parent_id.as_deref(), Some("parent-1"));

        let calls = runner.take_calls();
        assert_eq!(calls.len(), 4);
        assert_eq!(
            calls[0].args,
            vec![
                "--no-daemon",
                "update",
                "task-1",
                "--title",
                "Renamed",
                "--description",
                "Updated description",
                "--acceptance",
                "Updated acceptance",
                "--notes",
                "Updated notes",
                "--status",
                "blocked",
                "--priority",
                "1",
                "--type",
                "feature",
                "--assignee",
                "alice",
                "--parent",
                "parent-1",
                "--set-labels",
                "api,backend",
                "--json",
            ]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
        );
        let metadata_root = metadata_from_call(&calls[2]);
        assert_eq!(metadata_root["openducktor"]["qaRequired"], Value::Bool(false));
        Ok(())
    }

    #[test]
    fn update_task_can_update_only_ai_review_metadata() -> Result<()> {
        let repo = RepoFixture::new("update-task-metadata");
        let current = issue_value(
            "task-1",
            "open",
            "task",
            None,
            json!([]),
            Some(json!({"openducktor": {"qaRequired": false}})),
        );
        let updated = issue_value(
            "task-1",
            "open",
            "task",
            None,
            json!([]),
            Some(json!({"openducktor": {"qaRequired": true}})),
        );
        let runner = MockCommandRunner::with_steps(vec![
            MockStep::WithEnv(Ok(json!([current]).to_string())),
            MockStep::WithEnv(Ok("{}".to_string())),
            MockStep::WithEnv(Ok(json!([updated]).to_string())),
        ]);
        let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

        let task = store.update_task(
            repo.path(),
            "task-1",
            UpdateTaskPatch {
                title: None,
                description: None,
                acceptance_criteria: None,
                notes: None,
                status: None,
                priority: None,
                issue_type: None,
                ai_review_enabled: Some(true),
                labels: None,
                assignee: None,
                parent_id: None,
            },
        )?;
        assert!(task.ai_review_enabled);

        let calls = runner.take_calls();
        assert_eq!(calls.len(), 3);
        assert_eq!(calls[0].args[1], "show");
        assert_eq!(calls[1].args[1], "update");
        let metadata_root = metadata_from_call(&calls[1]);
        assert_eq!(metadata_root["openducktor"]["qaRequired"], Value::Bool(true));
        Ok(())
    }

    #[test]
    fn delete_task_forwards_cascade_flag() -> Result<()> {
        let repo = RepoFixture::new("delete-task");
        let runner = MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok("done".to_string()))]);
        let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

        assert!(store.delete_task(repo.path(), "task-1", true)?);
        let calls = runner.take_calls();
        assert_eq!(calls.len(), 1);
        assert!(calls[0].args.iter().any(|entry| entry == "--cascade"));
        Ok(())
    }

    #[test]
    fn get_spec_reads_latest_entry_and_falls_back_to_empty() -> Result<()> {
        let repo = RepoFixture::new("get-spec");
        let with_entries = issue_value(
            "task-1",
            "open",
            "task",
            None,
            json!([]),
            Some(json!({
                "openducktor": {
                    "documents": {
                        "spec": [
                            {
                                "markdown": "# Spec v1",
                                "updatedAt": "2026-02-20T11:00:00Z",
                                "updatedBy": "planner-agent",
                                "sourceTool": "set_spec",
                                "revision": 1
                            },
                            {
                                "markdown": "# Spec v2",
                                "updatedAt": "2026-02-20T12:00:00Z",
                                "updatedBy": "planner-agent",
                                "sourceTool": "set_spec",
                                "revision": 2
                            }
                        ]
                    }
                }
            })),
        );
        let empty = issue_value("task-1", "open", "task", None, json!([]), None);
        let runner = MockCommandRunner::with_steps(vec![
            MockStep::WithEnv(Ok(json!([with_entries]).to_string())),
            MockStep::WithEnv(Ok(json!([empty]).to_string())),
        ]);
        let store = BeadsTaskStore::with_test_runner("openducktor", runner);

        let latest = store.get_spec(repo.path(), "task-1")?;
        assert_eq!(latest.markdown, "# Spec v2");
        assert_eq!(latest.updated_at.as_deref(), Some("2026-02-20T12:00:00Z"));

        let missing = store.get_spec(repo.path(), "task-1")?;
        assert!(missing.markdown.is_empty());
        assert!(missing.updated_at.is_none());
        Ok(())
    }

    #[test]
    fn set_spec_trims_markdown_and_increments_revision() -> Result<()> {
        let repo = RepoFixture::new("set-spec");
        let current = issue_value(
            "task-1",
            "open",
            "task",
            None,
            json!([]),
            Some(json!({
                "openducktor": {
                    "documents": {
                        "spec": [
                            {
                                "markdown": "# Spec v2",
                                "updatedAt": "2026-02-20T12:00:00Z",
                                "updatedBy": "planner-agent",
                                "sourceTool": "set_spec",
                                "revision": 2
                            }
                        ]
                    }
                }
            })),
        );
        let runner = MockCommandRunner::with_steps(vec![
            MockStep::WithEnv(Ok(json!([current]).to_string())),
            MockStep::WithEnv(Ok("{}".to_string())),
        ]);
        let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

        let spec = store.set_spec(repo.path(), "task-1", "  ## Updated Spec  ")?;
        assert_eq!(spec.markdown, "## Updated Spec");
        assert!(spec.updated_at.as_deref().is_some());

        let calls = runner.take_calls();
        assert_eq!(calls.len(), 2);
        let metadata_root = metadata_from_call(&calls[1]);
        let entry = &metadata_root["openducktor"]["documents"]["spec"][0];
        assert_eq!(entry["markdown"], Value::String("## Updated Spec".to_string()));
        assert_eq!(entry["revision"], Value::Number(3.into()));
        assert_eq!(entry["sourceTool"], Value::String("set_spec".to_string()));
        assert!(entry["updatedAt"].as_str().is_some());
        Ok(())
    }

    #[test]
    fn get_and_set_plan_use_implementation_plan_metadata() -> Result<()> {
        let repo = RepoFixture::new("plan-docs");
        let current_with_plan = issue_value(
            "task-1",
            "open",
            "task",
            None,
            json!([]),
            Some(json!({
                "openducktor": {
                    "documents": {
                        "implementationPlan": [
                            {
                                "markdown": "# Plan v4",
                                "updatedAt": "2026-02-20T12:30:00Z",
                                "updatedBy": "planner-agent",
                                "sourceTool": "set_plan",
                                "revision": 4
                            }
                        ]
                    }
                }
            })),
        );
        let runner = MockCommandRunner::with_steps(vec![
            MockStep::WithEnv(Ok(json!([current_with_plan.clone()]).to_string())),
            MockStep::WithEnv(Ok(json!([current_with_plan]).to_string())),
            MockStep::WithEnv(Ok("{}".to_string())),
        ]);
        let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

        let plan = store.get_plan(repo.path(), "task-1")?;
        assert_eq!(plan.markdown, "# Plan v4");

        let updated = store.set_plan(repo.path(), "task-1", "  # Plan v5 ")?;
        assert_eq!(updated.markdown, "# Plan v5");

        let calls = runner.take_calls();
        let metadata_root = metadata_from_call(&calls[2]);
        let entry = &metadata_root["openducktor"]["documents"]["implementationPlan"][0];
        assert_eq!(entry["markdown"], Value::String("# Plan v5".to_string()));
        assert_eq!(entry["revision"], Value::Number(5.into()));
        assert_eq!(entry["sourceTool"], Value::String("set_plan".to_string()));
        Ok(())
    }

    #[test]
    fn qa_reports_support_latest_lookup_and_append_history() -> Result<()> {
        let repo = RepoFixture::new("qa-docs");
        let empty = issue_value("task-1", "open", "task", None, json!([]), None);
        let with_reports = issue_value(
            "task-1",
            "open",
            "task",
            None,
            json!([]),
            Some(json!({
                "openducktor": {
                    "documents": {
                        "qaReports": [
                            {
                                "markdown": "Initial QA",
                                "verdict": "approved",
                                "updatedAt": "2026-02-20T10:00:00Z",
                                "updatedBy": "qa-agent",
                                "sourceTool": "qa_approved",
                                "revision": 1
                            }
                        ]
                    }
                }
            })),
        );
        let runner = MockCommandRunner::with_steps(vec![
            MockStep::WithEnv(Ok(json!([empty]).to_string())),
            MockStep::WithEnv(Ok(json!([with_reports]).to_string())),
            MockStep::WithEnv(Ok("{}".to_string())),
        ]);
        let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

        let missing = store.get_latest_qa_report(repo.path(), "task-1")?;
        assert!(missing.is_none());

        let appended =
            store.append_qa_report(repo.path(), "task-1", "  Needs fixes  ", QaVerdict::Rejected)?;
        assert_eq!(appended.markdown, "Needs fixes");
        assert_eq!(appended.verdict, QaVerdict::Rejected);
        assert_eq!(appended.revision, 2);

        let calls = runner.take_calls();
        let metadata_root = metadata_from_call(&calls[2]);
        let reports = metadata_root["openducktor"]["documents"]["qaReports"]
            .as_array()
            .expect("qaReports should be an array");
        assert_eq!(reports.len(), 2);
        let newest = reports.last().expect("newest report missing");
        assert_eq!(newest["revision"], Value::Number(2.into()));
        assert_eq!(newest["sourceTool"], Value::String("qa_rejected".to_string()));
        Ok(())
    }

    #[test]
    fn get_latest_qa_report_returns_latest_entry_when_present() -> Result<()> {
        let repo = RepoFixture::new("qa-latest");
        let with_reports = issue_value(
            "task-1",
            "open",
            "task",
            None,
            json!([]),
            Some(json!({
                "openducktor": {
                    "documents": {
                        "qaReports": [
                            {
                                "markdown": "First report",
                                "verdict": "rejected",
                                "updatedAt": "2026-02-20T10:00:00Z",
                                "updatedBy": "qa-agent",
                                "sourceTool": "qa_rejected",
                                "revision": 1
                            },
                            {
                                "markdown": "Second report",
                                "verdict": "approved",
                                "updatedAt": "2026-02-20T11:00:00Z",
                                "updatedBy": "qa-agent",
                                "sourceTool": "qa_approved",
                                "revision": 2
                            }
                        ]
                    }
                }
            })),
        );
        let runner =
            MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(json!([with_reports]).to_string()))]);
        let store = BeadsTaskStore::with_test_runner("openducktor", runner);

        let latest = store
            .get_latest_qa_report(repo.path(), "task-1")?
            .expect("latest report should exist");
        assert_eq!(latest.markdown, "Second report");
        assert_eq!(latest.verdict, QaVerdict::Approved);
        assert_eq!(latest.updated_at, "2026-02-20T11:00:00Z");
        assert_eq!(latest.revision, 2);
        Ok(())
    }

    #[test]
    fn list_agent_sessions_is_sorted_descending_by_started_at() -> Result<()> {
        let repo = RepoFixture::new("list-sessions");
        let payload = issue_value(
            "task-1",
            "open",
            "task",
            None,
            json!([]),
            Some(json!({
                "openducktor": {
                    "agentSessions": [
                        serde_json::to_value(make_session("session-old", "2026-02-20T09:00:00Z", "idle"))?,
                        serde_json::to_value(make_session("session-new", "2026-02-20T11:00:00Z", "running"))?
                    ]
                }
            })),
        );
        let runner = MockCommandRunner::with_steps(vec![MockStep::WithEnv(Ok(json!([payload]).to_string()))]);
        let store = BeadsTaskStore::with_test_runner("openducktor", runner);

        let sessions = store.list_agent_sessions(repo.path(), "task-1")?;
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].session_id, "session-new");
        assert_eq!(sessions[1].session_id, "session-old");
        Ok(())
    }

    #[test]
    fn upsert_agent_session_updates_existing_session_without_duplication() -> Result<()> {
        let repo = RepoFixture::new("upsert-session");
        let payload = issue_value(
            "task-1",
            "open",
            "task",
            None,
            json!([]),
            Some(json!({
                "openducktor": {
                    "agentSessions": [
                        serde_json::to_value(make_session("session-1", "2026-02-20T10:00:00Z", "idle"))?,
                        serde_json::to_value(make_session("session-2", "2026-02-20T09:00:00Z", "idle"))?
                    ]
                }
            })),
        );
        let runner = MockCommandRunner::with_steps(vec![
            MockStep::WithEnv(Ok(json!([payload]).to_string())),
            MockStep::WithEnv(Ok("{}".to_string())),
        ]);
        let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

        let mut updated = make_session("session-1", "2026-02-20T12:00:00Z", "running");
        updated.updated_at = "2026-02-20T12:01:00Z".to_string();
        store.upsert_agent_session(repo.path(), "task-1", updated)?;

        let calls = runner.take_calls();
        let metadata_root = metadata_from_call(&calls[1]);
        let sessions = metadata_root["openducktor"]["agentSessions"]
            .as_array()
            .expect("agentSessions should be an array");
        assert_eq!(sessions.len(), 2);
        let session_1 = sessions
            .iter()
            .find(|entry| entry["sessionId"] == Value::String("session-1".to_string()))
            .expect("session-1 missing");
        assert_eq!(session_1["status"], Value::String("running".to_string()));
        Ok(())
    }

    #[test]
    fn upsert_agent_session_truncates_to_latest_100_entries() -> Result<()> {
        let repo = RepoFixture::new("upsert-session-truncate");
        let existing = (0..100)
            .map(|index| {
                let started_at = format!("2026-02-20T{:02}:00:00Z", index % 24);
                serde_json::to_value(make_session(
                    &format!("session-{index:03}"),
                    started_at.as_str(),
                    "idle",
                ))
                .expect("session should serialize")
            })
            .collect::<Vec<_>>();
        let payload = issue_value(
            "task-1",
            "open",
            "task",
            None,
            json!([]),
            Some(json!({
                "openducktor": {
                    "agentSessions": existing
                }
            })),
        );
        let runner = MockCommandRunner::with_steps(vec![
            MockStep::WithEnv(Ok(json!([payload]).to_string())),
            MockStep::WithEnv(Ok("{}".to_string())),
        ]);
        let store = BeadsTaskStore::with_test_runner("openducktor", runner.clone());

        let newest = make_session("session-newest", "2026-02-21T00:00:00Z", "running");
        store.upsert_agent_session(repo.path(), "task-1", newest)?;

        let calls = runner.take_calls();
        let metadata_root = metadata_from_call(&calls[1]);
        let sessions = metadata_root["openducktor"]["agentSessions"]
            .as_array()
            .expect("agentSessions should be an array");
        assert_eq!(sessions.len(), 100);
        assert!(sessions
            .iter()
            .any(|entry| entry["sessionId"] == Value::String("session-newest".to_string())));
        Ok(())
    }
}
