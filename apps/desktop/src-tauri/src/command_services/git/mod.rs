pub(crate) mod authorization;
pub(crate) mod requests;
pub(crate) mod snapshot;

use crate::command_services::error::{CommandServiceError, CommandServiceResult};
use host_application::AppService;
use requests::*;
use std::{
    path::Path,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

pub(crate) use snapshot::{
    build_worktree_status_summary_with_snapshot, build_worktree_status_with_snapshot,
    hash_worktree_diff_payload, hash_worktree_diff_summary_payload, hash_worktree_status_payload,
    WorktreeSnapshotMetadata, GIT_WORKTREE_HASH_VERSION,
};

#[cfg(test)]
pub(crate) use authorization::{
    authorized_worktree_cache, cache_key, read_git_common_dir, read_worktree_state_token,
    AuthorizedWorktreeCacheEntry,
};
pub(crate) use authorization::{
    invalidate_worktree_resolution_cache_for_repo, resolve_working_dir,
};

pub(crate) struct AuthorizedGitScope {
    pub(crate) repo_path: String,
    pub(crate) effective_working_dir: String,
}

fn request_error(error: impl std::fmt::Display) -> CommandServiceError {
    CommandServiceError::invalid_request(error.to_string())
}

fn service_error(error: anyhow::Error) -> CommandServiceError {
    CommandServiceError::internal(error)
}

pub(crate) fn authorize_git_scope(
    service: &AppService,
    repo_path: &str,
    working_dir: Option<&str>,
) -> CommandServiceResult<AuthorizedGitScope> {
    let repo_path = service
        .resolve_authorized_repo_path(repo_path)
        .map_err(request_error)?;
    let effective_working_dir = resolve_working_dir(repo_path.as_str(), working_dir)
        .map_err(CommandServiceError::invalid_request)?;

    Ok(AuthorizedGitScope {
        repo_path,
        effective_working_dir,
    })
}

pub(crate) fn parse_diff_scope(
    diff_scope: Option<&str>,
) -> CommandServiceResult<host_domain::GitDiffScope> {
    match diff_scope.unwrap_or("target") {
        "target" => Ok(host_domain::GitDiffScope::Target),
        "uncommitted" => Ok(host_domain::GitDiffScope::Uncommitted),
        value => Err(CommandServiceError::invalid_request(format!(
            "diffScope must be either 'target' or 'uncommitted', got: {value}"
        ))),
    }
}

pub(crate) fn require_target_branch(target_branch: &str) -> CommandServiceResult<&str> {
    let trimmed_target = target_branch.trim();
    if trimmed_target.is_empty() {
        return Err(CommandServiceError::invalid_request(
            "targetBranch is required",
        ));
    }
    Ok(trimmed_target)
}

pub(crate) fn require_commit_message(message: &str) -> CommandServiceResult<&str> {
    let trimmed_message = message.trim();
    if trimmed_message.is_empty() {
        return Err(CommandServiceError::invalid_request("message is required"));
    }
    Ok(trimmed_message)
}

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn build_worktree_snapshot_metadata(
    effective_working_dir: String,
    target_branch: String,
    diff_scope: host_domain::GitDiffScope,
    status_hash: String,
    diff_hash: String,
) -> WorktreeSnapshotMetadata {
    WorktreeSnapshotMetadata {
        effective_working_dir,
        target_branch,
        diff_scope,
        observed_at_ms: current_timestamp_ms(),
        hash_version: GIT_WORKTREE_HASH_VERSION,
        status_hash,
        diff_hash,
    }
}

pub(crate) fn get_branches(
    service: Arc<AppService>,
    request: GitRepoRequest,
) -> CommandServiceResult<Vec<host_domain::GitBranch>> {
    let scope = authorize_git_scope(&service, &request.repo_path, None)?;
    service
        .git_get_branches(&scope.repo_path)
        .map_err(service_error)
}

pub(crate) fn get_current_branch(
    service: Arc<AppService>,
    request: GitCurrentBranchRequest,
) -> CommandServiceResult<host_domain::GitCurrentBranch> {
    let scope = authorize_git_scope(&service, &request.repo_path, request.working_dir.as_deref())?;
    service
        .git_port()
        .get_current_branch(Path::new(&scope.effective_working_dir))
        .map_err(service_error)
}

pub(crate) fn switch_branch(
    service: Arc<AppService>,
    request: GitSwitchBranchRequest,
) -> CommandServiceResult<host_domain::GitCurrentBranch> {
    let scope = authorize_git_scope(&service, &request.repo_path, None)?;
    service
        .git_switch_branch(
            &scope.repo_path,
            &request.branch,
            request.create.unwrap_or(false),
        )
        .map_err(service_error)
}

pub(crate) fn create_worktree(
    service: Arc<AppService>,
    request: GitCreateWorktreeRequest,
) -> CommandServiceResult<host_domain::GitWorktreeSummary> {
    let scope = authorize_git_scope(&service, &request.repo_path, None)?;
    let summary = service
        .git_create_worktree(
            &scope.repo_path,
            &request.worktree_path,
            &request.branch,
            request.create_branch.unwrap_or(false),
        )
        .map_err(service_error)?;
    invalidate_worktree_resolution_cache_for_repo(&scope.repo_path)
        .map_err(|error| CommandServiceError::internal(anyhow::anyhow!(error)))?;
    Ok(summary)
}

pub(crate) fn remove_worktree(
    service: Arc<AppService>,
    request: GitRemoveWorktreeRequest,
) -> CommandServiceResult<bool> {
    let scope = authorize_git_scope(&service, &request.repo_path, None)?;
    let removed = service
        .git_remove_worktree(
            &scope.repo_path,
            &request.worktree_path,
            request.force.unwrap_or(false),
        )
        .map_err(service_error)?;
    invalidate_worktree_resolution_cache_for_repo(&scope.repo_path)
        .map_err(|error| CommandServiceError::internal(anyhow::anyhow!(error)))?;
    Ok(removed)
}

pub(crate) fn push_branch(
    service: Arc<AppService>,
    request: GitPushBranchRequest,
) -> CommandServiceResult<host_domain::GitPushResult> {
    let scope = authorize_git_scope(&service, &request.repo_path, request.working_dir.as_deref())?;
    service
        .git_push_branch(
            &scope.repo_path,
            Some(scope.effective_working_dir.as_str()),
            request.remote.as_deref(),
            &request.branch,
            request.set_upstream.unwrap_or(false),
            request.force_with_lease.unwrap_or(false),
        )
        .map_err(service_error)
}

pub(crate) fn get_status(
    service: Arc<AppService>,
    request: GitStatusRequest,
) -> CommandServiceResult<Vec<host_domain::GitFileStatus>> {
    let scope = authorize_git_scope(&service, &request.repo_path, request.working_dir.as_deref())?;
    service
        .git_port()
        .get_status(Path::new(&scope.effective_working_dir))
        .map_err(service_error)
}

pub(crate) fn get_diff(
    service: Arc<AppService>,
    request: GitDiffRequest,
) -> CommandServiceResult<Vec<host_domain::GitFileDiff>> {
    let scope = authorize_git_scope(&service, &request.repo_path, request.working_dir.as_deref())?;
    service
        .git_port()
        .get_diff(
            Path::new(&scope.effective_working_dir),
            request.target_branch.as_deref(),
        )
        .map_err(service_error)
}

pub(crate) fn commits_ahead_behind(
    service: Arc<AppService>,
    request: GitAheadBehindRequest,
) -> CommandServiceResult<host_domain::GitAheadBehind> {
    let scope = authorize_git_scope(&service, &request.repo_path, request.working_dir.as_deref())?;
    service
        .git_port()
        .commits_ahead_behind(
            Path::new(&scope.effective_working_dir),
            &request.target_branch,
        )
        .map_err(service_error)
}

pub(crate) fn get_worktree_status(
    service: Arc<AppService>,
    request: GitWorktreeStatusRequest,
) -> CommandServiceResult<host_domain::GitWorktreeStatus> {
    let git_scope =
        authorize_git_scope(&service, &request.repo_path, request.working_dir.as_deref())?;
    let target_branch = require_target_branch(&request.target_branch)?.to_string();
    let diff_scope = parse_diff_scope(request.diff_scope.as_deref())?;
    let worktree_status = service
        .git_port()
        .get_worktree_status(
            Path::new(&git_scope.effective_working_dir),
            &target_branch,
            diff_scope.clone(),
        )
        .map_err(service_error)?;
    let status_hash = hash_worktree_status_payload(
        &worktree_status.current_branch,
        worktree_status.file_statuses.as_slice(),
        &worktree_status.target_ahead_behind,
        &worktree_status.upstream_ahead_behind,
    );
    let diff_hash = hash_worktree_diff_payload(worktree_status.file_diffs.as_slice());

    Ok(build_worktree_status_with_snapshot(
        worktree_status,
        build_worktree_snapshot_metadata(
            git_scope.effective_working_dir,
            target_branch,
            diff_scope,
            status_hash,
            diff_hash,
        ),
    ))
}

pub(crate) fn get_worktree_status_summary(
    service: Arc<AppService>,
    request: GitWorktreeStatusRequest,
) -> CommandServiceResult<host_domain::GitWorktreeStatusSummary> {
    let git_scope =
        authorize_git_scope(&service, &request.repo_path, request.working_dir.as_deref())?;
    let target_branch = require_target_branch(&request.target_branch)?.to_string();
    let diff_scope = parse_diff_scope(request.diff_scope.as_deref())?;
    let summary = service
        .git_port()
        .get_worktree_status_summary(
            Path::new(&git_scope.effective_working_dir),
            &target_branch,
            diff_scope.clone(),
        )
        .map_err(service_error)?;

    let status_hash = hash_worktree_status_payload(
        &summary.current_branch,
        summary.file_statuses.as_slice(),
        &summary.target_ahead_behind,
        &summary.upstream_ahead_behind,
    );
    let diff_hash = hash_worktree_diff_summary_payload(
        &diff_scope,
        &summary.target_ahead_behind,
        &summary.file_status_counts,
    );

    Ok(build_worktree_status_summary_with_snapshot(
        summary.current_branch,
        summary.file_status_counts,
        summary.target_ahead_behind,
        summary.upstream_ahead_behind,
        summary.git_conflict,
        build_worktree_snapshot_metadata(
            git_scope.effective_working_dir,
            target_branch,
            diff_scope,
            status_hash,
            diff_hash,
        ),
    ))
}

pub(crate) fn commit_all(
    service: Arc<AppService>,
    request: GitCommitAllCommandRequest,
) -> CommandServiceResult<host_domain::GitCommitAllResult> {
    let scope = authorize_git_scope(&service, &request.repo_path, request.working_dir.as_deref())?;
    let message = require_commit_message(&request.message)?.to_string();
    service
        .git_commit_all(
            &scope.repo_path,
            host_domain::GitCommitAllRequest {
                working_dir: Some(scope.effective_working_dir),
                message,
            },
        )
        .map_err(service_error)
}

pub(crate) fn reset_worktree_selection(
    service: Arc<AppService>,
    request: GitResetWorktreeSelectionCommandRequest,
) -> CommandServiceResult<host_domain::GitResetWorktreeSelectionResult> {
    let scope = authorize_git_scope(&service, &request.repo_path, request.working_dir.as_deref())?;
    let target_branch = require_target_branch(&request.target_branch)?.to_string();
    service
        .git_reset_worktree_selection(
            &scope.repo_path,
            host_domain::GitResetWorktreeSelectionRequest {
                working_dir: Some(scope.effective_working_dir),
                target_branch,
                snapshot: request.snapshot,
                selection: request.selection,
            },
        )
        .map_err(service_error)
}

pub(crate) fn fetch_remote(
    service: Arc<AppService>,
    request: GitFetchRemoteRequest,
) -> CommandServiceResult<host_domain::GitFetchResult> {
    let scope = authorize_git_scope(&service, &request.repo_path, request.working_dir.as_deref())?;
    let target_branch = require_target_branch(&request.target_branch)?.to_string();
    service
        .git_fetch_remote(
            &scope.repo_path,
            host_domain::GitFetchRequest {
                working_dir: Some(scope.effective_working_dir),
                target_branch,
            },
        )
        .map_err(service_error)
}

pub(crate) fn pull_branch(
    service: Arc<AppService>,
    request: GitPullBranchRequest,
) -> CommandServiceResult<host_domain::GitPullResult> {
    let scope = authorize_git_scope(&service, &request.repo_path, request.working_dir.as_deref())?;
    service
        .git_pull_branch(
            &scope.repo_path,
            host_domain::GitPullRequest {
                working_dir: Some(scope.effective_working_dir),
            },
        )
        .map_err(service_error)
}

pub(crate) fn rebase_branch(
    service: Arc<AppService>,
    request: GitRebaseBranchCommandRequest,
) -> CommandServiceResult<host_domain::GitRebaseBranchResult> {
    let scope = authorize_git_scope(&service, &request.repo_path, request.working_dir.as_deref())?;
    let target_branch = require_target_branch(&request.target_branch)?.to_string();
    service
        .git_rebase_branch(
            &scope.repo_path,
            host_domain::GitRebaseBranchRequest {
                working_dir: Some(scope.effective_working_dir),
                target_branch,
            },
        )
        .map_err(service_error)
}

pub(crate) fn rebase_abort(
    service: Arc<AppService>,
    request: GitRebaseAbortCommandRequest,
) -> CommandServiceResult<host_domain::GitRebaseAbortResult> {
    let scope = authorize_git_scope(&service, &request.repo_path, request.working_dir.as_deref())?;
    service
        .git_rebase_abort(
            &scope.repo_path,
            host_domain::GitRebaseAbortRequest {
                working_dir: Some(scope.effective_working_dir),
            },
        )
        .map_err(service_error)
}

pub(crate) fn abort_conflict(
    service: Arc<AppService>,
    request: GitConflictAbortCommandRequest,
) -> CommandServiceResult<host_domain::GitConflictAbortResult> {
    let scope = authorize_git_scope(&service, &request.repo_path, request.working_dir.as_deref())?;
    service
        .git_abort_conflict(
            &scope.repo_path,
            host_domain::GitConflictAbortRequest {
                operation: request.operation,
                working_dir: Some(scope.effective_working_dir),
            },
        )
        .map_err(service_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_diff_scope_accepts_supported_values() -> CommandServiceResult<()> {
        assert_eq!(parse_diff_scope(None)?, host_domain::GitDiffScope::Target);
        assert_eq!(
            parse_diff_scope(Some("target"))?,
            host_domain::GitDiffScope::Target
        );
        assert_eq!(
            parse_diff_scope(Some("uncommitted"))?,
            host_domain::GitDiffScope::Uncommitted
        );
        Ok(())
    }

    #[test]
    fn parse_diff_scope_rejects_unknown_values() {
        let error = parse_diff_scope(Some("staged")).expect_err("invalid scope should fail");

        assert_eq!(
            error.to_string(),
            "diffScope must be either 'target' or 'uncommitted', got: staged"
        );
    }

    #[test]
    fn required_git_fields_reject_blank_values() {
        assert_eq!(
            require_target_branch("   ")
                .expect_err("blank target branch should fail")
                .to_string(),
            "targetBranch is required"
        );
        assert_eq!(
            require_commit_message("   ")
                .expect_err("blank message should fail")
                .to_string(),
            "message is required"
        );
    }
}
