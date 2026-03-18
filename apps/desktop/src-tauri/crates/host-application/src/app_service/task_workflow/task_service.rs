use crate::app_service::service_core::AppService;
use crate::app_service::workflow_rules::{
    default_qa_required_for_issue_type, is_open_state, validate_parent_relationships_for_create,
    validate_parent_relationships_for_update, validate_transition,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{
    AgentSessionDocument, CreateTaskInput, QaWorkflowVerdict, RunState, RuntimeRole, TaskCard,
    TaskMetadata, TaskStatus, UpdateTaskPatch,
};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

impl AppService {
    pub fn tasks_list(&self, repo_path: &str) -> Result<Vec<TaskCard>> {
        let context = self.load_task_repo_context(repo_path)?;
        Ok(self.enrich_tasks(context.tasks))
    }

    pub fn task_create(&self, repo_path: &str, mut input: CreateTaskInput) -> Result<TaskCard> {
        let mut context = self.load_task_repo_context(repo_path)?;
        if input.ai_review_enabled.is_none() {
            input.ai_review_enabled = Some(default_qa_required_for_issue_type(&input.issue_type));
        }

        validate_parent_relationships_for_create(&context.tasks, &input)?;

        let created = self.task_store.create_task(context.repo_dir(), input)?;
        context.tasks.push(created.clone());
        Ok(self.enrich_task(created, &context.tasks))
    }

    pub fn task_update(
        &self,
        repo_path: &str,
        task_id: &str,
        patch: UpdateTaskPatch,
    ) -> Result<TaskCard> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        if patch.status.is_some() {
            return Err(anyhow!(
                "Status cannot be updated directly. Use workflow transitions."
            ));
        }

        let mut context = self.load_task_repo_context_from_resolved(repo_path)?;
        let current = context.task(task_id)?;
        validate_parent_relationships_for_update(&context.tasks, current, &patch)?;

        let updated = self
            .task_store
            .update_task(context.repo_dir(), task_id, patch)?;
        if let Some(index) = context.tasks.iter().position(|task| task.id == task_id) {
            context.tasks[index] = updated.clone();
        }
        Ok(self.enrich_task(updated, &context.tasks))
    }

    pub fn task_delete(&self, repo_path: &str, task_id: &str, delete_subtasks: bool) -> Result<()> {
        let context = self.load_task_context(repo_path, task_id)?;
        let direct_subtask_ids = context
            .repo
            .tasks
            .iter()
            .filter(|entry| entry.parent_id.as_deref() == Some(task_id))
            .map(|entry| entry.id.clone())
            .collect::<Vec<_>>();

        if !direct_subtask_ids.is_empty() && !delete_subtasks {
            return Err(anyhow!(
                "Task {task_id} has {} subtasks. Confirm subtask deletion to continue.",
                direct_subtask_ids.len()
            ));
        }

        let target_tasks =
            collect_task_delete_targets(&context.repo.tasks, task_id, delete_subtasks);
        let target_task_ids = target_tasks
            .iter()
            .map(|task| task.id.as_str())
            .collect::<Vec<_>>();
        self.ensure_no_active_task_delete_runs(context.repo.repo_path.as_str(), &target_task_ids)?;
        let normalized_repo = normalize_path_for_comparison(context.repo.repo_path.as_str());
        let branch_prefix = self
            .config_store
            .repo_config(&context.repo.repo_path)?
            .branch_prefix;
        let mut removable_worktrees = Vec::new();
        let mut seen_worktree_keys = HashSet::new();

        for target_task in target_tasks {
            let sessions =
                self.agent_sessions_list(context.repo.repo_path.as_str(), target_task.id.as_str())?;
            for session in sessions {
                let worktree_path = session.working_directory.trim();
                if !is_managed_worktree_session(&session, &normalized_repo, worktree_path) {
                    continue;
                }
                let worktree_key = normalize_path_key(worktree_path);
                if !seen_worktree_keys.insert(worktree_key) {
                    continue;
                }

                if Path::new(worktree_path).exists() {
                    removable_worktrees.push(worktree_path.to_string());
                }
            }
        }

        let related_local_branches = self
            .git_port
            .get_branches(context.repo_dir())?
            .into_iter()
            .filter(|branch| !branch.is_remote)
            .filter(|branch| {
                target_task_ids.iter().any(|task_id| {
                    is_related_task_branch(branch.name.as_str(), branch_prefix.as_str(), task_id)
                })
            })
            .map(|branch| branch.name)
            .collect::<HashSet<_>>();

        for worktree_path in &removable_worktrees {
            self.git_remove_worktree(context.repo.repo_path.as_str(), worktree_path, true)
                .with_context(|| format!("Failed to remove task worktree {worktree_path}"))?;
        }

        for branch_name in related_local_branches {
            self.git_delete_local_branch(
                context.repo.repo_path.as_str(),
                branch_name.as_str(),
                true,
            )
            .with_context(|| format!("Failed to delete related local branch {branch_name}"))?;
        }

        self.task_store
            .delete_task(context.repo_dir(), task_id, delete_subtasks)
            .with_context(|| format!("Failed to delete task {task_id}"))?;
        Ok(())
    }

    pub fn task_reset_implementation(&self, repo_path: &str, task_id: &str) -> Result<TaskCard> {
        let mut context = self.load_task_context(repo_path, task_id)?;
        ensure_task_reset_status_allowed(&context.task)?;

        let sessions = self.agent_sessions_list(context.repo.repo_path.as_str(), task_id)?;
        self.ensure_no_active_task_reset_runs(context.repo.repo_path.as_str(), task_id, &sessions)?;

        let rollback_status = derive_reset_implementation_status(&context.task);
        let branch_prefix = self
            .config_store
            .repo_config(&context.repo.repo_path)?
            .branch_prefix;
        let related_local_branches = collect_related_task_branches(
            self,
            context.repo_dir(),
            branch_prefix.as_str(),
            task_id,
        )?;
        ensure_related_reset_branches_are_deletable(
            self,
            context.repo_dir(),
            &related_local_branches,
        )?;
        let removable_worktrees = collect_managed_task_worktree_paths(
            self,
            context.repo.repo_path.as_str(),
            task_id,
            branch_prefix.as_str(),
            &sessions,
            true,
        )?;
        let mut removed_worktrees = Vec::new();
        let mut deleted_branches = Vec::new();

        for worktree_path in &removable_worktrees {
            if let Err(error) = self
                .git_remove_worktree(context.repo.repo_path.as_str(), worktree_path, true)
                .with_context(|| {
                    format!("Failed to remove implementation worktree {worktree_path}")
                })
            {
                return Err(with_reset_cleanup_progress(
                    error,
                    &removed_worktrees,
                    &deleted_branches,
                ));
            }
            removed_worktrees.push(worktree_path.clone());
        }

        for branch_name in &related_local_branches {
            if let Err(error) = self
                .git_delete_local_branch(
                    context.repo.repo_path.as_str(),
                    branch_name.as_str(),
                    true,
                )
                .with_context(|| format!("Failed to delete implementation branch {branch_name}"))
            {
                return Err(with_reset_cleanup_progress(
                    error,
                    &removed_worktrees,
                    &deleted_branches,
                ));
            }
            deleted_branches.push(branch_name.clone());
        }

        self.task_store
            .clear_agent_sessions_by_roles(context.repo_dir(), task_id, &["build", "qa"])
            .with_context(|| format!("Failed to clear builder and QA sessions for {task_id}"))?;
        self.task_store
            .clear_qa_reports(context.repo_dir(), task_id)
            .with_context(|| format!("Failed to clear QA reports for {task_id}"))?;
        self.task_store
            .set_pull_request(context.repo_dir(), task_id, None)
            .with_context(|| format!("Failed to clear linked pull request for {task_id}"))?;
        self.task_store
            .set_direct_merge_record(context.repo_dir(), task_id, None)
            .with_context(|| format!("Failed to clear direct merge metadata for {task_id}"))?;

        let updated = self
            .task_store
            .update_task(
                context.repo_dir(),
                task_id,
                UpdateTaskPatch {
                    title: None,
                    description: None,
                    notes: None,
                    status: Some(rollback_status),
                    priority: None,
                    issue_type: None,
                    ai_review_enabled: None,
                    labels: None,
                    assignee: None,
                    parent_id: None,
                },
            )
            .with_context(|| format!("Failed to reset implementation for {task_id}"))?;

        if let Some(index) = context
            .repo
            .tasks
            .iter()
            .position(|entry| entry.id == task_id)
        {
            context.repo.tasks[index] = updated.clone();
        }

        Ok(self.enrich_task(updated, &context.repo.tasks))
    }

    fn ensure_no_active_task_delete_runs(&self, repo_path: &str, task_ids: &[&str]) -> Result<()> {
        let normalized_repo = normalize_path_for_comparison(repo_path);
        let runs = self
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?;
        let active_task_ids = runs
            .values()
            .filter(|run| normalize_path_for_comparison(run.repo_path.as_str()) == normalized_repo)
            .filter(|run| task_ids.iter().any(|task_id| *task_id == run.task_id))
            .filter(|run| {
                matches!(
                    run.summary.state,
                    RunState::Starting
                        | RunState::Running
                        | RunState::Blocked
                        | RunState::AwaitingDoneConfirmation
                )
            })
            .map(|run| run.task_id.clone())
            .collect::<HashSet<_>>();

        if active_task_ids.is_empty() {
            return Ok(());
        }

        let active_summary = active_task_ids.into_iter().collect::<Vec<_>>().join(", ");
        Err(anyhow!(
            "Cannot delete tasks with active builder work in progress. Stop the active run(s) first: {active_summary}"
        ))
    }

    fn ensure_no_active_task_reset_runs(
        &self,
        repo_path: &str,
        task_id: &str,
        sessions: &[AgentSessionDocument],
    ) -> Result<()> {
        let normalized_repo = normalize_path_for_comparison(repo_path);
        let runs = self
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?;
        let has_active_run = runs.values().any(|run| {
            normalize_path_for_comparison(run.repo_path.as_str()) == normalized_repo
                && run.task_id == task_id
                && matches!(
                    run.summary.state,
                    RunState::Starting
                        | RunState::Running
                        | RunState::Blocked
                        | RunState::AwaitingDoneConfirmation
                )
        });
        drop(runs);

        if has_active_run {
            return Err(anyhow!(
                "Cannot reset implementation while builder work is active for task {task_id}. Stop the active run first."
            ));
        }

        let active_runtime_roles = collect_active_runtime_roles_for_task(self, repo_path, task_id)
            .with_context(|| {
                format!("Failed checking live runtime state before resetting {task_id}")
            })?;
        if !active_runtime_roles.is_empty() {
            return Err(anyhow!(
                "Cannot reset implementation while active {} session(s) exist for task {task_id}. Stop the active session(s) first.",
                active_runtime_roles.join("/")
            ));
        }

        let active_roles = sessions
            .iter()
            .filter(|session| matches!(session.role.as_str(), "build" | "qa"))
            .filter(|session| {
                matches!(
                    session.status.as_deref(),
                    Some("starting") | Some("running")
                )
            })
            .map(|session| session.role.as_str())
            .collect::<HashSet<_>>();
        if active_roles.is_empty() {
            return Ok(());
        }

        let mut roles = active_roles.into_iter().collect::<Vec<_>>();
        roles.sort_unstable();
        Err(anyhow!(
            "Cannot reset implementation while active {} session(s) exist for task {task_id}. Stop the active session(s) first.",
            roles.join("/")
        ))
    }

    pub fn task_transition(
        &self,
        repo_path: &str,
        task_id: &str,
        target_status: TaskStatus,
        _reason: Option<&str>,
    ) -> Result<TaskCard> {
        let mut context = self.load_task_context(repo_path, task_id)?;

        validate_transition(
            &context.task,
            &context.repo.tasks,
            &context.task.status,
            &target_status,
        )?;

        if context.task.status == target_status {
            return Ok(self.enrich_task(context.task, &context.repo.tasks));
        }

        let updated = self.task_store.update_task(
            context.repo_dir(),
            task_id,
            UpdateTaskPatch {
                title: None,
                description: None,
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

        if let Some(index) = context
            .repo
            .tasks
            .iter()
            .position(|entry| entry.id == task_id)
        {
            context.repo.tasks[index] = updated.clone();
        }

        Ok(self.enrich_task(updated, &context.repo.tasks))
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
        let context = self.load_task_context(repo_path, task_id)?;
        let should_return_to_ai_review = context.task.ai_review_enabled
            && context.task.document_summary.qa_report.verdict != QaWorkflowVerdict::Approved;
        let next_status = if should_return_to_ai_review {
            TaskStatus::AiReview
        } else {
            TaskStatus::HumanReview
        };

        self.task_transition(
            context.repo.repo_path.as_str(),
            task_id,
            next_status,
            Some("Builder completed"),
        )
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
        let context = self.load_task_context(repo_path, task_id)?;

        if context.task.parent_id.is_some() {
            return Err(anyhow!("Subtasks cannot be deferred."));
        }

        if !is_open_state(&context.task.status) {
            return Err(anyhow!("Only non-closed open-state tasks can be deferred."));
        }

        self.task_transition(
            context.repo.repo_path.as_str(),
            task_id,
            TaskStatus::Deferred,
            Some("Deferred by user"),
        )
    }

    pub fn task_resume_deferred(&self, repo_path: &str, task_id: &str) -> Result<TaskCard> {
        let context = self.load_task_context(repo_path, task_id)?;
        if context.task.status != TaskStatus::Deferred {
            return Err(anyhow!("Task is not deferred: {task_id}"));
        }

        self.task_transition(
            context.repo.repo_path.as_str(),
            task_id,
            TaskStatus::Open,
            Some("Deferred task resumed"),
        )
    }

    pub fn task_metadata_get(&self, repo_path: &str, task_id: &str) -> Result<TaskMetadata> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        self.task_store
            .get_task_metadata(std::path::Path::new(&repo_path), task_id)
            .with_context(|| format!("Failed to load task metadata for {task_id}"))
    }
}

fn collect_task_delete_targets<'a>(
    tasks: &'a [TaskCard],
    task_id: &str,
    delete_subtasks: bool,
) -> Vec<&'a TaskCard> {
    let mut target_ids = HashSet::from([task_id.to_string()]);
    if delete_subtasks {
        loop {
            let previous_len = target_ids.len();
            for task in tasks {
                if task
                    .parent_id
                    .as_deref()
                    .is_some_and(|parent_id| target_ids.contains(parent_id))
                {
                    target_ids.insert(task.id.clone());
                }
            }
            if target_ids.len() == previous_len {
                break;
            }
        }
    }

    tasks
        .iter()
        .filter(|task| target_ids.contains(task.id.as_str()))
        .collect()
}

