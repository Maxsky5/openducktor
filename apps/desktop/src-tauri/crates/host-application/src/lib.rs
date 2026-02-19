use anyhow::{anyhow, Context, Result};
use host_domain::{
    now_rfc3339, AgentRuntimeSummary, AgentSessionDocument, BeadsCheck, CreateTaskInput,
    PlanSubtaskInput, QaVerdict, RunEvent, RunState, RunSummary, RuntimeCheck, SpecDocument,
    SystemCheck, TaskAction, TaskCard, TaskStatus, TaskStore, UpdateTaskPatch, WorkspaceRecord,
};
use host_infra_system::{
    build_branch_name, command_exists, pick_free_port, remove_worktree, resolve_central_beads_dir,
    run_command, run_command_allow_failure, version_command, AppConfigStore, RepoConfig,
};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use uuid::Uuid;

pub type RunEmitter = Arc<dyn Fn(RunEvent) + Send + Sync + 'static>;

#[derive(Clone)]
pub struct AppService {
    task_store: Arc<dyn TaskStore>,
    config_store: AppConfigStore,
    runs: Arc<Mutex<HashMap<String, RunProcess>>>,
    agent_runtimes: Arc<Mutex<HashMap<String, AgentRuntimeProcess>>>,
    initialized_repos: Arc<Mutex<HashSet<String>>>,
}

struct RunProcess {
    summary: RunSummary,
    child: Child,
    repo_path: String,
    task_id: String,
    worktree_path: String,
    repo_config: RepoConfig,
}

struct AgentRuntimeProcess {
    summary: AgentRuntimeSummary,
    child: Child,
    cleanup_repo_path: Option<String>,
    cleanup_worktree_path: Option<String>,
}

impl AppService {
    const WORKSPACE_RUNTIME_ROLE: &'static str = "workspace";
    const WORKSPACE_RUNTIME_TASK_ID: &'static str = "__workspace__";

