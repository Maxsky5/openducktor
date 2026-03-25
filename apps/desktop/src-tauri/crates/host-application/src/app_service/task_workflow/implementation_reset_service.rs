use super::{
    lifecycle_support::{
        derive_reset_implementation_status, ensure_task_reset_status_allowed,
        with_reset_cleanup_progress, BranchCleanupPlan, TaskActivityGuard, WorktreeCleanupPlan,
    },
    task_context::LoadedTaskContext,
};
use crate::app_service::service_core::AppService;
use anyhow::{Context, Result};
use host_domain::{TaskCard, UpdateTaskPatch};

pub(super) struct ImplementationResetService<'a> {
    service: &'a AppService,
}

impl<'a> ImplementationResetService<'a> {
    pub(super) fn new(service: &'a AppService) -> Self {
        Self { service }
    }

    pub(super) fn reset(&self, repo_path: &str, task_id: &str) -> Result<TaskCard> {
        let context = self.service.load_task_context(repo_path, task_id)?;
        self.reset_loaded(context)
    }

    fn reset_loaded(&self, mut context: LoadedTaskContext) -> Result<TaskCard> {
        let task_id = context.task.id.clone();
        ensure_task_reset_status_allowed(&context.task)?;

        let sessions = self
            .service
            .agent_sessions_list(context.repo.repo_path.as_str(), task_id.as_str())?;
        TaskActivityGuard::new(self.service).ensure_no_active_task_reset_runs(
            context.repo.repo_path.as_str(),
            task_id.as_str(),
            &sessions,
        )?;

        let rollback_status = derive_reset_implementation_status(&context.task);
        let branch_prefix = self
            .service
            .config_store
            .repo_config(&context.repo.repo_path)?
            .branch_prefix;
        let branch_plan = BranchCleanupPlan::for_task(
            self.service,
            context.repo_dir(),
            branch_prefix.as_str(),
            task_id.as_str(),
        )?;
        let worktree_plan = WorktreeCleanupPlan::for_task_sessions(
            self.service,
            context.repo.repo_path.as_str(),
            task_id.as_str(),
            branch_prefix.as_str(),
            &sessions,
            true,
        )?;

        self.service
            .stop_dev_servers_for_task(context.repo.repo_path.as_str(), task_id.as_str())?;
        let mut removed_worktrees = Vec::new();
        let mut deleted_branches = Vec::new();

        for worktree_path in worktree_plan.paths() {
            if let Err(error) = self
                .service
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

        if let Err(error) = branch_plan.ensure_unused_by_worktrees(self.service, context.repo_dir())
        {
            return Err(with_reset_cleanup_progress(
                error,
                &removed_worktrees,
                &deleted_branches,
            ));
        }

        for branch_name in branch_plan.names() {
            if let Err(error) = self
                .service
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

        self.service
            .task_store
            .clear_agent_sessions_by_roles(context.repo_dir(), task_id.as_str(), &["build", "qa"])
            .with_context(|| format!("Failed to clear builder and QA sessions for {task_id}"))
            .map_err(|error| {
                with_reset_cleanup_progress(error, &removed_worktrees, &deleted_branches)
            })?;
        self.service
            .task_store
            .clear_qa_reports(context.repo_dir(), task_id.as_str())
            .with_context(|| format!("Failed to clear QA reports for {task_id}"))
            .map_err(|error| {
                with_reset_cleanup_progress(error, &removed_worktrees, &deleted_branches)
            })?;
        self.service
            .task_store
            .set_pull_request(context.repo_dir(), task_id.as_str(), None)
            .with_context(|| format!("Failed to clear linked pull request for {task_id}"))
            .map_err(|error| {
                with_reset_cleanup_progress(error, &removed_worktrees, &deleted_branches)
            })?;
        self.service
            .task_store
            .set_direct_merge_record(context.repo_dir(), task_id.as_str(), None)
            .with_context(|| format!("Failed to clear direct merge metadata for {task_id}"))
            .map_err(|error| {
                with_reset_cleanup_progress(error, &removed_worktrees, &deleted_branches)
            })?;

        let updated = self
            .service
            .task_store
            .update_task(
                context.repo_dir(),
                task_id.as_str(),
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
            .with_context(|| format!("Failed to reset implementation for {task_id}"))
            .map_err(|error| {
                with_reset_cleanup_progress(error, &removed_worktrees, &deleted_branches)
            })?;

        if let Some(index) = context
            .repo
            .tasks
            .iter()
            .position(|entry| entry.id == task_id)
        {
            context.repo.tasks[index] = updated.clone();
        }

        self.service
            .clear_task_runs(context.repo.repo_path.as_str(), task_id.as_str())?;

        Ok(self.service.enrich_task(updated, &context.repo.tasks))
    }
}
