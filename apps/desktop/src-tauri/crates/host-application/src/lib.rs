use anyhow::{anyhow, Context, Result};
use host_domain::{
    now_rfc3339, AgentRuntimeSummary, AgentSessionDocument, BeadsCheck, CreateTaskInput,
    GitBranch, GitCurrentBranch, GitPort, GitPushSummary, GitWorktreeSummary, PlanSubtaskInput,
    QaVerdict, RunEvent, RunState, RunSummary, RuntimeCheck, SpecDocument, SystemCheck, TaskAction,
    TaskCard, TaskStatus, TaskStore, UpdateTaskPatch, WorkspaceRecord,
};
use host_infra_system::{
    build_branch_name, command_exists, command_path, pick_free_port, remove_worktree,
    resolve_central_beads_dir, run_command, run_command_allow_failure, version_command,
    AppConfigStore, GitCliPort, RepoConfig,
};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use uuid::Uuid;

pub type RunEmitter = Arc<dyn Fn(RunEvent) + Send + Sync + 'static>;

#[derive(Clone)]
pub struct AppService {
    task_store: Arc<dyn TaskStore>,
    git_port: Arc<dyn GitPort>,
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

impl Drop for AppService {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

impl AppService {
    const WORKSPACE_RUNTIME_ROLE: &'static str = "workspace";
    const WORKSPACE_RUNTIME_TASK_ID: &'static str = "__workspace__";

    pub fn new(task_store: Arc<dyn TaskStore>, config_store: AppConfigStore) -> Self {
        Self::with_git_port(task_store, config_store, Arc::new(GitCliPort::new()))
    }

