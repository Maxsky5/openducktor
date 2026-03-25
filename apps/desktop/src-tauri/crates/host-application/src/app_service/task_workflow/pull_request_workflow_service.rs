use super::approval_context_service::ApprovalContextService;
use super::approval_support::{
    ensure_clean_builder_worktree, ensure_pull_request_management_status,
    is_editable_pull_request_state, normalize_approval_target_branch,
    store_linked_pull_request_metadata,
};
use super::builder_cleanup_service::BuilderCleanupService;
use super::pull_request_provider_service::PullRequestProviderService;
use crate::app_service::git_provider::{GitHostingProvider, ResolvedPullRequest};
use crate::app_service::service_core::AppService;
use anyhow::{anyhow, Result};
use host_domain::{PullRequestRecord, TaskCard, TaskPullRequestDetectResult, TaskStatus};
use std::path::Path;

pub(super) struct PullRequestWorkflowService<'a> {
    service: &'a AppService,
}

impl<'a> PullRequestWorkflowService<'a> {
    pub(super) fn new(service: &'a AppService) -> Self {
        Self { service }
    }

    pub(super) fn task_pull_request_upsert(
        &self,
        repo_path: &str,
        task_id: &str,
        title: &str,
        body: &str,
    ) -> Result<PullRequestRecord> {
        let metadata = self.service.task_metadata_get(repo_path, task_id)?;
        if metadata.direct_merge.is_some() {
            return Err(anyhow!(
                "A local direct merge is already recorded for task {task_id}. Finish or discard that direct merge workflow before opening a pull request."
            ));
        }
        let approval = ApprovalContextService::new(self.service)
            .load_open_task_approval_context(repo_path, task_id)?;
        ensure_clean_builder_worktree(&approval)?;
        let repo_path = self.service.resolve_task_repo_path(repo_path)?;
        let provider_service = PullRequestProviderService::new(self.service);
        let provider = provider_service.github_provider();
        let repository = provider_service.github_pull_request_repository(repo_path.as_str())?;
        let remote_name = provider.resolve_remote_name(Path::new(&repo_path), &repository)?;
        match self.service.git_push_branch(
            repo_path.as_str(),
            approval.working_directory.as_deref(),
            Some(remote_name.as_str()),
            approval.source_branch.as_str(),
            true,
            false,
        )? {
            host_domain::GitPushResult::Pushed { .. } => {}
            host_domain::GitPushResult::RejectedNonFastForward { output, .. } => {
                return Err(anyhow!(
                    "Failed to push the builder branch before creating the pull request: {output}"
                ));
            }
        }

        let pull_request = match approval.pull_request {
            Some(existing)
                if existing.provider_id == "github"
                    && is_editable_pull_request_state(existing.state.as_str()) =>
            {
                provider.update_pull_request(
                    Path::new(&repo_path),
                    &repository,
                    existing.number,
                    title.trim(),
                    body,
                )?
            }
            _ => provider.create_pull_request(
                Path::new(&repo_path),
                &repository,
                approval.source_branch.as_str(),
                approval.target_branch.checkout_branch().as_str(),
                title.trim(),
                body,
            )?,
        };

        self.service
            .task_store
            .set_direct_merge_record(Path::new(&repo_path), task_id, None)?;
        self.service.task_store.set_pull_request(
            Path::new(&repo_path),
            task_id,
            Some(pull_request.record.clone()),
        )?;

        Ok(pull_request.record)
    }

    pub(super) fn task_pull_request_unlink(&self, repo_path: &str, task_id: &str) -> Result<bool> {
        let context = self.service.load_task_context(repo_path, task_id)?;
        ensure_pull_request_management_status(&context.task.status)?;
        if self
            .service
            .task_metadata_get(context.repo.repo_path.as_str(), task_id)?
            .pull_request
            .is_none()
        {
            return Err(anyhow!(
                "Task {task_id} does not have a linked pull request."
            ));
        }
        let repo_path = self.service.resolve_task_repo_path(repo_path)?;
        self.service
            .task_store
            .set_pull_request(Path::new(&repo_path), task_id, None)?;
        Ok(true)
    }

