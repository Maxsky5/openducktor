use super::approval_support::is_editable_pull_request_state;
use crate::app_service::git_provider::{github_provider, GitHostingProvider, ResolvedPullRequest};
use crate::app_service::service_core::AppService;
use anyhow::{anyhow, Result};
use host_domain::{
    GitProviderAvailability, GitProviderRepository, PullRequestRecord, TaskApprovalContext,
};
use std::path::Path;

const GITHUB_PROVIDER_ID: &str = "github";

pub(super) struct PullRequestProviderService<'a> {
    service: &'a AppService,
}

impl<'a> PullRequestProviderService<'a> {
    pub(super) fn new(service: &'a AppService) -> Self {
        Self { service }
    }

    pub(super) fn provider_availability(
        &self,
        repo_path: &Path,
        repo_config: &host_infra_system::RepoConfig,
    ) -> Vec<GitProviderAvailability> {
        let provider = github_provider();
        let config = repo_config
            .git
            .providers
            .get(GITHUB_PROVIDER_ID)
            .cloned()
            .unwrap_or_default();
        if !config.enabled {
            return vec![GitProviderAvailability {
                provider_id: GITHUB_PROVIDER_ID.to_string(),
                enabled: false,
                available: false,
                reason: Some("GitHub provider is not enabled for this repository.".to_string()),
            }];
        }
        if !provider.is_available() {
            return vec![GitProviderAvailability {
                provider_id: GITHUB_PROVIDER_ID.to_string(),
                enabled: true,
                available: false,
                reason: Some("gh CLI is not installed.".to_string()),
            }];
        }

        let repository = match config.repository.as_ref() {
            Some(repository) => Self::to_provider_repository(repository),
            None => {
                return vec![GitProviderAvailability {
                    provider_id: GITHUB_PROVIDER_ID.to_string(),
                    enabled: true,
                    available: false,
                    reason: Some("GitHub repository coordinates are missing.".to_string()),
                }];
            }
        };

        let auth_status = match provider.auth_status(repository.host.as_str()) {
            Ok(status) => status,
            Err(error) => {
                return vec![GitProviderAvailability {
                    provider_id: GITHUB_PROVIDER_ID.to_string(),
                    enabled: true,
                    available: false,
                    reason: Some(format!("Failed to check GitHub authentication: {error}")),
                }];
            }
        };
        if !auth_status.authenticated {
            return vec![GitProviderAvailability {
                provider_id: GITHUB_PROVIDER_ID.to_string(),
                enabled: true,
                available: false,
                reason: Some(auth_status.error.unwrap_or_else(|| {
                    "GitHub authentication is not configured. Run `gh auth login`.".to_string()
                })),
            }];
        }

        if let Err(error) = provider.resolve_remote_name(repo_path, &repository) {
            return vec![GitProviderAvailability {
                provider_id: GITHUB_PROVIDER_ID.to_string(),
                enabled: true,
                available: false,
                reason: Some(format!(
                    "No matching Git remote is configured for {}/{} on {}: {error}",
                    repository.owner, repository.name, repository.host
                )),
            }];
        }

        vec![GitProviderAvailability {
            provider_id: GITHUB_PROVIDER_ID.to_string(),
            enabled: true,
            available: true,
            reason: None,
        }]
    }

    pub(super) fn sync_available(&self) -> bool {
        github_provider().is_available()
    }

