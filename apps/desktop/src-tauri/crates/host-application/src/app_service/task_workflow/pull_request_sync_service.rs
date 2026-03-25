use super::approval_support::{
    github_repository_from_config, is_syncable_pull_request_state, is_terminal_task_status,
};
use super::builder_cleanup_service::BuilderCleanupService;
use super::pull_request_provider_service::PullRequestProviderService;
use crate::app_service::git_provider::GitHostingProvider;
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
        let provider = provider_service.github_provider();
        if !provider.is_available() {
            return Ok(false);
        }
        let github_repository = github_repository_from_config(
            &self.service.workspace_get_repo_config(repo_path.as_str())?,
        );

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
            if pull_request.provider_id != "github" {
                continue;
            }
            if !is_syncable_pull_request_state(pull_request.state.as_str()) {
                continue;
            }

            let Some(repository) = github_repository.as_ref() else {
                continue;
            };
            let updated = provider.fetch_pull_request(
                Path::new(&repo_path),
                repository,
                pull_request.number,
            )?;
            self.service.task_store.set_pull_request(
                Path::new(&repo_path),
                task.id.as_str(),
                Some(updated.record.clone()),
            )?;

            if updated.record.state == "merged" && task.status != TaskStatus::Closed {
                let _ = self.service.task_transition(
                    repo_path.as_str(),
                    task.id.as_str(),
                    TaskStatus::Closed,
                    Some("Linked pull request merged"),
                )?;
                BuilderCleanupService::new(self.service).finalize_direct_merge_cleanup(
                    repo_path.as_str(),
                    task.id.as_str(),
                    updated.source_branch.as_str(),
                    false,
                )?;
            }
        }

        Ok(true)
    }
}
