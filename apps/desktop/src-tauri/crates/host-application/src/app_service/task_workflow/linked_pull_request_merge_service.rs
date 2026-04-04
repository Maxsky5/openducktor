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
        self.service.task_store.set_pull_request(
            Path::new(repo_path),
            task_id,
            Some(pull_request),
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

        self.service.task_transition(
            repo_path,
            task_id,
            TaskStatus::Closed,
            Some(LINKED_PULL_REQUEST_MERGED_REASON),
        )
    }
}
