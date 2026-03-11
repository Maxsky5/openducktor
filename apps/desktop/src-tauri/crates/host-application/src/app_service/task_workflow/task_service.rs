use crate::app_service::service_core::AppService;
use crate::app_service::workflow_rules::{
    default_qa_required_for_issue_type, is_open_state, validate_parent_relationships_for_create,
    validate_parent_relationships_for_update, validate_transition,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{
    AgentSessionDocument, CreateTaskInput, QaWorkflowVerdict, TaskCard, TaskMetadata, TaskStatus,
    UpdateTaskPatch,
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

fn is_managed_worktree_session(
    session: &AgentSessionDocument,
    normalized_repo: &Path,
    working_directory: &str,
) -> bool {
    matches!(session.role.as_str(), "build" | "qa")
        && !working_directory.is_empty()
        && normalize_path_for_comparison(working_directory) != normalized_repo
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
