use anyhow::{anyhow, Context, Result};
use host_domain::{
    now_rfc3339, AgentSessionDocument, CreateTaskInput, QaReportDocument, QaVerdict, SpecDocument,
    TaskCard, TaskMetadata, TaskStore, UpdateTaskPatch,
};
use host_infra_system::{compute_repo_slug, resolve_central_beads_dir, AppConfigStore};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::command_runner::{CommandRunner, ProcessCommandRunner};
use crate::constants::{DEFAULT_METADATA_NAMESPACE, TASK_LIST_CACHE_TTL_MS};
use crate::metadata::{
    metadata_namespace, parse_agent_sessions, parse_markdown_entries, parse_metadata_root,
    parse_qa_entries,
};
use crate::model::{MarkdownEntry, QaEntry, RawIssue};
use crate::normalize::{normalize_labels, normalize_text_option};

type MetadataNamespaceResolver = Arc<dyn Fn() -> Result<String> + Send + Sync>;

#[derive(Clone)]
struct TaskListCacheEntry {
    tasks: Vec<TaskCard>,
    cached_at: Instant,
}

pub struct BeadsTaskStore {
    pub(crate) command_runner: Arc<dyn CommandRunner>,
    pub(crate) metadata_namespace: Mutex<String>,
    pub(crate) metadata_namespace_resolver: Option<MetadataNamespaceResolver>,
    pub(crate) init_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    pub(crate) initialized_repos: Mutex<HashSet<String>>,
    task_list_cache: Mutex<HashMap<String, TaskListCacheEntry>>,
}

