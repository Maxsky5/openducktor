use crate::app_state::AppState;
use crate::command_helpers::run_service_blocking;
use host_command_services::command_services::error::CommandServiceResult;
use host_command_services::command_services::git::{self as git_service, requests as git_requests};
use tauri::State;

async fn run_git_command<T, F>(operation_name: &'static str, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> CommandServiceResult<T> + Send + 'static,
{
    let result = run_service_blocking(operation_name, move || Ok(operation()))
        .await
        .map_err(|error| format!("{error:#}"))?;
    result.map_err(|error| error.to_tauri_error())
}

#[tauri::command]
pub async fn git_get_branches(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<Vec<host_domain::GitBranch>, String> {
    let service = state.service.clone();
    run_git_command("git_get_branches", move || {
        git_service::get_branches(service, git_requests::GitRepoRequest { repo_path })
    })
    .await
}

#[tauri::command]
pub async fn git_get_current_branch(
    state: State<'_, AppState>,
    repo_path: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitCurrentBranch, String> {
    let service = state.service.clone();
    run_git_command("git_get_current_branch", move || {
        git_service::get_current_branch(
            service,
            git_requests::GitCurrentBranchRequest {
                repo_path,
                working_dir,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn git_switch_branch(
    state: State<'_, AppState>,
    repo_path: String,
    branch: String,
    create: Option<bool>,
) -> Result<host_domain::GitCurrentBranch, String> {
    let service = state.service.clone();
    run_git_command("git_switch_branch", move || {
        git_service::switch_branch(
            service,
            git_requests::GitSwitchBranchRequest {
                repo_path,
                branch,
                create,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn git_create_worktree(
    state: State<'_, AppState>,
    repo_path: String,
    worktree_path: String,
    branch: String,
    create_branch: Option<bool>,
) -> Result<host_domain::GitWorktreeSummary, String> {
    let service = state.service.clone();
    run_git_command("git_create_worktree", move || {
        git_service::create_worktree(
            service,
            git_requests::GitCreateWorktreeRequest {
                repo_path,
                worktree_path,
                branch,
                create_branch,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn git_remove_worktree(
    state: State<'_, AppState>,
    repo_path: String,
    worktree_path: String,
    force: Option<bool>,
) -> Result<serde_json::Value, String> {
    let service = state.service.clone();
    let removed = run_git_command("git_remove_worktree", move || {
        git_service::remove_worktree(
            service,
            git_requests::GitRemoveWorktreeRequest {
                repo_path,
                worktree_path,
                force,
            },
        )
    })
    .await?;
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
    let service = state.service.clone();
    run_git_command("git_push_branch", move || {
        git_service::push_branch(
            service,
            git_requests::GitPushBranchRequest {
                repo_path,
                branch,
                working_dir,
                remote,
                set_upstream,
                force_with_lease,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn git_get_status(
    state: State<'_, AppState>,
    repo_path: String,
    working_dir: Option<String>,
) -> Result<Vec<host_domain::GitFileStatus>, String> {
    let service = state.service.clone();
    run_git_command("git_get_status", move || {
        git_service::get_status(
            service,
            git_requests::GitStatusRequest {
                repo_path,
                working_dir,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn git_get_diff(
    state: State<'_, AppState>,
    repo_path: String,
    target_branch: Option<String>,
    working_dir: Option<String>,
) -> Result<Vec<host_domain::GitFileDiff>, String> {
    let service = state.service.clone();
    run_git_command("git_get_diff", move || {
        git_service::get_diff(
            service,
            git_requests::GitDiffRequest {
                repo_path,
                target_branch,
                working_dir,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn git_commits_ahead_behind(
    state: State<'_, AppState>,
    repo_path: String,
    target_branch: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitAheadBehind, String> {
    let service = state.service.clone();
    run_git_command("git_commits_ahead_behind", move || {
        git_service::commits_ahead_behind(
            service,
            git_requests::GitAheadBehindRequest {
                repo_path,
                target_branch,
                working_dir,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn git_get_worktree_status(
    state: State<'_, AppState>,
    repo_path: String,
    target_branch: String,
    diff_scope: Option<String>,
    working_dir: Option<String>,
) -> Result<host_domain::GitWorktreeStatus, String> {
    let service = state.service.clone();
    run_git_command("git_get_worktree_status", move || {
        git_service::get_worktree_status(
            service,
            git_requests::GitWorktreeStatusRequest {
                repo_path,
                target_branch,
                diff_scope,
                working_dir,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn git_get_worktree_status_summary(
    state: State<'_, AppState>,
    repo_path: String,
    target_branch: String,
    diff_scope: Option<String>,
    working_dir: Option<String>,
) -> Result<host_domain::GitWorktreeStatusSummary, String> {
    let service = state.service.clone();
    run_git_command("git_get_worktree_status_summary", move || {
        git_service::get_worktree_status_summary(
            service,
            git_requests::GitWorktreeStatusRequest {
                repo_path,
                target_branch,
                diff_scope,
                working_dir,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn git_commit_all(
    state: State<'_, AppState>,
    repo_path: String,
    message: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitCommitAllResult, String> {
    let service = state.service.clone();
    run_git_command("git_commit_all", move || {
        git_service::commit_all(
            service,
            git_requests::GitCommitAllCommandRequest {
                repo_path,
                working_dir,
                message,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn git_reset_worktree_selection(
    state: State<'_, AppState>,
    repo_path: String,
    target_branch: String,
    snapshot: host_domain::GitResetSnapshot,
    selection: host_domain::GitResetWorktreeSelection,
    working_dir: Option<String>,
) -> Result<host_domain::GitResetWorktreeSelectionResult, String> {
    let service = state.service.clone();
    run_git_command("git_reset_worktree_selection", move || {
        git_service::reset_worktree_selection(
            service,
            git_requests::GitResetWorktreeSelectionCommandRequest {
                repo_path,
                target_branch,
                snapshot,
                selection,
                working_dir,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn git_pull_branch(
    state: State<'_, AppState>,
    repo_path: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitPullResult, String> {
    let service = state.service.clone();
    run_git_command("git_pull_branch", move || {
        git_service::pull_branch(
            service,
            git_requests::GitPullBranchRequest {
                repo_path,
                working_dir,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn git_fetch_remote(
    state: State<'_, AppState>,
    repo_path: String,
    target_branch: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitFetchResult, String> {
    let service = state.service.clone();
    run_git_command("git_fetch_remote", move || {
        git_service::fetch_remote(
            service,
            git_requests::GitFetchRemoteRequest {
                repo_path,
                target_branch,
                working_dir,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn git_rebase_branch(
    state: State<'_, AppState>,
    repo_path: String,
    target_branch: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitRebaseBranchResult, String> {
    let service = state.service.clone();
    run_git_command("git_rebase_branch", move || {
        git_service::rebase_branch(
            service,
            git_requests::GitRebaseBranchCommandRequest {
                repo_path,
                target_branch,
                working_dir,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn git_rebase_abort(
    state: State<'_, AppState>,
    repo_path: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitRebaseAbortResult, String> {
    let service = state.service.clone();
    run_git_command("git_rebase_abort", move || {
        git_service::rebase_abort(
            service,
            git_requests::GitRebaseAbortCommandRequest {
                repo_path,
                working_dir,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn git_abort_conflict(
    state: State<'_, AppState>,
    repo_path: String,
    operation: host_domain::GitConflictOperation,
    working_dir: Option<String>,
) -> Result<host_domain::GitConflictAbortResult, String> {
    let service = state.service.clone();
    run_git_command("git_abort_conflict", move || {
        git_service::abort_conflict(
            service,
            git_requests::GitConflictAbortCommandRequest {
                repo_path,
                operation,
                working_dir,
            },
        )
    })
    .await
}
