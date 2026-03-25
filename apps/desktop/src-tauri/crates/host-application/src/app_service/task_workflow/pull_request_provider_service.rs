use super::approval_support::is_editable_pull_request_state;
use crate::app_service::git_provider::{github_provider, GitHostingProvider, ResolvedPullRequest};
use crate::app_service::service_core::AppService;
use anyhow::{anyhow, Result};
use host_domain::{
    GitProviderAvailability, GitProviderRepository, PullRequestRecord, TaskApprovalContext,
};
use std::path::Path;

const GITHUB_PROVIDER_ID: &str = "github";

#[derive(Debug, Clone)]
pub(super) struct PullRequestMutationContext {
    pub(super) provider_id: String,
    pub(super) repository: GitProviderRepository,
    pub(super) remote_name: String,
}

#[derive(Debug, Clone)]
pub(super) struct PullRequestSyncContext {
    pub(super) repository: GitProviderRepository,
}

#[derive(Debug, Clone)]
pub(super) struct PullRequestSyncPolicy {
    pub(super) provider_id: String,
    pub(super) available: bool,
    pub(super) context: Option<PullRequestSyncContext>,
}

trait PullRequestProviderPort {
    fn provider_id(&self) -> &'static str;

    fn ui_status(
        &self,
        repo_path: &Path,
        repo_config: &host_infra_system::RepoConfig,
    ) -> GitProviderAvailability;

    fn mutation_context(
        &self,
        repo_path: &Path,
        repo_config: &host_infra_system::RepoConfig,
    ) -> Result<PullRequestMutationContext>;

    fn sync_policy(&self, repo_config: &host_infra_system::RepoConfig) -> PullRequestSyncPolicy;

    fn detect_repository(&self, repo_path: &Path) -> Result<Option<GitProviderRepository>>;

    fn upsert_pull_request(
        &self,
        repo_path: &Path,
        context: &PullRequestMutationContext,
        approval: &TaskApprovalContext,
        title: &str,
        body: &str,
    ) -> Result<ResolvedPullRequest>;

    fn find_open_pull_request_for_branch(
        &self,
        repo_path: &Path,
        context: &PullRequestMutationContext,
        source_branch: &str,
    ) -> Result<Option<ResolvedPullRequest>>;

    fn find_pull_request_for_branch(
        &self,
        repo_path: &Path,
        context: &PullRequestMutationContext,
        source_branch: &str,
    ) -> Result<Option<ResolvedPullRequest>>;

    fn fetch_pull_request(
        &self,
        repo_path: &Path,
        context: &PullRequestSyncContext,
        number: u32,
    ) -> Result<ResolvedPullRequest>;
}

#[derive(Debug, Default, Clone, Copy)]
struct GithubPullRequestProviderPort;

impl GithubPullRequestProviderPort {
    fn config(
        &self,
        repo_config: &host_infra_system::RepoConfig,
    ) -> host_infra_system::GitProviderConfig {
        repo_config
            .git
            .providers
            .get(self.provider_id())
            .cloned()
            .unwrap_or_default()
    }