    pub fn new(task_store: Arc<dyn TaskStore>, config_store: AppConfigStore) -> Self {
        Self {
            task_store,
            config_store,
            runs: Arc::new(Mutex::new(HashMap::new())),
            agent_runtimes: Arc::new(Mutex::new(HashMap::new())),
            initialized_repos: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    fn repo_key(repo_path: &str) -> String {
        fs::canonicalize(repo_path)
            .unwrap_or_else(|_| Path::new(repo_path).to_path_buf())
            .to_string_lossy()
            .to_string()
    }

    fn ensure_repo_initialized(&self, repo_path: &str) -> Result<()> {
        let repo_key = Self::repo_key(repo_path);
        {
            let cache = self
                .initialized_repos
                .lock()
                .map_err(|_| anyhow!("Initialized repo cache lock poisoned"))?;
            if cache.contains(&repo_key) {
                return Ok(());
            }
        }

        self.task_store
            .ensure_repo_initialized(Path::new(repo_path))
            .with_context(|| format!("Failed to initialize task store for {repo_path}"))?;

        let mut cache = self
            .initialized_repos
            .lock()
            .map_err(|_| anyhow!("Initialized repo cache lock poisoned"))?;
        cache.insert(repo_key);

        Ok(())
    }

    fn enrich_task(&self, task: TaskCard, all_tasks: &[TaskCard]) -> TaskCard {
        let mut enriched = task;
        enriched.available_actions = derive_available_actions(&enriched, all_tasks);
        enriched
    }

    fn enrich_tasks(&self, tasks: Vec<TaskCard>) -> Vec<TaskCard> {
        let snapshot = tasks.clone();
        tasks
            .into_iter()
            .map(|task| self.enrich_task(task, &snapshot))
            .collect()
    }

    pub fn runtime_check(&self) -> Result<RuntimeCheck> {
        let git_ok = command_exists("git");
        let opencode_ok = command_exists("opencode");

        let mut errors = Vec::new();
        if !git_ok {
            errors.push("git not found in PATH".to_string());
        }
        if !opencode_ok {
            errors.push("opencode not found in PATH".to_string());
        }

        Ok(RuntimeCheck {
            git_ok,
            git_version: version_command("git", &["--version"]),
            opencode_ok,
            opencode_version: version_command("opencode", &["--version"]),
            errors,
        })
    }

    pub fn beads_check(&self, repo_path: &str) -> Result<BeadsCheck> {
        if !command_exists("bd") {
            return Ok(BeadsCheck {
                beads_ok: false,
                beads_path: None,
                beads_error: Some("bd not found in PATH".to_string()),
            });
        }

        let repo = Path::new(repo_path);
        match resolve_central_beads_dir(repo) {
            Ok(path) => {
                let path_string = path.to_string_lossy().to_string();
                match self.ensure_repo_initialized(repo_path) {
                    Ok(()) => Ok(BeadsCheck {
                        beads_ok: true,
                        beads_path: Some(path_string),
                        beads_error: None,
                    }),
                    Err(error) => Ok(BeadsCheck {
                        beads_ok: false,
                        beads_path: Some(path_string),
                        beads_error: Some(error.to_string()),
                    }),
                }
            }
            Err(error) => Ok(BeadsCheck {
                beads_ok: false,
                beads_path: None,
                beads_error: Some(error.to_string()),
            }),
        }
    }

    pub fn system_check(&self, repo_path: &str) -> Result<SystemCheck> {
        let runtime = self.runtime_check()?;
        let beads = self.beads_check(repo_path)?;
        let mut errors = runtime.errors;
        if let Some(beads_error) = beads.beads_error.as_deref() {
            errors.push(format!("beads: {beads_error}"));
        }

        Ok(SystemCheck {
            git_ok: runtime.git_ok,
            git_version: runtime.git_version,
            opencode_ok: runtime.opencode_ok,
            opencode_version: runtime.opencode_version,
            beads_ok: beads.beads_ok,
            beads_path: beads.beads_path,
            beads_error: beads.beads_error,
            errors,
        })
    }

    pub fn workspace_list(&self) -> Result<Vec<WorkspaceRecord>> {
        self.config_store.list_workspaces()
    }

    pub fn workspace_add(&self, repo_path: &str) -> Result<WorkspaceRecord> {
        let workspace = self.config_store.add_workspace(repo_path)?;
        self.ensure_repo_initialized(repo_path)?;
        Ok(workspace)
    }

    pub fn workspace_select(&self, repo_path: &str) -> Result<WorkspaceRecord> {
        let workspace = self.config_store.select_workspace(repo_path)?;
        self.ensure_repo_initialized(repo_path)?;
        Ok(workspace)
    }

    pub fn workspace_update_repo_config(
        &self,
        repo_path: &str,
        config: RepoConfig,
    ) -> Result<WorkspaceRecord> {
        self.config_store.update_repo_config(repo_path, config)
    }

    pub fn workspace_get_repo_config(&self, repo_path: &str) -> Result<RepoConfig> {
        self.config_store.repo_config(repo_path)
    }

    pub fn workspace_get_repo_config_optional(
        &self,
        repo_path: &str,
    ) -> Result<Option<RepoConfig>> {
        self.config_store.repo_config_optional(repo_path)
    }

    pub fn workspace_set_trusted_hooks(
        &self,
        repo_path: &str,
        trusted: bool,
    ) -> Result<WorkspaceRecord> {
        self.config_store.set_repo_trust_hooks(repo_path, trusted)
    }

    pub fn tasks_list(&self, repo_path: &str) -> Result<Vec<TaskCard>> {
        self.ensure_repo_initialized(repo_path)?;
        let tasks = self.task_store.list_tasks(Path::new(repo_path))?;
        Ok(self.enrich_tasks(tasks))
    }

    pub fn task_create(&self, repo_path: &str, mut input: CreateTaskInput) -> Result<TaskCard> {
        self.ensure_repo_initialized(repo_path)?;
        input.issue_type = normalize_issue_type(&input.issue_type).to_string();
        if input.ai_review_enabled.is_none() {
            input.ai_review_enabled = Some(default_qa_required_for_issue_type(&input.issue_type));
        }

        let mut existing = self.task_store.list_tasks(Path::new(repo_path))?;
        validate_parent_relationships_for_create(&existing, &input)?;

        let created = self.task_store.create_task(Path::new(repo_path), input)?;
        existing.push(created.clone());
        Ok(self.enrich_task(created, &existing))
    }

    pub fn task_update(
        &self,
        repo_path: &str,
        task_id: &str,
        mut patch: UpdateTaskPatch,
    ) -> Result<TaskCard> {
        self.ensure_repo_initialized(repo_path)?;
        if patch.status.is_some() {
            return Err(anyhow!(
                "Status cannot be updated directly. Use workflow transitions."
            ));
        }
        if let Some(issue_type) = patch.issue_type.as_ref() {
            patch.issue_type = Some(normalize_issue_type(issue_type).to_string());
        }

        let mut existing = self.task_store.list_tasks(Path::new(repo_path))?;
        let current = existing
            .iter()
            .find(|task| task.id == task_id)
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;
        validate_parent_relationships_for_update(&existing, current, &patch)?;

        let updated = self
            .task_store
            .update_task(Path::new(repo_path), task_id, patch)?;
        if let Some(index) = existing.iter().position(|task| task.id == task_id) {
            existing[index] = updated.clone();
        }
        Ok(self.enrich_task(updated, &existing))
    }

    pub fn task_delete(&self, repo_path: &str, task_id: &str, delete_subtasks: bool) -> Result<()> {
        self.ensure_repo_initialized(repo_path)?;
        let tasks = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = tasks
            .iter()
            .find(|entry| entry.id == task_id)
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;

        let direct_subtask_ids = tasks
            .iter()
            .filter(|entry| entry.parent_id.as_deref() == Some(task.id.as_str()))
            .map(|entry| entry.id.clone())
            .collect::<Vec<_>>();

        if !direct_subtask_ids.is_empty() && !delete_subtasks {
            return Err(anyhow!(
                "Task {task_id} has {} subtasks. Confirm subtask deletion to continue.",
                direct_subtask_ids.len()
            ));
        }

        self.task_store
            .delete_task(Path::new(repo_path), task_id, delete_subtasks)
            .with_context(|| format!("Failed to delete task {task_id}"))?;
        Ok(())
    }

    pub fn task_transition(
        &self,
        repo_path: &str,
        task_id: &str,
        target_status: TaskStatus,
        _reason: Option<&str>,
    ) -> Result<TaskCard> {
        self.ensure_repo_initialized(repo_path)?;
        let mut existing = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = existing
            .iter()
            .find(|entry| entry.id == task_id)
            .cloned()
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;

        validate_transition(&task, &existing, &task.status, &target_status)?;

        if task.status == target_status {
            return Ok(self.enrich_task(task, &existing));
        }

        let updated = self.task_store.update_task(
            Path::new(repo_path),
            task_id,
            UpdateTaskPatch {
                title: None,
                description: None,
                acceptance_criteria: None,
                notes: None,
                status: Some(target_status),
                priority: None,
                issue_type: None,
                ai_review_enabled: None,
                labels: None,
                assignee: None,
                parent_id: None,
            },
        )?;

        if let Some(index) = existing.iter().position(|entry| entry.id == task_id) {
            existing[index] = updated.clone();
        }

        Ok(self.enrich_task(updated, &existing))
    }

    pub fn build_blocked(
        &self,
        repo_path: &str,
        task_id: &str,
        reason: Option<&str>,
    ) -> Result<TaskCard> {
        let reason = reason
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .ok_or_else(|| anyhow!("build_blocked requires a non-empty reason"))?;
        self.task_transition(repo_path, task_id, TaskStatus::Blocked, Some(reason))
    }

    pub fn build_resumed(&self, repo_path: &str, task_id: &str) -> Result<TaskCard> {
        self.task_transition(
            repo_path,
            task_id,
            TaskStatus::InProgress,
            Some("Builder resumed"),
        )
    }

    pub fn build_completed(
        &self,
        repo_path: &str,
        task_id: &str,
        _summary: Option<&str>,
    ) -> Result<TaskCard> {
        self.ensure_repo_initialized(repo_path)?;
        let tasks = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = tasks
            .iter()
            .find(|entry| entry.id == task_id)
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;
        let next_status = if task.ai_review_enabled {
            TaskStatus::AiReview
        } else {
            TaskStatus::HumanReview
        };

        self.task_transition(repo_path, task_id, next_status, Some("Builder completed"))
    }

    pub fn human_request_changes(
        &self,
        repo_path: &str,
        task_id: &str,
        note: Option<&str>,
    ) -> Result<TaskCard> {
        let reason = note
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .unwrap_or("Human requested changes");
        self.task_transition(repo_path, task_id, TaskStatus::InProgress, Some(reason))
    }

    pub fn human_approve(&self, repo_path: &str, task_id: &str) -> Result<TaskCard> {
        self.task_transition(
            repo_path,
            task_id,
            TaskStatus::Closed,
            Some("Human approved"),
        )
    }

    pub fn task_defer(
        &self,
        repo_path: &str,
        task_id: &str,
        _reason: Option<&str>,
    ) -> Result<TaskCard> {
        self.ensure_repo_initialized(repo_path)?;
        let existing = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = existing
            .iter()
            .find(|entry| entry.id == task_id)
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;

        if task.parent_id.is_some() {
            return Err(anyhow!("Subtasks cannot be deferred."));
        }

        if !is_open_state(&task.status) {
            return Err(anyhow!("Only non-closed open-state tasks can be deferred."));
        }

        self.task_transition(
            repo_path,
            task_id,
            TaskStatus::Deferred,
            Some("Deferred by user"),
        )
    }

    pub fn task_resume_deferred(&self, repo_path: &str, task_id: &str) -> Result<TaskCard> {
        self.ensure_repo_initialized(repo_path)?;
        let existing = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = existing
            .iter()
            .find(|entry| entry.id == task_id)
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;
        if task.status != TaskStatus::Deferred {
            return Err(anyhow!("Task is not deferred: {task_id}"));
        }
        self.task_transition(
            repo_path,
            task_id,
            TaskStatus::Open,
            Some("Deferred task resumed"),
        )
    }

    pub fn spec_get(&self, repo_path: &str, task_id: &str) -> Result<SpecDocument> {
        self.ensure_repo_initialized(repo_path)?;
        self.task_store.get_spec(Path::new(repo_path), task_id)
    }

    pub fn set_spec(&self, repo_path: &str, task_id: &str, markdown: &str) -> Result<SpecDocument> {
        self.ensure_repo_initialized(repo_path)?;
        let markdown = normalize_required_markdown(markdown, "spec")?;
        let tasks = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = tasks
            .iter()
            .find(|entry| entry.id == task_id)
            .cloned()
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;
        if !can_set_spec_from_status(&task.status) {
            return Err(anyhow!(
                "set_spec is only allowed from open/spec_ready (current: {})",
                task.status.as_cli_value()
            ));
        }

        let spec = self
            .task_store
            .set_spec(Path::new(repo_path), task_id, &markdown)
            .with_context(|| format!("Failed to persist spec markdown for {task_id}"))?;

        if task.status == TaskStatus::Open {
            self.task_transition(
                repo_path,
                task_id,
                TaskStatus::SpecReady,
                Some("Spec ready"),
            )?;
        }

        Ok(spec)
    }

    pub fn plan_get(&self, repo_path: &str, task_id: &str) -> Result<SpecDocument> {
        self.ensure_repo_initialized(repo_path)?;
        self.task_store.get_plan(Path::new(repo_path), task_id)
    }

    pub fn set_plan(
        &self,
        repo_path: &str,
        task_id: &str,
        markdown: &str,
        subtasks: Option<Vec<PlanSubtaskInput>>,
    ) -> Result<SpecDocument> {
        self.ensure_repo_initialized(repo_path)?;
        let markdown = normalize_required_markdown(markdown, "implementation plan")?;
        let tasks = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = tasks
            .iter()
            .find(|entry| entry.id == task_id)
            .cloned()
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;
        if !can_set_plan(&task) {
            return Err(anyhow!(
                "set_plan is not allowed for issue type {} from status {}",
                normalize_issue_type(&task.issue_type),
                task.status.as_cli_value()
            ));
        }

        let issue_type = normalize_issue_type(&task.issue_type);
        let mut subtask_creates = normalize_subtask_plan_inputs(subtasks.unwrap_or_default())?;
        validate_plan_subtask_rules(&task, &tasks, &subtask_creates)?;
        if issue_type != "epic" {
            subtask_creates.clear();
        }

        let plan = self
            .task_store
            .set_plan(Path::new(repo_path), task_id, &markdown)
            .with_context(|| format!("Failed to persist implementation plan for {task_id}"))?;

        if issue_type == "epic" && !subtask_creates.is_empty() {
            let mut current_tasks = self.task_store.list_tasks(Path::new(repo_path))?;
            let mut existing_titles = tasks
                .iter()
                .filter(|entry| entry.parent_id.as_deref() == Some(task_id))
                .map(|entry| normalize_title_key(&entry.title))
                .collect::<HashSet<_>>();

            for mut create_input in subtask_creates {
                let title_key = normalize_title_key(&create_input.title);
                if existing_titles.contains(&title_key) {
                    continue;
                }
                create_input.parent_id = Some(task_id.to_string());
                validate_parent_relationships_for_create(&current_tasks, &create_input)?;
                let created = self
                    .task_store
                    .create_task(Path::new(repo_path), create_input)?;
                current_tasks.push(created);
                existing_titles.insert(title_key);
            }
        }

        self.task_transition(
            repo_path,
            task_id,
            TaskStatus::ReadyForDev,
            Some("Implementation plan ready"),
        )?;

        Ok(plan)
    }

    pub fn qa_get_report(&self, repo_path: &str, task_id: &str) -> Result<SpecDocument> {
        self.ensure_repo_initialized(repo_path)?;
        let report = self
            .task_store
            .get_latest_qa_report(Path::new(repo_path), task_id)?
            .map(|entry| SpecDocument {
                markdown: entry.markdown,
                updated_at: Some(entry.updated_at),
            })
            .unwrap_or_else(|| SpecDocument {
                markdown: String::new(),
                updated_at: None,
            });
        Ok(report)
    }

    pub fn qa_approved(&self, repo_path: &str, task_id: &str, markdown: &str) -> Result<TaskCard> {
        self.ensure_repo_initialized(repo_path)?;
        let tasks = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = tasks
            .iter()
            .find(|entry| entry.id == task_id)
            .cloned()
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;
        validate_transition(&task, &tasks, &task.status, &TaskStatus::HumanReview)?;

        self.task_store
            .append_qa_report(Path::new(repo_path), task_id, markdown, QaVerdict::Approved)
            .with_context(|| format!("Failed to persist QA report for {task_id}"))?;

        self.task_transition(
            repo_path,
            task_id,
            TaskStatus::HumanReview,
            Some("QA approved"),
        )
    }

    pub fn qa_rejected(&self, repo_path: &str, task_id: &str, markdown: &str) -> Result<TaskCard> {
        self.ensure_repo_initialized(repo_path)?;
        let tasks = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = tasks
            .iter()
            .find(|entry| entry.id == task_id)
            .cloned()
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;
        validate_transition(&task, &tasks, &task.status, &TaskStatus::InProgress)?;

        self.task_store
            .append_qa_report(Path::new(repo_path), task_id, markdown, QaVerdict::Rejected)
            .with_context(|| format!("Failed to persist QA report for {task_id}"))?;

        self.task_transition(
            repo_path,
            task_id,
            TaskStatus::InProgress,
            Some("QA requested changes"),
        )
    }

    pub fn agent_sessions_list(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<Vec<AgentSessionDocument>> {
        self.ensure_repo_initialized(repo_path)?;
        self.task_store
            .list_agent_sessions(Path::new(repo_path), task_id)
            .with_context(|| format!("Failed to read persisted agent sessions for {task_id}"))
    }

    pub fn agent_session_upsert(
        &self,
        repo_path: &str,
        task_id: &str,
        mut session: AgentSessionDocument,
    ) -> Result<bool> {
        self.ensure_repo_initialized(repo_path)?;
        if session.task_id != task_id {
            session.task_id = task_id.to_string();
        }
        self.task_store
            .upsert_agent_session(Path::new(repo_path), task_id, session)
            .with_context(|| format!("Failed to persist agent session for {task_id}"))?;
        Ok(true)
    }

    pub fn runs_list(&self, repo_path: Option<&str>) -> Result<Vec<RunSummary>> {
        let runs = self
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?;

        let mut list = runs
            .values()
            .filter(|run| {
                if let Some(path) = repo_path {
                    run.repo_path == path
                } else {
                    true
                }
            })
            .map(|run| run.summary.clone())
            .collect::<Vec<_>>();

        list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        Ok(list)
    }

    pub fn opencode_runtime_list(
        &self,
        repo_path: Option<&str>,
    ) -> Result<Vec<AgentRuntimeSummary>> {
        let mut runtimes = self
            .agent_runtimes
            .lock()
            .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
        Self::prune_stale_runtimes(&mut runtimes);

        let mut list = runtimes
            .values()
            .filter(|runtime| {
                if let Some(path) = repo_path {
                    runtime.summary.repo_path == path
                } else {
                    true
                }
            })
            .map(|runtime| runtime.summary.clone())
            .collect::<Vec<_>>();

        list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        Ok(list)
    }

    pub fn opencode_repo_runtime_ensure(&self, repo_path: &str) -> Result<AgentRuntimeSummary> {
        self.ensure_repo_initialized(repo_path)?;

        {
            let mut runtimes = self
                .agent_runtimes
                .lock()
                .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
            Self::prune_stale_runtimes(&mut runtimes);

            if let Some(existing) = runtimes.values().find(|runtime| {
                runtime.summary.repo_path == repo_path
                    && runtime.summary.role == Self::WORKSPACE_RUNTIME_ROLE
            }) {
                return Ok(existing.summary.clone());
            }
        }

        let port = pick_free_port()?;
        let metadata_namespace = self.config_store.task_metadata_namespace()?;
        let mut child = spawn_opencode_server(
            Path::new(repo_path),
            Path::new(repo_path),
            metadata_namespace.as_str(),
            port,
        )?;
        if let Err(error) = wait_for_local_server(port, Duration::from_secs(8)) {
            let _ = child.kill();
            return Err(error)
                .with_context(|| format!("OpenCode workspace runtime failed to start for {repo_path}"));
        }

        let runtime_id = format!("runtime-{}", Uuid::new_v4().simple());
        let summary = AgentRuntimeSummary {
            runtime_id: runtime_id.clone(),
            repo_path: repo_path.to_string(),
            task_id: Self::WORKSPACE_RUNTIME_TASK_ID.to_string(),
            role: Self::WORKSPACE_RUNTIME_ROLE.to_string(),
            working_directory: repo_path.to_string(),
            port,
            started_at: now_rfc3339(),
        };

        {
            let mut runtimes = self
                .agent_runtimes
                .lock()
                .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
            Self::prune_stale_runtimes(&mut runtimes);

            if let Some(existing) = runtimes.values().find(|runtime| {
                runtime.summary.repo_path == repo_path
                    && runtime.summary.role == Self::WORKSPACE_RUNTIME_ROLE
            }) {
                let _ = child.kill();
                return Ok(existing.summary.clone());
            }

            runtimes.insert(
                runtime_id,
                AgentRuntimeProcess {
                    summary: summary.clone(),
                    child,
                    cleanup_repo_path: None,
                    cleanup_worktree_path: None,
                },
            );
        }

        Ok(summary)
    }

    pub fn opencode_runtime_start(
        &self,
        repo_path: &str,
        task_id: &str,
        role: &str,
    ) -> Result<AgentRuntimeSummary> {
        self.ensure_repo_initialized(repo_path)?;
        if !matches!(role, "spec" | "planner" | "qa") {
            return Err(anyhow!(
                "Unsupported agent runtime role: {role}. Supported: spec, planner, qa"
            ));
        }

        let tasks = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = tasks
            .iter()
            .find(|entry| entry.id == task_id)
            .cloned()
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;

        {
            let mut runtimes = self
                .agent_runtimes
                .lock()
                .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
            Self::prune_stale_runtimes(&mut runtimes);

            if let Some(existing) = runtimes.values().find(|runtime| {
                runtime.summary.repo_path == repo_path
                    && runtime.summary.task_id == task_id
                    && runtime.summary.role == role
            }) {
                return Ok(existing.summary.clone());
            }
        }

        let mut cleanup_repo_path: Option<String> = None;
        let mut cleanup_worktree_path: Option<String> = None;
        let runtime_working_directory = if role == "qa" {
            let repo_config = self.config_store.repo_config(repo_path)?;
            let worktree_base = repo_config.worktree_base_path.clone().ok_or_else(|| {
                anyhow!(
                    "QA blocked: configure repos.{repo_path}.worktreeBasePath in {}",
                    self.config_store.path().display()
                )
            })?;

            if (!repo_config.hooks.pre_start.is_empty() || !repo_config.hooks.post_complete.is_empty())
                && !repo_config.trusted_hooks
            {
                return Err(anyhow!(
                    "Hooks are configured but not trusted for {repo_path}. Confirm trust first."
                ));
            }

            let worktree_base_path = Path::new(&worktree_base);
            fs::create_dir_all(worktree_base_path).with_context(|| {
                format!(
                    "Failed creating QA worktree base directory {}",
                    worktree_base_path.display()
                )
            })?;

            let qa_worktree = worktree_base_path.join(format!("qa-{task_id}"));
            if qa_worktree.exists() {
                return Err(anyhow!(
                    "QA worktree path already exists for task {}: {}",
                    task_id,
                    qa_worktree.display()
                ));
            }

            let repo_path_ref = Path::new(repo_path);
            let branch = build_branch_name(&repo_config.branch_prefix, task_id, &task.title);
            let qa_worktree_str = qa_worktree
                .to_str()
                .ok_or_else(|| anyhow!("Invalid QA worktree path"))?;
            let checkout_existing =
                run_command("git", &["worktree", "add", qa_worktree_str, &branch], Some(repo_path_ref));
            if let Err(existing_error) = checkout_existing {
                run_command(
                    "git",
                    &["worktree", "add", qa_worktree_str, "-b", &branch],
                    Some(repo_path_ref),
                )
                .with_context(|| {
                    format!("Failed to create or checkout QA branch {branch}: {existing_error}")
                })?;
            }

            for hook in &repo_config.hooks.pre_start {
                let (ok, _stdout, stderr) =
                    run_command_allow_failure("sh", &["-lc", hook], Some(qa_worktree.as_path()))?;
                if !ok {
                    let _ = remove_worktree(repo_path_ref, qa_worktree.as_path());
                    return Err(anyhow!("QA pre-start hook failed: {hook}\n{stderr}"));
                }
            }

            cleanup_repo_path = Some(repo_path.to_string());
            cleanup_worktree_path = Some(qa_worktree_str.to_string());
            qa_worktree_str.to_string()
        } else {
            repo_path.to_string()
        };

        let port = pick_free_port()?;
        let metadata_namespace = self.config_store.task_metadata_namespace()?;
        let mut child = spawn_opencode_server(
            Path::new(&runtime_working_directory),
            Path::new(repo_path),
            metadata_namespace.as_str(),
            port,
        )?;
        if let Err(error) = wait_for_local_server(port, Duration::from_secs(8)) {
            let _ = child.kill();
            if let (Some(repo), Some(worktree)) = (
                cleanup_repo_path.as_deref(),
                cleanup_worktree_path.as_deref(),
            ) {
                let _ = remove_worktree(Path::new(repo), Path::new(worktree));
            }
            return Err(error)
                .with_context(|| format!("OpenCode runtime failed to start for task {task_id}"));
        }

        let runtime_id = format!("runtime-{}", Uuid::new_v4().simple());
        let summary = AgentRuntimeSummary {
            runtime_id: runtime_id.clone(),
            repo_path: repo_path.to_string(),
            task_id: task_id.to_string(),
            role: role.to_string(),
            working_directory: runtime_working_directory,
            port,
            started_at: now_rfc3339(),
        };

        self.agent_runtimes
            .lock()
            .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?
            .insert(
                runtime_id,
                AgentRuntimeProcess {
                    summary: summary.clone(),
                    child,
                    cleanup_repo_path,
                    cleanup_worktree_path,
                },
            );

        Ok(summary)
    }

    pub fn opencode_runtime_stop(&self, runtime_id: &str) -> Result<bool> {
        let mut runtimes = self
            .agent_runtimes
            .lock()
            .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
        let mut runtime = runtimes
            .remove(runtime_id)
            .ok_or_else(|| anyhow!("Runtime not found: {runtime_id}"))?;
        let _ = runtime.child.kill();
        if let (Some(repo_path), Some(worktree_path)) = (
            runtime.cleanup_repo_path.as_deref(),
            runtime.cleanup_worktree_path.as_deref(),
        ) {
            remove_worktree(Path::new(repo_path), Path::new(worktree_path)).with_context(|| {
                format!("Failed removing QA worktree runtime {worktree_path}")
            })?;
        }
        Ok(true)
    }

    fn prune_stale_runtimes(runtimes: &mut HashMap<String, AgentRuntimeProcess>) {
        let stale_runtime_ids = runtimes
            .iter_mut()
            .filter_map(|(runtime_id, runtime)| {
                runtime
                    .child
                    .try_wait()
                    .ok()
                    .flatten()
                    .map(|_| runtime_id.clone())
            })
            .collect::<Vec<_>>();
        for runtime_id in stale_runtime_ids {
            if let Some(mut runtime) = runtimes.remove(&runtime_id) {
                let _ = runtime.child.kill();
                if let (Some(repo_path), Some(worktree_path)) = (
                    runtime.cleanup_repo_path.as_deref(),
                    runtime.cleanup_worktree_path.as_deref(),
                ) {
                    let _ = remove_worktree(Path::new(repo_path), Path::new(worktree_path));
                }
            }
        }
    }

    pub fn build_start(
        &self,
        repo_path: &str,
        task_id: &str,
        emitter: RunEmitter,
    ) -> Result<RunSummary> {
        let repo_config = self.config_store.repo_config(repo_path)?;

        let worktree_base = repo_config.worktree_base_path.clone().ok_or_else(|| {
            anyhow!(
                "Build blocked: configure repos.{repo_path}.worktreeBasePath in {}",
                self.config_store.path().display()
            )
        })?;

        if (!repo_config.hooks.pre_start.is_empty() || !repo_config.hooks.post_complete.is_empty())
            && !repo_config.trusted_hooks
        {
            return Err(anyhow!(
                "Hooks are configured but not trusted for {repo_path}. Confirm trust first."
            ));
        }

        let tasks = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = tasks
            .iter()
            .find(|entry| entry.id == task_id)
            .cloned()
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;
        validate_transition(&task, &tasks, &task.status, &TaskStatus::InProgress)?;

        let branch = build_branch_name(&repo_config.branch_prefix, task_id, &task.title);

        let worktree_dir = Path::new(&worktree_base).join(task_id);
        fs::create_dir_all(Path::new(&worktree_base)).with_context(|| {
            format!(
                "Failed creating worktree base directory {}",
                Path::new(&worktree_base).display()
            )
        })?;

        if worktree_dir.exists() {
            return Err(anyhow!(
                "Worktree path already exists for task {}: {}",
                task_id,
                worktree_dir.display()
            ));
        }

        let repo_path_ref = Path::new(repo_path);
        run_command(
            "git",
            &[
                "worktree",
                "add",
                worktree_dir
                    .to_str()
                    .ok_or_else(|| anyhow!("Invalid worktree path"))?,
                "-b",
                &branch,
            ],
            Some(repo_path_ref),
        )?;

        for hook in &repo_config.hooks.pre_start {
            let (ok, _stdout, stderr) =
                run_command_allow_failure("sh", &["-lc", hook], Some(worktree_dir.as_path()))?;
            if !ok {
                let _ = self.task_transition(
                    repo_path,
                    task_id,
                    TaskStatus::Blocked,
                    Some("Pre-start hook failed"),
                );
                let cleanup_error = remove_worktree(repo_path_ref, worktree_dir.as_path())
                    .err()
                    .map(|error| error.to_string());
                return Err(anyhow!(
                    "Pre-start hook failed: {hook}\n{stderr}{}",
                    cleanup_error
                        .map(|error| format!("\nAlso failed to remove worktree: {error}"))
                        .unwrap_or_default()
                ));
            }
        }

        let port = pick_free_port()?;
        let metadata_namespace = self.config_store.task_metadata_namespace()?;

        let mut child = spawn_opencode_server(
            worktree_dir.as_path(),
            Path::new(repo_path),
            metadata_namespace.as_str(),
            port,
        )?;
        if let Err(error) = wait_for_local_server(port, Duration::from_secs(8)) {
            let _ = child.kill();
            return Err(error).with_context(|| {
                format!("OpenCode build runtime failed to start for task {task_id}")
            });
        }

        self.task_transition(
            repo_path,
            task_id,
            TaskStatus::InProgress,
            Some("Builder delegated"),
        )?;

        let run_id = format!("run-{}", Uuid::new_v4().simple());

        let summary = RunSummary {
            run_id: run_id.clone(),
            repo_path: repo_path.to_string(),
            task_id: task_id.to_string(),
            branch,
            worktree_path: worktree_dir
                .to_str()
                .ok_or_else(|| anyhow!("Invalid worktree path"))?
                .to_string(),
            port,
            state: RunState::Running,
            last_message: Some("Opencode server running".to_string()),
            started_at: now_rfc3339(),
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let process = RunProcess {
            summary: summary.clone(),
            child,
            repo_path: repo_path.to_string(),
            task_id: task_id.to_string(),
            worktree_path: worktree_dir
                .to_str()
                .ok_or_else(|| anyhow!("Invalid worktree path"))?
                .to_string(),
            repo_config,
        };

        self.runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?
            .insert(run_id.clone(), process);

        emit_event(
            &emitter,
            RunEvent::RunStarted {
                run_id: run_id.clone(),
                message: format!("Delegated task {} on branch {}", task_id, summary.branch),
                timestamp: now_rfc3339(),
            },
        );

        if let Some(stdout) = stdout {
            spawn_output_forwarder(run_id.clone(), "stdout", stdout, emitter.clone());
        }
        if let Some(stderr) = stderr {
            spawn_output_forwarder(run_id.clone(), "stderr", stderr, emitter.clone());
        }

        Ok(summary)
    }

    pub fn build_respond(
        &self,
        run_id: &str,
        action: &str,
        payload: Option<&str>,
        emitter: RunEmitter,
    ) -> Result<bool> {
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?;
        let run = runs
            .get_mut(run_id)
            .ok_or_else(|| anyhow!("Run not found: {run_id}"))?;

        match action {
            "approve" => {
                if payload
                    .map(|entry| entry.contains("git push"))
                    .unwrap_or(false)
                {
                    run.summary.last_message =
                        Some("Approved sensitive command: git push".to_string());
                } else {
                    run.summary.last_message = Some("Approval received".to_string());
                }
                run.summary.state = RunState::Running;
            }
            "deny" => {
                run.summary.last_message = Some("Command denied by user".to_string());
                run.summary.state = RunState::Blocked;
                let _ = self.task_transition(
                    &run.repo_path,
                    &run.task_id,
                    TaskStatus::Blocked,
                    Some("User denied command"),
                );
            }
            "message" => {
                run.summary.last_message = payload.map(|entry| entry.to_string());
            }
            other => return Err(anyhow!("Unknown build response action: {other}")),
        }

        emit_event(
            &emitter,
            RunEvent::AgentThought {
                run_id: run_id.to_string(),
                message: run
                    .summary
                    .last_message
                    .clone()
                    .unwrap_or_else(|| "User response applied".to_string()),
                timestamp: now_rfc3339(),
            },
        );

        Ok(true)
    }

    pub fn build_stop(&self, run_id: &str, emitter: RunEmitter) -> Result<bool> {
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?;
        let run = runs
            .get_mut(run_id)
            .ok_or_else(|| anyhow!("Run not found: {run_id}"))?;

        let _ = run.child.kill();
        run.summary.state = RunState::Stopped;
        run.summary.last_message = Some("Run stopped by user".to_string());

        emit_event(
            &emitter,
            RunEvent::RunFinished {
                run_id: run_id.to_string(),
                message: "Run stopped".to_string(),
                timestamp: now_rfc3339(),
                success: false,
            },
        );

        Ok(true)
    }

    pub fn build_cleanup(&self, run_id: &str, mode: &str, emitter: RunEmitter) -> Result<bool> {
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?;
        let mut run = runs
            .remove(run_id)
            .ok_or_else(|| anyhow!("Run not found: {run_id}"))?;

        let _ = run.child.kill();

        match mode {
            "failure" => {
                self.task_transition(
                    &run.repo_path,
                    &run.task_id,
                    TaskStatus::Blocked,
                    Some("Run failed; worktree retained"),
                )?;

                run.summary.state = RunState::Failed;
                emit_event(
                    &emitter,
                    RunEvent::RunFinished {
                        run_id: run_id.to_string(),
                        message: "Run marked as failed; worktree retained".to_string(),
                        timestamp: now_rfc3339(),
                        success: false,
                    },
                );
                return Ok(true);
            }
            "success" => {}
            other => return Err(anyhow!("Unknown cleanup mode: {other}")),
        }

        for hook in &run.repo_config.hooks.post_complete {
            emit_event(
                &emitter,
                RunEvent::PostHookStarted {
                    run_id: run_id.to_string(),
                    message: format!("Running post-complete hook: {hook}"),
                    timestamp: now_rfc3339(),
                },
            );

            let (ok, _stdout, stderr) = run_command_allow_failure(
                "sh",
                &["-lc", hook],
                Some(Path::new(&run.worktree_path)),
            )?;

            if !ok {
                self.task_transition(
                    &run.repo_path,
                    &run.task_id,
                    TaskStatus::Blocked,
                    Some("Post-complete hook failed"),
                )?;

                emit_event(
                    &emitter,
                    RunEvent::PostHookFailed {
                        run_id: run_id.to_string(),
                        message: format!("Post-complete hook failed: {hook}\n{stderr}"),
                        timestamp: now_rfc3339(),
                    },
                );

                return Ok(false);
            }
        }

        let current_task = self
            .task_store
            .list_tasks(Path::new(&run.repo_path))?
            .into_iter()
            .find(|task| task.id == run.task_id)
            .ok_or_else(|| anyhow!("Task not found: {}", run.task_id))?;

        let review_status = if current_task.ai_review_enabled {
            TaskStatus::AiReview
        } else {
            TaskStatus::HumanReview
        };

        let review_label = if current_task.ai_review_enabled {
            "AI review"
        } else {
            "Human review"
        };

        emit_event(
            &emitter,
            RunEvent::ReadyForManualDoneConfirmation {
                run_id: run_id.to_string(),
                message: format!("Post-complete hooks passed. Transitioning to {review_label}."),
                timestamp: now_rfc3339(),
            },
        );

        self.task_transition(
            &run.repo_path,
            &run.task_id,
            review_status,
            Some("Builder completed"),
        )?;

        remove_worktree(Path::new(&run.repo_path), Path::new(&run.worktree_path))?;

        emit_event(
            &emitter,
            RunEvent::RunFinished {
                run_id: run_id.to_string(),
                message: format!("Run completed; moved to {review_label}; worktree removed"),
                timestamp: now_rfc3339(),
                success: true,
            },
        );

        Ok(true)
    }
}

fn normalize_issue_type(issue_type: &str) -> &'static str {
    match issue_type {
        "epic" => "epic",
        "feature" => "feature",
        "bug" => "bug",
        _ => "task",
    }
}

fn default_qa_required_for_issue_type(issue_type: &str) -> bool {
    matches!(
        normalize_issue_type(issue_type),
        "epic" | "feature" | "task" | "bug"
    )
}

fn is_open_state(status: &TaskStatus) -> bool {
    !matches!(status, TaskStatus::Closed | TaskStatus::Deferred)
}

fn can_skip_spec_and_planning(task: &TaskCard) -> bool {
    matches!(normalize_issue_type(&task.issue_type), "task" | "bug")
}

fn allows_transition(task: &TaskCard, from: &TaskStatus, to: &TaskStatus) -> bool {
    if from == to {
        return true;
    }

    match from {
        TaskStatus::Open => {
            if can_skip_spec_and_planning(task) {
                matches!(
                    to,
                    TaskStatus::SpecReady
                        | TaskStatus::ReadyForDev
                        | TaskStatus::InProgress
                        | TaskStatus::Deferred
                )
            } else {
                matches!(to, TaskStatus::SpecReady | TaskStatus::Deferred)
            }
        }
        TaskStatus::SpecReady => {
            if can_skip_spec_and_planning(task) {
                matches!(
                    to,
                    TaskStatus::ReadyForDev | TaskStatus::InProgress | TaskStatus::Deferred
                )
            } else {
                matches!(to, TaskStatus::ReadyForDev | TaskStatus::Deferred)
            }
        }
        TaskStatus::ReadyForDev => matches!(to, TaskStatus::InProgress | TaskStatus::Deferred),
        TaskStatus::InProgress => {
            matches!(
                to,
                TaskStatus::Blocked
                    | TaskStatus::AiReview
                    | TaskStatus::HumanReview
                    | TaskStatus::Deferred
            )
        }
        TaskStatus::Blocked => matches!(to, TaskStatus::InProgress | TaskStatus::Deferred),
        TaskStatus::AiReview => matches!(
            to,
            TaskStatus::InProgress | TaskStatus::HumanReview | TaskStatus::Deferred
        ),
        TaskStatus::HumanReview => matches!(
            to,
            TaskStatus::InProgress | TaskStatus::Closed | TaskStatus::Deferred
        ),
        TaskStatus::Deferred => matches!(to, TaskStatus::Open),
        TaskStatus::Closed => false,
    }
}

fn validate_transition(
    task: &TaskCard,
    all_tasks: &[TaskCard],
    from: &TaskStatus,
    to: &TaskStatus,
) -> Result<()> {
    if !allows_transition(task, from, to) {
        return Err(anyhow!(
            "Transition not allowed for {} ({}): {} -> {}",
            task.id,
            task.issue_type,
            from.as_cli_value(),
            to.as_cli_value()
        ));
    }

    if *to == TaskStatus::Closed && normalize_issue_type(&task.issue_type) == "epic" {
        let blocking_subtasks = all_tasks.iter().filter(|candidate| {
            candidate.parent_id.as_deref() == Some(task.id.as_str())
                && !matches!(candidate.status, TaskStatus::Closed | TaskStatus::Deferred)
        });

        if let Some(first_blocking) = blocking_subtasks.take(1).next() {
            return Err(anyhow!(
                "Epic cannot be completed while direct subtask {} is still active.",
                first_blocking.id
            ));
        }
    }

    Ok(())
}

fn find_task<'a>(tasks: &'a [TaskCard], task_id: &str) -> Result<&'a TaskCard> {
    tasks
        .iter()
        .find(|task| task.id == task_id)
        .ok_or_else(|| anyhow!("Task not found: {task_id}"))
}

fn validate_parent_relationships_for_create(
    tasks: &[TaskCard],
    input: &CreateTaskInput,
) -> Result<()> {
    let issue_type = normalize_issue_type(&input.issue_type);
    let parent_id = input
        .parent_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if issue_type == "epic" && parent_id.is_some() {
        return Err(anyhow!("Epics cannot be created as subtasks."));
    }

    if let Some(parent_id) = parent_id {
        let parent = find_task(tasks, parent_id)?;
        if normalize_issue_type(&parent.issue_type) != "epic" {
            return Err(anyhow!("Only epics can have subtasks."));
        }
        if parent.parent_id.is_some() {
            return Err(anyhow!("Subtask depth is limited to one level."));
        }
    }

    Ok(())
}

fn validate_parent_relationships_for_update(
    tasks: &[TaskCard],
    current: &TaskCard,
    patch: &UpdateTaskPatch,
) -> Result<()> {
    let next_issue_type = patch
        .issue_type
        .as_deref()
        .map(normalize_issue_type)
        .unwrap_or_else(|| normalize_issue_type(&current.issue_type));

    let next_parent_id = match patch.parent_id.as_deref() {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }
        None => current.parent_id.as_deref(),
    };