impl fmt::Debug for BeadsTaskStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BeadsTaskStore")
            .field("metadata_namespace", &self.metadata_namespace_snapshot())
            .field(
                "has_metadata_namespace_resolver",
                &self.metadata_namespace_resolver.is_some(),
            )
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
            Some(Self::default_metadata_namespace_resolver()),
        )
    }

    pub fn with_metadata_namespace(namespace: &str) -> Self {
        Self::with_metadata_namespace_and_runner(
            namespace,
            Arc::new(ProcessCommandRunner),
            Some(Self::default_metadata_namespace_resolver()),
        )
    }

    fn with_metadata_namespace_and_runner(
        namespace: &str,
        command_runner: Arc<dyn CommandRunner>,
        metadata_namespace_resolver: Option<MetadataNamespaceResolver>,
    ) -> Self {
        Self {
            command_runner,
            metadata_namespace: Mutex::new(Self::normalize_metadata_namespace(namespace)),
            metadata_namespace_resolver,
            init_locks: Mutex::new(HashMap::new()),
            initialized_repos: Mutex::new(HashSet::new()),
            task_list_cache: Mutex::new(HashMap::new()),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_test_runner(
        namespace: &str,
        command_runner: Arc<dyn CommandRunner>,
    ) -> Self {
        Self::with_metadata_namespace_and_runner(namespace, command_runner, None)
    }

    #[cfg(test)]
    pub(crate) fn with_test_runner_and_namespace_resolver(
        namespace: &str,
        command_runner: Arc<dyn CommandRunner>,
        metadata_namespace_resolver: Arc<dyn Fn() -> Result<String> + Send + Sync>,
    ) -> Self {
        Self::with_metadata_namespace_and_runner(
            namespace,
            command_runner,
            Some(metadata_namespace_resolver),
        )
    }

    fn default_metadata_namespace_resolver() -> MetadataNamespaceResolver {
        Arc::new(|| {
            let config_store = AppConfigStore::new()?;
            config_store.task_metadata_namespace()
        })
    }

    fn normalize_metadata_namespace(namespace: &str) -> String {
        let trimmed = namespace.trim();
        if trimmed.is_empty() {
            DEFAULT_METADATA_NAMESPACE.to_string()
        } else {
            trimmed.to_string()
        }
    }

    fn metadata_namespace_snapshot(&self) -> String {
        match self.metadata_namespace.lock() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    fn set_metadata_namespace(&self, namespace: &str) {
        let normalized = Self::normalize_metadata_namespace(namespace);
        match self.metadata_namespace.lock() {
            Ok(mut guard) => *guard = normalized,
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                *guard = normalized;
            }
        }
    }

    fn refresh_metadata_namespace(&self) {
        let Some(resolve_namespace) = &self.metadata_namespace_resolver else {
            return;
        };

        let Ok(namespace) = resolve_namespace() else {
            return;
        };

        self.set_metadata_namespace(&namespace);
    }

    pub(crate) fn current_metadata_namespace(&self) -> String {
        self.refresh_metadata_namespace();
        self.metadata_namespace_snapshot()
    }

    fn task_list_cache_ttl() -> Duration {
        Duration::from_millis(TASK_LIST_CACHE_TTL_MS)
    }

    fn cached_task_list(&self, repo_key: &str) -> Result<Option<Vec<TaskCard>>> {
        let mut cache = self
            .task_list_cache
            .lock()
            .map_err(|_| anyhow!("Beads task-list cache lock poisoned"))?;

        let Some(entry) = cache.get(repo_key) else {
            return Ok(None);
        };

        if entry.cached_at.elapsed() <= Self::task_list_cache_ttl() {
            return Ok(Some(entry.tasks.clone()));
        }

        cache.remove(repo_key);
        Ok(None)
    }

    fn cache_task_list(&self, repo_key: &str, tasks: &[TaskCard]) -> Result<()> {
        let mut cache = self
            .task_list_cache
            .lock()
            .map_err(|_| anyhow!("Beads task-list cache lock poisoned"))?;
        cache.insert(
            repo_key.to_string(),
            TaskListCacheEntry {
                tasks: tasks.to_vec(),
                cached_at: Instant::now(),
            },
        );
        Ok(())
    }

    pub(crate) fn invalidate_task_list_cache(&self, repo_path: &Path) -> Result<()> {
        let repo_key = Self::repo_key(repo_path);
        let mut cache = self
            .task_list_cache
            .lock()
            .map_err(|_| anyhow!("Beads task-list cache lock poisoned"))?;
        cache.remove(&repo_key);
        Ok(())
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
        let repo_key = Self::repo_key(repo_path);
        if let Some(tasks) = self.cached_task_list(&repo_key)? {
            return Ok(tasks);
        }

        let value = self.run_bd_json(repo_path, &["list", "--all", "--limit", "0"])?;
        let metadata_namespace = self.current_metadata_namespace();

        let mut tasks = value
            .as_array()
            .ok_or_else(|| anyhow!("bd list did not return an array"))?
            .iter()
            .map(|entry| {
                let issue: RawIssue = serde_json::from_value(entry.clone())
                    .context("Failed to decode task from bd list")?;
                self.parse_task_card(issue, &metadata_namespace)
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

        self.cache_task_list(&repo_key, &tasks)?;
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
        self.invalidate_task_list_cache(repo_path)?;
        let raw: RawIssue =
            serde_json::from_value(value).context("Failed to decode created issue")?;
        let created_id = raw.id.clone();

        let mut metadata_root = parse_metadata_root(raw.metadata);
        let namespace_key = self.current_metadata_namespace();
        let mut namespace_map = metadata_namespace(&metadata_root, &namespace_key)
            .cloned()
            .unwrap_or_default();

        namespace_map.insert(
            "qaRequired".to_string(),
            Value::Bool(input.ai_review_enabled.unwrap_or(true)),
        );

        self.persist_namespace(
            repo_path,
            &created_id,
            &namespace_key,
            &mut metadata_root,
            namespace_map,
        )?;

        self.show_task(repo_path, &created_id)
    }

    fn update_task(
        &self,
        repo_path: &Path,
        task_id: &str,
        patch: UpdateTaskPatch,
    ) -> Result<TaskCard> {
        let mut args = vec!["update".to_string()];

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

        if args.len() > 1 {
            args.push("--".to_string());
            args.push(task_id.to_string());
            let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
            self.run_bd_json(repo_path, &arg_refs)?;
            self.invalidate_task_list_cache(repo_path)?;
        }

        if let Some(ai_review_enabled) = patch.ai_review_enabled {
            let (_issue, mut root, namespace_key, mut namespace_map) =
                self.load_namespace(repo_path, task_id)?;
            namespace_map.insert("qaRequired".to_string(), Value::Bool(ai_review_enabled));
            self.persist_namespace(repo_path, task_id, &namespace_key, &mut root, namespace_map)?;
        }

        self.show_task(repo_path, task_id)
    }

    fn delete_task(&self, repo_path: &Path, task_id: &str, delete_subtasks: bool) -> Result<bool> {
        let mut args = vec!["delete", "--force", "--reason", "Deleted from OpenDucktor"];
        if delete_subtasks {
            args.push("--cascade");
        }
        args.push("--");
        args.push(task_id);

        self.run_bd(repo_path, &args)?;
        self.invalidate_task_list_cache(repo_path)?;
        Ok(true)
    }

    fn get_spec(&self, repo_path: &Path, task_id: &str) -> Result<SpecDocument> {
        let issue = self.show_raw_issue(repo_path, task_id)?;
        let metadata_root = parse_metadata_root(issue.metadata.clone());
        let namespace_key = self.current_metadata_namespace();
        let entries = metadata_namespace(&metadata_root, &namespace_key)
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
        let (_issue, mut root, namespace_key, mut namespace_map) =
            self.load_namespace(repo_path, task_id)?;
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

        self.persist_namespace(repo_path, task_id, &namespace_key, &mut root, namespace_map)?;

        Ok(SpecDocument {
            markdown: entry.markdown,
            updated_at: Some(timestamp),
        })
    }

    fn get_plan(&self, repo_path: &Path, task_id: &str) -> Result<SpecDocument> {
        let issue = self.show_raw_issue(repo_path, task_id)?;
        let metadata_root = parse_metadata_root(issue.metadata.clone());
        let namespace_key = self.current_metadata_namespace();
        let entries = metadata_namespace(&metadata_root, &namespace_key)
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
        let (_issue, mut root, namespace_key, mut namespace_map) =
            self.load_namespace(repo_path, task_id)?;
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

        self.persist_namespace(repo_path, task_id, &namespace_key, &mut root, namespace_map)?;

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
        let namespace_key = self.current_metadata_namespace();
        let namespace = metadata_namespace(&metadata_root, &namespace_key);
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
        let (_issue, mut root, namespace_key, mut namespace_map) =
            self.load_namespace(repo_path, task_id)?;
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

        self.persist_namespace(repo_path, task_id, &namespace_key, &mut root, namespace_map)?;
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
        let namespace_key = self.current_metadata_namespace();
        let mut entries = metadata_namespace(&metadata_root, &namespace_key)
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
        let (_issue, mut root, namespace_key, mut namespace_map) =
            self.load_namespace(repo_path, task_id)?;
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

        self.persist_namespace(repo_path, task_id, &namespace_key, &mut root, namespace_map)?;
        Ok(())
    }

    fn get_task_metadata(&self, repo_path: &Path, task_id: &str) -> Result<TaskMetadata> {
        let issue = self.show_raw_issue(repo_path, task_id)?;
        let metadata_root = parse_metadata_root(issue.metadata);
        let namespace_key = self.current_metadata_namespace();
        let namespace = metadata_namespace(&metadata_root, &namespace_key);

        // Extract spec
        let spec_entries = namespace
            .and_then(|ns| ns.get("documents"))
            .and_then(|docs| docs.get("spec"))
            .and_then(parse_markdown_entries);
        let spec_latest = spec_entries.as_ref().and_then(|list| list.last());
        let spec = SpecDocument {
            markdown: spec_latest
                .map(|entry| entry.markdown.clone())
                .unwrap_or_default(),
            updated_at: spec_latest.map(|entry| entry.updated_at.clone()),
        };

        // Extract plan
        let plan_entries = namespace
            .and_then(|ns| ns.get("documents"))
            .and_then(|docs| docs.get("implementationPlan"))
            .and_then(parse_markdown_entries);
        let plan_latest = plan_entries.as_ref().and_then(|list| list.last());
        let plan = SpecDocument {
            markdown: plan_latest
                .map(|entry| entry.markdown.clone())
                .unwrap_or_default(),
            updated_at: plan_latest.map(|entry| entry.updated_at.clone()),
        };

        // Extract QA report
        let qa_entries = namespace
            .and_then(|ns| ns.get("documents"))
            .and_then(|docs| docs.get("qaReports"))
            .and_then(parse_qa_entries);
        let qa_report = qa_entries
            .as_ref()
            .and_then(|entries| entries.last())
            .map(|entry| QaReportDocument {
                markdown: entry.markdown.clone(),
                verdict: entry.verdict.clone(),
                updated_at: entry.updated_at.clone(),
                revision: entry.revision,
            });

        // Extract agent sessions
        let mut agent_sessions = namespace
            .and_then(|ns| ns.get("agentSessions"))
            .and_then(parse_agent_sessions)
            .unwrap_or_default();
        agent_sessions.sort_by(|a, b| b.started_at.cmp(&a.started_at));

        Ok(TaskMetadata {
            spec,
            plan,
            qa_report,
            agent_sessions,
        })
    }
}
