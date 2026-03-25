use super::approval_context_service::ApprovalContextService;
use super::approval_support::{
    direct_merge_conflict, direct_merge_record, ensure_clean_builder_worktree,
};
use super::builder_cleanup_service::BuilderCleanupService;
use crate::app_service::service_core::AppService;
use anyhow::{anyhow, Result};
use host_domain::{
    DirectMergeRecord, GitMergeBranchRequest, GitMergeBranchResult, GitMergeMethod, TaskCard,
    TaskDirectMergeResult, TaskStatus,
};
use std::path::Path;

pub(super) struct DirectMergeWorkflowService<'a> {
    service: &'a AppService,
}

impl<'a> DirectMergeWorkflowService<'a> {
    pub(super) fn new(service: &'a AppService) -> Self {
        Self { service }
    }

    pub(super) fn task_direct_merge(
        &self,
        repo_path: &str,
        task_id: &str,
        method: GitMergeMethod,
        squash_commit_message: Option<String>,
    ) -> Result<TaskDirectMergeResult> {
        let metadata = self.service.task_metadata_get(repo_path, task_id)?;
        if metadata.direct_merge.is_some() {
            return Err(anyhow!(
                "A local direct merge is already recorded for task {task_id}. Finish the direct merge workflow before trying again."
            ));
        }
        let approval = ApprovalContextService::new(self.service)
            .load_open_task_approval_context(repo_path, task_id)?;
        ensure_clean_builder_worktree(&approval)?;
        let repo_path = self.service.resolve_task_repo_path(repo_path)?;
        match self.service.git_port.merge_branch(
            Path::new(&repo_path),
            GitMergeBranchRequest {
                source_branch: approval.source_branch.clone(),
                target_branch: approval.target_branch.canonical(),
                source_working_directory: approval.working_directory.clone(),
                method: method.clone(),
                squash_commit_message,
            },
        )? {
            GitMergeBranchResult::Merged { .. } => {}
            GitMergeBranchResult::UpToDate { .. } => {}
            GitMergeBranchResult::Conflicts {
                conflicted_files,
                output,
            } => {
                return Ok(TaskDirectMergeResult::Conflicts {
                    conflict: direct_merge_conflict(
                        repo_path.as_str(),
                        &approval,
                        &method,
                        conflicted_files,
                        output,
                    ),
                });
            }
        }

        self.service.task_store.set_delivery_metadata(
            Path::new(&repo_path),
            task_id,
            None,
            Some(direct_merge_record(method, &approval)),
        )?;

        if approval.publish_target.is_some() {
            let current_task = self
                .service
                .load_task_context(repo_path.as_str(), task_id)?
                .task;
            if current_task.status == TaskStatus::AiReview {
                return self
                    .service
                    .task_transition(
                        repo_path.as_str(),
                        task_id,
                        TaskStatus::HumanReview,
                        Some("Local direct merge applied"),
                    )
                    .map(|task| TaskDirectMergeResult::Completed {
                        task: Box::new(task),
                    });
            }
            return Ok(TaskDirectMergeResult::Completed {
                task: Box::new(current_task),
            });
        }

        let task = self.service.task_transition(
            repo_path.as_str(),
            task_id,
            TaskStatus::Closed,
            Some("Human approved via direct merge"),
        )?;
        BuilderCleanupService::new(self.service).finalize_direct_merge_cleanup(
            repo_path.as_str(),
            task_id,
            approval.source_branch.as_str(),
            approval.target_branch.checkout_branch().as_str(),
        )?;
        Ok(TaskDirectMergeResult::Completed {
            task: Box::new(task),
        })
    }

    pub(super) fn task_direct_merge_complete(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<TaskCard> {
        let context = self.service.load_task_context(repo_path, task_id)?;
        let direct_merge = self
            .service
            .task_metadata_get(context.repo.repo_path.as_str(), task_id)?
            .direct_merge
            .ok_or_else(|| {
                anyhow!("Task {task_id} does not have a locally applied direct merge to complete.")
            })?;
        let repo_path = self.service.resolve_task_repo_path(repo_path)?;
        self.ensure_direct_merge_publish_completed(repo_path.as_str(), task_id, &direct_merge)?;

        let task = if context.task.status == TaskStatus::Closed {
            context.task
        } else {
            self.service.task_transition(
                repo_path.as_str(),
                task_id,
                TaskStatus::Closed,
                Some("Human approved via direct merge"),
            )?
        };
        let cleanup = BuilderCleanupService::new(self.service);
        cleanup.finalize_direct_merge_cleanup(
            repo_path.as_str(),
            task_id,
            direct_merge.source_branch.as_str(),
            direct_merge.target_branch.checkout_branch().as_str(),
        )?;
        Ok(task)
    }

    fn ensure_direct_merge_publish_completed(
        &self,
        repo_path: &str,
        task_id: &str,
        direct_merge: &DirectMergeRecord,
    ) -> Result<()> {
        let Some(publish_target) = direct_merge.publish_target() else {
            return Ok(());
        };

        let current_branch = self
            .service
            .git_port
            .get_current_branch(Path::new(repo_path))?;
        let current_branch_name = current_branch
            .name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .ok_or_else(|| {
                anyhow!(
                    "Cannot finish the direct merge for task {task_id} because the target branch checkout is not active."
                )
            })?;
        let expected_branch = publish_target.checkout_branch();
        if current_branch_name != expected_branch {
            return Err(anyhow!(
                "Cannot finish the direct merge for task {task_id} until branch {} is checked out locally.",
                expected_branch
            ));
        }

        let publish_target_ref = publish_target.canonical();
        let publish_sync = self
            .service
            .git_port
            .commits_ahead_behind(Path::new(repo_path), publish_target_ref.as_str())?;
        if publish_sync.ahead != 0 || publish_sync.behind != 0 {
            return Err(anyhow!(
                "Cannot finish the direct merge for task {task_id} until {} is fully published and synchronized.",
                publish_target_ref
            ));
        }

        Ok(())
    }
}
