use crate::app_service::git_provider::{github_provider, GitHostingProvider};
use crate::app_service::service_core::AppService;
use anyhow::{anyhow, Result};
use host_domain::{
    now_rfc3339, DirectMergeRecord, GitMergeBranchRequest, GitMergeBranchResult, GitMergeMethod,
    GitDiffScope, GitProviderAvailability, GitProviderRepository, GitTargetBranch, PullRequestRecord,
    TaskApprovalContext, TaskCard, TaskStatus,
};
use std::path::Path;

impl AppService {
    pub fn task_approval_context_get(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<TaskApprovalContext> {
        let context = self.load_task_context(repo_path, task_id)?;
        ensure_human_approval_status(&context.task.status)?;
        let repo_config = self.workspace_get_repo_config(context.repo.repo_path.as_str())?;
        let metadata = self.task_metadata_get(context.repo.repo_path.as_str(), task_id)?;
        let working_directory = self
            .qa_review_target_get(context.repo.repo_path.as_str(), task_id)?
            .working_directory;
        let current_branch = self.git_port.get_current_branch(Path::new(&working_directory))?;
        if current_branch.detached {
            return Err(anyhow!(
                "Human approval requires a builder branch, but the latest builder workspace is detached."
            ));
        }
        let source_branch = current_branch
            .name
            .ok_or_else(|| anyhow!("Human approval requires a builder branch name."))?;
        let target_branch = normalize_approval_target_branch(&repo_config.default_target_branch)?;
        let publish_target = publish_target_branch(&repo_config.default_target_branch)?;
        let worktree_status = self.git_port.get_worktree_status_summary(
            Path::new(&working_directory),
            target_branch.canonical().as_str(),
            GitDiffScope::Uncommitted,
        )?;
        let config = self.config_store.load()?;

        Ok(TaskApprovalContext {
            task_id: task_id.to_string(),
            task_status: context.task.status.as_cli_value().to_string(),
            working_directory,
            source_branch,
            target_branch,
            publish_target,
            default_merge_method: to_domain_merge_method(config.git.default_merge_method),
            has_uncommitted_changes: worktree_status.file_status_counts.total > 0,
            uncommitted_file_count: worktree_status.file_status_counts.total,
            pull_request: metadata.pull_request,
            providers: vec![github_provider_availability(Path::new(&context.repo.repo_path), &repo_config)],
        })
    }

    pub fn task_direct_merge(
        &self,
        repo_path: &str,
        task_id: &str,
        method: GitMergeMethod,
    ) -> Result<TaskCard> {
        let approval = self.task_approval_context_get(repo_path, task_id)?;
        ensure_clean_builder_worktree(&approval)?;
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        match self.git_port.merge_branch(
            Path::new(&repo_path),
            GitMergeBranchRequest {
                source_branch: approval.source_branch.clone(),
                target_branch: approval.target_branch.canonical(),
                source_working_directory: Some(approval.working_directory.clone()),
                method: method.clone(),
            },
        )? {
            GitMergeBranchResult::Merged { .. } | GitMergeBranchResult::UpToDate { .. } => {}
            GitMergeBranchResult::Conflicts {
                conflicted_files,
                output,
            } => {
                return Err(anyhow!(
                    "Direct merge stopped on conflicts for task {task_id}: {}. {}",
                    conflicted_files.join(", "),
                    output
                ));
            }
        }

        self.cleanup_builder_workspace(
            repo_path.as_str(),
            approval.working_directory.as_str(),
            approval.source_branch.as_str(),
        )?;
        self.task_store.set_pull_request(
            Path::new(&repo_path),
            task_id,
            None,
        )?;
        self.task_store.set_direct_merge_record(
            Path::new(&repo_path),
            task_id,
            Some(DirectMergeRecord {
                method,
                source_branch: approval.source_branch,
                target_branch: approval.target_branch.display(),
                merged_at: now_rfc3339(),
            }),
        )?;

        self.task_transition(
            repo_path.as_str(),
            task_id,
            TaskStatus::Closed,
            Some("Human approved via direct merge"),
        )
    }

    pub fn task_pull_request_upsert(
        &self,
        repo_path: &str,
        task_id: &str,
        title: &str,
        body: &str,
    ) -> Result<PullRequestRecord> {
        let approval = self.task_approval_context_get(repo_path, task_id)?;
        ensure_clean_builder_worktree(&approval)?;
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        let repo_config = self.workspace_get_repo_config(repo_path.as_str())?;
        let provider = github_provider();
        if !provider.is_available() {
            return Err(anyhow!(
                "GitHub pull request support requires the gh CLI to be installed."
            ));
        }

        let github_config = repo_config.git.providers.get("github").cloned().unwrap_or_default();
        if !github_config.enabled {
            return Err(anyhow!(
                "GitHub pull request support is not enabled for this repository."
            ));
        }
        let repository =
            github_repository_from_config(&repo_config).ok_or_else(|| {
                anyhow!("GitHub pull request support requires repository coordinates.")
            })?;
        let remote_name = provider.resolve_remote_name(Path::new(&repo_path), &repository)?;
        let auth_status = provider.auth_status(repository.host.as_str())?;
        if !auth_status.authenticated {
            return Err(anyhow!(
                "{}",
                auth_status.error.unwrap_or_else(|| {
                    "GitHub authentication is not configured. Run `gh auth login`.".to_string()
                })
            ));
        }
        match self.git_push_branch(
            repo_path.as_str(),
            Some(approval.working_directory.as_str()),
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

        let pull_request = match approval.pull_request {
            Some(existing)
                if existing.provider_id == "github"
                    && is_editable_pull_request_state(existing.state.as_str()) =>
            {
                provider.update_pull_request(
                    Path::new(&repo_path),
                    &repository,
                    existing.number,
                    title.trim(),
                    body,
                )?
            }
            _ => provider.create_pull_request(
                Path::new(&repo_path),
                &repository,
                approval.source_branch.as_str(),
                approval.target_branch.checkout_branch().as_str(),
                title.trim(),
                body,
            )?,
        };

        self.task_store.set_direct_merge_record(Path::new(&repo_path), task_id, None)?;
        self.task_store.set_pull_request(
            Path::new(&repo_path),
            task_id,
            Some(pull_request.record.clone()),
        )?;

        let current_task = self.load_task_context(repo_path.as_str(), task_id)?.task;
        if current_task.status == TaskStatus::AiReview {
            let _ = self.task_transition(
                repo_path.as_str(),
                task_id,
                TaskStatus::HumanReview,
                Some("Human approved via pull request"),
            )?;
        }

        Ok(pull_request.record)
    }

    pub fn repo_pull_request_sync(&self, repo_path: &str) -> Result<bool> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        let tasks = self.task_store.list_tasks(Path::new(&repo_path))?;
        let provider = github_provider();
        if !provider.is_available() {
            return Ok(false);
        }
        let github_repository = github_repository_from_config(
            &self.workspace_get_repo_config(repo_path.as_str())?,
        );

        for task in tasks {
            if is_terminal_task_status(&task.status) {
                continue;
            }
            let Some(pull_request) =
                self.task_metadata_get(repo_path.as_str(), task.id.as_str())?.pull_request
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
            self.task_store.set_pull_request(
                Path::new(&repo_path),
                task.id.as_str(),
                Some(updated.record.clone()),
            )?;

            if updated.record.state == "merged" && task.status != TaskStatus::Closed {
                if let Some(cleanup_target) = latest_builder_cleanup_target(
                    self,
                    repo_path.as_str(),
                    task.id.as_str(),
                    Some(updated.source_branch.as_str()),
                )? {
                    self.cleanup_builder_workspace(
                        repo_path.as_str(),
                        cleanup_target.working_directory.as_str(),
                        cleanup_target.source_branch.as_str(),
                    )?;
                }
                let _ = self.task_transition(
                    repo_path.as_str(),
                    task.id.as_str(),
                    TaskStatus::Closed,
                    Some("Linked pull request merged"),
                )?;
            }
        }

        Ok(true)
    }

    pub fn auto_detect_git_provider_for_repo(&self, repo_path: &str) -> Result<()> {
        let repo_path = self.resolve_initialized_repo_path(repo_path)?;
        let mut repo_config = self.workspace_get_repo_config_optional(repo_path.as_str())?
            .unwrap_or_default();
        let existing = repo_config.git.providers.get("github").cloned().unwrap_or_default();
        if existing.repository.is_some() {
            return Ok(());
        }

        let provider = github_provider();
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
            let _ = self.workspace_update_repo_config(repo_path.as_str(), repo_config)?;
        }

        Ok(())
    }

