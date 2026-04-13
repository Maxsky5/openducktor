use super::builder_cleanup_service::BuilderCleanupService;
use crate::app_service::service_core::AppService;
use anyhow::Result;
use host_domain::{PullRequestRecord, TaskCard, TaskStatus};
use std::path::Path;

const LINKED_PULL_REQUEST_MERGED_REASON: &str = "Linked pull request merged";

#[derive(Clone, Debug)]
pub(super) enum LinkedPullRequestMergeCleanup {
    Skip,
    BuilderBranches {
        source_branch: String,
        target_branch: String,
    },
}

pub(super) struct LinkedPullRequestMergeService<'a> {
    service: &'a AppService,
}

impl<'a> LinkedPullRequestMergeService<'a> {
    pub(super) fn new(service: &'a AppService) -> Self {
        Self { service }
    }

    pub(super) fn persist_merge_and_close_task(
        &self,
        repo_path: &str,
        task_id: &str,
        pull_request: PullRequestRecord,
        cleanup: LinkedPullRequestMergeCleanup,
    ) -> Result<TaskCard> {
        let pr_provider = pull_request.provider_id.clone();
        let pr_number = pull_request.number;
        let pr_url = pull_request.url.clone();
        let pr_merged_at = pull_request.merged_at.clone();
        let (cleanup_source_branch, cleanup_target_branch) = match &cleanup {
            LinkedPullRequestMergeCleanup::Skip => (None::<String>, None::<String>),
            LinkedPullRequestMergeCleanup::BuilderBranches {
                source_branch,
                target_branch,
            } => (Some(source_branch.clone()), Some(target_branch.clone())),
        };

        self.service.task_store.set_delivery_metadata(
            Path::new(repo_path),
            task_id,
            Some(pull_request),
            None,
        )?;

        if let LinkedPullRequestMergeCleanup::BuilderBranches {
            source_branch,
            target_branch,
        } = cleanup
        {
            BuilderCleanupService::new(self.service).finalize_direct_merge_cleanup(
                repo_path,
                task_id,
                source_branch.as_str(),
                target_branch.as_str(),
            )?;
        }

        let task = self.service.task_transition(
            repo_path,
            task_id,
            TaskStatus::Closed,
            Some(LINKED_PULL_REQUEST_MERGED_REASON),
        )?;

        tracing::info!(
            target: "openducktor.task-sync",
            event = "linked_pull_request_merged_task_closed",
            repo_path,
            task_id,
            task_status = ?task.status,
            pr_provider = pr_provider.as_str(),
            pr_number,
            pr_url = pr_url.as_str(),
            pr_merged_at = pr_merged_at.as_deref().unwrap_or(""),
            cleanup_source_branch = cleanup_source_branch.as_deref().unwrap_or(""),
            cleanup_target_branch = cleanup_target_branch.as_deref().unwrap_or(""),
            "Closed task after linked pull request merge"
        );

        Ok(task)
    }
}
