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

fn hash_worktree_diff_summary_payload(
    diff_scope: &host_domain::GitDiffScope,
    target_ahead_behind: &host_domain::GitAheadBehind,
    file_status_counts: &host_domain::GitFileStatusCounts,
) -> String {
    let mut hasher = Fnv1a64Hasher::new();

    match diff_scope {
        host_domain::GitDiffScope::Target => hasher.update_str("target"),
        host_domain::GitDiffScope::Uncommitted => hasher.update_str("uncommitted"),
    }

    hasher.update_u32(target_ahead_behind.ahead);
    hasher.update_u32(target_ahead_behind.behind);
    hasher.update_u32(file_status_counts.total);
    hasher.update_u32(file_status_counts.staged);
    hasher.update_u32(file_status_counts.unstaged);

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

fn build_worktree_status_summary_with_snapshot(
    current_branch: host_domain::GitCurrentBranch,
    file_status_counts: host_domain::GitFileStatusCounts,
    target_ahead_behind: host_domain::GitAheadBehind,
    upstream_ahead_behind: host_domain::GitUpstreamAheadBehind,
    snapshot_metadata: WorktreeSnapshotMetadata,
) -> host_domain::GitWorktreeStatusSummary {
    host_domain::GitWorktreeStatusSummary {
        current_branch,
        file_status_counts,
        target_ahead_behind,
        upstream_ahead_behind,
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

#[cfg(test)]
mod tests {
    use super::{
        build_worktree_status_summary_with_snapshot, build_worktree_status_with_snapshot,
        git_get_worktree_status, git_get_worktree_status_summary, hash_worktree_diff_payload,
        hash_worktree_diff_summary_payload, hash_worktree_status_payload, parse_diff_scope,
        require_target_branch, resolve_working_dir, WorktreeSnapshotMetadata,
        GIT_WORKTREE_HASH_VERSION,
    };
    use crate::AppState;
    use anyhow::anyhow;
    use host_application::AppService;
    use host_domain::GitPort;
    use host_domain::{
        GitAheadBehind, GitBranch, GitCommitAllRequest, GitCommitAllResult, GitCurrentBranch,
        GitDiffScope, GitFileDiff, GitFileStatus, GitFileStatusCounts, GitPullRequest,
        GitPullResult, GitPushSummary, GitRebaseBranchRequest, GitRebaseBranchResult,
        GitUpstreamAheadBehind, GitWorktreeStatus, GitWorktreeStatusData, GitWorktreeStatusSummary,
        GitWorktreeStatusSummaryData, TaskStore, TASK_METADATA_NAMESPACE,
    };
    use host_infra_beads::BeadsTaskStore;
    use host_infra_system::AppConfigStore;
    use serde_json::{json, Value};
    use std::{
        collections::HashMap,
        env, fs,
        path::{Path, PathBuf},
        process::Command,
        sync::{Arc, Mutex},
        time::{SystemTime, UNIX_EPOCH},
    };
    use tauri::{
        ipc::{CallbackFn, InvokeBody},
        test::{mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY},
        webview::InvokeRequest,
        App, Webview, WebviewWindow, WebviewWindowBuilder,
    };

    #[derive(Clone)]
    enum WorktreeStatusResult {
        Ok(GitWorktreeStatusData),
        Err(String),
    }

    #[derive(Clone)]
    enum WorktreeStatusSummaryResult {
        Ok(GitWorktreeStatusSummaryData),
        Err(String),
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct WorktreeStatusCall {
        repo_path: String,
        target_branch: String,
        diff_scope: GitDiffScope,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct WorktreeStatusSummaryCall {
        repo_path: String,
        target_branch: String,
        diff_scope: GitDiffScope,
    }

    struct CommandGitPortState {
        worktree_status_result: WorktreeStatusResult,
        worktree_status_calls: Vec<WorktreeStatusCall>,
        worktree_status_summary_result: WorktreeStatusSummaryResult,
        worktree_status_summary_calls: Vec<WorktreeStatusSummaryCall>,
    }

    struct CommandGitPort {
        state: Arc<Mutex<CommandGitPortState>>,
    }

    impl CommandGitPort {
        fn new_with_summary_result(
            result: WorktreeStatusResult,
            summary_result: WorktreeStatusSummaryResult,
        ) -> Self {
            Self {
                state: Arc::new(Mutex::new(CommandGitPortState {
                    worktree_status_result: result,
                    worktree_status_calls: Vec::new(),
                    worktree_status_summary_result: summary_result,
                    worktree_status_summary_calls: Vec::new(),
                })),
            }
        }
    }

    impl GitPort for CommandGitPort {
        fn get_branches(&self, _repo_path: &Path) -> anyhow::Result<Vec<GitBranch>> {
            panic!("unexpected call: get_branches");
        }

        fn get_current_branch(&self, _repo_path: &Path) -> anyhow::Result<GitCurrentBranch> {
            panic!("unexpected call: get_current_branch");
        }

        fn switch_branch(
            &self,
            _repo_path: &Path,
            _branch: &str,
            _create: bool,
        ) -> anyhow::Result<GitCurrentBranch> {
            panic!("unexpected call: switch_branch");
        }

        fn create_worktree(
            &self,
            _repo_path: &Path,
            _worktree_path: &Path,
            _branch: &str,
            _create_branch: bool,
        ) -> anyhow::Result<()> {
            panic!("unexpected call: create_worktree");
        }

        fn remove_worktree(
            &self,
            _repo_path: &Path,
            _worktree_path: &Path,
            _force: bool,
        ) -> anyhow::Result<()> {
            panic!("unexpected call: remove_worktree");
        }

        fn push_branch(
            &self,
            _repo_path: &Path,
            _remote: &str,
            _branch: &str,
            _set_upstream: bool,
            _force_with_lease: bool,
        ) -> anyhow::Result<GitPushSummary> {
            panic!("unexpected call: push_branch");
        }

        fn pull_branch(
            &self,
            _repo_path: &Path,
            _request: GitPullRequest,
        ) -> anyhow::Result<GitPullResult> {
            panic!("unexpected call: pull_branch");
        }

        fn get_status(&self, _repo_path: &Path) -> anyhow::Result<Vec<GitFileStatus>> {
            panic!("unexpected call: get_status");
        }

        fn get_diff(
            &self,
            _repo_path: &Path,
            _target_branch: Option<&str>,
        ) -> anyhow::Result<Vec<GitFileDiff>> {
            panic!("unexpected call: get_diff");
        }

        fn get_worktree_status(
            &self,
            repo_path: &Path,
            target_branch: &str,
            diff_scope: GitDiffScope,
        ) -> anyhow::Result<GitWorktreeStatusData> {
            let mut state = self
                .state
                .lock()
                .expect("command git port state lock should not be poisoned");
            state.worktree_status_calls.push(WorktreeStatusCall {
                repo_path: repo_path.to_string_lossy().to_string(),
                target_branch: target_branch.to_string(),
                diff_scope,
            });
            match state.worktree_status_result.clone() {
                WorktreeStatusResult::Ok(payload) => Ok(payload),
                WorktreeStatusResult::Err(message) => Err(anyhow!(message)),
            }
        }

        fn get_worktree_status_summary(
            &self,
            repo_path: &Path,
            target_branch: &str,
            diff_scope: GitDiffScope,
        ) -> anyhow::Result<GitWorktreeStatusSummaryData> {
            let mut state = self
                .state
                .lock()
                .expect("command git port state lock should not be poisoned");
            state
                .worktree_status_summary_calls
                .push(WorktreeStatusSummaryCall {
                    repo_path: repo_path.to_string_lossy().to_string(),
                    target_branch: target_branch.to_string(),
                    diff_scope,
                });
            match state.worktree_status_summary_result.clone() {
                WorktreeStatusSummaryResult::Ok(payload) => Ok(payload),
                WorktreeStatusSummaryResult::Err(message) => Err(anyhow!(message)),
            }
        }

        fn resolve_upstream_target(&self, _repo_path: &Path) -> anyhow::Result<Option<String>> {
            panic!("unexpected call: resolve_upstream_target");
        }

        fn commits_ahead_behind(
            &self,
            _repo_path: &Path,
            _target_branch: &str,
        ) -> anyhow::Result<GitAheadBehind> {
            panic!("unexpected call: commits_ahead_behind");
        }

        fn commit_all(
            &self,
            _repo_path: &Path,
            _request: GitCommitAllRequest,
        ) -> anyhow::Result<GitCommitAllResult> {
            panic!("unexpected call: commit_all");
        }

        fn rebase_branch(
            &self,
            _repo_path: &Path,
            _request: GitRebaseBranchRequest,
        ) -> anyhow::Result<GitRebaseBranchResult> {
            panic!("unexpected call: rebase_branch");
        }
    }

    struct CommandGitFixture {
        _app: App<MockRuntime>,
        webview: WebviewWindow<MockRuntime>,
        repo_path: String,
        git_state: Arc<Mutex<CommandGitPortState>>,
        root: PathBuf,
    }

    impl Drop for CommandGitFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

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

    fn setup_command_git_fixture(
        prefix: &str,
        result: WorktreeStatusResult,
        authorize_repo: bool,
    ) -> CommandGitFixture {
        setup_command_git_fixture_with_summary(
            prefix,
            result,
            WorktreeStatusSummaryResult::Ok(sample_worktree_status_summary_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                },
            )),
            authorize_repo,
        )
    }

    fn setup_command_git_fixture_with_summary(
        prefix: &str,
        result: WorktreeStatusResult,
        summary_result: WorktreeStatusSummaryResult,
        authorize_repo: bool,
    ) -> CommandGitFixture {
        let root = unique_test_dir(prefix);
        let repo = root.join("repo");
        init_repo(&repo);

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        if authorize_repo {
            config_store
                .add_workspace(repo.to_string_lossy().as_ref())
                .expect("workspace should be allowlisted");
        }

        let git_port = CommandGitPort::new_with_summary_result(result, summary_result);
        let git_state = git_port.state.clone();
        let task_store: Arc<dyn TaskStore> = Arc::new(BeadsTaskStore::with_metadata_namespace(
            TASK_METADATA_NAMESPACE,
        ));
        let service = Arc::new(AppService::with_git_port(
            task_store,
            config_store,
            Arc::new(git_port),
        ));
        let app = mock_builder()
            .manage(AppState {
                service,
                hook_trust_challenges: Mutex::new(HashMap::new()),
                hook_trust_dialog_test_response: Mutex::new(None),
            })
            .invoke_handler(tauri::generate_handler![
                git_get_worktree_status,
                git_get_worktree_status_summary
            ])
            .build(mock_context(noop_assets()))
            .expect("test app should build");
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("test webview should build");

        CommandGitFixture {
            _app: app,
            webview,
            repo_path: repo.to_string_lossy().to_string(),
            git_state,
            root,
        }
    }

    fn invoke_json<W: AsRef<Webview<MockRuntime>>>(
        webview: &W,
        cmd: &str,
        body: Value,
    ) -> Result<Value, Value> {
        tauri::test::get_ipc_response(
            webview,
            InvokeRequest {
                cmd: cmd.to_string(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "http://tauri.localhost"
                    .parse()
                    .expect("invoke URL should parse"),
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|payload| {
            payload
                .deserialize::<Value>()
                .expect("command response should deserialize")
        })
    }

    fn sample_worktree_status_data(upstream: GitUpstreamAheadBehind) -> GitWorktreeStatusData {
        GitWorktreeStatusData {
            current_branch: GitCurrentBranch {
                name: Some("feature/command".to_string()),
                detached: false,
            },
            file_statuses: vec![GitFileStatus {
                path: "src/main.rs".to_string(),
                status: "M".to_string(),
                staged: false,
            }],
            file_diffs: vec![GitFileDiff {
                file: "src/main.rs".to_string(),
                diff_type: "modified".to_string(),
                additions: 1,
                deletions: 0,
                diff: "@@ -1 +1 @@\n-old\n+new\n".to_string(),
            }],
            target_ahead_behind: GitAheadBehind {
                ahead: 1,
                behind: 0,
            },
            upstream_ahead_behind: upstream,
        }
    }

    fn sample_worktree_status_summary_data(
        upstream: GitUpstreamAheadBehind,
    ) -> GitWorktreeStatusSummaryData {
        GitWorktreeStatusSummaryData {
            current_branch: GitCurrentBranch {
                name: Some("feature/command".to_string()),
                detached: false,
            },
            file_statuses: vec![GitFileStatus {
                path: "src/main.rs".to_string(),
                status: "M".to_string(),
                staged: false,
            }],
            file_status_counts: GitFileStatusCounts {
                total: 1,
                staged: 0,
                unstaged: 1,
            },
            target_ahead_behind: GitAheadBehind {
                ahead: 1,
                behind: 0,
            },
            upstream_ahead_behind: upstream,
        }
    }

    #[test]
    fn git_get_worktree_status_rejects_unauthorized_repo() {
        let fixture = setup_command_git_fixture(
            "git-command-unauthorized",
            WorktreeStatusResult::Ok(sample_worktree_status_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                },
            )),
            false,
        );

        let error = invoke_json(
            &fixture.webview,
            "git_get_worktree_status",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "targetBranch": "origin/main",
            }),
        )
        .expect_err("unauthorized repo should fail");

        assert!(
            error
                .to_string()
                .contains("Repository path is not in the configured workspace allowlist"),
            "unexpected error: {error}"
        );
        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert!(
            state.worktree_status_calls.is_empty(),
            "git port should not run when authorization fails"
        );
    }

    #[test]
    fn git_get_worktree_status_keeps_upstream_error_variant_and_snapshot_metadata() {
        let fixture = setup_command_git_fixture(
            "git-command-upstream-error",
            WorktreeStatusResult::Ok(sample_worktree_status_data(GitUpstreamAheadBehind::Error {
                message: "upstream not configured".to_string(),
            })),
            true,
        );

        let response = invoke_json(
            &fixture.webview,
            "git_get_worktree_status",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "targetBranch": "  origin/main  ",
                "diffScope": "uncommitted",
            }),
        )
        .expect("command should succeed");
        let status: GitWorktreeStatus =
            serde_json::from_value(response).expect("response should decode as GitWorktreeStatus");

        assert_eq!(
            status.upstream_ahead_behind,
            GitUpstreamAheadBehind::Error {
                message: "upstream not configured".to_string()
            }
        );
        assert_eq!(status.snapshot.target_branch, "origin/main");
        assert_eq!(status.snapshot.diff_scope, GitDiffScope::Uncommitted);
        assert_eq!(status.snapshot.hash_version, GIT_WORKTREE_HASH_VERSION);
        assert_eq!(status.snapshot.status_hash.len(), 16);
        assert_eq!(status.snapshot.diff_hash.len(), 16);

        let expected_effective = fs::canonicalize(Path::new(&fixture.repo_path))
            .expect("repo should canonicalize")
            .to_string_lossy()
            .to_string();
        assert_eq!(status.snapshot.effective_working_dir, expected_effective);

        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert_eq!(state.worktree_status_calls.len(), 1);
        assert_eq!(
            state.worktree_status_calls[0],
            WorktreeStatusCall {
                repo_path: expected_effective,
                target_branch: "origin/main".to_string(),
                diff_scope: GitDiffScope::Uncommitted,
            }
        );
    }

    #[test]
    fn git_get_worktree_status_propagates_upstream_status_collection_failures() {
        let fixture = setup_command_git_fixture(
            "git-command-status-failure",
            WorktreeStatusResult::Err("failed collecting upstream status".to_string()),
            true,
        );

        let error = invoke_json(
            &fixture.webview,
            "git_get_worktree_status",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "targetBranch": "origin/main",
            }),
        )
        .expect_err("git port failure should be returned");

        assert!(
            error
                .to_string()
                .contains("failed collecting upstream status"),
            "unexpected error: {error}"
        );
        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert_eq!(state.worktree_status_calls.len(), 1);
    }

    #[test]
    fn git_get_worktree_status_rejects_unrelated_working_dir() {
        let fixture = setup_command_git_fixture(
            "git-command-working-dir-reject",
            WorktreeStatusResult::Ok(sample_worktree_status_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                },
            )),
            true,
        );
        let external = fixture.root.join("external");
        init_repo(&external);

        let error = invoke_json(
            &fixture.webview,
            "git_get_worktree_status",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "targetBranch": "origin/main",
                "workingDir": external.to_string_lossy().to_string(),
            }),
        )
        .expect_err("unrelated working_dir should fail");

        assert!(
            error
                .to_string()
                .contains("working_dir is not within authorized repository or linked worktrees"),
            "unexpected error: {error}"
        );
        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert!(
            state.worktree_status_calls.is_empty(),
            "git port should not run for unauthorized working_dir"
        );
    }

    #[test]
    fn git_get_worktree_status_accepts_registered_worktree_working_dir() {
        let fixture = setup_command_git_fixture(
            "git-command-working-dir-accept",
            WorktreeStatusResult::Ok(sample_worktree_status_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 1,
                    behind: 0,
                },
            )),
            true,
        );
        let worktree = fixture.root.join("repo-wt");
        let worktree_str = worktree.to_string_lossy().to_string();
        run_git(
            &[
                "-C",
                fixture.repo_path.as_str(),
                "worktree",
                "add",
                "-b",
                "feature/command-working-dir",
                worktree_str.as_str(),
            ],
            Path::new(&fixture.repo_path),
        );

        let response = invoke_json(
            &fixture.webview,
            "git_get_worktree_status",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "targetBranch": "origin/main",
                "workingDir": worktree_str,
            }),
        )
        .expect("registered worktree should be accepted");
        let status: GitWorktreeStatus =
            serde_json::from_value(response).expect("response should decode as GitWorktreeStatus");
        let expected_worktree = fs::canonicalize(&worktree)
            .expect("worktree should canonicalize")
            .to_string_lossy()
            .to_string();
        assert_eq!(status.snapshot.effective_working_dir, expected_worktree);

        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert_eq!(state.worktree_status_calls.len(), 1);
        assert_eq!(state.worktree_status_calls[0].repo_path, expected_worktree);
    }

    #[test]
    fn git_get_worktree_status_summary_rejects_unauthorized_repo() {
        let fixture = setup_command_git_fixture(
            "git-command-summary-unauthorized",
            WorktreeStatusResult::Ok(sample_worktree_status_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                },
            )),
            false,
        );

        let error = invoke_json(
            &fixture.webview,
            "git_get_worktree_status_summary",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "targetBranch": "origin/main",
            }),
        )
        .expect_err("unauthorized repo should fail");

        assert!(
            error
                .to_string()
                .contains("Repository path is not in the configured workspace allowlist"),
            "unexpected error: {error}"
        );
        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert!(
            state.worktree_status_summary_calls.is_empty(),
            "git port summary path should not run when authorization fails"
        );
    }

    #[test]
    fn git_get_worktree_status_summary_keeps_upstream_error_variant_and_snapshot_metadata() {
        let fixture = setup_command_git_fixture_with_summary(
            "git-command-summary-upstream-error",
            WorktreeStatusResult::Ok(sample_worktree_status_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                },
            )),
            WorktreeStatusSummaryResult::Ok(sample_worktree_status_summary_data(
                GitUpstreamAheadBehind::Error {
                    message: "upstream not configured".to_string(),
                },
            )),
            true,
        );

        let response = invoke_json(
            &fixture.webview,
            "git_get_worktree_status_summary",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "targetBranch": "  origin/main  ",
                "diffScope": "uncommitted",
            }),
        )
        .expect("summary command should succeed");
        let status: GitWorktreeStatusSummary = serde_json::from_value(response)
            .expect("response should decode as GitWorktreeStatusSummary");

        assert_eq!(
            status.upstream_ahead_behind,
            GitUpstreamAheadBehind::Error {
                message: "upstream not configured".to_string()
            }
        );
        assert_eq!(status.snapshot.target_branch, "origin/main");
        assert_eq!(status.snapshot.diff_scope, GitDiffScope::Uncommitted);
        assert_eq!(status.snapshot.hash_version, GIT_WORKTREE_HASH_VERSION);
        assert_eq!(status.snapshot.status_hash.len(), 16);
        assert_eq!(status.snapshot.diff_hash.len(), 16);

        let expected_effective = fs::canonicalize(Path::new(&fixture.repo_path))
            .expect("repo should canonicalize")
            .to_string_lossy()
            .to_string();
        assert_eq!(status.snapshot.effective_working_dir, expected_effective);

        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert_eq!(state.worktree_status_summary_calls.len(), 1);
        assert_eq!(
            state.worktree_status_summary_calls[0],
            WorktreeStatusSummaryCall {
                repo_path: expected_effective,
                target_branch: "origin/main".to_string(),
                diff_scope: GitDiffScope::Uncommitted,
            }
        );
    }

    #[test]
    fn git_get_worktree_status_summary_propagates_git_port_failures() {
        let fixture = setup_command_git_fixture_with_summary(
            "git-command-summary-status-failure",
            WorktreeStatusResult::Ok(sample_worktree_status_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                },
            )),
            WorktreeStatusSummaryResult::Err("failed collecting summary status".to_string()),
            true,
        );

        let error = invoke_json(
            &fixture.webview,
            "git_get_worktree_status_summary",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "targetBranch": "origin/main",
            }),
        )
        .expect_err("git port summary failure should be returned");

        assert!(
            error
                .to_string()
                .contains("failed collecting summary status"),
            "unexpected error: {error}"
        );
        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert_eq!(state.worktree_status_summary_calls.len(), 1);
    }

    #[test]
    fn git_get_worktree_status_summary_rejects_invalid_diff_scope_before_git_port_call() {
        let fixture = setup_command_git_fixture(
            "git-command-summary-invalid-scope",
            WorktreeStatusResult::Ok(sample_worktree_status_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                },
            )),
            true,
        );

        let error = invoke_json(
            &fixture.webview,
            "git_get_worktree_status_summary",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "targetBranch": "origin/main",
                "diffScope": "staged",
            }),
        )
        .expect_err("invalid diff scope should fail");

        assert!(
            error
                .to_string()
                .contains("diffScope must be either 'target' or 'uncommitted'"),
            "unexpected error: {error}"
        );
        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert!(
            state.worktree_status_summary_calls.is_empty(),
            "git port summary path should not run when diffScope is invalid"
        );
    }

    #[test]
    fn git_get_worktree_status_summary_rejects_unrelated_working_dir() {
        let fixture = setup_command_git_fixture(
            "git-command-summary-working-dir-reject",
            WorktreeStatusResult::Ok(sample_worktree_status_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                },
            )),
            true,
        );
        let external = fixture.root.join("external-summary");
        init_repo(&external);

        let error = invoke_json(
            &fixture.webview,
            "git_get_worktree_status_summary",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "targetBranch": "origin/main",
                "workingDir": external.to_string_lossy().to_string(),
            }),
        )
        .expect_err("unrelated working_dir should fail");

        assert!(
            error
                .to_string()
                .contains("working_dir is not within authorized repository or linked worktrees"),
            "unexpected error: {error}"
        );
        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert!(
            state.worktree_status_summary_calls.is_empty(),
            "git port summary path should not run for unauthorized working_dir"
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

    #[test]
    fn diff_summary_hash_changes_when_scope_or_counts_change() {
        let target_ahead_behind = GitAheadBehind {
            ahead: 1,
            behind: 0,
        };
        let baseline_counts = GitFileStatusCounts {
            total: 2,
            staged: 1,
            unstaged: 1,
        };
        let changed_counts = GitFileStatusCounts {
            total: 3,
            staged: 1,
            unstaged: 2,
        };

        let baseline_hash = hash_worktree_diff_summary_payload(
            &GitDiffScope::Target,
            &target_ahead_behind,
            &baseline_counts,
        );
        let changed_counts_hash = hash_worktree_diff_summary_payload(
            &GitDiffScope::Target,
            &target_ahead_behind,
            &changed_counts,
        );
        let changed_scope_hash = hash_worktree_diff_summary_payload(
            &GitDiffScope::Uncommitted,
            &target_ahead_behind,
            &baseline_counts,
        );

        assert_ne!(baseline_hash, changed_counts_hash);
        assert_ne!(baseline_hash, changed_scope_hash);
    }

    #[test]
    fn build_worktree_status_summary_with_snapshot_preserves_payload_and_snapshot_fields() {
        let built = build_worktree_status_summary_with_snapshot(
            GitCurrentBranch {
                name: Some("feature/snapshot".to_string()),
                detached: false,
            },
            GitFileStatusCounts {
                total: 4,
                staged: 2,
                unstaged: 2,
            },
            GitAheadBehind {
                ahead: 3,
                behind: 1,
            },
            GitUpstreamAheadBehind::Tracking {
                ahead: 5,
                behind: 0,
            },
            WorktreeSnapshotMetadata {
                effective_working_dir: "/tmp/openducktor-worktree".to_string(),
                target_branch: "origin/main".to_string(),
                diff_scope: GitDiffScope::Uncommitted,
                observed_at_ms: 99,
                hash_version: GIT_WORKTREE_HASH_VERSION,
                status_hash: "0123456789abcdef".to_string(),
                diff_hash: "fedcba9876543210".to_string(),
            },
        );

        assert_eq!(
            built.current_branch.name.as_deref(),
            Some("feature/snapshot")
        );
        assert_eq!(built.file_status_counts.total, 4);
        assert_eq!(built.file_status_counts.staged, 2);
        assert_eq!(built.file_status_counts.unstaged, 2);
        assert_eq!(built.target_ahead_behind.ahead, 3);
        assert_eq!(
            built.upstream_ahead_behind,
            GitUpstreamAheadBehind::Tracking {
                ahead: 5,
                behind: 0
            }
        );
        assert_eq!(built.snapshot.diff_scope, GitDiffScope::Uncommitted);
        assert_eq!(built.snapshot.observed_at_ms, 99);
        assert_eq!(built.snapshot.hash_version, GIT_WORKTREE_HASH_VERSION);
        assert_eq!(built.snapshot.status_hash, "0123456789abcdef");
        assert_eq!(built.snapshot.diff_hash, "fedcba9876543210");
    }
}