    fn provider(&self) -> impl GitHostingProvider {
        github_provider()
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

impl PullRequestProviderPort for GithubPullRequestProviderPort {
    fn provider_id(&self) -> &'static str {
        GITHUB_PROVIDER_ID
    }

    fn ui_status(
        &self,
        repo_path: &Path,
        repo_config: &host_infra_system::RepoConfig,
    ) -> GitProviderAvailability {
        let provider = self.provider();
        let config = self.config(repo_config);
        if !config.enabled {
            return GitProviderAvailability {
                provider_id: self.provider_id().to_string(),
                enabled: false,
                available: false,
                reason: Some("GitHub provider is not enabled for this repository.".to_string()),
            };
        }
        if !provider.is_available() {
            return GitProviderAvailability {
                provider_id: self.provider_id().to_string(),
                enabled: true,
                available: false,
                reason: Some("gh CLI is not installed.".to_string()),
            };
        }

        let repository = match config.repository.as_ref() {
            Some(repository) => Self::to_provider_repository(repository),
            None => {
                return GitProviderAvailability {
                    provider_id: self.provider_id().to_string(),
                    enabled: true,
                    available: false,
                    reason: Some("GitHub repository coordinates are missing.".to_string()),
                };
            }
        };

        let auth_status = match provider.auth_status(repository.host.as_str()) {
            Ok(status) => status,
            Err(error) => {
                return GitProviderAvailability {
                    provider_id: self.provider_id().to_string(),
                    enabled: true,
                    available: false,
                    reason: Some(format!("Failed to check GitHub authentication: {error}")),
                };
            }
        };
        if !auth_status.authenticated {
            return GitProviderAvailability {
                provider_id: self.provider_id().to_string(),
                enabled: true,
                available: false,
                reason: Some(auth_status.error.unwrap_or_else(|| {
                    "GitHub authentication is not configured. Run `gh auth login`.".to_string()
                })),
            };
        }

        if let Err(error) = provider.resolve_remote_name(repo_path, &repository) {
            return GitProviderAvailability {
                provider_id: self.provider_id().to_string(),
                enabled: true,
                available: false,
                reason: Some(format!(
                    "No matching Git remote is configured for {}/{} on {}: {error}",
                    repository.owner, repository.name, repository.host
                )),
            };
        }

        GitProviderAvailability {
            provider_id: self.provider_id().to_string(),
            enabled: true,
            available: true,
            reason: None,
        }
    }

    fn mutation_context(
        &self,
        repo_path: &Path,
        repo_config: &host_infra_system::RepoConfig,
    ) -> Result<PullRequestMutationContext> {
        let provider = self.provider();
        if !provider.is_available() {
            return Err(anyhow!(
                "GitHub pull request support requires the gh CLI to be installed."
            ));
        }

        let config = self.config(repo_config);
        if !config.enabled {
            return Err(anyhow!(
                "GitHub pull request support is not enabled for this repository."
            ));
        }

        let repository = config
            .repository
            .as_ref()
            .map(Self::to_provider_repository)
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

        let remote_name = provider.resolve_remote_name(repo_path, &repository)?;
        Ok(PullRequestMutationContext {
            provider_id: self.provider_id().to_string(),
            repository,
            remote_name,
        })
    }

    fn sync_policy(&self, repo_config: &host_infra_system::RepoConfig) -> PullRequestSyncPolicy {
        let config = self.config(repo_config);
        let provider = self.provider();
        let available = config.enabled && provider.is_available();
        let repository = config.repository.as_ref().map(Self::to_provider_repository);

        PullRequestSyncPolicy {
            provider_id: self.provider_id().to_string(),
            available,
            context: if available {
                repository.map(|repository| PullRequestSyncContext { repository })
            } else {
                None
            },
        }
    }

    fn detect_repository(&self, repo_path: &Path) -> Result<Option<GitProviderRepository>> {
        self.provider().detect_repository(repo_path)
    }

    fn upsert_pull_request(
        &self,
        repo_path: &Path,
        context: &PullRequestMutationContext,
        approval: &TaskApprovalContext,
        title: &str,
        body: &str,
    ) -> Result<ResolvedPullRequest> {
        let provider = self.provider();
        match approval.pull_request.as_ref() {
            Some(existing)
                if existing.provider_id == context.provider_id
                    && is_editable_pull_request_state(existing.state.as_str()) =>
            {
                provider.update_pull_request(
                    repo_path,
                    &context.repository,
                    existing.number,
                    title.trim(),
                    body,
                )
            }
            _ => provider.create_pull_request(
                repo_path,
                &context.repository,
                approval.source_branch.as_str(),
                approval.target_branch.checkout_branch().as_str(),
                title.trim(),
                body,
            ),
        }
    }

    fn find_open_pull_request_for_branch(
        &self,
        repo_path: &Path,
        context: &PullRequestMutationContext,
        source_branch: &str,
    ) -> Result<Option<ResolvedPullRequest>> {
        self.provider().find_open_pull_request_for_branch(
            repo_path,
            &context.repository,
            source_branch,
        )
    }

    fn find_pull_request_for_branch(
        &self,
        repo_path: &Path,
        context: &PullRequestMutationContext,
        source_branch: &str,
    ) -> Result<Option<ResolvedPullRequest>> {
        self.provider()
            .find_pull_request_for_branch(repo_path, &context.repository, source_branch)
    }

    fn fetch_pull_request(
        &self,
        repo_path: &Path,
        context: &PullRequestSyncContext,
        number: u32,
    ) -> Result<ResolvedPullRequest> {
        self.provider()
            .fetch_pull_request(repo_path, &context.repository, number)
    }
}

pub(super) struct PullRequestProviderService<'a> {
    service: &'a AppService,
}

impl<'a> PullRequestProviderService<'a> {
    pub(super) fn new(service: &'a AppService) -> Self {
        Self { service }
    }

    pub(super) fn provider_statuses(
        &self,
        repo_path: &Path,
        repo_config: &host_infra_system::RepoConfig,
    ) -> Vec<GitProviderAvailability> {
        vec![GithubPullRequestProviderPort.ui_status(repo_path, repo_config)]
    }