    pub fn with_git_port(
        task_store: Arc<dyn TaskStore>,
        config_store: AppConfigStore,
        git_port: Arc<dyn GitPort>,
    ) -> Self {
        Self {
            task_store,
            git_port,
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
        let opencode_binary = resolve_opencode_binary_path();
        let opencode_ok = opencode_binary.is_some();

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
            opencode_version: opencode_binary.as_ref().map(|binary| {
                if let Some(version) = read_opencode_version(binary.as_str()) {
                    format!("{version} ({binary})")
                } else {
                    format!("installed ({binary})")
                }
            }),
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

    pub fn git_get_branches(&self, repo_path: &str) -> Result<Vec<GitBranch>> {
        self.ensure_repo_initialized(repo_path)?;
        self.git_port.get_branches(Path::new(repo_path))
    }

    pub fn git_get_current_branch(&self, repo_path: &str) -> Result<GitCurrentBranch> {
        self.ensure_repo_initialized(repo_path)?;
        self.git_port.get_current_branch(Path::new(repo_path))
    }

    pub fn git_switch_branch(
        &self,
        repo_path: &str,
        branch: &str,
        create: bool,
    ) -> Result<GitCurrentBranch> {
        self.ensure_repo_initialized(repo_path)?;
        self.git_port
            .switch_branch(Path::new(repo_path), branch, create)
    }

    pub fn git_create_worktree(
        &self,
        repo_path: &str,
        worktree_path: &str,
        branch: &str,
        create_branch: bool,
    ) -> Result<GitWorktreeSummary> {
        self.ensure_repo_initialized(repo_path)?;
        let worktree = worktree_path.trim();
        if worktree.is_empty() {
            return Err(anyhow!("worktree path cannot be empty"));
        }

        self.git_port.create_worktree(
            Path::new(repo_path),
            Path::new(worktree),
            branch,
            create_branch,
        )?;

        Ok(GitWorktreeSummary {
            branch: branch.trim().to_string(),
            worktree_path: worktree.to_string(),
        })
    }

    pub fn git_remove_worktree(
        &self,
        repo_path: &str,
        worktree_path: &str,
        force: bool,
    ) -> Result<bool> {
        self.ensure_repo_initialized(repo_path)?;
        let worktree = worktree_path.trim();
        if worktree.is_empty() {
            return Err(anyhow!("worktree path cannot be empty"));
        }
        self.git_port
            .remove_worktree(Path::new(repo_path), Path::new(worktree), force)?;
        Ok(true)
    }

    pub fn git_push_branch(
        &self,
        repo_path: &str,
        remote: Option<&str>,
        branch: &str,
        set_upstream: bool,
        force_with_lease: bool,
    ) -> Result<GitPushSummary> {
        self.ensure_repo_initialized(repo_path)?;
        let remote = remote
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("origin");
        self.git_port.push_branch(
            Path::new(repo_path),
            remote,
            branch,
            set_upstream,
            force_with_lease,
        )
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
        let repo_key_filter = repo_path.map(Self::repo_key);
        let mut runtimes = self
            .agent_runtimes
            .lock()
            .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
        Self::prune_stale_runtimes(&mut runtimes);

        let mut list = runtimes
            .values()
            .filter(|runtime| {
                if let Some(path_key) = repo_key_filter.as_deref() {
                    Self::repo_key(runtime.summary.repo_path.as_str()) == path_key
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
        let repo_key = Self::repo_key(repo_path);

        {
            let mut runtimes = self
                .agent_runtimes
                .lock()
                .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
            Self::prune_stale_runtimes(&mut runtimes);

            if let Some(existing) = runtimes.values().find(|runtime| {
                Self::repo_key(runtime.summary.repo_path.as_str()) == repo_key
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
        if let Err(error) = wait_for_local_server_with_process(&mut child, port, Duration::from_secs(8))
        {
            terminate_child_process(&mut child);
            return Err(error)
                .with_context(|| format!("OpenCode workspace runtime failed to start for {repo_path}"));
        }

        let runtime_id = format!("runtime-{}", Uuid::new_v4().simple());
        let summary = AgentRuntimeSummary {
            runtime_id: runtime_id.clone(),
            repo_path: repo_key.clone(),
            task_id: Self::WORKSPACE_RUNTIME_TASK_ID.to_string(),
            role: Self::WORKSPACE_RUNTIME_ROLE.to_string(),
            working_directory: repo_key.clone(),
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
                Self::repo_key(runtime.summary.repo_path.as_str()) == repo_key
                    && runtime.summary.role == Self::WORKSPACE_RUNTIME_ROLE
            }) {
                terminate_child_process(&mut child);
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
        let repo_key = Self::repo_key(repo_path);
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
                Self::repo_key(runtime.summary.repo_path.as_str()) == repo_key
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
        if let Err(error) = wait_for_local_server_with_process(&mut child, port, Duration::from_secs(8))
        {
            terminate_child_process(&mut child);
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
            repo_path: repo_key,
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
        terminate_child_process(&mut runtime.child);
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
                terminate_child_process(&mut runtime.child);
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
        if let Err(error) = wait_for_local_server_with_process(&mut child, port, Duration::from_secs(8))
        {
            terminate_child_process(&mut child);
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

        terminate_child_process(&mut run.child);
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

        terminate_child_process(&mut run.child);

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

    pub fn shutdown(&self) -> Result<()> {
        {
            let mut runs = self
                .runs
                .lock()
                .map_err(|_| anyhow!("Run state lock poisoned"))?;
            for (_, mut run) in runs.drain() {
                terminate_child_process(&mut run.child);
            }
        }

        let mut cleanup_errors = Vec::new();
        {
            let mut runtimes = self
                .agent_runtimes
                .lock()
                .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
            for (_, mut runtime) in runtimes.drain() {
                terminate_child_process(&mut runtime.child);
                if let (Some(repo_path), Some(worktree_path)) = (
                    runtime.cleanup_repo_path.as_deref(),
                    runtime.cleanup_worktree_path.as_deref(),
                ) {
                    if let Err(error) = remove_worktree(Path::new(repo_path), Path::new(worktree_path))
                    {
                        cleanup_errors.push(format!(
                            "Failed removing QA worktree runtime {}: {}",
                            worktree_path, error
                        ));
                    }
                }
            }
        }

        if cleanup_errors.is_empty() {
            Ok(())
        } else {
            Err(anyhow!(cleanup_errors.join("\n")))
        }
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
        "@openducktor/openducktor-mcp".to_string(),
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
        "logLevel": "INFO",
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

fn read_opencode_version(binary: &str) -> Option<String> {
    let mut command = Command::new(binary);
    command
        .arg("--version")
        .env("OPENCODE_CONFIG_CONTENT", r#"{"logLevel":"INFO"}"#)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    configure_process_group(&mut command);

    let mut child = command.spawn().ok()?;
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match child.try_wait().ok()? {
            Some(status) => {
                if !status.success() {
                    return None;
                }
                let output = child.wait_with_output().ok()?;
                let stdout = String::from_utf8_lossy(&output.stdout);
                return stdout
                    .lines()
                    .find(|line| !line.trim().is_empty())
                    .map(|line| line.trim().to_string());
            }
            None => {
                if Instant::now() >= deadline {
                    terminate_child_process(&mut child);
                    return None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

fn resolve_opencode_binary_path() -> Option<String> {
    if let Ok(override_binary) = std::env::var("OPENDUCKTOR_OPENCODE_BINARY") {
        let trimmed = override_binary.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    if let Some(resolved) = command_path("opencode") {
        return Some(resolved);
    }

    let home = std::env::var_os("HOME")?;
    let candidate = PathBuf::from(home)
        .join(".opencode")
        .join("bin")
        .join("opencode");
    if candidate.is_file() {
        return candidate.to_str().map(|value| value.to_string());
    }

    None
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_process_group(_command: &mut Command) {}

#[cfg(unix)]
fn terminate_process_group_if_owned(child: &Child) {
    let pid = child.id() as i32;
    if pid <= 0 {
        return;
    }
    // Only signal the process group if this process is the group leader.
    let pgid = unsafe { libc::getpgid(pid) };
    if pgid == pid {
        unsafe {
            libc::killpg(pid, libc::SIGTERM);
        }
    }
}

#[cfg(not(unix))]
fn terminate_process_group_if_owned(_child: &Child) {}

fn terminate_child_process(child: &mut Child) {
    terminate_process_group_if_owned(child);
    let _ = child.kill();
    let _ = child.wait();
}

fn spawn_opencode_server(
    working_directory: &Path,
    repo_path_for_mcp: &Path,
    metadata_namespace: &str,
    port: u16,
) -> Result<Child> {
    let config_content = build_opencode_config_content(repo_path_for_mcp, metadata_namespace)?;
    let opencode_binary = resolve_opencode_binary_path()
        .ok_or_else(|| anyhow!("opencode binary not found in PATH or ~/.opencode/bin"))?;
    let mut command = Command::new(&opencode_binary);
    command
        .arg("serve")
        .arg("--hostname")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .env("OPENCODE_CONFIG_CONTENT", config_content)
        .current_dir(working_directory)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);
    command.spawn().with_context(|| {
        format!(
            "Failed to spawn opencode serve with binary {}",
            opencode_binary
        )
    })
}

#[cfg(test)]
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

fn read_child_pipe(pipe: &mut Option<impl Read>) -> String {
    let Some(mut reader) = pipe.take() else {
        return String::new();
    };
    let mut output = String::new();
    let _ = reader.read_to_string(&mut output);
    output.trim().to_string()
}

fn wait_for_local_server_with_process(child: &mut Child, port: u16, timeout: Duration) -> Result<()> {
    let deadline = Instant::now() + timeout;
    let address: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .context("Invalid localhost address")?;

    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok() {
            return Ok(());
        }

        if let Some(status) = child.try_wait().context("Failed checking OpenCode process state")? {
            let stderr = read_child_pipe(&mut child.stderr);
            let stdout = read_child_pipe(&mut child.stdout);
            let details = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                format!("process exited with status {status}")
            };
            return Err(anyhow!(
                "OpenCode process exited before runtime became reachable: {details}"
            ));
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
        default_mcp_workspace_root,
        derive_available_actions, normalize_required_markdown, normalize_subtask_plan_inputs,
        parse_mcp_command_json, read_opencode_version, resolve_mcp_command,
        resolve_opencode_binary_path, validate_parent_relationships_for_create,
        validate_parent_relationships_for_update, validate_plan_subtask_rules, validate_transition,
        terminate_child_process, wait_for_local_server, wait_for_local_server_with_process,
        AppService,
    };
    use anyhow::{anyhow, Result};
    use host_domain::{
        AgentRuntimeSummary, AgentSessionDocument, CreateTaskInput, GitBranch, GitCurrentBranch, GitPort,
        GitPushSummary, PlanSubtaskInput, QaReportDocument, QaVerdict, RunEvent, RunState,
        RunSummary, SpecDocument, TaskAction, TaskCard, TaskStatus, TaskStore, UpdateTaskPatch,
    };
    use host_infra_system::{AppConfigStore, HookSet, RepoConfig};
    use serde_json::Value;
    use std::ffi::OsString;
    use std::fs;
    use std::io::Write;
    use std::net::{TcpListener, TcpStream};
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};
    use std::sync::{Arc, LazyLock, Mutex};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

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

    #[derive(Debug, Default)]
    struct TaskStoreState {
        ensure_calls: Vec<String>,
        ensure_error: Option<String>,
        tasks: Vec<TaskCard>,
        list_error: Option<String>,
        delete_calls: Vec<(String, bool)>,
        created_inputs: Vec<CreateTaskInput>,
        updated_patches: Vec<(String, UpdateTaskPatch)>,
        spec_get_calls: Vec<String>,
        spec_set_calls: Vec<(String, String)>,
        plan_get_calls: Vec<String>,
        plan_set_calls: Vec<(String, String)>,
        qa_append_calls: Vec<(String, String, QaVerdict)>,
        latest_qa_report: Option<QaReportDocument>,
        agent_sessions: Vec<AgentSessionDocument>,
        upserted_sessions: Vec<(String, AgentSessionDocument)>,
    }

    #[derive(Clone)]
    struct FakeTaskStore {
        state: Arc<Mutex<TaskStoreState>>,
    }

    impl TaskStore for FakeTaskStore {
        fn ensure_repo_initialized(&self, repo_path: &Path) -> Result<()> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            if let Some(message) = state.ensure_error.as_ref() {
                return Err(anyhow!(message.clone()));
            }
            state
                .ensure_calls
                .push(repo_path.to_string_lossy().to_string());
            Ok(())
        }

        fn list_tasks(&self, _repo_path: &Path) -> Result<Vec<TaskCard>> {
            let state = self.state.lock().expect("task store lock poisoned");
            if let Some(message) = state.list_error.as_ref() {
                return Err(anyhow!(message.clone()));
            }
            Ok(state.tasks.clone())
        }

        fn create_task(&self, _repo_path: &Path, input: CreateTaskInput) -> Result<TaskCard> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            state.created_inputs.push(input.clone());
            let task = TaskCard {
                id: format!("generated-{}", state.tasks.len() + 1),
                title: input.title,
                description: input.description.unwrap_or_default(),
                acceptance_criteria: input.acceptance_criteria.unwrap_or_default(),
                notes: String::new(),
                status: TaskStatus::Open,
                priority: input.priority,
                issue_type: input.issue_type,
                ai_review_enabled: input.ai_review_enabled.unwrap_or(true),
                available_actions: Vec::new(),
                labels: input.labels.unwrap_or_default(),
                assignee: None,
                parent_id: input.parent_id,
                subtask_ids: Vec::new(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
                created_at: "2026-01-01T00:00:00Z".to_string(),
            };
            state.tasks.push(task.clone());
            Ok(task)
        }

        fn update_task(
            &self,
            _repo_path: &Path,
            task_id: &str,
            patch: UpdateTaskPatch,
        ) -> Result<TaskCard> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            state
                .updated_patches
                .push((task_id.to_string(), patch.clone()));
            let index = state
                .tasks
                .iter()
                .position(|task| task.id == task_id)
                .ok_or_else(|| anyhow!("task not found: {task_id}"))?;

            let mut updated = state.tasks[index].clone();
            if let Some(title) = patch.title {
                updated.title = title;
            }
            if let Some(status) = patch.status {
                updated.status = status;
            }
            if let Some(issue_type) = patch.issue_type {
                updated.issue_type = issue_type;
            }
            if let Some(ai_review_enabled) = patch.ai_review_enabled {
                updated.ai_review_enabled = ai_review_enabled;
            }
            if let Some(parent_id) = patch.parent_id {
                updated.parent_id = Some(parent_id);
            }
            if let Some(labels) = patch.labels {
                updated.labels = labels;
            }

            state.tasks[index] = updated.clone();
            Ok(updated)
        }

        fn delete_task(
            &self,
            _repo_path: &Path,
            task_id: &str,
            delete_subtasks: bool,
        ) -> Result<bool> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            state
                .delete_calls
                .push((task_id.to_string(), delete_subtasks));
            Ok(true)
        }

        fn get_spec(&self, _repo_path: &Path, _task_id: &str) -> Result<SpecDocument> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            state.spec_get_calls.push(_task_id.to_string());
            Ok(SpecDocument {
                markdown: String::new(),
                updated_at: None,
            })
        }

        fn set_spec(
            &self,
            _repo_path: &Path,
            _task_id: &str,
            markdown: &str,
        ) -> Result<SpecDocument> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            state
                .spec_set_calls
                .push((_task_id.to_string(), markdown.to_string()));
            Ok(SpecDocument {
                markdown: markdown.to_string(),
                updated_at: Some("2026-01-01T00:00:00Z".to_string()),
            })
        }

        fn get_plan(&self, _repo_path: &Path, _task_id: &str) -> Result<SpecDocument> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            state.plan_get_calls.push(_task_id.to_string());
            Ok(SpecDocument {
                markdown: String::new(),
                updated_at: None,
            })
        }

        fn set_plan(
            &self,
            _repo_path: &Path,
            _task_id: &str,
            markdown: &str,
        ) -> Result<SpecDocument> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            state
                .plan_set_calls
                .push((_task_id.to_string(), markdown.to_string()));
            Ok(SpecDocument {
                markdown: markdown.to_string(),
                updated_at: Some("2026-01-01T00:00:00Z".to_string()),
            })
        }

        fn get_latest_qa_report(
            &self,
            _repo_path: &Path,
            _task_id: &str,
        ) -> Result<Option<QaReportDocument>> {
            let state = self.state.lock().expect("task store lock poisoned");
            Ok(state.latest_qa_report.clone())
        }

        fn append_qa_report(
            &self,
            _repo_path: &Path,
            _task_id: &str,
            markdown: &str,
            verdict: QaVerdict,
        ) -> Result<QaReportDocument> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            state.qa_append_calls.push((
                _task_id.to_string(),
                markdown.to_string(),
                verdict.clone(),
            ));
            Ok(QaReportDocument {
                markdown: markdown.to_string(),
                verdict,
                updated_at: "2026-01-01T00:00:00Z".to_string(),
                revision: 1,
            })
        }

        fn list_agent_sessions(
            &self,
            _repo_path: &Path,
            _task_id: &str,
        ) -> Result<Vec<AgentSessionDocument>> {
            let state = self.state.lock().expect("task store lock poisoned");
            Ok(state.agent_sessions.clone())
        }

        fn upsert_agent_session(
            &self,
            _repo_path: &Path,
            _task_id: &str,
            session: AgentSessionDocument,
        ) -> Result<()> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            state
                .upserted_sessions
                .push((_task_id.to_string(), session.clone()));
            if let Some(index) = state
                .agent_sessions
                .iter()
                .position(|entry| entry.session_id == session.session_id)
            {
                state.agent_sessions[index] = session;
            } else {
                state.agent_sessions.push(session);
            }
            Ok(())
        }
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    enum GitCall {
        GetBranches {
            repo_path: String,
        },
        GetCurrentBranch {
            repo_path: String,
        },
        SwitchBranch {
            repo_path: String,
            branch: String,
            create: bool,
        },
        CreateWorktree {
            repo_path: String,
            worktree_path: String,
            branch: String,
            create_branch: bool,
        },
        RemoveWorktree {
            repo_path: String,
            worktree_path: String,
            force: bool,
        },
        PushBranch {
            repo_path: String,
            remote: String,
            branch: String,
            set_upstream: bool,
            force_with_lease: bool,
        },
    }

    #[derive(Debug)]
    struct GitState {
        calls: Vec<GitCall>,
        branches: Vec<GitBranch>,
        current_branch: GitCurrentBranch,
    }

    #[derive(Clone)]
    struct FakeGitPort {
        state: Arc<Mutex<GitState>>,
    }

    impl GitPort for FakeGitPort {
        fn get_branches(&self, repo_path: &Path) -> Result<Vec<GitBranch>> {
            let mut state = self.state.lock().expect("git state lock poisoned");
            state.calls.push(GitCall::GetBranches {
                repo_path: repo_path.to_string_lossy().to_string(),
            });
            Ok(state.branches.clone())
        }

        fn get_current_branch(&self, repo_path: &Path) -> Result<GitCurrentBranch> {
            let mut state = self.state.lock().expect("git state lock poisoned");
            state.calls.push(GitCall::GetCurrentBranch {
                repo_path: repo_path.to_string_lossy().to_string(),
            });
            Ok(state.current_branch.clone())
        }

        fn switch_branch(
            &self,
            repo_path: &Path,
            branch: &str,
            create: bool,
        ) -> Result<GitCurrentBranch> {
            let mut state = self.state.lock().expect("git state lock poisoned");
            state.calls.push(GitCall::SwitchBranch {
                repo_path: repo_path.to_string_lossy().to_string(),
                branch: branch.to_string(),
                create,
            });
            state.current_branch = GitCurrentBranch {
                name: Some(branch.to_string()),
                detached: false,
            };
            Ok(state.current_branch.clone())
        }

        fn create_worktree(
            &self,
            repo_path: &Path,
            worktree_path: &Path,
            branch: &str,
            create_branch: bool,
        ) -> Result<()> {
            let mut state = self.state.lock().expect("git state lock poisoned");
            state.calls.push(GitCall::CreateWorktree {
                repo_path: repo_path.to_string_lossy().to_string(),
                worktree_path: worktree_path.to_string_lossy().to_string(),
                branch: branch.to_string(),
                create_branch,
            });
            Ok(())
        }

        fn remove_worktree(&self, repo_path: &Path, worktree_path: &Path, force: bool) -> Result<()> {
            let mut state = self.state.lock().expect("git state lock poisoned");
            state.calls.push(GitCall::RemoveWorktree {
                repo_path: repo_path.to_string_lossy().to_string(),
                worktree_path: worktree_path.to_string_lossy().to_string(),
                force,
            });
            Ok(())
        }

        fn push_branch(
            &self,
            repo_path: &Path,
            remote: &str,
            branch: &str,
            set_upstream: bool,
            force_with_lease: bool,
        ) -> Result<GitPushSummary> {
            let mut state = self.state.lock().expect("git state lock poisoned");
            state.calls.push(GitCall::PushBranch {
                repo_path: repo_path.to_string_lossy().to_string(),
                remote: remote.to_string(),
                branch: branch.to_string(),
                set_upstream,
                force_with_lease,
            });
            Ok(GitPushSummary {
                remote: remote.to_string(),
                branch: branch.to_string(),
                output: "ok".to_string(),
            })
        }
    }

    fn build_service_with_state(
        tasks: Vec<TaskCard>,
        branches: Vec<GitBranch>,
        current_branch: GitCurrentBranch,
    ) -> (AppService, Arc<Mutex<TaskStoreState>>, Arc<Mutex<GitState>>) {
        let task_state = Arc::new(Mutex::new(TaskStoreState {
            ensure_calls: Vec::new(),
            ensure_error: None,
            tasks,
            list_error: None,
            delete_calls: Vec::new(),
            created_inputs: Vec::new(),
            updated_patches: Vec::new(),
            spec_get_calls: Vec::new(),
            spec_set_calls: Vec::new(),
            plan_get_calls: Vec::new(),
            plan_set_calls: Vec::new(),
            qa_append_calls: Vec::new(),
            latest_qa_report: None,
            agent_sessions: Vec::new(),
            upserted_sessions: Vec::new(),
        }));
        let git_state = Arc::new(Mutex::new(GitState {
            calls: Vec::new(),
            branches,
            current_branch,
        }));
        let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
            state: task_state.clone(),
        });
        let git_port: Arc<dyn GitPort> = Arc::new(FakeGitPort {
            state: git_state.clone(),
        });
        let config_store = AppConfigStore::from_path(unique_temp_path("host-app-config"));
        let service = AppService::with_git_port(task_store, config_store, git_port);
        (service, task_state, git_state)
    }

    fn make_session(task_id: &str, session_id: &str) -> AgentSessionDocument {
        AgentSessionDocument {
            session_id: session_id.to_string(),
            external_session_id: format!("external-{session_id}"),
            task_id: task_id.to_string(),
            role: "build".to_string(),
            scenario: "build_default".to_string(),
            status: "running".to_string(),
            started_at: "2026-02-20T12:00:00Z".to_string(),
            updated_at: "2026-02-20T12:00:10Z".to_string(),
            ended_at: None,
            runtime_id: Some("runtime-1".to_string()),
            run_id: Some("run-1".to_string()),
            base_url: "http://127.0.0.1:4173".to_string(),
            working_directory: "/tmp/repo".to_string(),
            selected_model: None,
        }
    }

    #[test]
    fn app_service_new_constructor_is_callable() -> Result<()> {
        let config_store = AppConfigStore::from_path(unique_temp_path("new-constructor"));
        let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
            state: Arc::new(Mutex::new(TaskStoreState {
                ensure_calls: Vec::new(),
                ensure_error: None,
                tasks: Vec::new(),
                list_error: None,
                delete_calls: Vec::new(),
                created_inputs: Vec::new(),
                updated_patches: Vec::new(),
                spec_get_calls: Vec::new(),
                spec_set_calls: Vec::new(),
                plan_get_calls: Vec::new(),
                plan_set_calls: Vec::new(),
                qa_append_calls: Vec::new(),
                latest_qa_report: None,
                agent_sessions: Vec::new(),
                upserted_sessions: Vec::new(),
            })),
        });

        let service = AppService::new(task_store, config_store);
        let _ = service.runtime_check()?;
        Ok(())
    }

    static ENV_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    fn lock_env<'a>() -> std::sync::MutexGuard<'a, ()> {
        ENV_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    fn unique_temp_path(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir().join(format!("openducktor-host-app-{name}-{nonce}"))
    }

    fn write_executable_script(path: &Path, script: &str) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = fs::File::create(path)?;
        file.write_all(script.as_bytes())?;
        let status = Command::new("chmod")
            .arg("+x")
            .arg(path)
            .status()
            .map_err(|error| anyhow!("failed running chmod: {error}"))?;
        if !status.success() {
            return Err(anyhow!("chmod +x failed for {}", path.display()));
        }
        Ok(())
    }

    fn init_git_repo(path: &Path) -> Result<()> {
        fs::create_dir_all(path)?;
        Command::new("git")
            .arg("init")
            .arg(path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()?;
        Command::new("git")
            .arg("-C")
            .arg(path)
            .arg("config")
            .arg("user.email")
            .arg("odt-test@example.com")
            .status()?;
        Command::new("git")
            .arg("-C")
            .arg(path)
            .arg("config")
            .arg("user.name")
            .arg("OpenDucktor Test")
            .status()?;
        fs::write(path.join("README.md"), "# test\n")?;
        Command::new("git")
            .arg("-C")
            .arg(path)
            .arg("add")
            .arg(".")
            .status()?;
        Command::new("git")
            .arg("-C")
            .arg(path)
            .arg("commit")
            .arg("-m")
            .arg("initial")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()?;
        Ok(())
    }

    fn create_fake_opencode(path: &Path) -> Result<()> {
        let script = r#"#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "opencode-fake 0.0.1"
  exit 0
fi

if [ "$1" = "serve" ]; then
  HOST="127.0.0.1"
  PORT="0"
  while [ $# -gt 0 ]; do
    case "$1" in
      --hostname)
        HOST="$2"
        shift 2
        ;;
      --port)
        PORT="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done
  echo "permission requested: git push"
  echo "tool execution heartbeat" >&2
  exec python3 - "$HOST" "$PORT" <<'PY'
import signal
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind((host, port))
server.listen(16)

def _stop(*_):
    try:
        server.close()
    finally:
        raise SystemExit(0)

signal.signal(signal.SIGTERM, _stop)
signal.signal(signal.SIGINT, _stop)

while True:
    conn, _ = server.accept()
    try:
        conn.recv(1024)
    except Exception:
        pass
    finally:
        conn.close()
PY
fi

echo "unsupported opencode invocation" >&2
exit 1
"#;
        write_executable_script(path, script)
    }

    fn create_failing_opencode(path: &Path) -> Result<()> {
        let script = r#"#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "opencode-fake 0.0.1"
  exit 0
fi

if [ "$1" = "serve" ]; then
  echo "simulated startup failure" >&2
  exit 42
fi

echo "unsupported opencode invocation" >&2
exit 1
"#;
        write_executable_script(path, script)
    }

    fn create_fake_bd(path: &Path) -> Result<()> {
        let script = r#"#!/bin/sh
echo "bd-fake"
"#;
        write_executable_script(path, script)
    }

    struct EnvVarGuard {
        key: String,
        previous: Option<OsString>,
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            if let Some(previous) = self.previous.clone() {
                std::env::set_var(self.key.as_str(), previous);
            } else {
                std::env::remove_var(self.key.as_str());
            }
        }
    }

    fn set_env_var(key: &str, value: &str) -> EnvVarGuard {
        let previous = std::env::var_os(key);
        std::env::set_var(key, value);
        EnvVarGuard {
            key: key.to_string(),
            previous,
        }
    }

    fn remove_env_var(key: &str) -> EnvVarGuard {
        let previous = std::env::var_os(key);
        std::env::remove_var(key);
        EnvVarGuard {
            key: key.to_string(),
            previous,
        }
    }

    fn prepend_path(path_prefix: &Path) -> EnvVarGuard {
        let previous = std::env::var_os("PATH");
        let mut parts = vec![path_prefix.to_string_lossy().to_string()];
        if let Some(current) = previous.as_ref() {
            parts.push(current.to_string_lossy().to_string());
        }
        let value = parts.join(":");
        std::env::set_var("PATH", value);
        EnvVarGuard {
            key: "PATH".to_string(),
            previous,
        }
    }

    fn build_service_with_store(
        tasks: Vec<TaskCard>,
        branches: Vec<GitBranch>,
        current_branch: GitCurrentBranch,
        config_store: AppConfigStore,
    ) -> (AppService, Arc<Mutex<TaskStoreState>>, Arc<Mutex<GitState>>) {
        let task_state = Arc::new(Mutex::new(TaskStoreState {
            ensure_calls: Vec::new(),
            ensure_error: None,
            tasks,
            list_error: None,
            delete_calls: Vec::new(),
            created_inputs: Vec::new(),
            updated_patches: Vec::new(),
            spec_get_calls: Vec::new(),
            spec_set_calls: Vec::new(),
            plan_get_calls: Vec::new(),
            plan_set_calls: Vec::new(),
            qa_append_calls: Vec::new(),
            latest_qa_report: None,
            agent_sessions: Vec::new(),
            upserted_sessions: Vec::new(),
        }));
        let git_state = Arc::new(Mutex::new(GitState {
            calls: Vec::new(),
            branches,
            current_branch,
        }));
        let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
            state: task_state.clone(),
        });
        let git_port: Arc<dyn GitPort> = Arc::new(FakeGitPort {
            state: git_state.clone(),
        });
        let service = AppService::with_git_port(task_store, config_store, git_port);
        (service, task_state, git_state)
    }

    fn make_emitter(events: Arc<Mutex<Vec<RunEvent>>>) -> Arc<dyn Fn(RunEvent) + Send + Sync> {
        Arc::new(move |event| {
            events.lock().expect("events lock poisoned").push(event);
        })
    }

    fn spawn_sleep_process(seconds: u64) -> std::process::Child {
        Command::new("/bin/sh")
            .arg("-lc")
            .arg(format!("sleep {seconds}"))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn sleep process")
    }

    fn empty_patch() -> UpdateTaskPatch {
        UpdateTaskPatch {
            title: None,
            description: None,
            acceptance_criteria: None,
            notes: None,
            status: None,
            priority: None,
            issue_type: None,
            ai_review_enabled: None,
            labels: None,
            assignee: None,
            parent_id: None,
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

    fn find_closed_low_port() -> u16 {
        for port in 1..1024 {
            if TcpStream::connect(("127.0.0.1", port)).is_err() {
                return port;
            }
        }
        panic!("expected at least one closed privileged localhost port");
    }

    #[test]
    fn wait_for_local_server_times_out_when_port_is_closed() {
        let port = find_closed_low_port();
        let result = wait_for_local_server(port, Duration::from_millis(250));
        assert!(result.is_err());
    }

    #[test]
    fn terminate_child_process_stops_background_process() {
        let mut child = Command::new("/bin/sh")
            .arg("-lc")
            .arg("sleep 5")
            .spawn()
            .expect("spawn sleep");
        terminate_child_process(&mut child);
        let status = child.try_wait().expect("try_wait should succeed");
        assert!(status.is_some(), "child process should be terminated");
    }

    #[test]
    fn wait_for_local_server_with_process_returns_early_when_child_exits() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
        let port = listener.local_addr().expect("addr").port();
        drop(listener);

        let mut child = Command::new("/bin/sh")
            .arg("-lc")
            .arg("echo startup failed >&2; exit 42")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("spawn failing process");
        let error = wait_for_local_server_with_process(&mut child, port, Duration::from_secs(2))
            .expect_err("should report early process exit");
        assert!(error.to_string().contains("startup failed"));
    }

    #[test]
    fn git_get_branches_initializes_repo_and_returns_git_data() -> Result<()> {
        let repo_path = "/tmp/odt-repo";
        let expected = vec![
            GitBranch {
                name: "main".to_string(),
                is_current: true,
                is_remote: false,
            },
            GitBranch {
                name: "origin/main".to_string(),
                is_current: false,
                is_remote: true,
            },
        ];
        let (service, task_state, git_state) = build_service_with_state(
            vec![],
            expected.clone(),
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let branches = service.git_get_branches(repo_path)?;
        assert_eq!(branches, expected);

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(task_state.ensure_calls, vec![repo_path.to_string()]);
        drop(task_state);

        let git_state = git_state.lock().expect("git lock poisoned");
        assert_eq!(
            git_state.calls,
            vec![GitCall::GetBranches {
                repo_path: repo_path.to_string()
            }]
        );
        Ok(())
    }

    #[test]
    fn git_get_current_branch_uses_repo_init_cache() -> Result<()> {
        let repo_path = "/tmp/odt-repo-cache";
        let (service, task_state, git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("feature/demo".to_string()),
                detached: false,
            },
        );

        let first = service.git_get_current_branch(repo_path)?;
        let second = service.git_get_current_branch(repo_path)?;
        assert_eq!(first.name.as_deref(), Some("feature/demo"));
        assert_eq!(second.name.as_deref(), Some("feature/demo"));

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(task_state.ensure_calls.len(), 1);
        drop(task_state);

        let git_state = git_state.lock().expect("git lock poisoned");
        assert_eq!(
            git_state.calls,
            vec![
                GitCall::GetCurrentBranch {
                    repo_path: repo_path.to_string()
                },
                GitCall::GetCurrentBranch {
                    repo_path: repo_path.to_string()
                }
            ]
        );
        Ok(())
    }

    #[test]
    fn git_switch_branch_forwards_create_flag() -> Result<()> {
        let repo_path = "/tmp/odt-repo-switch";
        let (service, _task_state, git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let branch = service.git_switch_branch(repo_path, "feature/new-ui", true)?;
        assert_eq!(branch.name.as_deref(), Some("feature/new-ui"));
        assert!(!branch.detached);

        let git_state = git_state.lock().expect("git lock poisoned");
        assert!(git_state.calls.contains(&GitCall::SwitchBranch {
            repo_path: repo_path.to_string(),
            branch: "feature/new-ui".to_string(),
            create: true,
        }));
        Ok(())
    }

    #[test]
    fn git_create_worktree_rejects_empty_path() {
        let repo_path = "/tmp/odt-repo-worktree";
        let (service, task_state, git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let error = service
            .git_create_worktree(repo_path, "   ", "feature/new", true)
            .expect_err("empty worktree path should fail");
        assert!(error.to_string().contains("worktree path cannot be empty"));

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(task_state.ensure_calls, vec![repo_path.to_string()]);
        drop(task_state);

        let git_state = git_state.lock().expect("git lock poisoned");
        assert!(git_state
            .calls
            .iter()
            .all(|call| !matches!(call, GitCall::CreateWorktree { .. })));
    }

    #[test]
    fn git_remove_worktree_forwards_force_flag() -> Result<()> {
        let repo_path = "/tmp/odt-repo-remove-worktree";
        let (service, _task_state, git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        assert!(service.git_remove_worktree(repo_path, "/tmp/wt-1", true)?);

        let git_state = git_state.lock().expect("git lock poisoned");
        assert!(git_state.calls.contains(&GitCall::RemoveWorktree {
            repo_path: repo_path.to_string(),
            worktree_path: "/tmp/wt-1".to_string(),
            force: true,
        }));
        Ok(())
    }

    #[test]
    fn git_push_branch_defaults_remote_to_origin() -> Result<()> {
        let repo_path = "/tmp/odt-repo-push";
        let (service, _task_state, git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let summary = service.git_push_branch(repo_path, Some("   "), "feature/x", true, false)?;
        assert_eq!(summary.remote, "origin");
        assert_eq!(summary.branch, "feature/x");

        let git_state = git_state.lock().expect("git lock poisoned");
        assert!(git_state.calls.contains(&GitCall::PushBranch {
            repo_path: repo_path.to_string(),
            remote: "origin".to_string(),
            branch: "feature/x".to_string(),
            set_upstream: true,
            force_with_lease: false,
        }));
        Ok(())
    }

    #[test]
    fn task_update_rejects_direct_status_changes() {
        let repo_path = "/tmp/odt-repo-task-update";
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let error = service
            .task_update(
                repo_path,
                "task-1",
                UpdateTaskPatch {
                    title: None,
                    description: None,
                    acceptance_criteria: None,
                    notes: None,
                    status: Some(TaskStatus::Closed),
                    priority: None,
                    issue_type: None,
                    ai_review_enabled: None,
                    labels: None,
                    assignee: None,
                    parent_id: None,
                },
            )
            .expect_err("direct status updates should fail");
        assert!(error
            .to_string()
            .contains("Status cannot be updated directly"));
    }

    #[test]
    fn validate_parent_relationships_for_update_enforces_hierarchy_constraints() {
        let epic = make_task("epic-1", "epic", TaskStatus::Open);
        let current = make_task("task-1", "task", TaskStatus::Open);
        let mut direct_subtask = make_task("sub-1", "task", TaskStatus::Open);
        direct_subtask.parent_id = Some("task-1".to_string());
        let feature_parent = make_task("feature-1", "feature", TaskStatus::Open);
        let mut nested_parent = make_task("nested-parent", "epic", TaskStatus::Open);
        nested_parent.parent_id = Some("epic-1".to_string());

        let tasks = vec![
            epic.clone(),
            current.clone(),
            direct_subtask.clone(),
            feature_parent.clone(),
            nested_parent.clone(),
        ];

        let mut epic_parent_patch = empty_patch();
        epic_parent_patch.parent_id = Some("task-1".to_string());
        let epic_error = validate_parent_relationships_for_update(&tasks, &epic, &epic_parent_patch)
            .expect_err("epic should not become subtask");
        assert!(epic_error
            .to_string()
            .contains("Epics cannot be converted to subtasks."));

        let mut become_subtask_patch = empty_patch();
        become_subtask_patch.parent_id = Some("epic-1".to_string());
        let parent_error =
            validate_parent_relationships_for_update(&tasks, &current, &become_subtask_patch)
                .expect_err("task with direct subtasks cannot become subtask");
        assert!(parent_error
            .to_string()
            .contains("Tasks with subtasks cannot become subtasks."));

        let mut non_epic_patch = empty_patch();
        non_epic_patch.issue_type = Some("feature".to_string());
        let type_error = validate_parent_relationships_for_update(&tasks, &current, &non_epic_patch)
            .expect_err("task with direct subtasks must remain epic");
        assert!(type_error.to_string().contains("Only epics can have subtasks."));

        let standalone = make_task("standalone", "task", TaskStatus::Open);
        let tasks_for_parent_checks = vec![
            epic.clone(),
            standalone.clone(),
            feature_parent.clone(),
            nested_parent.clone(),
        ];

        let mut bad_parent_patch = empty_patch();
        bad_parent_patch.parent_id = Some("feature-1".to_string());
        let bad_parent_error = validate_parent_relationships_for_update(
            &tasks_for_parent_checks,
            &standalone,
            &bad_parent_patch,
        )
        .expect_err("non-epic parent should be rejected");
        assert!(bad_parent_error
            .to_string()
            .contains("Only epics can be selected as parents."));

        let mut nested_parent_patch = empty_patch();
        nested_parent_patch.parent_id = Some("nested-parent".to_string());
        let nested_parent_error = validate_parent_relationships_for_update(
            &tasks_for_parent_checks,
            &standalone,
            &nested_parent_patch,
        )
        .expect_err("nested parent should be rejected");
        assert!(nested_parent_error
            .to_string()
            .contains("Subtask depth is limited to one level."));

        let mut clear_parent_patch = empty_patch();
        clear_parent_patch.parent_id = Some("   ".to_string());
        let mut current_with_parent = standalone.clone();
        current_with_parent.parent_id = Some("epic-1".to_string());
        assert!(validate_parent_relationships_for_update(
            &tasks_for_parent_checks,
            &current_with_parent,
            &clear_parent_patch,
        )
        .is_ok());
    }

    #[test]
    fn task_delete_blocks_when_subtasks_exist_without_confirmation() {
        let repo_path = "/tmp/odt-repo-task-delete";
        let parent = make_task("parent-1", "epic", TaskStatus::Open);
        let mut child = make_task("child-1", "task", TaskStatus::Open);
        child.parent_id = Some("parent-1".to_string());
        let (service, task_state, _git_state) = build_service_with_state(
            vec![parent, child],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let error = service
            .task_delete(repo_path, "parent-1", false)
            .expect_err("delete must require subtask confirmation");
        assert!(error.to_string().contains("Confirm subtask deletion"));

        let task_state = task_state.lock().expect("task lock poisoned");
        assert!(task_state.delete_calls.is_empty());
    }

    #[test]
    fn task_delete_allows_cascade_and_forwards_delete_flag() -> Result<()> {
        let repo_path = "/tmp/odt-repo-task-delete-cascade";
        let parent = make_task("parent-1", "epic", TaskStatus::Open);
        let mut child = make_task("child-1", "task", TaskStatus::Open);
        child.parent_id = Some("parent-1".to_string());
        let (service, task_state, _git_state) = build_service_with_state(
            vec![parent, child],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        service.task_delete(repo_path, "parent-1", true)?;

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(
            task_state.delete_calls,
            vec![("parent-1".to_string(), true)]
        );
        Ok(())
    }

    #[test]
    fn build_blocked_requires_non_empty_reason() {
        let repo_path = "/tmp/odt-repo-build";
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::InProgress)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let error = service
            .build_blocked(repo_path, "task-1", Some("   "))
            .expect_err("blank reason should fail");
        assert!(error.to_string().contains("requires a non-empty reason"));
    }

    #[test]
    fn build_resumed_human_actions_and_resume_deferred_paths_work() -> Result<()> {
        let repo_path = "/tmp/odt-repo-human-actions";
        let mut deferred = make_task("task-deferred", "task", TaskStatus::Deferred);
        deferred.parent_id = None;
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![
                make_task("task-blocked", "task", TaskStatus::Blocked),
                make_task("task-human-review", "task", TaskStatus::HumanReview),
                make_task("task-approve", "task", TaskStatus::HumanReview),
                deferred,
            ],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let resumed = service.build_resumed(repo_path, "task-blocked")?;
        assert_eq!(resumed.status, TaskStatus::InProgress);

        let requested_changes = service.human_request_changes(repo_path, "task-human-review", None)?;
        assert_eq!(requested_changes.status, TaskStatus::InProgress);

        let approved = service.human_approve(repo_path, "task-approve")?;
        assert_eq!(approved.status, TaskStatus::Closed);

        let resumed_deferred = service.task_resume_deferred(repo_path, "task-deferred")?;
        assert_eq!(resumed_deferred.status, TaskStatus::Open);
        Ok(())
    }

    #[test]
    fn task_resume_deferred_requires_deferred_state() {
        let repo_path = "/tmp/odt-repo-resume";
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let error = service
            .task_resume_deferred(repo_path, "task-1")
            .expect_err("non-deferred task should fail");
        assert!(error.to_string().contains("Task is not deferred"));
    }

    #[test]
    fn tasks_list_enriches_available_actions() -> Result<()> {
        let repo_path = "/tmp/odt-repo-list";
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![make_task("feature-1", "feature", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let tasks = service.tasks_list(repo_path)?;
        assert_eq!(tasks.len(), 1);
        assert!(tasks[0].available_actions.contains(&TaskAction::SetSpec));
        assert!(tasks[0].available_actions.contains(&TaskAction::ViewDetails));
        Ok(())
    }

    #[test]
    fn task_create_normalizes_issue_type_and_defaults_ai_review() -> Result<()> {
        let repo_path = "/tmp/odt-repo-create";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let created = service.task_create(
            repo_path,
            CreateTaskInput {
                title: "New task".to_string(),
                issue_type: "something-unknown".to_string(),
                priority: 2,
                description: None,
                acceptance_criteria: None,
                labels: None,
                ai_review_enabled: None,
                parent_id: None,
            },
        )?;
        assert_eq!(created.issue_type, "task");
        assert!(created.ai_review_enabled);

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(task_state.created_inputs.len(), 1);
        assert_eq!(task_state.created_inputs[0].issue_type, "task");
        assert_eq!(task_state.created_inputs[0].ai_review_enabled, Some(true));
        Ok(())
    }

    #[test]
    fn task_transition_returns_current_task_when_status_is_unchanged() -> Result<()> {
        let repo_path = "/tmp/odt-repo-transition-same";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let task = service.task_transition(repo_path, "task-1", TaskStatus::Open, None)?;
        assert_eq!(task.status, TaskStatus::Open);

        let task_state = task_state.lock().expect("task lock poisoned");
        assert!(task_state.updated_patches.is_empty());
        Ok(())
    }

    #[test]
    fn task_transition_updates_status_when_valid() -> Result<()> {
        let repo_path = "/tmp/odt-repo-transition-update";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![make_task("bug-1", "bug", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let task = service.task_transition(repo_path, "bug-1", TaskStatus::InProgress, None)?;
        assert_eq!(task.status, TaskStatus::InProgress);

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(task_state.updated_patches.len(), 1);
        assert_eq!(
            task_state.updated_patches[0].1.status,
            Some(TaskStatus::InProgress)
        );
        Ok(())
    }

    #[test]
    fn build_completed_routes_to_ai_review_when_enabled() -> Result<()> {
        let repo_path = "/tmp/odt-repo-build-ai";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::InProgress)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let task = service.build_completed(repo_path, "task-1", Some("done"))?;
        assert_eq!(task.status, TaskStatus::AiReview);

        let task_state = task_state.lock().expect("task lock poisoned");
        assert!(task_state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::AiReview)));
        Ok(())
    }

    #[test]
    fn build_completed_routes_to_human_review_when_ai_is_disabled() -> Result<()> {
        let repo_path = "/tmp/odt-repo-build-human";
        let mut task = make_task("task-1", "task", TaskStatus::InProgress);
        task.ai_review_enabled = false;
        let (service, task_state, _git_state) = build_service_with_state(
            vec![task],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let task = service.build_completed(repo_path, "task-1", None)?;
        assert_eq!(task.status, TaskStatus::HumanReview);

        let task_state = task_state.lock().expect("task lock poisoned");
        assert!(task_state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::HumanReview)));
        Ok(())
    }

    #[test]
    fn task_defer_rejects_subtasks() {
        let repo_path = "/tmp/odt-repo-defer-subtask";
        let mut subtask = make_task("task-1", "task", TaskStatus::Open);
        subtask.parent_id = Some("epic-1".to_string());
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![subtask],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let error = service
            .task_defer(repo_path, "task-1", Some("later"))
            .expect_err("subtasks cannot be deferred");
        assert!(error.to_string().contains("Subtasks cannot be deferred"));
    }

    #[test]
    fn task_defer_transitions_open_parent_task() -> Result<()> {
        let repo_path = "/tmp/odt-repo-defer-parent";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let task = service.task_defer(repo_path, "task-1", Some("later"))?;
        assert_eq!(task.status, TaskStatus::Deferred);

        let task_state = task_state.lock().expect("task lock poisoned");
        assert!(task_state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::Deferred)));
        Ok(())
    }

    #[test]
    fn task_defer_rejects_closed_tasks() {
        let repo_path = "/tmp/odt-repo-defer-closed";
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::Closed)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let error = service
            .task_defer(repo_path, "task-1", None)
            .expect_err("closed tasks cannot be deferred");
        assert!(error.to_string().contains("Only non-closed open-state tasks"));
    }

    #[test]
    fn set_spec_persists_trimmed_markdown_and_transitions_open_task() -> Result<()> {
        let repo_path = "/tmp/odt-repo-spec";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "feature", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let spec = service.set_spec(repo_path, "task-1", "  # Spec  ")?;
        assert_eq!(spec.markdown, "# Spec");

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(
            task_state.spec_set_calls,
            vec![("task-1".to_string(), "# Spec".to_string())]
        );
        assert!(task_state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::SpecReady)));
        Ok(())
    }

    #[test]
    fn set_spec_rejects_invalid_status() {
        let repo_path = "/tmp/odt-repo-spec-invalid";
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::InProgress)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let error = service
            .set_spec(repo_path, "task-1", "# Spec")
            .expect_err("set_spec should be blocked in in_progress");
        assert!(error.to_string().contains("set_spec is only allowed"));
    }

    #[test]
    fn set_plan_for_non_epic_transitions_ready_for_dev() -> Result<()> {
        let repo_path = "/tmp/odt-repo-plan-task";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let plan = service.set_plan(repo_path, "task-1", "  # Plan  ", None)?;
        assert_eq!(plan.markdown, "# Plan");

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(
            task_state.plan_set_calls,
            vec![("task-1".to_string(), "# Plan".to_string())]
        );
        assert_eq!(task_state.created_inputs.len(), 0);
        assert!(task_state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::ReadyForDev)));
        Ok(())
    }

