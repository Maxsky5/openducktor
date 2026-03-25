use super::approval_support::{
    ensure_human_approval_status, github_provider_availability, is_terminal_task_status,
    latest_builder_cleanup_target, normalize_approval_target_branch,
    normalize_recorded_target_branch, publish_recorded_target_branch, publish_target_branch,
    to_domain_merge_method,
};
use crate::app_service::service_core::AppService;
use anyhow::{anyhow, Result};
use host_domain::{GitDiffScope, TaskApprovalContext};
use std::path::Path;

pub(super) struct ApprovalContextService<'a> {
    service: &'a AppService,
}

impl<'a> ApprovalContextService<'a> {
    pub(super) fn new(service: &'a AppService) -> Self {
        Self { service }
    }

    pub(super) fn task_approval_context_get(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<TaskApprovalContext> {
        let context = self.service.load_task_context(repo_path, task_id)?;
        ensure_human_approval_status(&context.task.status)?;
        let repo_config = self
            .service
            .workspace_get_repo_config(context.repo.repo_path.as_str())?;
        let metadata = self
            .service
            .task_metadata_get(context.repo.repo_path.as_str(), task_id)?;
        let config = self.service.config_store.load()?;

        if let Some(direct_merge) = metadata
            .direct_merge
            .clone()
            .filter(|_| !is_terminal_task_status(&context.task.status))
        {
            let target_branch = normalize_recorded_target_branch(&direct_merge.target_branch)?;
            let publish_target = publish_recorded_target_branch(&direct_merge.target_branch)?;
            let working_directory = latest_builder_cleanup_target(
                self.service,
                context.repo.repo_path.as_str(),
                task_id,
                Some(direct_merge.source_branch.as_str()),
            )?
            .and_then(|target| {
                Path::new(target.working_directory.as_str())
                    .exists()
                    .then_some(target.working_directory)
            });

            return Ok(TaskApprovalContext {
                task_id: task_id.to_string(),
                task_status: context.task.status.as_cli_value().to_string(),
                working_directory,
                source_branch: direct_merge.source_branch.clone(),
                target_branch,
                publish_target,
                default_merge_method: to_domain_merge_method(config.git.default_merge_method),
                has_uncommitted_changes: false,
                uncommitted_file_count: 0,
                pull_request: metadata.pull_request,
                direct_merge: Some(direct_merge),
                suggested_squash_commit_message: None,
                providers: vec![github_provider_availability(
                    Path::new(&context.repo.repo_path),
                    &repo_config,
                )],
            });
        }

        let mut approval = self.load_open_task_approval_context(repo_path, task_id)?;
        approval.suggested_squash_commit_message =
            self.service.git_port.suggested_squash_commit_message(
                Path::new(&context.repo.repo_path),
                approval.source_branch.as_str(),
                approval.target_branch.canonical().as_str(),
            )?;
        Ok(approval)
    }

    pub(super) fn load_open_task_approval_context(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<TaskApprovalContext> {
        let context = self.service.load_task_context(repo_path, task_id)?;
        ensure_human_approval_status(&context.task.status)?;
        let repo_config = self
            .service
            .workspace_get_repo_config(context.repo.repo_path.as_str())?;
        let metadata = self
            .service
            .task_metadata_get(context.repo.repo_path.as_str(), task_id)?;
        let config = self.service.config_store.load()?;
        let target_branch = normalize_approval_target_branch(&repo_config.default_target_branch)?;
        let publish_target = publish_target_branch(&repo_config.default_target_branch)?;
        let working_directory = self
            .service
            .build_continuation_target_get(context.repo.repo_path.as_str(), task_id)?
            .working_directory;
        let current_branch = self
            .service
            .git_port
            .get_current_branch(Path::new(&working_directory))?;
        if current_branch.detached {
            return Err(anyhow!(
                "Human approval requires a builder branch, but the latest builder workspace is detached."
            ));
        }
        let source_branch = current_branch
            .name
            .ok_or_else(|| anyhow!("Human approval requires a builder branch name."))?;
        let worktree_status = self.service.git_port.get_worktree_status_summary(
            Path::new(&working_directory),
            target_branch.canonical().as_str(),
            GitDiffScope::Uncommitted,
        )?;

        Ok(TaskApprovalContext {
            task_id: task_id.to_string(),
            task_status: context.task.status.as_cli_value().to_string(),
            working_directory: Some(working_directory),
            source_branch,
            target_branch,
            publish_target,
            default_merge_method: to_domain_merge_method(config.git.default_merge_method),
            has_uncommitted_changes: worktree_status.file_status_counts.total > 0,
            uncommitted_file_count: worktree_status.file_status_counts.total,
            pull_request: metadata.pull_request,
            direct_merge: None,
            suggested_squash_commit_message: None,
            providers: vec![github_provider_availability(
                Path::new(&context.repo.repo_path),
                &repo_config,
            )],
        })
    }
}
