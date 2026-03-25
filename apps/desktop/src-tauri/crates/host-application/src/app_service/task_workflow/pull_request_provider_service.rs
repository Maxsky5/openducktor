use super::approval_support::{github_repository_from_config, to_config_repository};
use crate::app_service::git_provider::{github_provider, GitHostingProvider};
use crate::app_service::service_core::AppService;
use anyhow::{anyhow, Result};
use host_domain::GitProviderRepository;
use std::path::Path;

pub(super) struct PullRequestProviderService<'a> {
    service: &'a AppService,
}

impl<'a> PullRequestProviderService<'a> {
    pub(super) fn new(service: &'a AppService) -> Self {
        Self { service }
    }

    pub(super) fn github_provider(&self) -> impl GitHostingProvider {
        github_provider()
    }

    pub(super) fn github_pull_request_repository(
        &self,
        repo_path: &str,
    ) -> Result<GitProviderRepository> {
        let repo_config = self.service.workspace_get_repo_config(repo_path)?;
        let provider = self.github_provider();
        if !provider.is_available() {
            return Err(anyhow!(
                "GitHub pull request support requires the gh CLI to be installed."
            ));
        }

        let github_config = repo_config
            .git
            .providers
            .get("github")
            .cloned()
            .unwrap_or_default();
        if !github_config.enabled {
            return Err(anyhow!(
                "GitHub pull request support is not enabled for this repository."
            ));
        }

        let repository = github_repository_from_config(&repo_config).ok_or_else(|| {
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

    pub(super) fn auto_detect_git_provider_for_repo(&self, repo_path: &str) -> Result<()> {
        let repo_path = self.service.resolve_authorized_repo_path(repo_path)?;
        let mut repo_config = self
            .service
            .workspace_get_repo_config_optional(repo_path.as_str())?
            .unwrap_or_default();
        let existing = repo_config
            .git
            .providers
            .get("github")
            .cloned()
            .unwrap_or_default();
        if existing.repository.is_some() {
            return Ok(());
        }

        let provider = self.github_provider();
        let detected = provider.detect_repository(Path::new(&repo_path))?;
        if let Some(repository) = detected {
            repo_config.git.providers.insert(
                "github".to_string(),
                host_infra_system::GitProviderConfig {
                    enabled: true,
                    repository: Some(to_config_repository(&repository)),
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
        let provider = self.github_provider();
        let detected = provider.detect_repository(Path::new(&repo_path))?;
        Ok(detected.map(|repository| to_config_repository(&repository)))
    }
}