    pub fn workspace_detect_github_repository(
        &self,
        repo_path: &str,
    ) -> Result<Option<host_infra_system::GitProviderRepository>> {
        let repo_path = self.resolve_initialized_repo_path(repo_path)?;
        let provider = github_provider();
        let detected = provider.detect_repository(Path::new(&repo_path))?;
        Ok(detected.map(|repository| to_config_repository(&repository)))
    }

    fn cleanup_builder_workspace(
        &self,
        repo_path: &str,
        working_directory: &str,
        source_branch: &str,
    ) -> Result<()> {
        let normalized_repo = std::fs::canonicalize(repo_path)
            .unwrap_or_else(|_| Path::new(repo_path).to_path_buf());
        let normalized_working_directory = std::fs::canonicalize(working_directory)
            .unwrap_or_else(|_| Path::new(working_directory).to_path_buf());

        if normalized_repo != normalized_working_directory && Path::new(working_directory).exists() {
            let _ = self.git_remove_worktree(repo_path, working_directory, false)?;
        }

        let branch_exists = self
            .git_port
            .get_branches(Path::new(repo_path))?
            .into_iter()
            .any(|branch| !branch.is_remote && branch.name == source_branch);
        if branch_exists {
            let _ = self.git_delete_local_branch(repo_path, source_branch, false)?;
        }

        Ok(())
    }
}

