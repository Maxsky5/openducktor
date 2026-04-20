use super::{
    cleanup_plans::{
        ensure_task_full_reset_status_allowed, with_task_reset_cleanup_progress, BranchCleanupPlan,
        WorktreeCleanupPlan, WorktreeCleanupSessionOptions, TASK_RESET_SESSION_ROLES,
    },
    task_activity_guard::TaskActivityGuard,
    task_context::LoadedTaskContext,
};
use crate::app_service::service_core::AppService;
use anyhow::{Context, Result};
use host_domain::{TaskCard, TaskStatus, UpdateTaskPatch};

pub(super) struct TaskResetService<'a> {
    service: &'a AppService,
}

impl<'a> TaskResetService<'a> {
    pub(super) fn new(service: &'a AppService) -> Self {
        Self { service }
    }

    pub(super) fn reset(&self, repo_path: &str, task_id: &str) -> Result<TaskCard> {
        let context = self.service.load_task_context(repo_path, task_id)?;
        self.reset_loaded(context)
    }

    fn reset_loaded(&self, mut context: LoadedTaskContext) -> Result<TaskCard> {
        let task_id = context.task.id.clone();
        ensure_task_full_reset_status_allowed(&context.task)?;

        let reset_plan = self.build_reset_plan(&context)?;
        let mut cleanup_progress = TaskResetCleanupProgress::default();

        self.execute_cleanup(&context, &reset_plan, &mut cleanup_progress)?;
        self.clear_reset_artifacts(context.repo_dir(), task_id.as_str(), &mut cleanup_progress)?;
        let updated =
            self.apply_reset_status(context.repo_dir(), task_id.as_str(), &cleanup_progress)?;

        if let Some(index) = context
            .repo
            .tasks
            .iter()
            .position(|entry| entry.id == task_id)
        {
            context.repo.tasks[index] = updated.clone();
        }

        Ok(self.service.enrich_task(updated, &context.repo.tasks))
    }

    fn build_reset_plan(&self, context: &LoadedTaskContext) -> Result<TaskResetPlan> {
        let task_id = context.task.id.as_str();
        let sessions = self
            .service
            .agent_sessions_list(context.repo.repo_path.as_str(), task_id)?;
        TaskActivityGuard::new(self.service).ensure_no_active_task_reset_activity(
            context.repo.repo_path.as_str(),
            task_id,
            &sessions,
            "reset task",
            TASK_RESET_SESSION_ROLES,
        )?;
        let branch_prefix = self
            .service
            .workspace_get_repo_config_by_repo_path(&context.repo.repo_path)?
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
                session_roles: TASK_RESET_SESSION_ROLES,
                operation_label: "reset task",
                skip_detached_head: false,
            },
        )?;

        Ok(TaskResetPlan {
            branch_plan,
            worktree_plan,
        })
    }

    fn execute_cleanup(
        &self,
        context: &LoadedTaskContext,
        reset_plan: &TaskResetPlan,
        cleanup_progress: &mut TaskResetCleanupProgress,
    ) -> Result<()> {
        let task_id = context.task.id.as_str();
        self.service
            .stop_dev_servers_for_task(context.repo.repo_path.as_str(), task_id)?;

        for worktree_path in reset_plan.worktree_plan.paths() {
            if let Err(error) = self
                .service
                .git_remove_worktree(context.repo.repo_path.as_str(), worktree_path, true)
                .with_context(|| format!("Failed to remove task worktree {worktree_path}"))
            {
                return Err(cleanup_progress.wrap(error));
            }
            cleanup_progress
                .removed_worktrees
                .push(worktree_path.clone());
        }

        if let Err(error) = reset_plan
            .branch_plan
            .ensure_unused_by_worktrees(self.service, context.repo_dir())
        {
            return Err(cleanup_progress.wrap(error));
        }

        for branch_name in reset_plan.branch_plan.names() {
            if let Err(error) = self
                .service
                .git_delete_local_branch(
                    context.repo.repo_path.as_str(),
                    branch_name.as_str(),
                    true,
                )
                .with_context(|| format!("Failed to delete related local branch {branch_name}"))
            {
                return Err(cleanup_progress.wrap(error));
            }
            cleanup_progress.deleted_branches.push(branch_name.clone());
        }

        Ok(())
    }

    fn clear_reset_artifacts(
        &self,
        repo_dir: &std::path::Path,
        task_id: &str,
        cleanup_progress: &mut TaskResetCleanupProgress,
    ) -> Result<()> {
        self.service
            .task_store
            .clear_workflow_documents(repo_dir, task_id)
            .with_context(|| format!("Failed to clear workflow documents for {task_id}"))
            .map_err(|error| cleanup_progress.wrap(error))?;
        cleanup_progress
            .completed_steps
            .push("cleared workflow documents");

        self.service
            .task_store
            .clear_agent_sessions_by_roles(repo_dir, task_id, TASK_RESET_SESSION_ROLES)
            .with_context(|| format!("Failed to clear linked agent sessions for {task_id}"))
            .map_err(|error| cleanup_progress.wrap(error))?;
        cleanup_progress
            .completed_steps
            .push("cleared linked agent sessions");

        self.service
            .task_store
            .set_delivery_metadata(repo_dir, task_id, None, None)
            .with_context(|| format!("Failed to clear delivery metadata for {task_id}"))
            .map_err(|error| cleanup_progress.wrap(error))?;
        cleanup_progress
            .completed_steps
            .push("cleared linked delivery metadata");

        Ok(())
    }

    fn apply_reset_status(
        &self,
        repo_dir: &std::path::Path,
        task_id: &str,
        cleanup_progress: &TaskResetCleanupProgress,
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
                    status: Some(TaskStatus::Open),
                    priority: None,
                    issue_type: None,
                    ai_review_enabled: None,
                    labels: None,
                    assignee: None,
                    parent_id: None,
                    target_branch: None,
                },
            )
            .with_context(|| format!("Failed to reset task {task_id}"))
            .map_err(|error| cleanup_progress.wrap(error))
    }
}

struct TaskResetPlan {
    branch_plan: BranchCleanupPlan,
    worktree_plan: WorktreeCleanupPlan,
}

#[derive(Default)]
struct TaskResetCleanupProgress {
    removed_worktrees: Vec<String>,
    deleted_branches: Vec<String>,
    completed_steps: Vec<&'static str>,
}

impl TaskResetCleanupProgress {
    fn wrap(&self, error: anyhow::Error) -> anyhow::Error {
        with_task_reset_cleanup_progress(
            error,
            &self.removed_worktrees,
            &self.deleted_branches,
            &self.completed_steps,
        )
    }
}