    if next_issue_type == "epic" && next_parent_id.is_some() {
        return Err(anyhow!("Epics cannot be converted to subtasks."));
    }

    let has_direct_subtasks = tasks
        .iter()
        .any(|task| task.parent_id.as_deref() == Some(current.id.as_str()));
    if has_direct_subtasks && next_parent_id.is_some() {
        return Err(anyhow!("Tasks with subtasks cannot become subtasks."));
    }

    if has_direct_subtasks && next_issue_type != "epic" {
        return Err(anyhow!("Only epics can have subtasks."));
    }

    if let Some(parent_id) = next_parent_id {
        let parent = find_task(tasks, parent_id)?;
        if normalize_issue_type(&parent.issue_type) != "epic" {
            return Err(anyhow!("Only epics can be selected as parents."));
        }
        if parent.parent_id.is_some() {
            return Err(anyhow!("Subtask depth is limited to one level."));
        }
    }

    Ok(())
}

fn normalize_required_markdown(markdown: &str, document_label: &str) -> Result<String> {
    let trimmed = markdown.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("{document_label} markdown cannot be empty."));
    }
    Ok(trimmed.to_string())
}

fn can_set_spec_from_status(status: &TaskStatus) -> bool {
    matches!(status, TaskStatus::Open | TaskStatus::SpecReady)
}

