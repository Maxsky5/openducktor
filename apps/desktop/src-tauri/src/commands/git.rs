use crate::{as_error, AppState};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;

const GIT_WORKTREE_HASH_VERSION: u32 = 1;
const FNV1A_64_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV1A_64_PRIME: u64 = 0x100000001b3;

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

fn require_target_branch(target_branch: &str) -> Result<&str, String> {
    let trimmed_target = target_branch.trim();
    if trimmed_target.is_empty() {
        return Err("targetBranch is required".to_string());
    }
    Ok(trimmed_target)
}

struct Fnv1a64Hasher {
    state: u64,
}

impl Fnv1a64Hasher {
    fn new() -> Self {
        Self {
            state: FNV1A_64_OFFSET_BASIS,
        }
    }

    fn update_byte(&mut self, byte: u8) {
        self.state ^= u64::from(byte);
        self.state = self.state.wrapping_mul(FNV1A_64_PRIME);
    }

    fn update_bytes(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.update_byte(*byte);
        }
    }

    fn update_bool(&mut self, value: bool) {
        self.update_byte(u8::from(value));
    }

    fn update_u32(&mut self, value: u32) {
        self.update_bytes(&value.to_le_bytes());
    }

    fn update_u64(&mut self, value: u64) {
        self.update_bytes(&value.to_le_bytes());
    }

    fn update_str(&mut self, value: &str) {
        self.update_u64(value.len() as u64);
        self.update_bytes(value.as_bytes());
    }

    fn finish_hex(self) -> String {
        format!("{:016x}", self.state)
    }
}

fn hash_optional_str(hasher: &mut Fnv1a64Hasher, value: Option<&str>) {
    match value {
        Some(value) => {
            hasher.update_byte(1);
            hasher.update_str(value);
        }
        None => {
            hasher.update_byte(0);
        }
    }
}
fn hash_upstream_ahead_behind(
    hasher: &mut Fnv1a64Hasher,
    upstream_ahead_behind: &host_domain::GitUpstreamAheadBehind,
) {
    match upstream_ahead_behind {
        host_domain::GitUpstreamAheadBehind::Tracking { ahead, behind } => {
            hasher.update_str("tracking");
            hasher.update_u32(*ahead);
            hasher.update_u32(*behind);
        }
        host_domain::GitUpstreamAheadBehind::Untracked { ahead } => {
            hasher.update_str("untracked");
            hasher.update_u32(*ahead);
        }
        host_domain::GitUpstreamAheadBehind::Error { message } => {
            hasher.update_str("error");
            hasher.update_str(message);
        }
    }
}

fn hash_worktree_status_payload(
    current_branch: &host_domain::GitCurrentBranch,
    file_statuses: &[host_domain::GitFileStatus],
    target_ahead_behind: &host_domain::GitAheadBehind,
    upstream_ahead_behind: &host_domain::GitUpstreamAheadBehind,
) -> String {
    let mut hasher = Fnv1a64Hasher::new();

    hash_optional_str(&mut hasher, current_branch.name.as_deref());
    hasher.update_bool(current_branch.detached);

    hasher.update_u64(file_statuses.len() as u64);
    for status in file_statuses {
        hasher.update_str(&status.path);
        hasher.update_str(&status.status);
        hasher.update_bool(status.staged);
    }

    hasher.update_u32(target_ahead_behind.ahead);
    hasher.update_u32(target_ahead_behind.behind);

    hash_upstream_ahead_behind(&mut hasher, upstream_ahead_behind);

    hasher.finish_hex()
}

fn hash_worktree_diff_payload(file_diffs: &[host_domain::GitFileDiff]) -> String {
    let mut hasher = Fnv1a64Hasher::new();
    hasher.update_u64(file_diffs.len() as u64);

    for diff in file_diffs {
        hasher.update_str(&diff.file);
        hasher.update_str(&diff.diff_type);
        hasher.update_u32(diff.additions);
        hasher.update_u32(diff.deletions);
        hasher.update_str(&diff.diff);
    }

    hasher.finish_hex()
}

