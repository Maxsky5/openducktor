use super::command_registry::CommandRegistry;
use super::command_support::{
    deserialize_args, handle_repo_path_operation_blocking, invalidate_repo_worktree_cache,
    request_error, run_headless_blocking, serialize_value, CommandResult, HeadlessCommandError,
    HeadlessState,
};
use crate::commands::git::{
    build_worktree_status_summary_with_snapshot, build_worktree_status_with_snapshot,
    hash_worktree_diff_payload, hash_worktree_diff_summary_payload, hash_worktree_status_payload,
    parse_diff_scope, require_target_branch, resolve_working_dir, WorktreeSnapshotMetadata,
    GIT_WORKTREE_HASH_VERSION,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitCurrentBranchArgs {
    repo_path: String,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitSwitchBranchArgs {
    repo_path: String,
    branch: String,
    create: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitCreateWorktreeArgs {
    repo_path: String,
    worktree_path: String,
    branch: String,
    create_branch: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitRemoveWorktreeArgs {
    repo_path: String,
    worktree_path: String,
    force: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitPushBranchArgs {
    repo_path: String,
    branch: String,
    working_dir: Option<String>,
    remote: Option<String>,
    set_upstream: Option<bool>,
    force_with_lease: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitStatusArgs {
    repo_path: String,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitDiffArgs {
    repo_path: String,
    target_branch: Option<String>,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitAheadBehindArgs {
    repo_path: String,
    target_branch: String,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitPullBranchArgs {
    repo_path: String,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitResetWorktreeSelectionArgs {
    repo_path: String,
    target_branch: String,
    snapshot: host_domain::GitResetSnapshot,
    selection: host_domain::GitResetWorktreeSelection,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitRebaseAbortArgs {
    repo_path: String,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitConflictAbortArgs {
    repo_path: String,
    operation: host_domain::GitConflictOperation,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitWorktreeStatusArgs {
    repo_path: String,
    target_branch: String,
    diff_scope: Option<String>,
    working_dir: Option<String>,
}

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn resolve_authorized_working_dir(
    state: &HeadlessState,
    repo_path: &str,
    working_dir: Option<&str>,
) -> Result<String, HeadlessCommandError> {
    state
        .service
        .resolve_authorized_repo_path(repo_path)
        .map_err(request_error)?;
    resolve_working_dir(repo_path, working_dir).map_err(request_error)
}

fn require_git_commit_message(message: &str) -> Result<String, HeadlessCommandError> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err(HeadlessCommandError::bad_request("message is required"));
    }
    Ok(trimmed.to_string())
}

fn require_git_rebase_target_branch(target_branch: &str) -> Result<String, HeadlessCommandError> {
    let trimmed = target_branch.trim();
    if trimmed.is_empty() {
        return Err(HeadlessCommandError::bad_request(
            "targetBranch is required",
        ));
    }
    Ok(trimmed.to_string())
}

fn build_worktree_snapshot_metadata(
    effective_working_dir: String,
    target_branch: &str,
    diff_scope: host_domain::GitDiffScope,
    status_hash: String,
    diff_hash: String,
) -> WorktreeSnapshotMetadata {
    WorktreeSnapshotMetadata {
        effective_working_dir,
        target_branch: target_branch.to_string(),
        diff_scope,
        observed_at_ms: current_timestamp_ms(),
        hash_version: GIT_WORKTREE_HASH_VERSION,
        status_hash,
        diff_hash,
    }
}

pub(super) fn register_commands(registry: &mut CommandRegistry) -> Result<(), String> {
    registry.register("git_get_branches", |state, args| {
        Box::pin(async move {
            handle_repo_path_operation_blocking(
                state,
                args,
                "git_get_branches",
                |service, repo_path| service.git_get_branches(&repo_path),
            )
            .await
        })
    })?;
    registry.register("git_get_current_branch", |state, args| {
        Box::pin(handle_git_get_current_branch(state, args))
    })?;
    registry.register("git_switch_branch", |state, args| {
        Box::pin(handle_git_switch_branch(state, args))
    })?;
    registry.register("git_create_worktree", |state, args| {
        Box::pin(handle_git_create_worktree(state, args))
    })?;
    registry.register("git_remove_worktree", |state, args| {
        Box::pin(handle_git_remove_worktree(state, args))
    })?;
    registry.register("git_push_branch", |state, args| {
        Box::pin(handle_git_push_branch(state, args))
    })?;
    registry.register("git_get_status", |state, args| {
        Box::pin(handle_git_get_status(state, args))
    })?;
    registry.register("git_get_diff", |state, args| {
        Box::pin(handle_git_get_diff(state, args))
    })?;
    registry.register("git_commits_ahead_behind", |state, args| {
        Box::pin(handle_git_commits_ahead_behind(state, args))
    })?;
    registry.register("git_get_worktree_status", |state, args| {
        Box::pin(handle_git_get_worktree_status(state, args))
    })?;
    registry.register("git_get_worktree_status_summary", |state, args| {
        Box::pin(handle_git_get_worktree_status_summary(state, args))
    })?;
    registry.register("git_commit_all", |state, args| {
        Box::pin(handle_git_commit_all(state, args))
    })?;
    registry.register("git_reset_worktree_selection", |state, args| {
        Box::pin(handle_git_reset_worktree_selection(state, args))
    })?;
    registry.register("git_pull_branch", |state, args| {
        Box::pin(handle_git_pull_branch(state, args))
    })?;
    registry.register("git_rebase_branch", |state, args| {
        Box::pin(handle_git_rebase_branch(state, args))
    })?;
    registry.register("git_rebase_abort", |state, args| {
        Box::pin(handle_git_rebase_abort(state, args))
    })?;
    registry.register("git_abort_conflict", |state, args| {
        Box::pin(handle_git_abort_conflict(state, args))
    })?;
    Ok(())
}

async fn handle_git_get_current_branch(state: &HeadlessState, args: Value) -> CommandResult {
    let GitCurrentBranchArgs {
        repo_path,
        working_dir,
    } = deserialize_args(args)?;
    let effective = resolve_authorized_working_dir(state, &repo_path, working_dir.as_deref())?;
    let service = state.service.clone();
    serialize_value(
        run_headless_blocking("git_get_current_branch", move || {
            service
                .git_port()
                .get_current_branch(std::path::Path::new(&effective))
        })
        .await?,
    )
}

async fn handle_git_switch_branch(state: &HeadlessState, args: Value) -> CommandResult {
    let GitSwitchBranchArgs {
        repo_path,
        branch,
        create,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    let create = create.unwrap_or(false);
    serialize_value(
        run_headless_blocking("git_switch_branch", move || {
            service.git_switch_branch(&repo_path, &branch, create)
        })
        .await?,
    )
}

async fn handle_git_create_worktree(state: &HeadlessState, args: Value) -> CommandResult {
    let GitCreateWorktreeArgs {
        repo_path,
        worktree_path,
        branch,
        create_branch,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    let create_branch = create_branch.unwrap_or(false);
    let repo_path_for_worker = repo_path.clone();
    let summary = run_headless_blocking("git_create_worktree", move || {
        service.git_create_worktree(
            &repo_path_for_worker,
            &worktree_path,
            &branch,
            create_branch,
        )
    })
    .await?;
    invalidate_repo_worktree_cache(&repo_path)?;
    serialize_value(summary)
}

async fn handle_git_remove_worktree(state: &HeadlessState, args: Value) -> CommandResult {
    let GitRemoveWorktreeArgs {
        repo_path,
        worktree_path,
        force,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    let force = force.unwrap_or(false);
    let repo_path_for_worker = repo_path.clone();
    let removed = run_headless_blocking("git_remove_worktree", move || {
        service.git_remove_worktree(&repo_path_for_worker, &worktree_path, force)
    })
    .await?;
    invalidate_repo_worktree_cache(&repo_path)?;
    Ok(json!({ "ok": removed }))
}

async fn handle_git_push_branch(state: &HeadlessState, args: Value) -> CommandResult {
    let GitPushBranchArgs {
        repo_path,
        branch,
        working_dir,
        remote,
        set_upstream,
        force_with_lease,
    } = deserialize_args(args)?;
    let effective = resolve_authorized_working_dir(state, &repo_path, working_dir.as_deref())?;
    let service = state.service.clone();
    let set_upstream = set_upstream.unwrap_or(false);
    let force_with_lease = force_with_lease.unwrap_or(false);
    serialize_value(
        run_headless_blocking("git_push_branch", move || {
            service.git_push_branch(
                &repo_path,
                Some(effective.as_str()),
                remote.as_deref(),
                &branch,
                set_upstream,
                force_with_lease,
            )
        })
        .await?,
    )
}

async fn handle_git_get_status(state: &HeadlessState, args: Value) -> CommandResult {
    let GitStatusArgs {
        repo_path,
        working_dir,
    } = deserialize_args(args)?;
    let effective = resolve_authorized_working_dir(state, &repo_path, working_dir.as_deref())?;
    let service = state.service.clone();
    serialize_value(
        run_headless_blocking("git_get_status", move || {
            service
                .git_port()
                .get_status(std::path::Path::new(&effective))
        })
        .await?,
    )
}

async fn handle_git_get_diff(state: &HeadlessState, args: Value) -> CommandResult {
    let GitDiffArgs {
        repo_path,
        target_branch,
        working_dir,
    } = deserialize_args(args)?;
    let effective = resolve_authorized_working_dir(state, &repo_path, working_dir.as_deref())?;
    let service = state.service.clone();
    serialize_value(
        run_headless_blocking("git_get_diff", move || {
            service
                .git_port()
                .get_diff(std::path::Path::new(&effective), target_branch.as_deref())
        })
        .await?,
    )
}

async fn handle_git_commits_ahead_behind(state: &HeadlessState, args: Value) -> CommandResult {
    let GitAheadBehindArgs {
        repo_path,
        target_branch,
        working_dir,
    } = deserialize_args(args)?;
    let effective = resolve_authorized_working_dir(state, &repo_path, working_dir.as_deref())?;
    let service = state.service.clone();
    serialize_value(
        run_headless_blocking("git_commits_ahead_behind", move || {
            service
                .git_port()
                .commits_ahead_behind(std::path::Path::new(&effective), &target_branch)
        })
        .await?,
    )
}

async fn handle_git_get_worktree_status(state: &HeadlessState, args: Value) -> CommandResult {
    let GitWorktreeStatusArgs {
        repo_path,
        target_branch,
        diff_scope,
        working_dir,
    } = deserialize_args(args)?;
    let trimmed_target = require_target_branch(&target_branch)
        .map_err(request_error)?
        .to_string();
    let scope = parse_diff_scope(diff_scope.as_deref()).map_err(request_error)?;
    let effective = resolve_authorized_working_dir(state, &repo_path, working_dir.as_deref())?;
    let service = state.service.clone();
    let effective_for_worker = effective.clone();
    let trimmed_target_for_worker = trimmed_target.clone();
    let scope_for_worker = scope.clone();
    let worktree_status = run_headless_blocking("git_get_worktree_status", move || {
        service.git_port().get_worktree_status(
            std::path::Path::new(&effective_for_worker),
            &trimmed_target_for_worker,
            scope_for_worker,
        )
    })
    .await?;
    let status_hash = hash_worktree_status_payload(
        &worktree_status.current_branch,
        worktree_status.file_statuses.as_slice(),
        &worktree_status.target_ahead_behind,
        &worktree_status.upstream_ahead_behind,
    );
    let diff_hash = hash_worktree_diff_payload(worktree_status.file_diffs.as_slice());
    serialize_value(build_worktree_status_with_snapshot(
        worktree_status,
        build_worktree_snapshot_metadata(effective, &trimmed_target, scope, status_hash, diff_hash),
    ))
}

async fn handle_git_get_worktree_status_summary(
    state: &HeadlessState,
    args: Value,
) -> CommandResult {
    let GitWorktreeStatusArgs {
        repo_path,
        target_branch,
        diff_scope,
        working_dir,
    } = deserialize_args(args)?;
    let trimmed_target = require_target_branch(&target_branch)
        .map_err(request_error)?
        .to_string();
    let scope = parse_diff_scope(diff_scope.as_deref()).map_err(request_error)?;
    let effective = resolve_authorized_working_dir(state, &repo_path, working_dir.as_deref())?;
    let service = state.service.clone();
    let effective_for_worker = effective.clone();
    let trimmed_target_for_worker = trimmed_target.clone();
    let scope_for_worker = scope.clone();
    let summary = run_headless_blocking("git_get_worktree_status_summary", move || {
        service.git_port().get_worktree_status_summary(
            std::path::Path::new(&effective_for_worker),
            &trimmed_target_for_worker,
            scope_for_worker,
        )
    })
    .await?;
    let status_hash = hash_worktree_status_payload(
        &summary.current_branch,
        summary.file_statuses.as_slice(),
        &summary.target_ahead_behind,
        &summary.upstream_ahead_behind,
    );
    let diff_hash = hash_worktree_diff_summary_payload(
        &scope,
        &summary.target_ahead_behind,
        &summary.file_status_counts,
    );
    serialize_value(build_worktree_status_summary_with_snapshot(
        summary.current_branch,
        summary.file_status_counts,
        summary.target_ahead_behind,
        summary.upstream_ahead_behind,
        build_worktree_snapshot_metadata(effective, &trimmed_target, scope, status_hash, diff_hash),
    ))
}

async fn handle_git_commit_all(state: &HeadlessState, args: Value) -> CommandResult {
    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GitCommitAllArgs {
        repo_path: String,
        working_dir: Option<String>,
        message: String,
    }

    let request: GitCommitAllArgs = deserialize_args(args)?;
    let message = require_git_commit_message(&request.message)?;
    let effective =
        resolve_authorized_working_dir(state, &request.repo_path, request.working_dir.as_deref())?;
    let service = state.service.clone();
    serialize_value(
        run_headless_blocking("git_commit_all", move || {
            service.git_commit_all(
                &request.repo_path,
                host_domain::GitCommitAllRequest {
                    working_dir: Some(effective),
                    message,
                },
            )
        })
        .await?,
    )
}

async fn handle_git_reset_worktree_selection(state: &HeadlessState, args: Value) -> CommandResult {
    let request: GitResetWorktreeSelectionArgs = deserialize_args(args)?;
    let target_branch = require_target_branch(&request.target_branch)
        .map_err(request_error)?
        .to_string();
    let effective =
        resolve_authorized_working_dir(state, &request.repo_path, request.working_dir.as_deref())?;
    let service = state.service.clone();
    serialize_value(
        run_headless_blocking("git_reset_worktree_selection", move || {
            service.git_reset_worktree_selection(
                &request.repo_path,
                host_domain::GitResetWorktreeSelectionRequest {
                    working_dir: Some(effective),
                    target_branch,
                    snapshot: request.snapshot,
                    selection: request.selection,
                },
            )
        })
        .await?,
    )
}

async fn handle_git_pull_branch(state: &HeadlessState, args: Value) -> CommandResult {
    let request: GitPullBranchArgs = deserialize_args(args)?;
    let effective =
        resolve_authorized_working_dir(state, &request.repo_path, request.working_dir.as_deref())?;
    let service = state.service.clone();
    serialize_value(
        run_headless_blocking("git_pull_branch", move || {
            service.git_pull_branch(
                &request.repo_path,
                host_domain::GitPullRequest {
                    working_dir: Some(effective),
                },
            )
        })
        .await?,
    )
}

async fn handle_git_rebase_branch(state: &HeadlessState, args: Value) -> CommandResult {
    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GitRebaseBranchArgs {
        repo_path: String,
        target_branch: String,
        working_dir: Option<String>,
    }

    let request: GitRebaseBranchArgs = deserialize_args(args)?;
    let target_branch = require_git_rebase_target_branch(&request.target_branch)?;
    let effective =
        resolve_authorized_working_dir(state, &request.repo_path, request.working_dir.as_deref())?;
    let service = state.service.clone();
    serialize_value(
        run_headless_blocking("git_rebase_branch", move || {
            service.git_rebase_branch(
                &request.repo_path,
                host_domain::GitRebaseBranchRequest {
                    working_dir: Some(effective),
                    target_branch,
                },
            )
        })
        .await?,
    )
}

async fn handle_git_rebase_abort(state: &HeadlessState, args: Value) -> CommandResult {
    let request: GitRebaseAbortArgs = deserialize_args(args)?;
    let effective =
        resolve_authorized_working_dir(state, &request.repo_path, request.working_dir.as_deref())?;
    let service = state.service.clone();
    serialize_value(
        run_headless_blocking("git_rebase_abort", move || {
            service.git_rebase_abort(
                &request.repo_path,
                host_domain::GitRebaseAbortRequest {
                    working_dir: Some(effective),
                },
            )
        })
        .await?,
    )
}

async fn handle_git_abort_conflict(state: &HeadlessState, args: Value) -> CommandResult {
    let request: GitConflictAbortArgs = deserialize_args(args)?;
    let effective =
        resolve_authorized_working_dir(state, &request.repo_path, request.working_dir.as_deref())?;
    let service = state.service.clone();
    serialize_value(
        run_headless_blocking("git_abort_conflict", move || {
            service.git_abort_conflict(
                &request.repo_path,
                host_domain::GitConflictAbortRequest {
                    operation: request.operation,
                    working_dir: Some(effective),
                },
            )
        })
        .await?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;

    #[test]
    fn require_git_commit_message_rejects_blank_values() {
        let error =
            require_git_commit_message("   ").expect_err("blank commit message should fail");

        assert_eq!(error.status, StatusCode::BAD_REQUEST);
        assert_eq!(error.message, "message is required");
    }

    #[test]
    fn require_git_rebase_target_branch_rejects_blank_values() {
        let error =
            require_git_rebase_target_branch("   ").expect_err("blank target branch should fail");

        assert_eq!(error.status, StatusCode::BAD_REQUEST);
        assert_eq!(error.message, "targetBranch is required");
    }
}