    #[test]
    fn set_plan_rejects_invalid_status_for_feature() {
        let repo_path = "/tmp/odt-repo-plan-invalid";
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "feature", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let error = service
            .set_plan(repo_path, "task-1", "# Plan", None)
            .expect_err("feature/open should not allow plan");
        assert!(error.to_string().contains("set_plan is not allowed"));
    }

    #[test]
    fn set_plan_for_epic_creates_unique_missing_subtasks() -> Result<()> {
        let repo_path = "/tmp/odt-repo-plan-epic";
        let epic = make_task("epic-1", "epic", TaskStatus::SpecReady);
        let mut existing_child = make_task("child-1", "task", TaskStatus::Open);
        existing_child.title = "Build API".to_string();
        existing_child.parent_id = Some("epic-1".to_string());

        let (service, task_state, _git_state) = build_service_with_state(
            vec![epic, existing_child],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let plan = service.set_plan(
            repo_path,
            "epic-1",
            "# Epic Plan",
            Some(vec![
                PlanSubtaskInput {
                    title: "Build API".to_string(),
                    issue_type: Some("task".to_string()),
                    priority: Some(2),
                    description: None,
                },
                PlanSubtaskInput {
                    title: "Build UI".to_string(),
                    issue_type: Some("feature".to_string()),
                    priority: Some(2),
                    description: Some("Add interface".to_string()),
                },
                PlanSubtaskInput {
                    title: "Build UI".to_string(),
                    issue_type: Some("feature".to_string()),
                    priority: Some(2),
                    description: Some("Duplicate".to_string()),
                },
            ]),
        )?;
        assert_eq!(plan.markdown, "# Epic Plan");

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(task_state.created_inputs.len(), 1);
        assert_eq!(task_state.created_inputs[0].title, "Build UI");
        assert_eq!(
            task_state.created_inputs[0].parent_id.as_deref(),
            Some("epic-1")
        );
        assert!(task_state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::ReadyForDev)));
        Ok(())
    }