fn can_set_plan(task: &TaskCard) -> bool {
    let issue_type = normalize_issue_type(&task.issue_type);
    match issue_type {
        "epic" | "feature" => matches!(task.status, TaskStatus::SpecReady),
        "task" | "bug" => matches!(task.status, TaskStatus::Open | TaskStatus::SpecReady),
        _ => false,
    }
}

fn derive_available_actions(task: &TaskCard, all_tasks: &[TaskCard]) -> Vec<TaskAction> {
    let mut actions = vec![TaskAction::ViewDetails];

    if can_set_spec_from_status(&task.status) {
        actions.push(TaskAction::SetSpec);
    }

    if can_set_plan(task) {
        actions.push(TaskAction::SetPlan);
    }

    if allows_transition(task, &task.status, &TaskStatus::InProgress) {
        actions.push(TaskAction::BuildStart);
    }

    if matches!(
        task.status,
        TaskStatus::InProgress | TaskStatus::Blocked | TaskStatus::HumanReview
    ) {
        actions.push(TaskAction::OpenBuilder);
    }

    if task.parent_id.is_none() {
        if task.status == TaskStatus::Deferred {
            actions.push(TaskAction::ResumeDeferred);
        } else if is_open_state(&task.status) {
            actions.push(TaskAction::DeferIssue);
        }
    }

    if task.status == TaskStatus::HumanReview {
        actions.push(TaskAction::HumanRequestChanges);
    }

    if validate_transition(task, all_tasks, &task.status, &TaskStatus::Closed).is_ok() {
        actions.push(TaskAction::HumanApprove);
    }

    actions
}