fn derive_reset_implementation_status(task: &TaskCard) -> TaskStatus {
    if task.document_summary.plan.has {
        return TaskStatus::ReadyForDev;
    }
    if task.document_summary.spec.has {
        return TaskStatus::SpecReady;
    }
    TaskStatus::Open
}

fn normalize_path_for_comparison(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return PathBuf::new();
    }

    fs::canonicalize(trimmed).unwrap_or_else(|_| {
        let without_trailing_separators = trimmed.trim_end_matches(['/', '\\']);
        if without_trailing_separators.is_empty() {
            PathBuf::from(trimmed)
        } else {
            PathBuf::from(without_trailing_separators)
        }
    })
}

fn normalize_path_key(path: &str) -> String {
    normalize_path_for_comparison(path)
        .to_string_lossy()
        .to_string()
}

fn collect_managed_task_worktree_paths(
    service: &AppService,
    repo_path: &str,
    task_id: &str,
    branch_prefix: &str,
    sessions: &[AgentSessionDocument],
    require_existing_path: bool,
) -> Result<Vec<String>> {
    let mut removable_worktrees = Vec::new();
    let mut seen_worktree_keys = HashSet::new();
    let normalized_repo = normalize_path_for_comparison(repo_path);
    let managed_worktree_base = resolve_effective_worktree_base_path(service, repo_path)?
        .map(|path| normalize_path_for_comparison(path.as_str()));

    let Some(managed_worktree_base) = managed_worktree_base else {
        return Ok(removable_worktrees);
    };
    let scope = ManagedTaskWorktreeScope {
        task_id,
        branch_prefix,
        normalized_repo: normalized_repo.as_path(),
        managed_worktree_base: managed_worktree_base.as_path(),
        require_existing_path,
    };

    for session in sessions {
        let worktree_path = session.working_directory.trim();
        if !is_managed_task_worktree_session(service, &scope, session, worktree_path)? {
            continue;
        }
        let worktree_key = normalize_path_key(worktree_path);
        if !seen_worktree_keys.insert(worktree_key) {
            continue;
        }

        removable_worktrees.push(worktree_path.to_string());
    }

    Ok(removable_worktrees)
}

