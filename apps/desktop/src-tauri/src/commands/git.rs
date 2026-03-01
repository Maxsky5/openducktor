use crate::{as_error, AppState};
use std::path::Path;
use tauri::State;

/// Validates that a `working_dir` is actually a git worktree (its `.git` is a
/// file pointing to the parent repo, not a directory). This prevents callers
/// from using arbitrary paths to bypass the workspace allowlist.
fn validate_worktree(working_dir: &str) -> Result<(), String> {
    let git_path = Path::new(working_dir).join(".git");
    if git_path.is_file() {
        // .git is a file → valid worktree (content is "gitdir: <path>")
        return Ok(());
    }
    if git_path.is_dir() {
        // .git is a directory → this is a regular repo root, allow it too
        return Ok(());
    }
    Err(format!(
        "working_dir is not a valid git repository or worktree: {working_dir}"
    ))
}

/// Resolve the effective path for a git operation. If `working_dir` is
/// provided, it is validated as a git worktree/repo and used instead of
/// `repo_path`. The caller must have already authorized `repo_path`.
fn resolve_working_dir(repo_path: &str, working_dir: Option<&str>) -> Result<String, String> {
    match working_dir {
        Some(wd) if !wd.is_empty() && wd != repo_path => {
            validate_worktree(wd)?;
            Ok(wd.to_string())
        }
        _ => Ok(repo_path.to_string()),
    }
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
    // Authorize against repo_path, execute in working_dir
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
    as_error(state.service.git_create_worktree(
        &repo_path,
        &worktree_path,
        &branch,
        create_branch.unwrap_or(false),
    ))
}

#[tauri::command]
pub async fn git_remove_worktree(
    state: State<'_, AppState>,
    repo_path: String,
    worktree_path: String,
    force: Option<bool>,
) -> Result<serde_json::Value, String> {
    as_error(
        state
            .service
            .git_remove_worktree(&repo_path, &worktree_path, force.unwrap_or(false))
            .map(|ok| serde_json::json!({ "ok": ok })),
    )
}

#[tauri::command]
pub async fn git_push_branch(
    state: State<'_, AppState>,
    repo_path: String,
    branch: String,
    remote: Option<String>,
    set_upstream: Option<bool>,
    force_with_lease: Option<bool>,
) -> Result<host_domain::GitPushSummary, String> {
    as_error(state.service.git_push_branch(
        &repo_path,
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
    as_error(
        state
            .service
            .git_port()
            .get_status(Path::new(&effective)),
    )
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
