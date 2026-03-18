use crate::{as_error, run_service_blocking, AppState};
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;

use super::{
    authorization::{invalidate_worktree_resolution_cache_for_repo, resolve_working_dir},
    snapshot::{
        build_worktree_status_summary_with_snapshot, build_worktree_status_with_snapshot,
        hash_worktree_diff_payload, hash_worktree_diff_summary_payload,
        hash_worktree_status_payload, WorktreeSnapshotMetadata, GIT_WORKTREE_HASH_VERSION,
    },
};

struct AuthorizedGitScope {
    repo_path: String,
    effective_working_dir: String,
}

fn authorize_git_scope(
    state: &State<'_, AppState>,
    repo_path: &str,
    working_dir: Option<&str>,
) -> Result<AuthorizedGitScope, String> {
    let repo_path = as_error(state.service.resolve_authorized_repo_path(repo_path))?;
    let effective_working_dir = resolve_working_dir(repo_path.as_str(), working_dir)?;

    Ok(AuthorizedGitScope {
        repo_path,
        effective_working_dir,
    })
}

pub(crate) fn parse_diff_scope(
    diff_scope: Option<&str>,
) -> Result<host_domain::GitDiffScope, String> {
    match diff_scope.unwrap_or("target") {
        "target" => Ok(host_domain::GitDiffScope::Target),
        "uncommitted" => Ok(host_domain::GitDiffScope::Uncommitted),
        value => Err(format!(
            "diffScope must be either 'target' or 'uncommitted', got: {value}"
        )),
    }
}

pub(crate) fn require_target_branch(target_branch: &str) -> Result<&str, String> {
    let trimmed_target = target_branch.trim();
    if trimmed_target.is_empty() {
        return Err("targetBranch is required".to_string());
    }
    Ok(trimmed_target)
}

