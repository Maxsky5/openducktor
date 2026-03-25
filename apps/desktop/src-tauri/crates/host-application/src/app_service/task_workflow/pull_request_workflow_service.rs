use super::approval_context_service::ApprovalContextService;
use super::approval_support::{
    ensure_clean_builder_worktree, ensure_pull_request_management_status,
};
use super::builder_branch_service::BuilderBranchService;
use super::builder_cleanup_service::BuilderCleanupService;
use super::pull_request_provider_service::PullRequestProviderService;
use crate::app_service::git_provider::ResolvedPullRequest;
use crate::app_service::service_core::AppService;
use anyhow::{anyhow, Result};
use host_domain::{PullRequestRecord, TaskCard, TaskPullRequestDetectResult, TaskStatus};

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
        let pull_request = PullRequestProviderService::new(self.service).upsert_pull_request(
            repo_path.as_str(),
            &approval,
            title,
            body,
        )?;

        self.service.task_store.set_delivery_metadata(
            std::path::Path::new(&repo_path),
            task_id,
            Some(pull_request.record.clone()),
            None,
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
        self.service.task_store.set_pull_request(
            std::path::Path::new(&repo_path),
            task_id,
            None,
        )?;
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

        let builder_context = BuilderBranchService::new(self.service).load_builder_branch_context(
            context.repo.repo_path.as_str(),
            task_id,
            "Pull request detection",
        )?;
        let target_branch = BuilderBranchService::new(self.service)
            .target_branch_for_repo(context.repo.repo_path.as_str())?
            .checkout_branch();
        let repo_path = self.service.resolve_task_repo_path(repo_path)?;
        let provider_service = PullRequestProviderService::new(self.service);
        let pull_request = provider_service.find_open_pull_request_for_branch(
            repo_path.as_str(),
            builder_context.source_branch.as_str(),
        )?;

        if let Some(pull_request) = pull_request {
            let record = provider_service.store_linked_pull_request_metadata(
                repo_path.as_str(),
                task_id,
                pull_request,
            )?;
            return Ok(TaskPullRequestDetectResult::Linked {
                pull_request: record,
            });
        }

        let pull_request = provider_service.find_pull_request_for_branch(
            repo_path.as_str(),
            builder_context.source_branch.as_str(),
        )?;

        let Some(pull_request) = pull_request else {
            return Ok(TaskPullRequestDetectResult::NotFound {
                source_branch: builder_context.source_branch,
                target_branch,
            });
        };

        if pull_request.record.state == "merged" {
            return Ok(TaskPullRequestDetectResult::Merged {
                pull_request: pull_request.record,
            });
        }

        Ok(TaskPullRequestDetectResult::NotFound {
            source_branch: builder_context.source_branch,
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
        let builder_context = BuilderBranchService::new(self.service).load_builder_branch_context(
            context.repo.repo_path.as_str(),
            task_id,
            "Pull request linking",
        )?;

        if metadata.pull_request.is_none() {
            PullRequestProviderService::new(self.service).store_linked_pull_request_metadata(
                repo_path.as_str(),
                task_id,
                ResolvedPullRequest {
                    record: pull_request,
                    source_branch: builder_context.source_branch.clone(),
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
            builder_context.source_branch.as_str(),
            false,
        )?;
        Ok(task)
    }
}