fn validate_plan_subtask_rules(
    task: &TaskCard,
    all_tasks: &[TaskCard],
    plan_subtasks: &[CreateTaskInput],
) -> Result<()> {
    let issue_type = normalize_issue_type(&task.issue_type);
    if issue_type != "epic" {
        if !plan_subtasks.is_empty() {
            return Err(anyhow!(
                "Only epics can receive subtask proposals during planning."
            ));
        }
        return Ok(());
    }

    let has_direct_subtasks = all_tasks
        .iter()
        .any(|entry| entry.parent_id.as_deref() == Some(task.id.as_str()));
    if !has_direct_subtasks && plan_subtasks.is_empty() {
        return Err(anyhow!(
            "Epic plans must provide at least one direct subtask proposal."
        ));
    }

    Ok(())
}

fn normalize_title_key(title: &str) -> String {
    title.trim().to_ascii_lowercase()
}

fn normalize_subtask_plan_inputs(inputs: Vec<PlanSubtaskInput>) -> Result<Vec<CreateTaskInput>> {
    let mut normalized = Vec::with_capacity(inputs.len());
    for entry in inputs {
        let title = entry.title.trim().to_string();
        if title.is_empty() {
            return Err(anyhow!("Subtask proposals require a non-empty title."));
        }

        let issue_type =
            normalize_issue_type(entry.issue_type.as_deref().unwrap_or("task")).to_string();
        if issue_type == "epic" {
            return Err(anyhow!(
                "Epic subtasks are not allowed. Subtask hierarchy depth is limited to one level."
            ));
        }

        let priority = entry.priority.unwrap_or(2).clamp(0, 4);
        let description = entry.description.and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        });

        normalized.push(CreateTaskInput {
            title,
            issue_type: issue_type.clone(),
            priority,
            description,
            acceptance_criteria: None,
            labels: None,
            ai_review_enabled: Some(default_qa_required_for_issue_type(&issue_type)),
            parent_id: None,
        });
    }
    Ok(normalized)
}