struct WorktreeSnapshotMetadata {
    effective_working_dir: String,
    target_branch: String,
    diff_scope: host_domain::GitDiffScope,
    observed_at_ms: u64,
    hash_version: u32,
    status_hash: String,
    diff_hash: String,
}

fn build_worktree_status_with_snapshot(
    status_data: host_domain::GitWorktreeStatusData,
    snapshot_metadata: WorktreeSnapshotMetadata,
) -> host_domain::GitWorktreeStatus {
    host_domain::GitWorktreeStatus {
        current_branch: status_data.current_branch,
        file_statuses: status_data.file_statuses,
        file_diffs: status_data.file_diffs,
        target_ahead_behind: status_data.target_ahead_behind,
        upstream_ahead_behind: status_data.upstream_ahead_behind,
        snapshot: host_domain::GitWorktreeStatusSnapshot {
            effective_working_dir: snapshot_metadata.effective_working_dir,
            target_branch: snapshot_metadata.target_branch,
            diff_scope: snapshot_metadata.diff_scope,
            observed_at_ms: snapshot_metadata.observed_at_ms,
            hash_version: snapshot_metadata.hash_version,
            status_hash: snapshot_metadata.status_hash,
            diff_hash: snapshot_metadata.diff_hash,
        },
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
    use super::{
        build_worktree_status_with_snapshot, hash_worktree_diff_payload,
        hash_worktree_status_payload, parse_diff_scope, require_target_branch, resolve_working_dir,
        WorktreeSnapshotMetadata, GIT_WORKTREE_HASH_VERSION,
    };
    use host_domain::{
        GitAheadBehind, GitCurrentBranch, GitDiffScope, GitFileDiff, GitFileStatus,
        GitUpstreamAheadBehind, GitWorktreeStatusData,
    };
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

    #[test]
    fn require_target_branch_rejects_blank_values() {
        let error = require_target_branch("   ")
            .expect_err("blank target branch should be rejected at command boundary");
        assert_eq!(error, "targetBranch is required");
    }

    #[test]
    fn parse_diff_scope_accepts_uncommitted_and_rejects_unknown_values() {
        assert_eq!(
            parse_diff_scope(Some("uncommitted")).expect("uncommitted scope should parse"),
            GitDiffScope::Uncommitted
        );

        let error = parse_diff_scope(Some("staged"))
            .expect_err("unknown diff scope should be rejected at command boundary");
        assert!(
            error.contains("diffScope must be either 'target' or 'uncommitted'"),
            "unexpected scope parse error: {error}"
        );
    }

    #[test]
    fn build_worktree_status_with_snapshot_preserves_payload_and_snapshot_fields() {
        let status_data = GitWorktreeStatusData {
            current_branch: GitCurrentBranch {
                name: Some("feature/snapshot".to_string()),
                detached: false,
            },
            file_statuses: vec![GitFileStatus {
                path: "src/main.rs".to_string(),
                status: "modified".to_string(),
                staged: false,
            }],
            file_diffs: vec![GitFileDiff {
                file: "src/main.rs".to_string(),
                diff_type: "modified".to_string(),
                additions: 3,
                deletions: 1,
                diff: "@@ -1 +1 @@\n-old\n+new\n".to_string(),
            }],
            target_ahead_behind: GitAheadBehind {
                ahead: 2,
                behind: 0,
            },
            upstream_ahead_behind: GitUpstreamAheadBehind::Tracking {
                ahead: 1,
                behind: 4,
            },
        };

        let built = build_worktree_status_with_snapshot(
            status_data,
            WorktreeSnapshotMetadata {
                effective_working_dir: "/tmp/openducktor-worktree".to_string(),
                target_branch: "origin/main".to_string(),
                diff_scope: GitDiffScope::Target,
                observed_at_ms: 42,
                hash_version: GIT_WORKTREE_HASH_VERSION,
                status_hash: "0123456789abcdef".to_string(),
                diff_hash: "fedcba9876543210".to_string(),
            },
        );

        assert_eq!(
            built.current_branch.name.as_deref(),
            Some("feature/snapshot")
        );
        assert_eq!(built.file_statuses.len(), 1);
        assert_eq!(built.file_diffs.len(), 1);
        assert_eq!(built.target_ahead_behind.ahead, 2);
        assert_eq!(
            built.upstream_ahead_behind,
            GitUpstreamAheadBehind::Tracking {
                ahead: 1,
                behind: 4
            }
        );
        assert_eq!(
            built.snapshot.effective_working_dir,
            "/tmp/openducktor-worktree"
        );
        assert_eq!(built.snapshot.target_branch, "origin/main");
        assert_eq!(built.snapshot.diff_scope, GitDiffScope::Target);
        assert_eq!(built.snapshot.observed_at_ms, 42);
        assert_eq!(built.snapshot.hash_version, GIT_WORKTREE_HASH_VERSION);
        assert_eq!(built.snapshot.status_hash, "0123456789abcdef");
        assert_eq!(built.snapshot.diff_hash, "fedcba9876543210");
    }

    #[test]
    fn status_hash_changes_when_status_payload_changes() {
        let current_branch = GitCurrentBranch {
            name: Some("feature/task-1".to_string()),
            detached: false,
        };
        let file_statuses = vec![GitFileStatus {
            path: "src/main.rs".to_string(),
            status: "M".to_string(),
            staged: false,
        }];
        let target_ahead_behind = GitAheadBehind {
            ahead: 1,
            behind: 0,
        };
        let baseline_upstream = GitUpstreamAheadBehind::Tracking {
            ahead: 1,
            behind: 0,
        };
        let changed_upstream = GitUpstreamAheadBehind::Tracking {
            ahead: 2,
            behind: 0,
        };

        let baseline_hash = hash_worktree_status_payload(
            &current_branch,
            file_statuses.as_slice(),
            &target_ahead_behind,
            &baseline_upstream,
        );
        let changed_hash = hash_worktree_status_payload(
            &current_branch,
            file_statuses.as_slice(),
            &target_ahead_behind,
            &changed_upstream,
        );

        assert_ne!(baseline_hash, changed_hash);
    }

    #[test]
    fn status_hash_is_stable_for_identical_payload() {
        let current_branch = GitCurrentBranch {
            name: Some("feature/task-1".to_string()),
            detached: false,
        };
        let file_statuses = vec![GitFileStatus {
            path: "src/main.rs".to_string(),
            status: "M".to_string(),
            staged: false,
        }];
        let target_ahead_behind = GitAheadBehind {
            ahead: 1,
            behind: 0,
        };
        let upstream = GitUpstreamAheadBehind::Tracking {
            ahead: 1,
            behind: 0,
        };

        let first_hash = hash_worktree_status_payload(
            &current_branch,
            file_statuses.as_slice(),
            &target_ahead_behind,
            &upstream,
        );
        let second_hash = hash_worktree_status_payload(
            &current_branch,
            file_statuses.as_slice(),
            &target_ahead_behind,
            &upstream,
        );

        assert_eq!(first_hash, second_hash);
    }

    #[test]
    fn diff_hash_changes_when_diff_payload_changes() {
        let baseline_diff = vec![GitFileDiff {
            file: "src/main.rs".to_string(),
            diff_type: "modified".to_string(),
            additions: 1,
            deletions: 0,
            diff: "@@ -1 +1 @@".to_string(),
        }];
        let changed_diff = vec![GitFileDiff {
            file: "src/main.rs".to_string(),
            diff_type: "modified".to_string(),
            additions: 2,
            deletions: 1,
            diff: "@@ -1 +1,2 @@".to_string(),
        }];

        let baseline_hash = hash_worktree_diff_payload(baseline_diff.as_slice());
        let changed_hash = hash_worktree_diff_payload(changed_diff.as_slice());

        assert_ne!(baseline_hash, changed_hash);
    }
}
