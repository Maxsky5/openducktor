use super::approval_support::{is_syncable_pull_request_state, is_terminal_task_status};
use super::merged_pull_request_completion_service::{
    MergedPullRequestCleanupContext, MergedPullRequestCompletionService,
};
use super::pull_request_provider_service::PullRequestProviderService;
use crate::app_service::service_core::AppService;
use anyhow::Result;
use host_domain::TaskStatus;
use std::path::Path;

pub(super) struct PullRequestSyncService<'a> {
    service: &'a AppService,
}

impl<'a> PullRequestSyncService<'a> {
    pub(super) fn new(service: &'a AppService) -> Self {
        Self { service }
    }

    pub(super) fn repo_pull_request_sync(&self, repo_path: &str) -> Result<bool> {
        let repo_path = self.service.resolve_task_repo_path(repo_path)?;
        let tasks = self.service.task_store.list_tasks(Path::new(&repo_path))?;
        let provider_service = PullRequestProviderService::new(self.service);
        if !provider_service.sync_policy(repo_path.as_str())?.available {
            return Ok(false);
        }

        for task in tasks {
            if is_terminal_task_status(&task.status) {
                continue;
            }
            let Some(pull_request) = self
                .service
                .task_metadata_get(repo_path.as_str(), task.id.as_str())?
                .pull_request
            else {
                continue;
            };
            if !is_syncable_pull_request_state(pull_request.state.as_str()) {
                continue;
            }

            let Some(updated) =
                provider_service.fetch_linked_pull_request(repo_path.as_str(), &pull_request)?
            else {
                continue;
            };
            if updated.record.state == "merged" && task.status != TaskStatus::Closed {
                let _ = MergedPullRequestCompletionService::new(self.service)
                    .complete_linked_pull_request_merge(
                        repo_path.as_str(),
                        task.id.as_str(),
                        updated.record,
                        Some(MergedPullRequestCleanupContext {
                            source_branch: updated.source_branch,
                            target_branch: updated.target_branch,
                        }),
                    )?;
            } else {
                self.service.task_store.set_pull_request(
                    Path::new(&repo_path),
                    task.id.as_str(),
                    Some(updated.record),
                )?;
            }
        }

        Ok(true)
    }
}