struct ManagedTaskWorktreeScope<'a> {
    task_id: &'a str,
    branch_prefix: &'a str,
    normalized_repo: &'a Path,
    managed_worktree_base: &'a Path,
    require_existing_path: bool,
}

fn is_managed_worktree_session(
    session: &AgentSessionDocument,
    normalized_repo: &Path,
    working_directory: &str,
) -> bool {
    matches!(session.role.as_str(), "build" | "qa")
        && !working_directory.is_empty()
        && normalize_path_for_comparison(working_directory) != normalized_repo
}

fn is_managed_task_worktree_session(
    service: &AppService,
    scope: &ManagedTaskWorktreeScope<'_>,
    session: &AgentSessionDocument,
    working_directory: &str,
) -> Result<bool> {
    if !matches!(session.role.as_str(), "build" | "qa") || working_directory.is_empty() {
        return Ok(false);
    }

    let normalized_worktree = normalize_path_for_comparison(working_directory);
    if normalized_worktree == scope.normalized_repo
        || !normalized_worktree.starts_with(scope.managed_worktree_base)
    {
        return Ok(false);
    }

    if scope.require_existing_path && !Path::new(working_directory).exists() {
        return Ok(false);
    }

    let current_branch = service
        .git_port
        .get_current_branch(Path::new(working_directory))
        .with_context(|| {
            format!("Failed to inspect implementation worktree branch for {working_directory}")
        })?;
    let branch_name = current_branch
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            anyhow!(
                "Cannot reset implementation for task {} because worktree {working_directory} is detached or has no active branch.",
                scope.task_id
            )
        })?;

    Ok(is_related_task_branch(
        branch_name,
        scope.branch_prefix,
        scope.task_id,
    ))
}

