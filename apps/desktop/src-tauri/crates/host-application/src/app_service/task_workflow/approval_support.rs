use crate::app_service::git_provider::{github_provider, GitHostingProvider, ResolvedPullRequest};
use crate::app_service::service_core::AppService;
use anyhow::{anyhow, Result};
use host_domain::{
    now_rfc3339, DirectMergeRecord, GitConflict, GitConflictOperation, GitMergeMethod,
    GitProviderAvailability, GitProviderRepository, GitTargetBranch, PullRequestRecord,
    TaskApprovalContext, TaskStatus,
};
use std::path::Path;

pub(super) fn ensure_human_approval_status(status: &TaskStatus) -> Result<()> {
    if matches!(status, TaskStatus::AiReview | TaskStatus::HumanReview) {
        return Ok(());
    }

    Err(anyhow!(
        "Human approval is only allowed from ai_review or human_review."
    ))
}

pub(super) fn is_terminal_task_status(status: &TaskStatus) -> bool {
    matches!(status, TaskStatus::Closed | TaskStatus::Deferred)
}

pub(super) fn ensure_pull_request_management_status(status: &TaskStatus) -> Result<()> {
    if matches!(
        status,
        TaskStatus::InProgress | TaskStatus::AiReview | TaskStatus::HumanReview
    ) {
        return Ok(());
    }

    Err(anyhow!(
        "Pull request management is only available from in_progress, ai_review, or human_review."
    ))
}

pub(super) fn is_syncable_pull_request_state(state: &str) -> bool {
    matches!(state, "open" | "draft")
}

pub(super) fn is_editable_pull_request_state(state: &str) -> bool {
    matches!(state, "open" | "draft")
}