    pub(super) fn sync_policy(&self, repo_path: &str) -> Result<PullRequestSyncPolicy> {
        let repo_config = self.service.workspace_get_repo_config(repo_path)?;
        Ok(GithubPullRequestProviderPort.sync_policy(&repo_config))
    }

    pub(super) fn upsert_pull_request(
        &self,
        repo_path: &str,
        approval: &TaskApprovalContext,
        title: &str,
        body: &str,
    ) -> Result<ResolvedPullRequest> {
        let repo_config = self.service.workspace_get_repo_config(repo_path)?;
        let context =
            GithubPullRequestProviderPort.mutation_context(Path::new(repo_path), &repo_config)?;
        match self.service.git_push_branch(
            repo_path,
            approval.working_directory.as_deref(),
            Some(context.remote_name.as_str()),
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

        GithubPullRequestProviderPort.upsert_pull_request(
            Path::new(repo_path),
            &context,
            approval,
            title,
            body,
        )
    }

    pub(super) fn find_open_pull_request_for_branch(
        &self,
        repo_path: &str,
        source_branch: &str,
    ) -> Result<Option<ResolvedPullRequest>> {
        let repo_config = self.service.workspace_get_repo_config(repo_path)?;
        let context =
            GithubPullRequestProviderPort.mutation_context(Path::new(repo_path), &repo_config)?;
        GithubPullRequestProviderPort.find_open_pull_request_for_branch(
            Path::new(repo_path),
            &context,
            source_branch,
        )
    }

    pub(super) fn find_pull_request_for_branch(
        &self,
        repo_path: &str,
        source_branch: &str,
    ) -> Result<Option<ResolvedPullRequest>> {
        let repo_config = self.service.workspace_get_repo_config(repo_path)?;
        let context =
            GithubPullRequestProviderPort.mutation_context(Path::new(repo_path), &repo_config)?;
        GithubPullRequestProviderPort.find_pull_request_for_branch(
            Path::new(repo_path),
            &context,
            source_branch,
        )
    }

    pub(super) fn fetch_linked_pull_request(
        &self,
        repo_path: &str,
        pull_request: &PullRequestRecord,
    ) -> Result<Option<ResolvedPullRequest>> {
        let policy = self.sync_policy(repo_path)?;
        if pull_request.provider_id != policy.provider_id {
            return Ok(None);
        }
        let Some(context) = policy.context else {
            return Ok(None);
        };

        GithubPullRequestProviderPort
            .fetch_pull_request(Path::new(repo_path), &context, pull_request.number)
            .map(Some)
    }

    pub(super) fn store_linked_pull_request_metadata(
        &self,
        repo_path: &str,
        task_id: &str,
        pull_request: ResolvedPullRequest,
    ) -> Result<PullRequestRecord> {
        self.service.task_store.set_delivery_metadata(
            Path::new(repo_path),
            task_id,
            Some(pull_request.record.clone()),
            None,
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

        let detected = GithubPullRequestProviderPort.detect_repository(Path::new(&repo_path))?;
        if let Some(repository) = detected {
            repo_config.git.providers.insert(
                GITHUB_PROVIDER_ID.to_string(),
                host_infra_system::GitProviderConfig {
                    enabled: true,
                    repository: Some(GithubPullRequestProviderPort::to_config_repository(
                        &repository,
                    )),
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
        let detected = GithubPullRequestProviderPort.detect_repository(Path::new(&repo_path))?;
        Ok(detected
            .map(|repository| GithubPullRequestProviderPort::to_config_repository(&repository)))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        GithubPullRequestProviderPort, PullRequestProviderPort, PullRequestProviderService,
    };
    use crate::app_service::git_provider::ResolvedPullRequest;
    use crate::app_service::test_support::{
        build_service_with_store, init_git_repo, make_task, unique_temp_path,
    };
    use crate::app_service::AppService;
    use anyhow::Result;
    use host_domain::{GitCurrentBranch, PullRequestRecord, TaskStatus};
    use host_infra_system::{AppConfigStore, RepoConfig};
    use std::fs;
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    fn build_service(
        root: &Path,
    ) -> Result<(
        AppService,
        Arc<Mutex<crate::app_service::test_support::TaskStoreState>>,
    )> {
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "task", TaskStatus::HumanReview)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
                revision: None,
            },
            config_store,
        );
        Ok((service, task_state))
    }

    #[test]
    fn provider_status_reports_missing_repository_coordinates() {
        let mut repo_config = RepoConfig::default();
        repo_config.git.providers.insert(
            "github".to_string(),
            host_infra_system::GitProviderConfig {
                enabled: true,
                repository: None,
                auto_detected: false,
            },
        );
        let status = GithubPullRequestProviderPort.ui_status(Path::new("/tmp/repo"), &repo_config);

        assert!(!status.available);
        assert_eq!(status.provider_id, "github");
        assert_eq!(
            status.reason.as_deref(),
            Some("GitHub repository coordinates are missing.")
        );
    }

    #[test]
    fn sync_policy_without_repository_coordinates_has_no_context() -> Result<()> {
        let root = unique_temp_path("provider-sync-policy");
        let repo = root.join("repo");
        let worktree_base = root.join("worktrees");
        init_git_repo(&repo)?;

        let (service, _task_state) = build_service(&root)?;
        let repo_path = repo.to_string_lossy().to_string();
        service.workspace_add(repo_path.as_str())?;
        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                ..RepoConfig::default()
            },
        )?;

        let policy = PullRequestProviderService::new(&service).sync_policy(repo_path.as_str())?;
        assert_eq!(policy.provider_id, "github");
        assert!(!policy.available);
        assert!(policy.context.is_none());

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn store_linked_pull_request_metadata_clears_direct_merge_record() -> Result<()> {
        let root = unique_temp_path("provider-store-link");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let (service, task_state) = build_service(&root)?;
        let repo_path = repo.to_string_lossy().to_string();
        service.workspace_add(repo_path.as_str())?;

        task_state
            .lock()
            .expect("task state lock poisoned")
            .direct_merge_records
            .insert(
                "task-1".to_string(),
                host_domain::DirectMergeRecord {
                    method: host_domain::GitMergeMethod::MergeCommit,
                    source_branch: "odt/task-1".to_string(),
                    target_branch: host_domain::GitTargetBranch {
                        remote: Some("origin".to_string()),
                        branch: "main".to_string(),
                    },
                    merged_at: "2026-03-11T10:00:00Z".to_string(),
                },
            );

        let record = PullRequestProviderService::new(&service).store_linked_pull_request_metadata(
            repo_path.as_str(),
            "task-1",
            ResolvedPullRequest {
                record: PullRequestRecord {
                    provider_id: "github".to_string(),
                    number: 17,
                    url: "https://github.com/openai/openducktor/pull/17".to_string(),
                    state: "open".to_string(),
                    created_at: "2026-03-11T10:00:00Z".to_string(),
                    updated_at: "2026-03-11T10:10:00Z".to_string(),
                    last_synced_at: None,
                    merged_at: None,
                    closed_at: None,
                },
                source_branch: "odt/task-1".to_string(),
            },
        )?;

        let state = task_state.lock().expect("task state lock poisoned");
        assert_eq!(record.number, 17);
        assert!(!state.direct_merge_records.contains_key("task-1"));
        assert_eq!(
            state
                .pull_requests
                .get("task-1")
                .map(|pull_request| pull_request.number),
            Some(17)
        );

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn store_linked_pull_request_metadata_is_atomic_in_fake_store() -> Result<()> {
        let root = unique_temp_path("provider-store-link-atomic");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let (service, task_state) = build_service(&root)?;
        let repo_path = repo.to_string_lossy().to_string();
        service.workspace_add(repo_path.as_str())?;

        {
            let mut state = task_state.lock().expect("task state lock poisoned");
            state.set_delivery_metadata_error = Some("boom".to_string());
            state.direct_merge_records.insert(
                "task-1".to_string(),
                host_domain::DirectMergeRecord {
                    method: host_domain::GitMergeMethod::MergeCommit,
                    source_branch: "odt/task-1".to_string(),
                    target_branch: host_domain::GitTargetBranch {
                        remote: Some("origin".to_string()),
                        branch: "main".to_string(),
                    },
                    merged_at: "2026-03-11T10:00:00Z".to_string(),
                },
            );
        }

        let error = PullRequestProviderService::new(&service)
            .store_linked_pull_request_metadata(
                repo_path.as_str(),
                "task-1",
                ResolvedPullRequest {
                    record: PullRequestRecord {
                        provider_id: "github".to_string(),
                        number: 17,
                        url: "https://github.com/openai/openducktor/pull/17".to_string(),
                        state: "open".to_string(),
                        created_at: "2026-03-11T10:00:00Z".to_string(),
                        updated_at: "2026-03-11T10:10:00Z".to_string(),
                        last_synced_at: None,
                        merged_at: None,
                        closed_at: None,
                    },
                    source_branch: "odt/task-1".to_string(),
                },
            )
            .expect_err("metadata update should fail");
        assert_eq!(error.to_string(), "boom");

        let state = task_state.lock().expect("task state lock poisoned");
        assert!(!state.pull_requests.contains_key("task-1"));
        assert!(state.direct_merge_records.contains_key("task-1"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }
}