fn is_related_task_branch(branch_name: &str, branch_prefix: &str, task_id: &str) -> bool {
    let clean_prefix = if branch_prefix.trim().is_empty() {
        "obp"
    } else {
        branch_prefix.trim()
    };
    let task_prefix = format!("{clean_prefix}/{task_id}");
    branch_name == task_prefix || branch_name.starts_with(&format!("{task_prefix}-"))
}

fn ensure_task_reset_status_allowed(task: &TaskCard) -> Result<()> {
    if matches!(
        task.status,
        TaskStatus::InProgress | TaskStatus::AiReview | TaskStatus::HumanReview
    ) {
        return Ok(());
    }

    Err(anyhow!(
        "Implementation reset is only allowed from in_progress, ai_review, or human_review (current: {}).",
        task.status.as_cli_value()
    ))
}

fn collect_related_task_branches(
    service: &AppService,
    repo_path: &Path,
    branch_prefix: &str,
    task_id: &str,
) -> Result<HashSet<String>> {
    Ok(service
        .git_port
        .get_branches(repo_path)?
        .into_iter()
        .filter(|branch| !branch.is_remote)
        .filter(|branch| is_related_task_branch(branch.name.as_str(), branch_prefix, task_id))
        .map(|branch| branch.name)
        .collect())
}