    #[test]
    fn qa_get_report_returns_latest_markdown_when_present() -> Result<()> {
        let repo_path = "/tmp/odt-repo-qa-report";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );
        {
            let mut state = task_state.lock().expect("task lock poisoned");
            state.latest_qa_report = Some(QaReportDocument {
                markdown: "QA body".to_string(),
                verdict: QaVerdict::Approved,
                updated_at: "2026-02-20T12:00:00Z".to_string(),
                revision: 2,
            });
        }

        let report = service.qa_get_report(repo_path, "task-1")?;
        assert_eq!(report.markdown, "QA body");
        assert_eq!(report.updated_at.as_deref(), Some("2026-02-20T12:00:00Z"));
        Ok(())
    }

    #[test]
    fn qa_get_report_returns_empty_when_not_present() -> Result<()> {
        let repo_path = "/tmp/odt-repo-qa-empty";
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let report = service.qa_get_report(repo_path, "task-1")?;
        assert!(report.markdown.is_empty());
        assert!(report.updated_at.is_none());
        Ok(())
    }

    #[test]
    fn spec_get_and_plan_get_delegate_to_task_store() -> Result<()> {
        let repo_path = "/tmp/odt-repo-docs-read";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let _ = service.spec_get(repo_path, "task-1")?;
        let _ = service.plan_get(repo_path, "task-1")?;

        let state = task_state.lock().expect("task lock poisoned");
        assert_eq!(state.spec_get_calls, vec!["task-1".to_string()]);
        assert_eq!(state.plan_get_calls, vec!["task-1".to_string()]);
        Ok(())
    }