fn ensure_human_approval_status(status: &TaskStatus) -> Result<()> {
    if matches!(status, TaskStatus::AiReview | TaskStatus::HumanReview) {
        return Ok(());
    }

    Err(anyhow!(
        "Human approval is only allowed from ai_review or human_review."
    ))
}

fn is_terminal_task_status(status: &TaskStatus) -> bool {
    matches!(status, TaskStatus::Closed | TaskStatus::Deferred)
}

fn is_syncable_pull_request_state(state: &str) -> bool {
    matches!(state, "open" | "draft")
}

fn is_editable_pull_request_state(state: &str) -> bool {
    matches!(state, "open" | "draft")
}

fn ensure_clean_builder_worktree(approval: &TaskApprovalContext) -> Result<()> {
    if !approval.has_uncommitted_changes {
        return Ok(());
    }

    let file_label = if approval.uncommitted_file_count == 1 {
        "1 uncommitted file"
    } else {
        return Err(anyhow!(
            "Human approval is blocked because the builder worktree has {} uncommitted files. Commit or discard them before merging or opening a pull request.",
            approval.uncommitted_file_count
        ));
    };

    Err(anyhow!(
        "Human approval is blocked because the builder worktree has {file_label}. Commit or discard it before merging or opening a pull request."
    ))
}

fn github_provider_availability(
    repo_path: &Path,
    repo_config: &host_infra_system::RepoConfig,
) -> GitProviderAvailability {
    let provider = github_provider();
    let config = repo_config.git.providers.get("github").cloned().unwrap_or_default();
    if !config.enabled {
        return GitProviderAvailability {
            provider_id: "github".to_string(),
            enabled: false,
            available: false,
            reason: Some("GitHub provider is not enabled for this repository.".to_string()),
        };
    }
    if !provider.is_available() {
        return GitProviderAvailability {
            provider_id: "github".to_string(),
            enabled: true,
            available: false,
            reason: Some("gh CLI is not installed.".to_string()),
        };
    }
    let repository = match config.repository.as_ref() {
        Some(repository) => repository,
        None => {
            return GitProviderAvailability {
                provider_id: "github".to_string(),
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
                provider_id: "github".to_string(),
                enabled: true,
                available: false,
                reason: Some(format!("Failed to check GitHub authentication: {error}")),
            };
        }
    };
    if !auth_status.authenticated {
        return GitProviderAvailability {
            provider_id: "github".to_string(),
            enabled: true,
            available: false,
            reason: Some(auth_status.error.unwrap_or_else(|| {
                "GitHub authentication is not configured. Run `gh auth login`.".to_string()
            })),
        };
    }
    if let Err(error) = provider.resolve_remote_name(repo_path, &to_provider_repository(repository)) {
        return GitProviderAvailability {
            provider_id: "github".to_string(),
            enabled: true,
            available: false,
            reason: Some(error.to_string()),
        };
    }
    GitProviderAvailability {
        provider_id: "github".to_string(),
        enabled: true,
        available: true,
        reason: None,
    }
}