fn emit_event(emitter: &RunEmitter, event: RunEvent) {
    (emitter)(event);
}

fn spawn_output_forwarder(
    run_id: String,
    source: &'static str,
    stream: impl std::io::Read + Send + 'static,
    emitter: RunEmitter,
) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines() {
            let Ok(line) = line else {
                continue;
            };
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            if trimmed.contains("permission") || trimmed.contains("git push") {
                emit_event(
                    &emitter,
                    RunEvent::PermissionRequired {
                        run_id: run_id.clone(),
                        message: format!("{}: {}", source, trimmed),
                        command: if trimmed.contains("git push") {
                            Some("git push".to_string())
                        } else {
                            None
                        },
                        timestamp: now_rfc3339(),
                    },
                );
            } else {
                emit_event(
                    &emitter,
                    RunEvent::ToolExecution {
                        run_id: run_id.clone(),
                        message: format!("{}: {}", source, trimmed),
                        timestamp: now_rfc3339(),
                    },
                );
            }
        }
    });
}

fn parse_mcp_command_json(raw: &str) -> Result<Vec<String>> {
    let parsed: serde_json::Value =
        serde_json::from_str(raw).context("Invalid OPENDUCKTOR_MCP_COMMAND_JSON format")?;
    let values = parsed
        .as_array()
        .ok_or_else(|| anyhow!("OPENDUCKTOR_MCP_COMMAND_JSON must be a JSON string array"))?;

    let command = values
        .iter()
        .map(|entry| {
            entry
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .ok_or_else(|| {
                    anyhow!("OPENDUCKTOR_MCP_COMMAND_JSON must contain only non-empty strings")
                })
        })
        .collect::<Result<Vec<_>>>()?;

    if command.is_empty() {
        return Err(anyhow!("OPENDUCKTOR_MCP_COMMAND_JSON cannot be empty"));
    }
    Ok(command)
}