    #[test]
    fn qa_approved_appends_report_and_transitions_to_human_review() -> Result<()> {
        let repo_path = "/tmp/odt-repo-qa-approved";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::AiReview)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let task = service.qa_approved(repo_path, "task-1", "Looks good")?;
        assert_eq!(task.status, TaskStatus::HumanReview);

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(
            task_state.qa_append_calls,
            vec![(
                "task-1".to_string(),
                "Looks good".to_string(),
                QaVerdict::Approved
            )]
        );
        assert!(task_state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::HumanReview)));
        Ok(())
    }

    #[test]
    fn qa_rejected_appends_report_and_transitions_to_in_progress() -> Result<()> {
        let repo_path = "/tmp/odt-repo-qa-rejected";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::AiReview)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let task = service.qa_rejected(repo_path, "task-1", "Needs work")?;
        assert_eq!(task.status, TaskStatus::InProgress);

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(
            task_state.qa_append_calls,
            vec![(
                "task-1".to_string(),
                "Needs work".to_string(),
                QaVerdict::Rejected
            )]
        );
        assert!(task_state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::InProgress)));
        Ok(())
    }

    #[test]
    fn agent_sessions_list_and_upsert_flow_through_store() -> Result<()> {
        let repo_path = "/tmp/odt-repo-sessions";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );
        {
            let mut state = task_state.lock().expect("task lock poisoned");
            state.agent_sessions = vec![make_session("task-1", "session-1")];
        }

        let sessions = service.agent_sessions_list(repo_path, "task-1")?;
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "session-1");

        let upserted = service.agent_session_upsert(
            repo_path,
            "task-1",
            make_session("wrong-task", "session-2"),
        )?;
        assert!(upserted);

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(task_state.upserted_sessions.len(), 1);
        assert_eq!(task_state.upserted_sessions[0].0, "task-1");
        assert_eq!(task_state.upserted_sessions[0].1.task_id, "task-1");
        Ok(())
    }

    #[test]
    fn runtime_beads_system_and_workspace_paths_are_exercised() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("runtime-workspace");
        let repo = root.join("repo");
        init_git_repo(&repo)?;

        let bin_dir = root.join("bin");
        let fake_opencode = bin_dir.join("opencode");
        let fake_bd = bin_dir.join("bd");
        create_fake_opencode(&fake_opencode)?;
        create_fake_bd(&fake_bd)?;

        let _opencode_guard = set_env_var(
            "OPENDUCKTOR_OPENCODE_BINARY",
            fake_opencode.to_string_lossy().as_ref(),
        );
        let _path_guard = prepend_path(&bin_dir);

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "task", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );

        let repo_path = repo.to_string_lossy().to_string();
        let runtime = service.runtime_check()?;
        assert!(runtime.git_ok);
        assert!(runtime.opencode_ok);
        assert!(runtime
            .opencode_version
            .as_deref()
            .unwrap_or_default()
            .contains("opencode-fake"));

        let beads = service.beads_check(repo_path.as_str())?;
        assert!(beads.beads_ok);
        assert!(beads.beads_path.is_some());

        let system = service.system_check(repo_path.as_str())?;
        assert!(system.git_ok);
        assert!(system.beads_ok);
        assert!(system.opencode_ok);
        assert!(system.errors.is_empty());

        let workspace = service.workspace_add(repo_path.as_str())?;
        assert!(workspace.is_active);
        let selected = service.workspace_select(repo_path.as_str())?;
        assert!(selected.is_active);

        let worktree_base = root.join("worktrees").to_string_lossy().to_string();
        let updated = service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.clone()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: false,
                hooks: HookSet::default(),
                agent_defaults: Default::default(),
            },
        )?;
        assert!(updated.has_config);

        let config = service.workspace_get_repo_config(repo_path.as_str())?;
        assert_eq!(config.branch_prefix, "odt");
        assert_eq!(config.worktree_base_path.as_deref(), Some(worktree_base.as_str()));
        assert!(service
            .workspace_get_repo_config_optional(repo_path.as_str())?
            .is_some());
        let trusted = service.workspace_set_trusted_hooks(repo_path.as_str(), true)?;
        assert!(trusted.has_config);

        let records = service.workspace_list()?;
        assert_eq!(records.len(), 1);
        assert!(records[0].is_active);

        let state = task_state.lock().expect("task lock poisoned");
        assert!(!state.ensure_calls.is_empty());
        drop(state);

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn beads_check_reports_task_store_init_error() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("beads-error");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let bin_dir = root.join("bin");
        create_fake_bd(&bin_dir.join("bd"))?;
        let _path_guard = prepend_path(&bin_dir);

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );
        task_state
            .lock()
            .expect("task lock poisoned")
            .ensure_error = Some("init failed".to_string());

        let repo_path = repo.to_string_lossy().to_string();
        let check = service.beads_check(repo_path.as_str())?;
        assert!(!check.beads_ok);
        let beads_error = check.beads_error.unwrap_or_default();
        assert!(
            beads_error.contains("Failed to initialize task store"),
            "unexpected beads error: {beads_error}"
        );
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn beads_and_system_checks_report_missing_bd_binary() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("beads-missing-binary");
        let _path_guard = set_env_var("PATH", "/usr/bin:/bin");

        let (service, _task_state, _git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let beads = service.beads_check("/tmp/does-not-matter")?;
        assert!(!beads.beads_ok);
        assert!(beads.beads_path.is_none());
        assert!(
            beads
                .beads_error
                .as_deref()
                .unwrap_or_default()
                .contains("bd not found in PATH")
        );

        let system = service.system_check("/tmp/does-not-matter")?;
        assert!(system
            .errors
            .iter()
            .any(|entry| entry.contains("beads: bd not found in PATH")));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn opencode_workspace_runtime_ensure_list_and_stop_flow() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("runtime-workspace-flow");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let fake_opencode = root.join("opencode");
        create_fake_opencode(&fake_opencode)?;
        let _opencode_guard = set_env_var(
            "OPENDUCKTOR_OPENCODE_BINARY",
            fake_opencode.to_string_lossy().as_ref(),
        );

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );

        let repo_path = repo.to_string_lossy().to_string();
        let first = service.opencode_repo_runtime_ensure(repo_path.as_str())?;
        let second = service.opencode_repo_runtime_ensure(repo_path.as_str())?;
        assert_eq!(first.runtime_id, second.runtime_id);

        let listed = service.opencode_runtime_list(Some(repo_path.as_str()))?;
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].runtime_id, first.runtime_id);

        assert!(service.opencode_runtime_stop(first.runtime_id.as_str())?);
        assert!(service.opencode_runtime_list(Some(repo_path.as_str()))?.is_empty());
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn opencode_runtime_start_supports_spec_and_qa_roles() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("runtime-start");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let fake_opencode = root.join("opencode");
        create_fake_opencode(&fake_opencode)?;
        let _opencode_guard = set_env_var(
            "OPENDUCKTOR_OPENCODE_BINARY",
            fake_opencode.to_string_lossy().as_ref(),
        );

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let worktree_base = root.join("qa-worktrees");
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "task", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );
        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet::default(),
                agent_defaults: Default::default(),
            },
        )?;

        let spec_runtime = service.opencode_runtime_start(repo_path.as_str(), "task-1", "spec")?;
        assert_eq!(spec_runtime.role, "spec");
        assert!(service.opencode_runtime_stop(spec_runtime.runtime_id.as_str())?);

        let qa_runtime = service.opencode_runtime_start(repo_path.as_str(), "task-1", "qa")?;
        assert_eq!(qa_runtime.role, "qa");
        let qa_worktree = PathBuf::from(qa_runtime.working_directory.clone());
        assert!(qa_worktree.exists());
        assert!(service.opencode_runtime_stop(qa_runtime.runtime_id.as_str())?);
        assert!(!qa_worktree.exists());

        let bad_role = service
            .opencode_runtime_start(repo_path.as_str(), "task-1", "build")
            .expect_err("unsupported role should fail");
        assert!(bad_role
            .to_string()
            .contains("Unsupported agent runtime role"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn opencode_runtime_start_reports_missing_task() -> Result<()> {
        let root = unique_temp_path("runtime-missing-task");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );

        let repo_path = repo.to_string_lossy().to_string();
        let error = service
            .opencode_runtime_start(repo_path.as_str(), "missing-task", "spec")
            .expect_err("missing task should fail");
        assert!(error.to_string().contains("Task not found: missing-task"));
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn opencode_runtime_start_qa_validates_config_and_existing_worktree_path() -> Result<()> {
        let root = unique_temp_path("runtime-qa-guards");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let worktree_base = root.join("qa-worktrees");
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "task", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );

        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: None,
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet::default(),
                agent_defaults: Default::default(),
            },
        )?;
        let missing_base_error = service
            .opencode_runtime_start(repo_path.as_str(), "task-1", "qa")
            .expect_err("qa runtime should require worktree base path");
        assert!(missing_base_error
            .to_string()
            .contains("QA blocked: configure repos."));

        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: false,
                hooks: HookSet {
                    pre_start: vec!["echo pre-hook".to_string()],
                    post_complete: Vec::new(),
                },
                agent_defaults: Default::default(),
            },
        )?;
        let trust_error = service
            .opencode_runtime_start(repo_path.as_str(), "task-1", "qa")
            .expect_err("qa runtime should reject untrusted hooks");
        assert!(trust_error
            .to_string()
            .contains("Hooks are configured but not trusted"));

        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet::default(),
                agent_defaults: Default::default(),
            },
        )?;
        fs::create_dir_all(worktree_base.join("qa-task-1"))?;
        let existing_path_error = service
            .opencode_runtime_start(repo_path.as_str(), "task-1", "qa")
            .expect_err("existing qa worktree should fail");
        assert!(existing_path_error
            .to_string()
            .contains("QA worktree path already exists"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn opencode_runtime_start_reuses_existing_runtime_for_same_task_and_role() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("runtime-reuse");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let fake_opencode = root.join("opencode");
        create_fake_opencode(&fake_opencode)?;
        let _opencode_guard = set_env_var(
            "OPENDUCKTOR_OPENCODE_BINARY",
            fake_opencode.to_string_lossy().as_ref(),
        );
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "task", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );
        let repo_path = repo.to_string_lossy().to_string();

        let first = service.opencode_runtime_start(repo_path.as_str(), "task-1", "spec")?;
        let second = service.opencode_runtime_start(repo_path.as_str(), "task-1", "spec")?;
        assert_eq!(first.runtime_id, second.runtime_id);
        assert!(service.opencode_runtime_stop(first.runtime_id.as_str())?);
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn opencode_runtime_stop_reports_cleanup_failure() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let runtime_id = "runtime-cleanup-error".to_string();
        service
            .agent_runtimes
            .lock()
            .expect("runtime lock poisoned")
            .insert(
                runtime_id.clone(),
                super::AgentRuntimeProcess {
                    summary: AgentRuntimeSummary {
                        runtime_id: runtime_id.clone(),
                        repo_path: "/tmp/repo".to_string(),
                        task_id: "task-1".to_string(),
                        role: "qa".to_string(),
                        working_directory: "/tmp/repo".to_string(),
                        port: 1,
                        started_at: "2026-02-20T12:00:00Z".to_string(),
                    },
                    child: spawn_sleep_process(20),
                    cleanup_repo_path: Some("/tmp/non-existent-repo-for-stop".to_string()),
                    cleanup_worktree_path: Some("/tmp/non-existent-worktree-for-stop".to_string()),
                },
            );

        let error = service
            .opencode_runtime_stop(runtime_id.as_str())
            .expect_err("cleanup failure should bubble up");
        assert!(error
            .to_string()
            .contains("Failed removing QA worktree runtime"));
        assert!(service
            .agent_runtimes
            .lock()
            .expect("runtime lock poisoned")
            .is_empty());
        Ok(())
    }

    #[test]
    fn opencode_runtime_list_prunes_stale_entries() -> Result<()> {
        let root = unique_temp_path("runtime-prune");
        let repo = root.join("repo");
        init_git_repo(&repo)?;

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );

        let stale_child = Command::new("/bin/sh")
            .arg("-lc")
            .arg("exit 0")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn stale child");
        let summary = AgentRuntimeSummary {
            runtime_id: "runtime-stale".to_string(),
            repo_path: repo.to_string_lossy().to_string(),
            task_id: "task-1".to_string(),
            role: "spec".to_string(),
            working_directory: repo.to_string_lossy().to_string(),
            port: 1,
            started_at: "2026-02-20T12:00:00Z".to_string(),
        };
        service
            .agent_runtimes
            .lock()
            .expect("runtime lock poisoned")
            .insert(
                summary.runtime_id.clone(),
                super::AgentRuntimeProcess {
                    summary,
                    child: stale_child,
                    cleanup_repo_path: None,
                    cleanup_worktree_path: None,
                },
            );

        std::thread::sleep(Duration::from_millis(50));
        let listed = service.opencode_runtime_list(None)?;
        assert!(listed.is_empty());

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn build_start_respond_and_cleanup_success_flow() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("build-success");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let fake_opencode = root.join("opencode");
        create_fake_opencode(&fake_opencode)?;
        let _opencode_guard = set_env_var(
            "OPENDUCKTOR_OPENCODE_BINARY",
            fake_opencode.to_string_lossy().as_ref(),
        );

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let worktree_base = root.join("builder-worktrees");
        let (service, task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "bug", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );
        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet::default(),
                agent_defaults: Default::default(),
            },
        )?;

        let events = Arc::new(Mutex::new(Vec::<RunEvent>::new()));
        let emitter = make_emitter(events.clone());

        let run = service.build_start(repo_path.as_str(), "task-1", emitter.clone())?;
        assert!(matches!(run.state, RunState::Running));
        assert_eq!(service.runs_list(Some(repo_path.as_str()))?.len(), 1);

        std::thread::sleep(Duration::from_millis(200));
        assert!(service.build_respond(
            run.run_id.as_str(),
            "approve",
            Some("Allow git push"),
            emitter.clone()
        )?);

        assert!(service.build_cleanup(run.run_id.as_str(), "success", emitter.clone())?);
        assert!(service.runs_list(Some(repo_path.as_str()))?.is_empty());

        let state = task_state.lock().expect("task lock poisoned");
        assert!(state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::InProgress)));
        assert!(state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::AiReview)));
        drop(state);

        let emitted = events.lock().expect("events lock poisoned");
        assert!(emitted.iter().any(|event| matches!(event, RunEvent::RunStarted { .. })));
        assert!(emitted
            .iter()
            .any(|event| matches!(event, RunEvent::PermissionRequired { .. })));
        assert!(emitted
            .iter()
            .any(|event| matches!(event, RunEvent::ToolExecution { .. })));
        assert!(emitted
            .iter()
            .any(|event| matches!(event, RunEvent::RunFinished { success: true, .. })));
        drop(emitted);

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn build_stop_respond_and_cleanup_failure_paths() -> Result<()> {
        let root = unique_temp_path("build-failure");
        let repo = root.join("repo");
        init_git_repo(&repo)?;

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let (service, task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "bug", TaskStatus::InProgress)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );

        let run_id = "run-local".to_string();
        service.runs.lock().expect("run lock poisoned").insert(
            run_id.clone(),
            super::RunProcess {
                summary: RunSummary {
                    run_id: run_id.clone(),
                    repo_path: repo_path.clone(),
                    task_id: "task-1".to_string(),
                    branch: "odt/task-1".to_string(),
                    worktree_path: repo_path.clone(),
                    port: 1,
                    state: RunState::Running,
                    last_message: None,
                    started_at: "2026-02-20T12:00:00Z".to_string(),
                },
                child: spawn_sleep_process(20),
                repo_path: repo_path.clone(),
                task_id: "task-1".to_string(),
                worktree_path: repo_path.clone(),
                repo_config: RepoConfig {
                    worktree_base_path: None,
                    branch_prefix: "odt".to_string(),
                    trusted_hooks: true,
                    hooks: HookSet::default(),
                    agent_defaults: Default::default(),
                },
            },
        );

        let events = Arc::new(Mutex::new(Vec::<RunEvent>::new()));
        let emitter = make_emitter(events.clone());
        assert!(service.build_respond(run_id.as_str(), "message", Some("note"), emitter.clone())?);
        assert!(service.build_respond(run_id.as_str(), "deny", None, emitter.clone())?);
        let unknown = service
            .build_respond(run_id.as_str(), "nope", None, emitter.clone())
            .expect_err("unknown action should fail");
        assert!(unknown.to_string().contains("Unknown build response action"));

        assert!(service.build_stop(run_id.as_str(), emitter.clone())?);
        assert!(service.build_cleanup(run_id.as_str(), "failure", emitter.clone())?);
        assert!(service.runs_list(Some(repo_path.as_str()))?.is_empty());

        let state = task_state.lock().expect("task lock poisoned");
        assert!(state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::Blocked)));
        drop(state);

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn build_start_and_cleanup_cover_hook_failure_paths() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("build-hooks");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let fake_opencode = root.join("opencode");
        create_fake_opencode(&fake_opencode)?;
        let _opencode_guard = set_env_var(
            "OPENDUCKTOR_OPENCODE_BINARY",
            fake_opencode.to_string_lossy().as_ref(),
        );

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let worktree_base = root.join("hook-worktrees");
        let (service, task_state, _git_state) = build_service_with_store(
            vec![
                make_task("task-1", "bug", TaskStatus::Open),
                make_task("task-2", "bug", TaskStatus::Open),
            ],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );

        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet {
                    pre_start: vec!["echo pre-fail >&2; exit 1".to_string()],
                    post_complete: Vec::new(),
                },
                agent_defaults: Default::default(),
            },
        )?;

        let pre_start_error = service
            .build_start(
                repo_path.as_str(),
                "task-1",
                make_emitter(Arc::new(Mutex::new(Vec::new()))),
            )
            .expect_err("pre-start failure should fail");
        assert!(pre_start_error.to_string().contains("Pre-start hook failed"));

        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet {
                    pre_start: Vec::new(),
                    post_complete: vec!["echo post-fail >&2; exit 1".to_string()],
                },
                agent_defaults: Default::default(),
            },
        )?;

        let events = Arc::new(Mutex::new(Vec::<RunEvent>::new()));
        let emitter = make_emitter(events.clone());
        let run = service.build_start(repo_path.as_str(), "task-2", emitter.clone())?;
        let cleaned = service.build_cleanup(run.run_id.as_str(), "success", emitter.clone())?;
        assert!(!cleaned, "post-hook failure should report false");

        let invalid_mode = service
            .build_cleanup("run-missing", "unknown", emitter)
            .expect_err("unknown mode should fail");
        assert!(invalid_mode.to_string().contains("Run not found"));

        let state = task_state.lock().expect("task lock poisoned");
        assert!(state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::Blocked)));
        drop(state);

        let emitted = events.lock().expect("events lock poisoned");
        assert!(emitted
            .iter()
            .any(|event| matches!(event, RunEvent::PostHookStarted { .. })));
        assert!(emitted
            .iter()
            .any(|event| matches!(event, RunEvent::PostHookFailed { .. })));
        drop(emitted);

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn build_start_requires_worktree_base_path() -> Result<()> {
        let root = unique_temp_path("build-no-worktree-base");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "bug", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );
        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: None,
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet::default(),
                agent_defaults: Default::default(),
            },
        )?;

        let error = service
            .build_start(
                repo_path.as_str(),
                "task-1",
                make_emitter(Arc::new(Mutex::new(Vec::new()))),
            )
            .expect_err("build_start should require worktree base");
        assert!(error
            .to_string()
            .contains("Build blocked: configure repos."));
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn build_start_rejects_untrusted_hooks_configuration() -> Result<()> {
        let root = unique_temp_path("build-untrusted-hooks");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let worktree_base = root.join("worktrees");
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "bug", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );
        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: false,
                hooks: HookSet {
                    pre_start: vec!["echo pre-hook".to_string()],
                    post_complete: Vec::new(),
                },
                agent_defaults: Default::default(),
            },
        )?;

        let error = service
            .build_start(
                repo_path.as_str(),
                "task-1",
                make_emitter(Arc::new(Mutex::new(Vec::new()))),
            )
            .expect_err("hooks should be rejected when not trusted");
        assert!(error
            .to_string()
            .contains("Hooks are configured but not trusted"));
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn build_start_rejects_existing_worktree_directory() -> Result<()> {
        let root = unique_temp_path("build-existing-worktree");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let worktree_base = root.join("worktrees");
        let task_worktree = worktree_base.join("task-1");
        fs::create_dir_all(&task_worktree)?;

        let (service, _task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "bug", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );
        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet::default(),
                agent_defaults: Default::default(),
            },
        )?;

        let error = service
            .build_start(
                repo_path.as_str(),
                "task-1",
                make_emitter(Arc::new(Mutex::new(Vec::new()))),
            )
            .expect_err("existing worktree path should be rejected");
        assert!(error
            .to_string()
            .contains("Worktree path already exists for task task-1"));
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn build_start_reports_opencode_startup_failure() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("build-startup-failure");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let failing_opencode = root.join("opencode");
        create_failing_opencode(&failing_opencode)?;
        let _opencode_guard = set_env_var(
            "OPENDUCKTOR_OPENCODE_BINARY",
            failing_opencode.to_string_lossy().as_ref(),
        );

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let worktree_base = root.join("worktrees");
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "bug", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );
        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet::default(),
                agent_defaults: Default::default(),
            },
        )?;

        let error = service
            .build_start(
                repo_path.as_str(),
                "task-1",
                make_emitter(Arc::new(Mutex::new(Vec::new()))),
            )
            .expect_err("startup failure should bubble up");
        let message = error.to_string();
        assert!(message.contains("OpenCode build runtime failed to start"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn shutdown_reports_runtime_cleanup_errors_and_drains_state() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let run_id = "run-shutdown".to_string();
        service.runs.lock().expect("run lock poisoned").insert(
            run_id.clone(),
            super::RunProcess {
                summary: RunSummary {
                    run_id: run_id.clone(),
                    repo_path: "/tmp/repo".to_string(),
                    task_id: "task-1".to_string(),
                    branch: "odt/task-1".to_string(),
                    worktree_path: "/tmp/worktree".to_string(),
                    port: 1,
                    state: RunState::Running,
                    last_message: None,
                    started_at: "2026-02-20T12:00:00Z".to_string(),
                },
                child: spawn_sleep_process(20),
                repo_path: "/tmp/repo".to_string(),
                task_id: "task-1".to_string(),
                worktree_path: "/tmp/worktree".to_string(),
                repo_config: RepoConfig {
                    worktree_base_path: None,
                    branch_prefix: "odt".to_string(),
                    trusted_hooks: true,
                    hooks: HookSet::default(),
                    agent_defaults: Default::default(),
                },
            },
        );

        let runtime_id = "runtime-shutdown".to_string();
        service
            .agent_runtimes
            .lock()
            .expect("runtime lock poisoned")
            .insert(
                runtime_id.clone(),
                super::AgentRuntimeProcess {
                    summary: AgentRuntimeSummary {
                        runtime_id,
                        repo_path: "/tmp/repo".to_string(),
                        task_id: "task-1".to_string(),
                        role: "qa".to_string(),
                        working_directory: "/tmp/worktree".to_string(),
                        port: 1,
                        started_at: "2026-02-20T12:00:00Z".to_string(),
                    },
                    child: spawn_sleep_process(20),
                    cleanup_repo_path: Some("/tmp/non-existent-repo-for-shutdown".to_string()),
                    cleanup_worktree_path: Some("/tmp/non-existent-worktree-for-shutdown".to_string()),
                },
            );

        let error = service
            .shutdown()
            .expect_err("shutdown should aggregate runtime cleanup failures");
        assert!(error
            .to_string()
            .contains("Failed removing QA worktree runtime"));
        assert!(service.runs.lock().expect("run lock poisoned").is_empty());
        assert!(service
            .agent_runtimes
            .lock()
            .expect("runtime lock poisoned")
            .is_empty());
        Ok(())
    }

    #[test]
    fn helper_functions_cover_mcp_and_opencode_resolution_paths() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("helpers");
        let fake_opencode = root.join("opencode");
        create_fake_opencode(&fake_opencode)?;
        let _opencode_guard = set_env_var(
            "OPENDUCKTOR_OPENCODE_BINARY",
            fake_opencode.to_string_lossy().as_ref(),
        );

        let version = read_opencode_version(fake_opencode.to_string_lossy().as_ref());
        assert_eq!(version.as_deref(), Some("opencode-fake 0.0.1"));
        assert_eq!(
            resolve_opencode_binary_path().as_deref(),
            Some(fake_opencode.to_string_lossy().as_ref())
        );

        let _workspace_guard = set_env_var("OPENDUCKTOR_WORKSPACE_ROOT", root.to_string_lossy().as_ref());
        let _command_guard = set_env_var("OPENDUCKTOR_MCP_COMMAND_JSON", "[\"mcp-bin\",\"--stdio\"]");
        let parsed = resolve_mcp_command()?;
        assert_eq!(parsed, vec!["mcp-bin".to_string(), "--stdio".to_string()]);
        assert_eq!(default_mcp_workspace_root()?, root.to_string_lossy().to_string());

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn resolve_opencode_binary_path_uses_home_fallback_when_override_and_path_missing() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("opencode-home-fallback");
        let home_bin = root.join(".opencode").join("bin");
        fs::create_dir_all(&home_bin)?;
        let home_opencode = home_bin.join("opencode");
        create_fake_opencode(&home_opencode)?;
        let empty_bin = root.join("empty-bin");
        fs::create_dir_all(&empty_bin)?;
        let fallback_path = format!("{}:/usr/bin:/bin", empty_bin.to_string_lossy());

        let _override_guard = set_env_var("OPENDUCKTOR_OPENCODE_BINARY", "   ");
        let _home_guard = set_env_var("HOME", root.to_string_lossy().as_ref());
        let _path_guard = set_env_var("PATH", fallback_path.as_str());

        let resolved = resolve_opencode_binary_path();
        assert_eq!(resolved.as_deref(), Some(home_opencode.to_string_lossy().as_ref()));
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn resolve_mcp_command_supports_cli_and_bun_fallback_modes() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("mcp-command-fallbacks");
        let cli_bin = root.join("cli-bin");
        let empty_bin = root.join("empty-bin");
        let bun_bin = root.join("bun-bin");
        fs::create_dir_all(&cli_bin)?;
        fs::create_dir_all(&empty_bin)?;
        fs::create_dir_all(&bun_bin)?;
        write_executable_script(&cli_bin.join("openducktor-mcp"), "#!/bin/sh\nexit 0\n")?;
        write_executable_script(&bun_bin.join("bun"), "#!/bin/sh\nexit 0\n")?;

        let _mcp_env_guard = remove_env_var("OPENDUCKTOR_MCP_COMMAND_JSON");

        {
            let _workspace_guard = remove_env_var("OPENDUCKTOR_WORKSPACE_ROOT");
            let path = format!("{}:/usr/bin:/bin", cli_bin.to_string_lossy());
            let _path_guard = set_env_var("PATH", path.as_str());
            let command = resolve_mcp_command()?;
            assert_eq!(command, vec!["openducktor-mcp".to_string()]);
        }

        {
            let _workspace_guard = remove_env_var("OPENDUCKTOR_WORKSPACE_ROOT");
            let path = format!("{}:/usr/bin:/bin", empty_bin.to_string_lossy());
            let _path_guard = set_env_var("PATH", path.as_str());
            let error = resolve_mcp_command().expect_err("missing mcp + bun should fail");
            assert!(error.to_string().contains("Missing MCP runner"));
        }

        let workspace_direct = root.join("workspace-direct");
        let direct_entrypoint = workspace_direct
            .join("packages")
            .join("openducktor-mcp")
            .join("src")
            .join("index.ts");
        fs::create_dir_all(
            direct_entrypoint
                .parent()
                .expect("entrypoint parent should exist"),
        )?;
        fs::write(&direct_entrypoint, "console.log('mcp');\n")?;

        {
            let path = format!("{}:/usr/bin:/bin", bun_bin.to_string_lossy());
            let _path_guard = set_env_var("PATH", path.as_str());
            let _workspace_guard =
                set_env_var("OPENDUCKTOR_WORKSPACE_ROOT", workspace_direct.to_string_lossy().as_ref());
            let command = resolve_mcp_command()?;
            assert_eq!(
                command,
                vec![
                    "bun".to_string(),
                    direct_entrypoint.to_string_lossy().to_string()
                ]
            );
        }

        let workspace_filter = root.join("workspace-filter");
        fs::create_dir_all(&workspace_filter)?;
        {
            let path = format!("{}:/usr/bin:/bin", bun_bin.to_string_lossy());
            let _path_guard = set_env_var("PATH", path.as_str());
            let _workspace_guard =
                set_env_var("OPENDUCKTOR_WORKSPACE_ROOT", workspace_filter.to_string_lossy().as_ref());
            let command = resolve_mcp_command()?;
            assert_eq!(
                command,
                vec![
                    "bun".to_string(),
                    "run".to_string(),
                    "--silent".to_string(),
                    "--cwd".to_string(),
                    workspace_filter.to_string_lossy().to_string(),
                    "--filter".to_string(),
                    "@openducktor/openducktor-mcp".to_string(),
                    "start".to_string(),
                ]
            );
        }

        let _ = fs::remove_dir_all(root);
        Ok(())
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
        assert_eq!(parsed["logLevel"].as_str(), Some("INFO"));
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
