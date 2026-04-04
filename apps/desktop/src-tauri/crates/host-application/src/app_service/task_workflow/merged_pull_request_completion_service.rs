use super::builder_cleanup_service::BuilderCleanupService;
use crate::app_service::service_core::AppService;
use anyhow::Result;
use host_domain::{PullRequestRecord, TaskCard, TaskStatus};
use std::path::Path;

#[derive(Clone, Debug)]
pub(super) struct MergedPullRequestCleanupContext {
    pub(super) source_branch: String,
    pub(super) target_branch: String,
}

pub(super) struct MergedPullRequestCompletionService<'a> {
    service: &'a AppService,
}

impl<'a> MergedPullRequestCompletionService<'a> {
    pub(super) fn new(service: &'a AppService) -> Self {
        Self { service }
    }

    pub(super) fn complete_linked_pull_request_merge(
        &self,
        repo_path: &str,
        task_id: &str,
        pull_request: PullRequestRecord,
        cleanup_context: Option<MergedPullRequestCleanupContext>,
    ) -> Result<TaskCard> {
        self.service.task_store.set_pull_request(
            Path::new(repo_path),
            task_id,
            Some(pull_request),
        )?;

        if let Some(cleanup_context) = cleanup_context {
            BuilderCleanupService::new(self.service).finalize_direct_merge_cleanup(
                repo_path,
                task_id,
                cleanup_context.source_branch.as_str(),
                cleanup_context.target_branch.as_str(),
            )?;
        }

        self.service.task_transition(
            repo_path,
            task_id,
            TaskStatus::Closed,
            Some("Linked pull request merged"),
        )
    }
}