fn resolve_effective_worktree_base_path(
    service: &AppService,
    repo_path: &str,
) -> Result<Option<String>> {
    let normalized_repo = normalize_path_for_comparison(repo_path);
    Ok(service
        .workspace_list()?
        .into_iter()
        .find(|workspace| normalize_path_for_comparison(workspace.path.as_str()) == normalized_repo)
        .and_then(|workspace| workspace.effective_worktree_base_path))
}

fn ensure_related_reset_branches_are_deletable(
    service: &AppService,
    repo_path: &Path,
    related_local_branches: &HashSet<String>,
) -> Result<()> {
    let current_branch = service.git_port.get_current_branch(repo_path)?;
    let Some(current_branch_name) = current_branch
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };

    if related_local_branches.contains(current_branch_name) {
        return Err(anyhow!(
            "Cannot reset implementation while branch {current_branch_name} is checked out. Switch branches first."
        ));
    }

    Ok(())
}

fn with_reset_cleanup_progress(
    error: anyhow::Error,
    removed_worktrees: &[String],
    deleted_branches: &[String],
) -> anyhow::Error {
    let mut progress = Vec::new();
    if !removed_worktrees.is_empty() {
        progress.push(format!(
            "Reset cleanup already removed worktrees: {}.",
            removed_worktrees.join(", ")
        ));
    }
    if !deleted_branches.is_empty() {
        progress.push(format!(
            "Reset cleanup already deleted branches: {}.",
            deleted_branches.join(", ")
        ));
    }
    if progress.is_empty() {
        return error;
    }

    progress.push("Retry reset to finish cleanup safely.".to_string());
    error.context(progress.join("\n"))
}

fn collect_active_runtime_roles_for_task(
    service: &AppService,
    repo_path: &str,
    task_id: &str,
) -> Result<Vec<&'static str>> {
    let normalized_repo = normalize_path_for_comparison(repo_path);
    let mut runtimes = service
        .agent_runtimes
        .lock()
        .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
    let mut active_roles = HashSet::new();

    for runtime in runtimes.values_mut() {
        if normalize_path_for_comparison(runtime.summary.repo_path.as_str()) != normalized_repo {
            continue;
        }
        if runtime.summary.task_id.as_deref() != Some(task_id) {
            continue;
        }
        match runtime.summary.role {
            RuntimeRole::Build | RuntimeRole::Qa => {}
            _ => continue,
        }

        match runtime.child.try_wait() {
            Ok(Some(_)) => continue,
            Ok(None) => {
                active_roles.insert(runtime.summary.role.as_str());
            }
            Err(error) => {
                return Err(anyhow!(
                    "Failed checking runtime {} for task {task_id}: {error}",
                    runtime.summary.runtime_id
                ));
            }
        }
    }

    let mut roles = active_roles.into_iter().collect::<Vec<_>>();
    roles.sort_unstable();
    Ok(roles)
}