    pub(super) fn upsert_pull_request(
        &self,
        repo_path: &str,
        approval: &TaskApprovalContext,
        title: &str,
        body: &str,
    ) -> Result<ResolvedPullRequest> {
        let provider = github_provider();
        let repository = self.github_pull_request_repository(repo_path)?;
        let remote_name = provider.resolve_remote_name(Path::new(repo_path), &repository)?;
        match self.service.git_push_branch(
            repo_path,
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

        match approval.pull_request.as_ref() {
            Some(existing)
                if existing.provider_id == GITHUB_PROVIDER_ID
                    && is_editable_pull_request_state(existing.state.as_str()) =>
            {
                provider.update_pull_request(
                    Path::new(repo_path),
                    &repository,
                    existing.number,
                    title.trim(),
                    body,
                )
            }
            _ => provider.create_pull_request(
                Path::new(repo_path),
                &repository,
                approval.source_branch.as_str(),
                approval.target_branch.checkout_branch().as_str(),
                title.trim(),
                body,
            ),
        }
    }

    pub(super) fn find_open_pull_request_for_branch(
        &self,
        repo_path: &str,
        source_branch: &str,
    ) -> Result<Option<ResolvedPullRequest>> {
        let provider = github_provider();
        let repository = self.github_pull_request_repository(repo_path)?;
        let _ = provider.resolve_remote_name(Path::new(repo_path), &repository)?;
        provider.find_open_pull_request_for_branch(Path::new(repo_path), &repository, source_branch)
    }

    pub(super) fn find_pull_request_for_branch(
        &self,
        repo_path: &str,
        source_branch: &str,
    ) -> Result<Option<ResolvedPullRequest>> {
        let provider = github_provider();
        let repository = self.github_pull_request_repository(repo_path)?;
        provider.find_pull_request_for_branch(Path::new(repo_path), &repository, source_branch)
    }

    pub(super) fn fetch_linked_pull_request(
        &self,
        repo_path: &str,
        pull_request: &PullRequestRecord,
    ) -> Result<Option<ResolvedPullRequest>> {
        if pull_request.provider_id != GITHUB_PROVIDER_ID {
            return Ok(None);
        }

        let Some(repository) =
            self.github_repository_from_config(&self.service.workspace_get_repo_config(repo_path)?)
        else {
            return Ok(None);
        };

        let provider = github_provider();
        if !provider.is_available() {
            return Ok(None);
        }

        provider
            .fetch_pull_request(Path::new(repo_path), &repository, pull_request.number)
            .map(Some)
    }

    pub(super) fn store_linked_pull_request_metadata(
        &self,
        repo_path: &str,
        task_id: &str,
        pull_request: ResolvedPullRequest,
    ) -> Result<PullRequestRecord> {
        self.service
            .task_store
            .set_direct_merge_record(Path::new(repo_path), task_id, None)?;
        self.service.task_store.set_pull_request(
            Path::new(repo_path),
            task_id,
            Some(pull_request.record.clone()),
        )?;

        Ok(pull_request.record)
    }

    pub(super) fn auto_detect_git_provider_for_repo(&self, repo_path: &str) -> Result<()> {
        let repo_path = self.service.resolve_authorized_repo_path(repo_path)?;
        let mut repo_config = self
            .service
            .workspace_get_repo_config_optional(repo_path.as_str())?
            .unwrap_or_default();
        let existing = repo_config
            .git
            .providers
            .get(GITHUB_PROVIDER_ID)
            .cloned()
            .unwrap_or_default();
        if existing.repository.is_some() {
            return Ok(());
        }

        let detected = github_provider().detect_repository(Path::new(&repo_path))?;
        if let Some(repository) = detected {
            repo_config.git.providers.insert(
                GITHUB_PROVIDER_ID.to_string(),
                host_infra_system::GitProviderConfig {
                    enabled: true,
                    repository: Some(Self::to_config_repository(&repository)),
                    auto_detected: true,
                },
            );
            let _ = self
                .service
                .workspace_update_repo_config(repo_path.as_str(), repo_config)?;
        }

        Ok(())
    }

    pub(super) fn workspace_detect_github_repository(
        &self,
        repo_path: &str,
    ) -> Result<Option<host_infra_system::GitProviderRepository>> {
        let repo_path = self.service.resolve_authorized_repo_path(repo_path)?;
        let detected = github_provider().detect_repository(Path::new(&repo_path))?;
        Ok(detected.map(|repository| Self::to_config_repository(&repository)))
    }

    fn github_pull_request_repository(&self, repo_path: &str) -> Result<GitProviderRepository> {
        let repo_config = self.service.workspace_get_repo_config(repo_path)?;
        let provider = github_provider();
        if !provider.is_available() {
            return Err(anyhow!(
                "GitHub pull request support requires the gh CLI to be installed."
            ));
        }

        let github_config = repo_config
            .git
            .providers
            .get(GITHUB_PROVIDER_ID)
            .cloned()
            .unwrap_or_default();
        if !github_config.enabled {
            return Err(anyhow!(
                "GitHub pull request support is not enabled for this repository."
            ));
        }

        let repository = self
            .github_repository_from_config(&repo_config)
            .ok_or_else(|| {
                anyhow!("GitHub pull request support requires repository coordinates.")
            })?;
        let auth_status = provider.auth_status(repository.host.as_str())?;
        if !auth_status.authenticated {
            return Err(anyhow!(
                "{}",
                auth_status.error.unwrap_or_else(|| {
                    "GitHub authentication is not configured. Run `gh auth login`.".to_string()
                })
            ));
        }

        Ok(repository)
    }

    fn github_repository_from_config(
        &self,
        repo_config: &host_infra_system::RepoConfig,
    ) -> Option<GitProviderRepository> {
        repo_config
            .git
            .providers
            .get(GITHUB_PROVIDER_ID)
            .and_then(|config| config.repository.as_ref())
            .map(Self::to_provider_repository)
    }

    fn to_provider_repository(
        repository: &host_infra_system::GitProviderRepository,
    ) -> GitProviderRepository {
        GitProviderRepository {
            host: repository.host.clone(),
            owner: repository.owner.clone(),
            name: repository.name.clone(),
        }
    }

    fn to_config_repository(
        repository: &host_domain::GitProviderRepository,
    ) -> host_infra_system::GitProviderRepository {
        host_infra_system::GitProviderRepository {
            host: repository.host.clone(),
            owner: repository.owner.clone(),
            name: repository.name.clone(),
        }
    }
}
