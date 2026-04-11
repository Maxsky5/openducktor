use super::linked_pull_request_merge_service::{
    LinkedPullRequestMergeCleanup, LinkedPullRequestMergeService,
};
use super::pull_request_provider_service::PullRequestProviderService;
use crate::app_service::service_core::AppService;
use anyhow::Result;
use host_domain::TaskStatus;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RepoPullRequestSyncResult {
    pub ran: bool,
    pub changed_task_ids: Vec<String>,
}

pub(super) struct PullRequestSyncService<'a> {
    service: &'a AppService,
}

impl<'a> PullRequestSyncService<'a> {
    pub(super) fn new(service: &'a AppService) -> Self {
        Self { service }
    }

    pub(super) fn prime_pull_request_sync_candidates(&self, repo_path: &str) -> Result<()> {
        let repo_path = self.service.resolve_task_repo_path(repo_path)?;
        let provider_service = PullRequestProviderService::new(self.service);
        if !provider_service.sync_policy(repo_path.as_str())?.available {
            return Ok(());
        }

        let _ = self
            .service
            .task_store
            .list_pull_request_sync_candidates(Path::new(&repo_path))?;
        Ok(())
    }

    pub(super) fn repo_pull_request_sync(
        &self,
        repo_path: &str,
    ) -> Result<RepoPullRequestSyncResult> {
        let repo_path = self.service.resolve_task_repo_path(repo_path)?;
        let provider_service = PullRequestProviderService::new(self.service);
        if !provider_service.sync_policy(repo_path.as_str())?.available {
            return Ok(RepoPullRequestSyncResult::default());
        }

        let tasks = self
            .service
            .task_store
            .list_pull_request_sync_candidates(Path::new(&repo_path))?;
        let mut changed_task_ids = Vec::new();

        for task in tasks {
            let Some(pull_request) = task.pull_request.clone() else {
                continue;
            };

            let Some(updated) =
                provider_service.fetch_linked_pull_request(repo_path.as_str(), &pull_request)?
            else {
                continue;
            };

            let changed = if updated.record.state == "merged" && task.status != TaskStatus::Closed {
                LinkedPullRequestMergeService::new(self.service).persist_merge_and_close_task(
                    repo_path.as_str(),
                    task.id.as_str(),
                    updated.record,
                    LinkedPullRequestMergeCleanup::BuilderBranches {
                        source_branch: updated.source_branch,
                        target_branch: updated.target_branch,
                    },
                )?;
                true
            } else if updated.record != pull_request {
                self.service.task_store.set_pull_request(
                    Path::new(&repo_path),
                    task.id.as_str(),
                    Some(updated.record),
                )?;
                true
            } else {
                false
            };

            if changed {
                changed_task_ids.push(task.id);
            }
        }

        Ok(RepoPullRequestSyncResult {
            ran: true,
            changed_task_ids,
        })
    }
}