pub(super) fn ensure_clean_builder_worktree(approval: &TaskApprovalContext) -> Result<()> {
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

pub(super) fn direct_merge_conflict(
    repo_path: &str,
    approval: &TaskApprovalContext,
    method: &GitMergeMethod,
    conflicted_files: Vec<String>,
    output: String,
) -> GitConflict {
    let (operation, current_branch, working_dir) = match method {
        GitMergeMethod::MergeCommit => (
            GitConflictOperation::DirectMergeMergeCommit,
            Some(approval.target_branch.checkout_branch()),
            Some(repo_path.to_string()),
        ),
        GitMergeMethod::Squash => (
            GitConflictOperation::DirectMergeSquash,
            Some(approval.target_branch.checkout_branch()),
            Some(repo_path.to_string()),
        ),
        GitMergeMethod::Rebase => (
            GitConflictOperation::DirectMergeRebase,
            Some(approval.source_branch.clone()),
            approval.working_directory.clone(),
        ),
    };

    GitConflict {
        operation,
        current_branch,
        target_branch: approval.target_branch.canonical(),
        conflicted_files,
        output,
        working_dir,
    }
}

pub(super) fn to_provider_repository(
    repository: &host_infra_system::GitProviderRepository,
) -> GitProviderRepository {
    GitProviderRepository {
        host: repository.host.clone(),
        owner: repository.owner.clone(),
        name: repository.name.clone(),
    }
}

pub(super) fn github_repository_from_config(
    repo_config: &host_infra_system::RepoConfig,
) -> Option<GitProviderRepository> {
    repo_config
        .git
        .providers
        .get("github")
        .and_then(|config| config.repository.as_ref())
        .map(to_provider_repository)
}

pub(super) fn to_config_repository(
    repository: &host_domain::GitProviderRepository,
) -> host_infra_system::GitProviderRepository {
    host_infra_system::GitProviderRepository {
        host: repository.host.clone(),
        owner: repository.owner.clone(),
        name: repository.name.clone(),
    }
}

pub(super) fn to_domain_merge_method(method: host_infra_system::GitMergeMethod) -> GitMergeMethod {
    match method {
        host_infra_system::GitMergeMethod::MergeCommit => GitMergeMethod::MergeCommit,
        host_infra_system::GitMergeMethod::Squash => GitMergeMethod::Squash,
        host_infra_system::GitMergeMethod::Rebase => GitMergeMethod::Rebase,
    }
}

pub(super) fn normalize_approval_target_branch(
    target_branch: &host_infra_system::GitTargetBranch,
) -> Result<GitTargetBranch> {
    normalize_target_branch(
        target_branch.remote.as_deref(),
        target_branch.branch.as_str(),
    )
}

pub(super) fn normalize_recorded_target_branch(
    target_branch: &GitTargetBranch,
) -> Result<GitTargetBranch> {
    normalize_target_branch(
        target_branch.remote.as_deref(),
        target_branch.branch.as_str(),
    )
}

pub(super) fn publish_target_branch(
    target_branch: &host_infra_system::GitTargetBranch,
) -> Result<Option<GitTargetBranch>> {
    let normalized = normalize_approval_target_branch(target_branch)?;
    publish_target_from_normalized(normalized)
}

pub(super) fn publish_recorded_target_branch(
    target_branch: &GitTargetBranch,
) -> Result<Option<GitTargetBranch>> {
    let normalized = normalize_recorded_target_branch(target_branch)?;
    publish_target_from_normalized(normalized)
}

fn normalize_target_branch(remote: Option<&str>, branch: &str) -> Result<GitTargetBranch> {
    let branch = branch.trim();
    if branch.is_empty() {
        return Err(anyhow!("Human approval requires a target branch."));
    }
    if branch == "@{upstream}" {
        return Err(anyhow!(
            "Human approval requires an explicit target branch. '@{{upstream}}' is not supported for direct merge or pull requests."
        ));
    }
    Ok(GitTargetBranch {
        remote: remote.map(ToOwned::to_owned),
        branch: branch.to_string(),
    })
}

fn publish_target_from_normalized(normalized: GitTargetBranch) -> Result<Option<GitTargetBranch>> {
    if normalized.remote.is_some() {
        return Ok(Some(normalized));
    }
    Ok(None)
}

pub(super) struct BuilderCleanupTarget {
    pub(super) working_directory: String,
}

pub(super) fn latest_builder_cleanup_target(
    service: &AppService,
    repo_path: &str,
    task_id: &str,
    preferred_source_branch: Option<&str>,
) -> Result<Option<BuilderCleanupTarget>> {
    let sessions = service.agent_sessions_list(repo_path, task_id)?;
    let mut builder_sessions = sessions
        .into_iter()
        .filter(|session| session.role == "build")
        .collect::<Vec<_>>();
    builder_sessions.sort_by(|left, right| {
        let left_key = left.started_at.as_str();
        let right_key = right.started_at.as_str();
        left_key
            .cmp(right_key)
            .then_with(|| left.session_id.cmp(&right.session_id))
    });
    builder_sessions.reverse();

    for session in builder_sessions {
        let working_directory = session.working_directory.trim().to_string();
        if working_directory.is_empty() {
            continue;
        }
        if !Path::new(working_directory.as_str()).exists() {
            continue;
        }
        let current_branch = service
            .git_port
            .get_current_branch(Path::new(working_directory.as_str()))?;
        let current_branch_name = match current_branch.name {
            Some(name) => {
                let trimmed = name.trim().to_string();
                if trimmed.is_empty() {
                    continue;
                }
                trimmed
            }
            None => continue,
        };
        if preferred_source_branch
            .map(str::trim)
            .is_some_and(|expected| current_branch_name != expected)
        {
            continue;
        }

        return Ok(Some(BuilderCleanupTarget { working_directory }));
    }

    Ok(None)
}

pub(super) fn github_provider_availability(
    repo_path: &Path,
    repo_config: &host_infra_system::RepoConfig,
) -> GitProviderAvailability {
    let provider = github_provider();
    let config = repo_config
        .git
        .providers
        .get("github")
        .cloned()
        .unwrap_or_default();
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
    let repository = to_provider_repository(repository);
    if let Err(error) = provider.resolve_remote_name(repo_path, &repository) {
        return GitProviderAvailability {
            provider_id: "github".to_string(),
            enabled: true,
            available: false,
            reason: Some(format!(
                "No matching Git remote is configured for {}/{} on {}: {error}",
                repository.owner, repository.name, repository.host
            )),
        };
    }
    GitProviderAvailability {
        provider_id: "github".to_string(),
        enabled: true,
        available: true,
        reason: None,
    }
}

pub(super) fn store_linked_pull_request_metadata(
    service: &AppService,
    repo_path: &str,
    task_id: &str,
    pull_request: ResolvedPullRequest,
) -> Result<PullRequestRecord> {
    service
        .task_store
        .set_direct_merge_record(Path::new(repo_path), task_id, None)?;
    service.task_store.set_pull_request(
        Path::new(repo_path),
        task_id,
        Some(pull_request.record.clone()),
    )?;

    Ok(pull_request.record)
}

pub(super) fn direct_merge_record(
    method: GitMergeMethod,
    approval: &TaskApprovalContext,
) -> DirectMergeRecord {
    DirectMergeRecord {
        method,
        source_branch: approval.source_branch.clone(),
        target_branch: approval.target_branch.clone(),
        merged_at: now_rfc3339(),
    }
}
