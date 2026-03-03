use crate::{as_error, AppState};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;

fn canonicalize_for_validation(path: &str, field: &str) -> Result<PathBuf, String> {
    fs::canonicalize(path)
        .map_err(|_| format!("{field} does not exist or is not accessible: {path}"))
}

fn list_authorized_worktrees(repo_path: &Path) -> Result<Vec<PathBuf>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("list")
        .arg("--porcelain")
        .output()
        .map_err(|e| format!("failed to enumerate authorized worktrees: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let reason = stderr.trim();
        return Err(if reason.is_empty() {
            "failed to enumerate authorized worktrees".to_string()
        } else {
            format!("failed to enumerate authorized worktrees: {reason}")
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .lines()
        .filter_map(|line| line.strip_prefix("worktree "))
        .filter_map(|path| fs::canonicalize(path).ok())
        .collect())
}

/// Resolve the effective path for a git operation. If `working_dir` is
/// provided, it is validated as a git worktree/repo and used instead of
/// `repo_path`. The caller must have already authorized `repo_path`.
fn resolve_working_dir(repo_path: &str, working_dir: Option<&str>) -> Result<String, String> {
    let canonical_repo = canonicalize_for_validation(repo_path, "repo_path")?;

    match working_dir {
        Some(wd) if !wd.is_empty() && wd != repo_path => {
            let canonical_working_dir = canonicalize_for_validation(wd, "working_dir")?;

            if canonical_working_dir == canonical_repo {
                return Ok(canonical_working_dir.to_string_lossy().to_string());
            }

            let worktrees = list_authorized_worktrees(canonical_repo.as_path())?;
            if worktrees
                .iter()
                .any(|worktree| worktree == &canonical_working_dir)
            {
                return Ok(canonical_working_dir.to_string_lossy().to_string());
            }

            Err(format!(
                "working_dir is not within authorized repository or linked worktrees: {wd}"
            ))
        }
        _ => Ok(canonical_repo.to_string_lossy().to_string()),
    }
}

fn parse_diff_scope(diff_scope: Option<&str>) -> Result<host_domain::GitDiffScope, String> {
    match diff_scope.unwrap_or("target") {
        "target" => Ok(host_domain::GitDiffScope::Target),
        "uncommitted" => Ok(host_domain::GitDiffScope::Uncommitted),
        value => Err(format!(
            "diffScope must be either 'target' or 'uncommitted', got: {value}"
        )),
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
    working_dir: Option<String>,
    remote: Option<String>,
    set_upstream: Option<bool>,
    force_with_lease: Option<bool>,
) -> Result<host_domain::GitPushSummary, String> {
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
    let trimmed_target = target_branch.trim();
    if trimmed_target.is_empty() {
        return Err("targetBranch is required".to_string());
    }
    let scope = parse_diff_scope(diff_scope.as_deref())?;

    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;
    let repo = Path::new(&effective);

    let current_branch = as_error(state.service.git_port().get_current_branch(repo))?;
    let file_statuses = as_error(state.service.git_port().get_status(repo))?;
    let file_diffs = as_error(state.service.git_port().get_diff(
        repo,
        match &scope {
            host_domain::GitDiffScope::Target => Some(trimmed_target),
            host_domain::GitDiffScope::Uncommitted => None,
        },
    ))?;
    let target_ahead_behind = as_error(
        state
            .service
            .git_port()
            .commits_ahead_behind(repo, trimmed_target),
    )?;
    let upstream_ahead_behind = match state.service.git_port().resolve_upstream_target(repo) {
        Ok(Some(upstream_target)) => {
            match state
                .service
                .git_port()
                .commits_ahead_behind(repo, upstream_target.as_str())
            {
                Ok(counts) => host_domain::GitUpstreamAheadBehind::Tracking {
                    ahead: counts.ahead,
                    behind: counts.behind,
                },
                Err(error) => host_domain::GitUpstreamAheadBehind::Error {
                    message: format!("{error:#}"),
                },
            }
        }
        Ok(None) => host_domain::GitUpstreamAheadBehind::Untracked {
            ahead: target_ahead_behind.ahead,
        },
        Err(error) => host_domain::GitUpstreamAheadBehind::Error {
            message: format!("{error:#}"),
        },
    };
    let observed_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    Ok(host_domain::GitWorktreeStatus {
        current_branch,
        file_statuses,
        file_diffs,
        target_ahead_behind,
        upstream_ahead_behind,
        snapshot: host_domain::GitWorktreeStatusSnapshot {
            effective_working_dir: effective,
            target_branch: trimmed_target.to_string(),
            diff_scope: scope,
            observed_at_ms,
        },
    })
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

#[cfg(test)]
mod tests {
    use super::resolve_working_dir;
    use std::{
        env, fs,
        path::{Path, PathBuf},
        process::Command,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn unique_test_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_nanos();
        let dir = env::temp_dir().join(format!("openducktor-{prefix}-{nanos}"));
        fs::create_dir_all(&dir).expect("failed to create test directory");
        dir
    }

    fn run_git(args: &[&str], cwd: &Path) {
        let status = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .status()
            .expect("failed to run git command");
        assert!(status.success(), "git command failed: {:?}", args);
    }

    fn init_repo(path: &Path) {
        fs::create_dir_all(path).expect("failed to create repo directory");
        run_git(&["init"], path);
        fs::write(path.join("README.md"), "init\n").expect("failed to write seed file");
        run_git(&["add", "."], path);
        run_git(
            &[
                "-c",
                "user.name=OpenDucktor Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "init",
            ],
            path,
        );
    }

    #[test]
    fn resolve_working_dir_accepts_repo_root() {
        let root = unique_test_dir("git-root");
        let repo = root.join("repo");
        init_repo(&repo);

        let resolved = resolve_working_dir(
            repo.to_string_lossy().as_ref(),
            Some(repo.to_string_lossy().as_ref()),
        )
        .expect("repo root should be accepted");
        let expected = fs::canonicalize(&repo)
            .expect("repo should be canonicalizable")
            .to_string_lossy()
            .to_string();
        assert_eq!(resolved, expected);

        fs::remove_dir_all(&root).expect("failed to remove test directory");
    }

    #[test]
    fn resolve_working_dir_accepts_registered_worktree() {
        let root = unique_test_dir("git-worktree");
        let repo = root.join("repo");
        let worktree = root.join("repo-wt");
        init_repo(&repo);

        let repo_str = repo.to_string_lossy().to_string();
        let worktree_str = worktree.to_string_lossy().to_string();
        run_git(
            &[
                "-C",
                repo_str.as_str(),
                "worktree",
                "add",
                "-b",
                "feature/test",
                worktree_str.as_str(),
            ],
            &repo,
        );

        let resolved = resolve_working_dir(repo_str.as_str(), Some(worktree_str.as_str()))
            .expect("registered worktree should be accepted");
        let expected = fs::canonicalize(&worktree)
            .expect("worktree should be canonicalizable")
            .to_string_lossy()
            .to_string();
        assert_eq!(resolved, expected);

        fs::remove_dir_all(&root).expect("failed to remove test directory");
    }

    #[test]
    fn resolve_working_dir_rejects_unrelated_external_repo() {
        let root = unique_test_dir("git-external");
        let authorized_repo = root.join("authorized");
        let external_repo = root.join("external");
        init_repo(&authorized_repo);
        init_repo(&external_repo);

        let error = resolve_working_dir(
            authorized_repo.to_string_lossy().as_ref(),
            Some(external_repo.to_string_lossy().as_ref()),
        )
        .expect_err("unrelated external repo must be rejected");
        assert!(
            error.contains("not within authorized repository or linked worktrees"),
            "unexpected error: {error}"
        );

        fs::remove_dir_all(&root).expect("failed to remove test directory");
    }
}