fn default_mcp_workspace_root() -> Result<String> {
    let from_env = std::env::var("OPENDUCKTOR_WORKSPACE_ROOT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(root) = from_env {
        return Ok(root);
    }

    let compiled_path = Path::new(env!("CARGO_MANIFEST_DIR"));
    let root = compiled_path
        .ancestors()
        .nth(5)
        .ok_or_else(|| anyhow!("Unable to resolve OpenDucktor workspace root from manifest path"))?;
    Ok(root.to_string_lossy().to_string())
}

fn resolve_mcp_command() -> Result<Vec<String>> {
    if let Ok(raw) = std::env::var("OPENDUCKTOR_MCP_COMMAND_JSON") {
        return parse_mcp_command_json(raw.as_str());
    }

    if command_exists("openducktor-mcp") {
        return Ok(vec!["openducktor-mcp".to_string()]);
    }

    if !command_exists("bun") {
        return Err(anyhow!(
            "Missing MCP runner. Install `openducktor-mcp` on PATH or install bun for workspace fallback."
        ));
    }

    let workspace_root = default_mcp_workspace_root()?;
    let direct_entrypoint = Path::new(&workspace_root)
        .join("packages")
        .join("openducktor-mcp")
        .join("src")
        .join("index.ts");

    if direct_entrypoint.exists() {
        return Ok(vec![
            "bun".to_string(),
            direct_entrypoint.to_string_lossy().to_string(),
        ]);
    }

    Ok(vec![
        "bun".to_string(),
        "run".to_string(),
        "--silent".to_string(),
        "--cwd".to_string(),
        workspace_root,
        "--filter".to_string(),
        "@openblueprint/openducktor-mcp".to_string(),
        "start".to_string(),
    ])
}

fn build_opencode_config_content(
    repo_path_for_mcp: &Path,
    metadata_namespace: &str,
) -> Result<String> {
    let mcp_command = resolve_mcp_command()?;
    let beads_dir = resolve_central_beads_dir(repo_path_for_mcp)?;
    let config = json!({
        "logLevel": "info",
        "mcp": {
            "openducktor": {
                "type": "local",
                "enabled": true,
                "command": mcp_command,
                "environment": {
                    "ODT_REPO_PATH": repo_path_for_mcp.to_string_lossy().to_string(),
                    "ODT_BEADS_DIR": beads_dir.to_string_lossy().to_string(),
                    "ODT_METADATA_NAMESPACE": metadata_namespace,
                }
            }
        }
    });
    serde_json::to_string(&config).context("Failed to serialize OpenCode MCP config")
}

fn spawn_opencode_server(
    working_directory: &Path,
    repo_path_for_mcp: &Path,
    metadata_namespace: &str,
    port: u16,
) -> Result<Child> {
    let config_content = build_opencode_config_content(repo_path_for_mcp, metadata_namespace)?;
    Command::new("opencode")
        .arg("serve")
        .arg("--hostname")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .env("OPENCODE_CONFIG_CONTENT", config_content)
        .current_dir(working_directory)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("Failed to spawn opencode serve")
}