fn to_provider_repository(
    repository: &host_infra_system::GitProviderRepository,
) -> host_domain::GitProviderRepository {
    host_domain::GitProviderRepository {
        host: repository.host.clone(),
        owner: repository.owner.clone(),
        name: repository.name.clone(),
    }
}

fn github_repository_from_config(
    repo_config: &host_infra_system::RepoConfig,
) -> Option<GitProviderRepository> {
    repo_config
        .git
        .providers
        .get("github")
        .and_then(|config| config.repository.as_ref())
        .map(to_provider_repository)
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

fn to_domain_merge_method(method: host_infra_system::GitMergeMethod) -> GitMergeMethod {
    match method {
        host_infra_system::GitMergeMethod::MergeCommit => GitMergeMethod::MergeCommit,
        host_infra_system::GitMergeMethod::Squash => GitMergeMethod::Squash,
        host_infra_system::GitMergeMethod::Rebase => GitMergeMethod::Rebase,
    }
}

fn normalize_approval_target_branch(
    target_branch: &host_infra_system::GitTargetBranch,
) -> Result<GitTargetBranch> {
    let branch = target_branch.branch.trim();
    if branch.is_empty() {
        return Err(anyhow!("Human approval requires a target branch."));
    }
    if branch == "@{upstream}" {
        return Err(anyhow!(
            "Human approval requires an explicit target branch. '@{{upstream}}' is not supported for direct merge or pull requests."
        ));
    }
    Ok(GitTargetBranch {
        remote: target_branch.remote.clone(),
        branch: branch.to_string(),
    })
}

fn publish_target_branch(
    target_branch: &host_infra_system::GitTargetBranch,
) -> Result<Option<GitTargetBranch>> {
    let normalized = normalize_approval_target_branch(target_branch)?;
    if normalized.remote.is_some() {
        return Ok(Some(normalized));
    }
    Ok(None)
}

struct BuilderCleanupTarget {
    working_directory: String,
    source_branch: String,
}

fn latest_builder_cleanup_target(
    service: &AppService,
    repo_path: &str,
    task_id: &str,
    preferred_source_branch: Option<&str>,
) -> Result<Option<BuilderCleanupTarget>> {
    let sessions = service.agent_sessions_list(repo_path, task_id)?;
    let latest_builder_session = sessions
        .into_iter()
        .filter(|session| session.role == "build")
        .max_by(|left, right| {
            let left_key = left.updated_at.as_deref().unwrap_or(left.started_at.as_str());
            let right_key = right.updated_at.as_deref().unwrap_or(right.started_at.as_str());
            left_key
                .cmp(right_key)
                .then_with(|| left.started_at.cmp(&right.started_at))
                .then_with(|| left.session_id.cmp(&right.session_id))
        });

    let Some(session) = latest_builder_session else {
        return Ok(None);
    };

    let working_directory = session.working_directory.trim().to_string();
    if working_directory.is_empty() {
        return Ok(None);
    }

    let source_branch = if let Some(branch) = preferred_source_branch.filter(|value| !value.trim().is_empty()) {
        branch.trim().to_string()
    } else if Path::new(working_directory.as_str()).exists() {
        let current_branch = service
            .git_port
            .get_current_branch(Path::new(working_directory.as_str()))?;
        match current_branch.name {
            Some(name) if !name.trim().is_empty() => name,
            _ => return Ok(None),
        }
    } else {
        return Ok(None);
    };

    Ok(Some(BuilderCleanupTarget {
        working_directory,
        source_branch,
    }))
}