    pub(super) fn task_pull_request_detect(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<TaskPullRequestDetectResult> {
        let context = self.service.load_task_context(repo_path, task_id)?;
        ensure_pull_request_management_status(&context.task.status)?;
        let metadata = self
            .service
            .task_metadata_get(context.repo.repo_path.as_str(), task_id)?;
        if metadata.pull_request.is_some() {
            return Err(anyhow!("Task {task_id} already has a linked pull request."));
        }
        if metadata.direct_merge.is_some() {
            return Err(anyhow!(
                "A local direct merge is already recorded for task {task_id}. Finish the direct merge workflow before linking a merged pull request."
            ));
        }

        let (source_branch, target_branch) =
            self.builder_branch_details(context.repo.repo_path.as_str(), task_id, "detection")?;
        let repo_path = self.service.resolve_task_repo_path(repo_path)?;
        let provider_service = PullRequestProviderService::new(self.service);
        let provider = provider_service.github_provider();
        let repository = provider_service.github_pull_request_repository(repo_path.as_str())?;
        let _remote_name = provider.resolve_remote_name(Path::new(&repo_path), &repository)?;
        let pull_request = provider.find_open_pull_request_for_branch(
            Path::new(&repo_path),
            &repository,
            source_branch.as_str(),
        )?;

        if let Some(pull_request) = pull_request {
            let record = store_linked_pull_request_metadata(
                self.service,
                repo_path.as_str(),
                task_id,
                pull_request,
            )?;
            return Ok(TaskPullRequestDetectResult::Linked {
                pull_request: record,
            });
        }

        let pull_request = provider.find_pull_request_for_branch(
            Path::new(&repo_path),
            &repository,
            source_branch.as_str(),
        )?;

        let Some(pull_request) = pull_request else {
            return Ok(TaskPullRequestDetectResult::NotFound {
                source_branch,
                target_branch,
            });
        };

        if pull_request.record.state == "merged" {
            return Ok(TaskPullRequestDetectResult::Merged {
                pull_request: pull_request.record,
            });
        }

        Ok(TaskPullRequestDetectResult::NotFound {
            source_branch,
            target_branch,
        })
    }

    pub(super) fn task_pull_request_link_merged(
        &self,
        repo_path: &str,
        task_id: &str,
        pull_request: PullRequestRecord,
    ) -> Result<TaskCard> {
        let context = self.service.load_task_context(repo_path, task_id)?;
        let metadata = self
            .service
            .task_metadata_get(context.repo.repo_path.as_str(), task_id)?;
        let same_existing_pull_request = metadata.pull_request.as_ref().is_some_and(|existing| {
            existing.provider_id == pull_request.provider_id
                && existing.number == pull_request.number
                && existing.state == "merged"
        });
        if context.task.status != TaskStatus::Closed || !same_existing_pull_request {
            ensure_pull_request_management_status(&context.task.status)?;
        }
        if metadata.direct_merge.is_some() {
            return Err(anyhow!(
                "A local direct merge is already recorded for task {task_id}. Finish the direct merge workflow before linking a merged pull request."
            ));
        }
        if pull_request.state != "merged" {
            return Err(anyhow!(
                "Task {task_id} can only link a merged pull request from detection results."
            ));
        }
        if metadata.pull_request.is_some() && !same_existing_pull_request {
            return Err(anyhow!("Task {task_id} already has a linked pull request."));
        }

        let repo_path = self.service.resolve_task_repo_path(repo_path)?;
        let (source_branch, _target_branch) =
            self.builder_branch_details(context.repo.repo_path.as_str(), task_id, "linking")?;

        if metadata.pull_request.is_none() {
            store_linked_pull_request_metadata(
                self.service,
                repo_path.as_str(),
                task_id,
                ResolvedPullRequest {
                    record: pull_request,
                    source_branch: source_branch.clone(),
                },
            )?;
        }
        let task = if context.task.status == TaskStatus::Closed {
            context.task
        } else {
            self.service.task_transition(
                repo_path.as_str(),
                task_id,
                TaskStatus::Closed,
                Some("Linked pull request merged"),
            )?
        };
        BuilderCleanupService::new(self.service).finalize_direct_merge_cleanup(
            repo_path.as_str(),
            task_id,
            source_branch.as_str(),
            false,
        )?;
        Ok(task)
    }

    fn builder_branch_details(
        &self,
        repo_path: &str,
        task_id: &str,
        operation: &str,
    ) -> Result<(String, String)> {
        let repo_config = self.service.workspace_get_repo_config(repo_path)?;
        let working_directory = self
            .service
            .build_continuation_target_get(repo_path, task_id)?
            .working_directory;
        let current_branch = self
            .service
            .git_port
            .get_current_branch(Path::new(&working_directory))?;
        if current_branch.detached {
            return Err(anyhow!(
                "Pull request {operation} requires a builder branch, but the latest builder workspace is detached."
            ));
        }
        let source_branch = current_branch
            .name
            .ok_or_else(|| anyhow!("Pull request {operation} requires a builder branch name."))?;
        let target_branch =
            normalize_approval_target_branch(&repo_config.default_target_branch)?.checkout_branch();
        Ok((source_branch, target_branch))
    }
}
