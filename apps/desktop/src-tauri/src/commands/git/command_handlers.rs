use crate::{as_error, AppState};
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
    as_error(state.service.git_get_branches(&repo_path))
}

#[tauri::command]
pub async fn git_get_current_branch(
    state: State<'_, AppState>,
    repo_path: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitCurrentBranch, String> {
    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;
    as_error(
        state
            .service
            .git_port()
            .get_current_branch(Path::new(&effective)),
    )
}

#[tauri::command]
pub async fn git_switch_branch(
    state: State<'_, AppState>,
    repo_path: String,
    branch: String,
    create: Option<bool>,
) -> Result<host_domain::GitCurrentBranch, String> {
    as_error(
        state
            .service
            .git_switch_branch(&repo_path, &branch, create.unwrap_or(false)),
    )
}

#[tauri::command]
pub async fn git_create_worktree(
    state: State<'_, AppState>,
    repo_path: String,
    worktree_path: String,
    branch: String,
    create_branch: Option<bool>,
) -> Result<host_domain::GitWorktreeSummary, String> {
    let summary = as_error(state.service.git_create_worktree(
        &repo_path,
        &worktree_path,
        &branch,
        create_branch.unwrap_or(false),
    ))?;
    invalidate_worktree_resolution_cache_for_repo(&repo_path)?;
    Ok(summary)
}

#[tauri::command]
pub async fn git_remove_worktree(
    state: State<'_, AppState>,
    repo_path: String,
    worktree_path: String,
    force: Option<bool>,
) -> Result<serde_json::Value, String> {
    let removed = as_error(state.service.git_remove_worktree(
        &repo_path,
        &worktree_path,
        force.unwrap_or(false),
    ))?;
    invalidate_worktree_resolution_cache_for_repo(&repo_path)?;
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
    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;

    as_error(state.service.git_push_branch(
        &repo_path,
        Some(effective.as_str()),
        remote.as_deref(),
        &branch,
        set_upstream.unwrap_or(false),
        force_with_lease.unwrap_or(false),
    ))
}

#[tauri::command]
pub async fn git_get_status(
    state: State<'_, AppState>,
    repo_path: String,
    working_dir: Option<String>,
) -> Result<Vec<host_domain::GitFileStatus>, String> {
    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;
    as_error(state.service.git_port().get_status(Path::new(&effective)))
}

#[tauri::command]
pub async fn git_get_diff(
    state: State<'_, AppState>,
    repo_path: String,
    target_branch: Option<String>,
    working_dir: Option<String>,
) -> Result<Vec<host_domain::GitFileDiff>, String> {
    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;
    as_error(
        state
            .service
            .git_port()
            .get_diff(Path::new(&effective), target_branch.as_deref()),
    )
}

#[tauri::command]
pub async fn git_commits_ahead_behind(
    state: State<'_, AppState>,
    repo_path: String,
    target_branch: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitAheadBehind, String> {
    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;
    as_error(
        state
            .service
            .git_port()
            .commits_ahead_behind(Path::new(&effective), &target_branch),
    )
}

#[tauri::command]
pub async fn git_get_worktree_status(
    state: State<'_, AppState>,
    repo_path: String,
    target_branch: String,
    diff_scope: Option<String>,
    working_dir: Option<String>,
) -> Result<host_domain::GitWorktreeStatus, String> {
    let trimmed_target = require_target_branch(&target_branch)?;
    let scope = parse_diff_scope(diff_scope.as_deref())?;

    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;
    let repo = Path::new(&effective);
    let worktree_status = as_error(state.service.git_port().get_worktree_status(
        repo,
        trimmed_target,
        scope.clone(),
    ))?;
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
            effective_working_dir: effective,
            target_branch: trimmed_target.to_string(),
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
    let trimmed_target = require_target_branch(&target_branch)?;
    let scope = parse_diff_scope(diff_scope.as_deref())?;

    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;
    let repo = Path::new(&effective);
    let worktree_status = as_error(state.service.git_port().get_worktree_status_summary(
        repo,
        trimmed_target,
        scope.clone(),
    ))?;

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
            effective_working_dir: effective,
            target_branch: trimmed_target.to_string(),
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
    if message.trim().is_empty() {
        return Err("message is required".to_string());
    }

    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;

    as_error(state.service.git_commit_all(
        &repo_path,
        host_domain::GitCommitAllRequest {
            working_dir: Some(effective),
            message: message.trim().to_string(),
        },
    ))
}

#[tauri::command]
pub async fn git_pull_branch(
    state: State<'_, AppState>,
    repo_path: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitPullResult, String> {
    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;

    as_error(state.service.git_pull_branch(
        &repo_path,
        host_domain::GitPullRequest {
            working_dir: Some(effective),
        },
    ))
}

#[tauri::command]
pub async fn git_rebase_branch(
    state: State<'_, AppState>,
    repo_path: String,
    target_branch: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitRebaseBranchResult, String> {
    if target_branch.trim().is_empty() {
        return Err("targetBranch is required".to_string());
    }

    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;

    as_error(state.service.git_rebase_branch(
        &repo_path,
        host_domain::GitRebaseBranchRequest {
            working_dir: Some(effective),
            target_branch: target_branch.trim().to_string(),
        },
    ))
}

#[tauri::command]
pub async fn git_rebase_abort(
    state: State<'_, AppState>,
    repo_path: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitRebaseAbortResult, String> {
    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;

    as_error(state.service.git_rebase_abort(
        &repo_path,
        host_domain::GitRebaseAbortRequest {
            working_dir: Some(effective),
        },
    ))
}