#[tauri::command]
pub async fn git_get_branches(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<Vec<host_domain::GitBranch>, String> {
    let scope = authorize_git_scope(&state, &repo_path, None)?;
    let service = state.service.clone();
    let result = run_service_blocking("git_get_branches", move || {
        service.git_get_branches(&scope.repo_path)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn git_get_current_branch(
    state: State<'_, AppState>,
    repo_path: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitCurrentBranch, String> {
    let scope = authorize_git_scope(&state, &repo_path, working_dir.as_deref())?;
    let service = state.service.clone();
    let result = run_service_blocking("git_get_current_branch", move || {
        service
            .git_port()
            .get_current_branch(Path::new(&scope.effective_working_dir))
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn git_switch_branch(
    state: State<'_, AppState>,
    repo_path: String,
    branch: String,
    create: Option<bool>,
) -> Result<host_domain::GitCurrentBranch, String> {
    let scope = authorize_git_scope(&state, &repo_path, None)?;
    let service = state.service.clone();
    let create = create.unwrap_or(false);
    let result = run_service_blocking("git_switch_branch", move || {
        service.git_switch_branch(&scope.repo_path, &branch, create)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn git_create_worktree(
    state: State<'_, AppState>,
    repo_path: String,
    worktree_path: String,
    branch: String,
    create_branch: Option<bool>,
) -> Result<host_domain::GitWorktreeSummary, String> {
    let scope = authorize_git_scope(&state, &repo_path, None)?;
    let service = state.service.clone();
    let create_branch = create_branch.unwrap_or(false);
    let repo_path_for_worker = scope.repo_path.clone();
    let result = run_service_blocking("git_create_worktree", move || {
        service.git_create_worktree(
            &repo_path_for_worker,
            &worktree_path,
            &branch,
            create_branch,
        )
    })
    .await;
    let summary = as_error(result)?;
    invalidate_worktree_resolution_cache_for_repo(&scope.repo_path)?;
    Ok(summary)
}

#[tauri::command]
pub async fn git_remove_worktree(
    state: State<'_, AppState>,
    repo_path: String,
    worktree_path: String,
    force: Option<bool>,
) -> Result<serde_json::Value, String> {
    let scope = authorize_git_scope(&state, &repo_path, None)?;
    let service = state.service.clone();
    let force = force.unwrap_or(false);
    let repo_path_for_worker = scope.repo_path.clone();
    let result = run_service_blocking("git_remove_worktree", move || {
        service.git_remove_worktree(&repo_path_for_worker, &worktree_path, force)
    })
    .await;
    let removed = as_error(result)?;
    invalidate_worktree_resolution_cache_for_repo(&scope.repo_path)?;
    Ok(serde_json::json!({ "ok": removed }))
}

#[tauri::command]
pub async fn git_push_branch(
    state: State<'_, AppState>,
    repo_path: String,
    branch: String,
    working_dir: Option<String>,
    remote: Option<String>,
    set_upstream: Option<bool>,
    force_with_lease: Option<bool>,
) -> Result<host_domain::GitPushResult, String> {
    let scope = authorize_git_scope(&state, &repo_path, working_dir.as_deref())?;
    let service = state.service.clone();
    let set_upstream = set_upstream.unwrap_or(false);
    let force_with_lease = force_with_lease.unwrap_or(false);
    let result = run_service_blocking("git_push_branch", move || {
        service.git_push_branch(
            &scope.repo_path,
            Some(scope.effective_working_dir.as_str()),
            remote.as_deref(),
            &branch,
            set_upstream,
            force_with_lease,
        )
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn git_get_status(
    state: State<'_, AppState>,
    repo_path: String,
    working_dir: Option<String>,
) -> Result<Vec<host_domain::GitFileStatus>, String> {
    let scope = authorize_git_scope(&state, &repo_path, working_dir.as_deref())?;
    let service = state.service.clone();
    let result = run_service_blocking("git_get_status", move || {
        service
            .git_port()
            .get_status(Path::new(&scope.effective_working_dir))
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn git_get_diff(
    state: State<'_, AppState>,
    repo_path: String,
    target_branch: Option<String>,
    working_dir: Option<String>,
) -> Result<Vec<host_domain::GitFileDiff>, String> {
    let scope = authorize_git_scope(&state, &repo_path, working_dir.as_deref())?;
    let service = state.service.clone();
    let result = run_service_blocking("git_get_diff", move || {
        service
            .git_port()
            .get_diff(Path::new(&scope.effective_working_dir), target_branch.as_deref())
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn git_commits_ahead_behind(
    state: State<'_, AppState>,
    repo_path: String,
    target_branch: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitAheadBehind, String> {
    let scope = authorize_git_scope(&state, &repo_path, working_dir.as_deref())?;
    let service = state.service.clone();
    let result = run_service_blocking("git_commits_ahead_behind", move || {
        service
            .git_port()
            .commits_ahead_behind(Path::new(&scope.effective_working_dir), &target_branch)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn git_get_worktree_status(
    state: State<'_, AppState>,
    repo_path: String,
    target_branch: String,
    diff_scope: Option<String>,
    working_dir: Option<String>,
) -> Result<host_domain::GitWorktreeStatus, String> {
    let git_scope = authorize_git_scope(&state, &repo_path, working_dir.as_deref())?;
    let trimmed_target = require_target_branch(&target_branch)?.to_string();
    let scope = parse_diff_scope(diff_scope.as_deref())?;
    let service = state.service.clone();
    let effective_for_worker = git_scope.effective_working_dir.clone();
    let trimmed_target_for_worker = trimmed_target.clone();
    let scope_for_worker = scope.clone();
    let worktree_status = as_error(
        run_service_blocking("git_get_worktree_status", move || {
            service.git_port().get_worktree_status(
                Path::new(&effective_for_worker),
                &trimmed_target_for_worker,
                scope_for_worker,
            )
        })
        .await,
    )?;
    let observed_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let status_hash = hash_worktree_status_payload(
        &worktree_status.current_branch,
        worktree_status.file_statuses.as_slice(),
        &worktree_status.target_ahead_behind,
        &worktree_status.upstream_ahead_behind,
    );
    let diff_hash = hash_worktree_diff_payload(worktree_status.file_diffs.as_slice());

    Ok(build_worktree_status_with_snapshot(
        worktree_status,
        WorktreeSnapshotMetadata {
            effective_working_dir: git_scope.effective_working_dir,
            target_branch: trimmed_target,
            diff_scope: scope,
            observed_at_ms,
            hash_version: GIT_WORKTREE_HASH_VERSION,
            status_hash,
            diff_hash,
        },
    ))
}

#[tauri::command]
pub async fn git_get_worktree_status_summary(
    state: State<'_, AppState>,
    repo_path: String,
    target_branch: String,
    diff_scope: Option<String>,
    working_dir: Option<String>,
) -> Result<host_domain::GitWorktreeStatusSummary, String> {
    let git_scope = authorize_git_scope(&state, &repo_path, working_dir.as_deref())?;
    let trimmed_target = require_target_branch(&target_branch)?.to_string();
    let scope = parse_diff_scope(diff_scope.as_deref())?;
    let service = state.service.clone();
    let effective_for_worker = git_scope.effective_working_dir.clone();
    let trimmed_target_for_worker = trimmed_target.clone();
    let scope_for_worker = scope.clone();
    let worktree_status = as_error(
        run_service_blocking("git_get_worktree_status_summary", move || {
            service.git_port().get_worktree_status_summary(
                Path::new(&effective_for_worker),
                &trimmed_target_for_worker,
                scope_for_worker,
            )
        })
        .await,
    )?;

    let observed_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let status_hash = hash_worktree_status_payload(
        &worktree_status.current_branch,
        worktree_status.file_statuses.as_slice(),
        &worktree_status.target_ahead_behind,
        &worktree_status.upstream_ahead_behind,
    );
    let diff_hash = hash_worktree_diff_summary_payload(
        &scope,
        &worktree_status.target_ahead_behind,
        &worktree_status.file_status_counts,
    );

    Ok(build_worktree_status_summary_with_snapshot(
        worktree_status.current_branch,
        worktree_status.file_status_counts,
        worktree_status.target_ahead_behind,
        worktree_status.upstream_ahead_behind,
        WorktreeSnapshotMetadata {
            effective_working_dir: git_scope.effective_working_dir,
            target_branch: trimmed_target,
            diff_scope: scope,
            observed_at_ms,
            hash_version: GIT_WORKTREE_HASH_VERSION,
            status_hash,
            diff_hash,
        },
    ))
}

#[tauri::command]
pub async fn git_commit_all(
    state: State<'_, AppState>,
    repo_path: String,
    message: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitCommitAllResult, String> {
    let scope = authorize_git_scope(&state, &repo_path, working_dir.as_deref())?;
    if message.trim().is_empty() {
        return Err("message is required".to_string());
    }

    let request = host_domain::GitCommitAllRequest {
        working_dir: Some(scope.effective_working_dir),
        message: message.trim().to_string(),
    };
    let service = state.service.clone();
    let result = run_service_blocking("git_commit_all", move || {
        service.git_commit_all(&scope.repo_path, request)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn git_pull_branch(
    state: State<'_, AppState>,
    repo_path: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitPullResult, String> {
    let scope = authorize_git_scope(&state, &repo_path, working_dir.as_deref())?;

    let request = host_domain::GitPullRequest {
        working_dir: Some(scope.effective_working_dir),
    };
    let service = state.service.clone();
    let result = run_service_blocking("git_pull_branch", move || {
        service.git_pull_branch(&scope.repo_path, request)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn git_rebase_branch(
    state: State<'_, AppState>,
    repo_path: String,
    target_branch: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitRebaseBranchResult, String> {
    let scope = authorize_git_scope(&state, &repo_path, working_dir.as_deref())?;
    if target_branch.trim().is_empty() {
        return Err("targetBranch is required".to_string());
    }

    let request = host_domain::GitRebaseBranchRequest {
        working_dir: Some(scope.effective_working_dir),
        target_branch: target_branch.trim().to_string(),
    };
    let service = state.service.clone();
    let result = run_service_blocking("git_rebase_branch", move || {
        service.git_rebase_branch(&scope.repo_path, request)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn git_rebase_abort(
    state: State<'_, AppState>,
    repo_path: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitRebaseAbortResult, String> {
    let scope = authorize_git_scope(&state, &repo_path, working_dir.as_deref())?;

    let request = host_domain::GitRebaseAbortRequest {
        working_dir: Some(scope.effective_working_dir),
    };
    let service = state.service.clone();
    let result = run_service_blocking("git_rebase_abort", move || {
        service.git_rebase_abort(&scope.repo_path, request)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn git_abort_conflict(
    state: State<'_, AppState>,
    repo_path: String,
    operation: host_domain::GitConflictOperation,
    working_dir: Option<String>,
) -> Result<host_domain::GitConflictAbortResult, String> {
    let scope = authorize_git_scope(&state, &repo_path, working_dir.as_deref())?;

    let request = host_domain::GitConflictAbortRequest {
        operation,
        working_dir: Some(scope.effective_working_dir),
    };
    let service = state.service.clone();
    let result = run_service_blocking("git_abort_conflict", move || {
        service.git_abort_conflict(&scope.repo_path, request)
    })
    .await;
    as_error(result)
}
