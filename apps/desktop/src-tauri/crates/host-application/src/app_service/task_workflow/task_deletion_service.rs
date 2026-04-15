use super::{
    cleanup_plans::{
        collect_task_delete_targets, with_delete_cleanup_progress, BranchCleanupPlan,
        WorktreeCleanupPlan,
    },
    task_activity_guard::TaskActivityGuard,
    task_context::LoadedTaskContext,
};
use crate::app_service::service_core::AppService;
use anyhow::{anyhow, Context, Result};

pub(super) struct TaskDeletionService<'a> {
    service: &'a AppService,
}

impl<'a> TaskDeletionService<'a> {
    pub(super) fn new(service: &'a AppService) -> Self {
        Self { service }
    }

    pub(super) fn delete(
        &self,
        repo_path: &str,
        task_id: &str,
        delete_subtasks: bool,
    ) -> Result<()> {
        let context = self.service.load_task_context(repo_path, task_id)?;
        self.delete_loaded(context, delete_subtasks)
    }

    fn delete_loaded(&self, context: LoadedTaskContext, delete_subtasks: bool) -> Result<()> {
        let deletion_plan = self.build_deletion_plan(&context, delete_subtasks)?;
        let mut cleanup_progress = DeleteCleanupProgress::default();

        self.execute_cleanup(&context, &deletion_plan, &mut cleanup_progress)?;
        self.delete_tasks_and_clear_runs(&context, &deletion_plan, &cleanup_progress)
    }

    fn build_deletion_plan(
        &self,
        context: &LoadedTaskContext,
        delete_subtasks: bool,
    ) -> Result<TaskDeletionPlan> {
        let task_id = context.task.id.as_str();
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
            .map(|task| task.id.clone())
            .collect::<Vec<_>>();
        let target_task_id_refs = target_task_ids
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        TaskActivityGuard::new(self.service).ensure_no_active_task_delete_runs(
            context.repo.repo_path.as_str(),
            &target_task_id_refs,
        )?;
        let branch_prefix = self
            .service
            .workspace_get_repo_config_by_repo_path(&context.repo.repo_path)?
            .branch_prefix;
        let worktree_plan = WorktreeCleanupPlan::for_delete_targets(
            self.service,
            context.repo.repo_path.as_str(),
            branch_prefix.as_str(),
            &target_tasks,
        )?;
        let branch_plan = BranchCleanupPlan::for_task_ids(
            self.service,
            context.repo_dir(),
            branch_prefix.as_str(),
            &target_task_ids,
        )?;

        Ok(TaskDeletionPlan {
            target_task_ids,
            delete_subtasks,
            worktree_plan,
            branch_plan,
        })
    }

    fn execute_cleanup(
        &self,
        context: &LoadedTaskContext,
        deletion_plan: &TaskDeletionPlan,
        cleanup_progress: &mut DeleteCleanupProgress,
    ) -> Result<()> {
        for target_task_id in &deletion_plan.target_task_ids {
            self.service
                .stop_dev_servers_for_task(context.repo.repo_path.as_str(), target_task_id)?;
        }

        for worktree_path in deletion_plan.worktree_plan.paths() {
            if let Err(error) = self
                .service
                .git_remove_worktree(context.repo.repo_path.as_str(), worktree_path, true)
                .with_context(|| format!("Failed to remove task worktree {worktree_path}"))
            {
                return Err(with_delete_cleanup_progress(
                    error,
                    &cleanup_progress.removed_worktrees,
                    &cleanup_progress.deleted_branches,
                ));
            }
            cleanup_progress
                .removed_worktrees
                .push(worktree_path.clone());
        }

        if let Err(error) = deletion_plan
            .branch_plan
            .ensure_unused_by_worktrees(self.service, context.repo_dir())
        {
            return Err(with_delete_cleanup_progress(
                error,
                &cleanup_progress.removed_worktrees,
                &cleanup_progress.deleted_branches,
            ));
        }

        for branch_name in deletion_plan.branch_plan.names() {
            if let Err(error) = self
                .service
                .git_delete_local_branch(
                    context.repo.repo_path.as_str(),
                    branch_name.as_str(),
                    true,
                )
                .with_context(|| format!("Failed to delete related local branch {branch_name}"))
            {
                return Err(with_delete_cleanup_progress(
                    error,
                    &cleanup_progress.removed_worktrees,
                    &cleanup_progress.deleted_branches,
                ));
            }
            cleanup_progress.deleted_branches.push(branch_name.clone());
        }

        Ok(())
    }

    fn delete_tasks_and_clear_runs(
        &self,
        context: &LoadedTaskContext,
        deletion_plan: &TaskDeletionPlan,
        cleanup_progress: &DeleteCleanupProgress,
    ) -> Result<()> {
        let task_id = context.task.id.as_str();
        self.service
            .task_store
            .delete_task(context.repo_dir(), task_id, deletion_plan.delete_subtasks)
            .with_context(|| format!("Failed to delete task {task_id}"))
            .map_err(|error| {
                with_delete_cleanup_progress(
                    error,
                    &cleanup_progress.removed_worktrees,
                    &cleanup_progress.deleted_branches,
                )
            })?;
        for target_task_id in &deletion_plan.target_task_ids {
            self.service
                .clear_task_runs(context.repo.repo_path.as_str(), target_task_id)
                .with_context(|| {
                    format!("Failed to clear run state for deleted task {target_task_id}")
                })
                .map_err(|error| {
                    with_delete_cleanup_progress(
                        error,
                        &cleanup_progress.removed_worktrees,
                        &cleanup_progress.deleted_branches,
                    )
                })?;
        }
        Ok(())
    }
}

struct TaskDeletionPlan {
    target_task_ids: Vec<String>,
    delete_subtasks: bool,
    worktree_plan: WorktreeCleanupPlan,
    branch_plan: BranchCleanupPlan,
}

#[derive(Default)]
struct DeleteCleanupProgress {
    removed_worktrees: Vec<String>,
    deleted_branches: Vec<String>,
}
