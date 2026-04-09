use super::{
    cleanup_plans::{
        derive_reset_implementation_status, ensure_task_reset_status_allowed,
        with_reset_cleanup_progress, BranchCleanupPlan, WorktreeCleanupPlan,
        WorktreeCleanupSessionOptions, IMPLEMENTATION_SESSION_ROLES,
    },
    task_activity_guard::TaskActivityGuard,
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

        let cleanup_plan = self.build_cleanup_plan(&context)?;
        let mut cleanup_progress = ResetCleanupProgress::default();

        self.execute_cleanup(&context, &cleanup_plan, &mut cleanup_progress)?;
        self.clear_reset_metadata(context.repo_dir(), task_id.as_str(), &cleanup_progress)?;
        let updated = self.apply_reset_status(
            context.repo_dir(),
            task_id.as_str(),
            cleanup_plan.rollback_status,
            &cleanup_progress,
        )?;

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

    fn build_cleanup_plan(&self, context: &LoadedTaskContext) -> Result<ImplementationResetPlan> {
        let task_id = context.task.id.as_str();
        let sessions = self
            .service
            .agent_sessions_list(context.repo.repo_path.as_str(), task_id)?;
        TaskActivityGuard::new(self.service).ensure_no_active_task_reset_activity(
            context.repo.repo_path.as_str(),
            task_id,
            &sessions,
            "reset implementation",
            IMPLEMENTATION_SESSION_ROLES,
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
            task_id,
        )?;
        let worktree_plan = WorktreeCleanupPlan::for_task_sessions(
            self.service,
            context.repo.repo_path.as_str(),
            task_id,
            branch_prefix.as_str(),
            &sessions,
            WorktreeCleanupSessionOptions {
                session_roles: IMPLEMENTATION_SESSION_ROLES,
                operation_label: "reset implementation",
                skip_detached_head: false,
            },
        )?;

        Ok(ImplementationResetPlan {
            rollback_status,
            branch_plan,
            worktree_plan,
        })
    }

    fn execute_cleanup(
        &self,
        context: &LoadedTaskContext,
        cleanup_plan: &ImplementationResetPlan,
        cleanup_progress: &mut ResetCleanupProgress,
    ) -> Result<()> {
        let task_id = context.task.id.as_str();
        self.service
            .stop_dev_servers_for_task(context.repo.repo_path.as_str(), task_id)?;

        for worktree_path in cleanup_plan.worktree_plan.paths() {
            if let Err(error) = self
                .service
                .git_remove_worktree(context.repo.repo_path.as_str(), worktree_path, true)
                .with_context(|| {
                    format!("Failed to remove implementation worktree {worktree_path}")
                })
            {
                return Err(with_reset_cleanup_progress(
                    error,
                    &cleanup_progress.removed_worktrees,
                    &cleanup_progress.deleted_branches,
                ));
            }
            cleanup_progress
                .removed_worktrees
                .push(worktree_path.clone());
        }

        if let Err(error) = cleanup_plan
            .branch_plan
            .ensure_unused_by_worktrees(self.service, context.repo_dir())
        {
            return Err(with_reset_cleanup_progress(
                error,
                &cleanup_progress.removed_worktrees,
                &cleanup_progress.deleted_branches,
            ));
        }

        for branch_name in cleanup_plan.branch_plan.names() {
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
                    &cleanup_progress.removed_worktrees,
                    &cleanup_progress.deleted_branches,
                ));
            }
            cleanup_progress.deleted_branches.push(branch_name.clone());
        }

        Ok(())
    }

    fn clear_reset_metadata(
        &self,
        repo_dir: &std::path::Path,
        task_id: &str,
        cleanup_progress: &ResetCleanupProgress,
    ) -> Result<()> {
        self.service
            .task_store
            .clear_agent_sessions_by_roles(repo_dir, task_id, &["build", "qa"])
            .with_context(|| format!("Failed to clear builder and QA sessions for {task_id}"))
            .map_err(|error| {
                with_reset_cleanup_progress(
                    error,
                    &cleanup_progress.removed_worktrees,
                    &cleanup_progress.deleted_branches,
                )
            })?;
        self.service
            .task_store
            .clear_qa_reports(repo_dir, task_id)
            .with_context(|| format!("Failed to clear QA reports for {task_id}"))
            .map_err(|error| {
                with_reset_cleanup_progress(
                    error,
                    &cleanup_progress.removed_worktrees,
                    &cleanup_progress.deleted_branches,
                )
            })?;
        self.service
            .task_store
            .set_delivery_metadata(repo_dir, task_id, None, None)
            .with_context(|| format!("Failed to clear delivery metadata for {task_id}"))
            .map_err(|error| {
                with_reset_cleanup_progress(
                    error,
                    &cleanup_progress.removed_worktrees,
                    &cleanup_progress.deleted_branches,
                )
            })?;

        Ok(())
    }

    fn apply_reset_status(
        &self,
        repo_dir: &std::path::Path,
        task_id: &str,
        rollback_status: host_domain::TaskStatus,
        cleanup_progress: &ResetCleanupProgress,
    ) -> Result<TaskCard> {
        self.service
            .task_store
            .update_task(
                repo_dir,
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
            .with_context(|| format!("Failed to reset implementation for {task_id}"))
            .map_err(|error| {
                with_reset_cleanup_progress(
                    error,
                    &cleanup_progress.removed_worktrees,
                    &cleanup_progress.deleted_branches,
                )
            })
    }
}

struct ImplementationResetPlan {
    rollback_status: host_domain::TaskStatus,
    branch_plan: BranchCleanupPlan,
    worktree_plan: WorktreeCleanupPlan,
}

#[derive(Default)]
struct ResetCleanupProgress {
    removed_worktrees: Vec<String>,
    deleted_branches: Vec<String>,
}