fn wait_for_local_server(port: u16, timeout: Duration) -> Result<()> {
    let deadline = Instant::now() + timeout;
    let address: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .context("Invalid localhost address")?;

    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(150));
    }

    Err(anyhow!(
        "Timed out waiting for OpenCode runtime on 127.0.0.1:{}",
        port
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        allows_transition, build_opencode_config_content, can_set_plan, can_set_spec_from_status,
        derive_available_actions, normalize_required_markdown, normalize_subtask_plan_inputs,
        parse_mcp_command_json, validate_parent_relationships_for_create,
        validate_parent_relationships_for_update, validate_plan_subtask_rules, validate_transition,
        wait_for_local_server,
    };
    use host_domain::{
        CreateTaskInput, PlanSubtaskInput, TaskAction, TaskCard, TaskStatus, UpdateTaskPatch,
    };
    use serde_json::Value;
    use std::path::Path;
    use std::net::TcpListener;
    use std::time::Duration;

    fn make_task(id: &str, issue_type: &str, status: TaskStatus) -> TaskCard {
        TaskCard {
            id: id.to_string(),
            title: format!("Task {id}"),
            description: String::new(),
            acceptance_criteria: String::new(),
            notes: String::new(),
            status,
            priority: 2,
            issue_type: issue_type.to_string(),
            ai_review_enabled: true,
            available_actions: Vec::new(),
            labels: Vec::new(),
            assignee: None,
            parent_id: None,
            subtask_ids: Vec::new(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn bug_can_skip_spec_and_go_in_progress_from_open() {
        let bug = make_task("bug-1", "bug", TaskStatus::Open);
        assert!(allows_transition(
            &bug,
            &TaskStatus::Open,
            &TaskStatus::InProgress
        ));
    }

    #[test]
    fn feature_cannot_skip_to_in_progress_from_open() {
        let feature = make_task("feature-1", "feature", TaskStatus::Open);
        assert!(!allows_transition(
            &feature,
            &TaskStatus::Open,
            &TaskStatus::InProgress
        ));
    }

    #[test]
    fn human_review_is_in_progress_state_not_closed() {
        let task = make_task("task-1", "task", TaskStatus::HumanReview);
        assert!(allows_transition(
            &task,
            &TaskStatus::HumanReview,
            &TaskStatus::InProgress
        ));
        assert!(allows_transition(
            &task,
            &TaskStatus::HumanReview,
            &TaskStatus::Closed
        ));
    }

    #[test]
    fn epic_close_ignores_deferred_subtasks_for_completion_guard() {
        let epic = make_task("epic-1", "epic", TaskStatus::HumanReview);
        let mut deferred_child = make_task("task-1", "task", TaskStatus::Deferred);
        deferred_child.parent_id = Some(epic.id.clone());

        let tasks = vec![epic.clone(), deferred_child];
        let result =
            validate_transition(&epic, &tasks, &TaskStatus::HumanReview, &TaskStatus::Closed);
        assert!(
            result.is_ok(),
            "deferred subtasks should not block epic completion"
        );
    }

    #[test]
    fn epic_close_is_blocked_by_open_direct_subtask() {
        let epic = make_task("epic-1", "epic", TaskStatus::HumanReview);
        let mut active_child = make_task("task-1", "task", TaskStatus::Open);
        active_child.parent_id = Some(epic.id.clone());

        let tasks = vec![epic.clone(), active_child];
        let result =
            validate_transition(&epic, &tasks, &TaskStatus::HumanReview, &TaskStatus::Closed);
        assert!(
            result.is_err(),
            "open direct subtasks must block epic completion"
        );
    }

    #[test]
    fn only_epics_can_have_subtasks_and_depth_is_one_level() {
        let epic = make_task("epic-1", "epic", TaskStatus::Open);
        let mut non_epic_parent = make_task("task-parent", "task", TaskStatus::Open);
        let mut level_two_parent = make_task("epic-child", "epic", TaskStatus::Open);
        level_two_parent.parent_id = Some(epic.id.clone());

        let tasks = vec![
            epic.clone(),
            non_epic_parent.clone(),
            level_two_parent.clone(),
        ];

        let invalid_non_epic_parent = CreateTaskInput {
            title: "child".to_string(),
            issue_type: "task".to_string(),
            priority: 2,
            description: None,
            acceptance_criteria: None,
            labels: None,
            ai_review_enabled: Some(true),
            parent_id: Some(non_epic_parent.id.clone()),
        };
        assert!(
            validate_parent_relationships_for_create(&tasks, &invalid_non_epic_parent).is_err()
        );

        let invalid_depth_two = CreateTaskInput {
            title: "child".to_string(),
            issue_type: "task".to_string(),
            priority: 2,
            description: None,
            acceptance_criteria: None,
            labels: None,
            ai_review_enabled: Some(true),
            parent_id: Some(level_two_parent.id.clone()),
        };
        assert!(validate_parent_relationships_for_create(&tasks, &invalid_depth_two).is_err());

        non_epic_parent.parent_id = Some(epic.id.clone());
        let patch = UpdateTaskPatch {
            title: None,
            description: None,
            acceptance_criteria: None,
            notes: None,
            status: Some(TaskStatus::Deferred),
            priority: None,
            issue_type: None,
            ai_review_enabled: None,
            labels: None,
            assignee: None,
            parent_id: Some(epic.id.clone()),
        };
        assert!(validate_parent_relationships_for_update(&tasks, &non_epic_parent, &patch).is_ok());
    }

    #[test]
    fn markdown_documents_require_non_empty_content() {
        assert!(normalize_required_markdown("   ", "spec").is_err());
        assert_eq!(
            normalize_required_markdown("  # Valid  ", "spec").expect("valid markdown"),
            "# Valid"
        );
    }

    #[test]
    fn subtask_plan_inputs_are_normalized_and_validated() {
        let normalized = normalize_subtask_plan_inputs(vec![PlanSubtaskInput {
            title: "  Build API  ".to_string(),
            issue_type: Some("feature".to_string()),
            priority: Some(99),
            description: Some("  add endpoint ".to_string()),
        }])
        .expect("normalized");

        assert_eq!(normalized.len(), 1);
        let first = &normalized[0];
        assert_eq!(first.title, "Build API");
        assert_eq!(first.issue_type, "feature");
        assert_eq!(first.priority, 4);
        assert_eq!(first.description.as_deref(), Some("add endpoint"));
    }

    #[test]
    fn subtask_plan_inputs_reject_epic_issue_type() {
        let result = normalize_subtask_plan_inputs(vec![PlanSubtaskInput {
            title: "Do work".to_string(),
            issue_type: Some("epic".to_string()),
            priority: Some(2),
            description: None,
        }]);
        assert!(result.is_err());
    }

    #[test]
    fn spec_and_plan_write_status_guards_follow_matrix() {
        assert!(can_set_spec_from_status(&TaskStatus::Open));
        assert!(can_set_spec_from_status(&TaskStatus::SpecReady));
        assert!(!can_set_spec_from_status(&TaskStatus::InProgress));

        let epic_open = make_task("epic-open", "epic", TaskStatus::Open);
        let epic_spec_ready = make_task("epic-spec", "epic", TaskStatus::SpecReady);
        let feature_open = make_task("feature-open", "feature", TaskStatus::Open);
        let task_open = make_task("task-open", "task", TaskStatus::Open);
        let bug_open = make_task("bug-open", "bug", TaskStatus::Open);
        let feature_in_progress = make_task("feature-progress", "feature", TaskStatus::InProgress);

        assert!(!can_set_plan(&epic_open));
        assert!(can_set_plan(&epic_spec_ready));
        assert!(!can_set_plan(&feature_open));
        assert!(can_set_plan(&task_open));
        assert!(can_set_plan(&bug_open));
        assert!(!can_set_plan(&feature_in_progress));
    }

    #[test]
    fn epic_plan_requires_existing_or_proposed_direct_subtasks() {
        let epic = make_task("epic-1", "epic", TaskStatus::SpecReady);
        let tasks = vec![epic.clone()];
        let result = validate_plan_subtask_rules(&epic, &tasks, &[]);
        assert!(result.is_err());

        let proposals = vec![CreateTaskInput {
            title: "Subtask".to_string(),
            issue_type: "task".to_string(),
            priority: 2,
            description: None,
            acceptance_criteria: None,
            labels: None,
            ai_review_enabled: Some(true),
            parent_id: None,
        }];
        assert!(validate_plan_subtask_rules(&epic, &tasks, &proposals).is_ok());
    }

    #[test]
    fn non_epic_plan_cannot_accept_subtask_proposals() {
        let task = make_task("task-1", "task", TaskStatus::Open);
        let proposals = vec![CreateTaskInput {
            title: "Child".to_string(),
            issue_type: "bug".to_string(),
            priority: 2,
            description: None,
            acceptance_criteria: None,
            labels: None,
            ai_review_enabled: Some(true),
            parent_id: None,
        }];

        let result = validate_plan_subtask_rules(&task, std::slice::from_ref(&task), &proposals);
        assert!(result.is_err());
    }

    #[test]
    fn feature_in_open_exposes_spec_only() {
        let feature = make_task("feature-1", "feature", TaskStatus::Open);
        let actions = derive_available_actions(&feature, std::slice::from_ref(&feature));

        assert!(actions.contains(&TaskAction::SetSpec));
        assert!(!actions.contains(&TaskAction::SetPlan));
        assert!(!actions.contains(&TaskAction::BuildStart));
    }

    #[test]
    fn epic_in_open_exposes_spec_only() {
        let epic = make_task("epic-1", "epic", TaskStatus::Open);
        let actions = derive_available_actions(&epic, std::slice::from_ref(&epic));

        assert!(actions.contains(&TaskAction::SetSpec));
        assert!(!actions.contains(&TaskAction::SetPlan));
        assert!(!actions.contains(&TaskAction::BuildStart));
    }

    #[test]
    fn bug_in_open_can_start_build_directly() {
        let bug = make_task("bug-1", "bug", TaskStatus::Open);
        let actions = derive_available_actions(&bug, std::slice::from_ref(&bug));
        assert!(actions.contains(&TaskAction::BuildStart));
    }

    #[test]
    fn in_progress_tasks_expose_builder_action_and_no_plan_actions() {
        let task = make_task("task-1", "task", TaskStatus::InProgress);
        let actions = derive_available_actions(&task, std::slice::from_ref(&task));
        assert!(actions.contains(&TaskAction::OpenBuilder));
        assert!(!actions.contains(&TaskAction::SetSpec));
        assert!(!actions.contains(&TaskAction::SetPlan));
    }

    #[test]
    fn deferred_parent_task_exposes_resume_and_hides_defer() {
        let deferred = make_task("task-1", "task", TaskStatus::Deferred);
        let actions = derive_available_actions(&deferred, std::slice::from_ref(&deferred));
        assert!(actions.contains(&TaskAction::ResumeDeferred));
        assert!(!actions.contains(&TaskAction::DeferIssue));
    }

    #[test]
    fn wait_for_local_server_returns_ok_when_port_is_open() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
        let port = listener.local_addr().expect("addr").port();
        let result = wait_for_local_server(port, Duration::from_millis(500));
        assert!(result.is_ok());
    }

    #[test]
    fn wait_for_local_server_times_out_when_port_is_closed() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
        let port = listener.local_addr().expect("addr").port();
        drop(listener);
        let result = wait_for_local_server(port, Duration::from_millis(250));
        assert!(result.is_err());
    }

    #[test]
    fn parse_mcp_command_json_accepts_non_empty_string_array() {
        let parsed = parse_mcp_command_json(r#"["openducktor-mcp","--repo","/tmp/repo"]"#)
            .expect("command should parse");
        assert_eq!(
            parsed,
            vec![
                "openducktor-mcp".to_string(),
                "--repo".to_string(),
                "/tmp/repo".to_string()
            ]
        );
    }

    #[test]
    fn parse_mcp_command_json_rejects_invalid_payloads() {
        assert!(parse_mcp_command_json("{}").is_err());
        assert!(parse_mcp_command_json("[]").is_err());
        assert!(parse_mcp_command_json(r#"["openducktor-mcp",""]"#).is_err());
    }

    #[test]
    fn parse_mcp_command_json_trims_entries() {
        let parsed =
            parse_mcp_command_json(r#"["  openducktor-mcp  "," --repo "," /tmp/repo "]"#)
                .expect("command should parse");
        assert_eq!(
            parsed,
            vec![
                "openducktor-mcp".to_string(),
                "--repo".to_string(),
                "/tmp/repo".to_string()
            ]
        );
    }

    #[test]
    fn build_opencode_config_content_embeds_mcp_command_and_env() {
        let previous = std::env::var("OPENDUCKTOR_MCP_COMMAND_JSON").ok();
        std::env::set_var(
            "OPENDUCKTOR_MCP_COMMAND_JSON",
            r#"["/usr/local/bin/openducktor-mcp","--stdio"]"#,
        );

        let config = build_opencode_config_content(Path::new("/tmp/openducktor-repo"), "odt-ns")
            .expect("config should serialize");

        match previous {
            Some(value) => std::env::set_var("OPENDUCKTOR_MCP_COMMAND_JSON", value),
            None => std::env::remove_var("OPENDUCKTOR_MCP_COMMAND_JSON"),
        }

        let parsed: Value = serde_json::from_str(&config).expect("valid json");
        let command = parsed["mcp"]["openducktor"]["command"]
            .as_array()
            .expect("command array")
            .iter()
            .filter_map(|entry| entry.as_str())
            .collect::<Vec<_>>();
        assert_eq!(command, vec!["/usr/local/bin/openducktor-mcp", "--stdio"]);

        let env = &parsed["mcp"]["openducktor"]["environment"];
        assert_eq!(env["ODT_REPO_PATH"].as_str(), Some("/tmp/openducktor-repo"));
        assert_eq!(env["ODT_METADATA_NAMESPACE"].as_str(), Some("odt-ns"));
        assert!(env["ODT_BEADS_DIR"].as_str().is_some());
    }
}
