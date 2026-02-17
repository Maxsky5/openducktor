use anyhow::{anyhow, Context, Result};
use host_domain::{
    now_rfc3339, CreateTaskInput, QaReportDocument, QaVerdict, SpecDocument, TaskCard, TaskStatus,
    TaskStore, UpdateTaskPatch,
};
use host_infra_system::{
    compute_repo_slug, resolve_central_beads_dir, run_command_allow_failure_with_env,
    run_command_with_env,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

const DEFAULT_METADATA_NAMESPACE: &str = "openducktor";
const CUSTOM_STATUS_VALUES: &str = "spec_ready,ready_for_dev,ai_review,human_review";

#[derive(Debug, Default)]
pub struct BeadsTaskStore {
    metadata_namespace: String,
    init_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    initialized_repos: Mutex<HashSet<String>>,
}

impl BeadsTaskStore {
    pub fn new() -> Self {
        Self::with_metadata_namespace(DEFAULT_METADATA_NAMESPACE)
    }

    pub fn with_metadata_namespace(namespace: &str) -> Self {
        let trimmed = namespace.trim();
        let metadata_namespace = if trimmed.is_empty() {
            DEFAULT_METADATA_NAMESPACE.to_string()
        } else {
            trimmed.to_string()
        };

        Self {
            metadata_namespace,
            init_locks: Mutex::new(HashMap::new()),
            initialized_repos: Mutex::new(HashSet::new()),
        }
    }

    fn run_bd(&self, repo_path: &Path, args: &[&str]) -> Result<String> {
        let beads_dir = resolve_central_beads_dir(repo_path)?;
        let beads_dir_env = beads_dir.to_string_lossy().to_string();
        let mut final_args = Vec::with_capacity(args.len() + 1);
        final_args.push("--no-daemon");
        final_args.extend(args);

        run_command_with_env(
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

        let output = run_command_with_env(
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
        normalize_issue_type, normalize_labels, normalize_text_option, parse_markdown_entries,
        parse_metadata_root, parse_qa_entries,
    };
    use serde_json::json;

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
    }
}
