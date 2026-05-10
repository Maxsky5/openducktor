use super::{build_registry, dispatch_command};
use crate::headless::command_support::{HeadlessCommandError, HeadlessState};
use crate::headless::events::HeadlessEventBus;
use axum::body::to_bytes;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use host_application::AppService;
use host_domain::{
    GitAheadBehind, GitBranch, GitCommitAllRequest, GitConflictAbortRequest,
    GitConflictAbortResult, GitCurrentBranch, GitDiffScope, GitFetchRequest, GitFetchResult,
    GitFileDiff, GitFileStatus, GitFileStatusCounts, GitMergeBranchRequest, GitMergeBranchResult,
    GitPort, GitPullRequest, GitPullResult, GitPushResult, GitRebaseAbortRequest,
    GitRebaseAbortResult, GitRebaseBranchRequest, GitRebaseBranchResult, GitResetSnapshot,
    GitResetWorktreeSelection, GitResetWorktreeSelectionRequest, GitResetWorktreeSelectionResult,
    GitUpstreamAheadBehind, GitWorktreeStatusData, GitWorktreeStatusSummaryData,
    GitWorktreeSummary, TaskStore,
};
use host_infra_beads::BeadsTaskStore;
use host_infra_system::AppConfigStore;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Notify;

struct TestGitFixture {
    state: HeadlessState,
    root: PathBuf,
    repo_path: PathBuf,
    git_state: Arc<Mutex<TestGitPortState>>,
}

impl Drop for TestGitFixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct FetchRemoteCall {
    repo_path: String,
    working_dir: Option<String>,
    target_branch: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResetWorktreeSelectionCall {
    repo_path: String,
    working_dir: Option<String>,
    target_branch: String,
    snapshot: GitResetSnapshot,
    selection: GitResetWorktreeSelection,
}

struct TestGitPortState {
    worktree_status_result: Result<Box<GitWorktreeStatusData>, String>,
    worktree_status_calls: Vec<WorktreeStatusCall>,
    worktree_status_summary_result: Result<Box<GitWorktreeStatusSummaryData>, String>,
    worktree_status_summary_calls: Vec<WorktreeStatusSummaryCall>,
    fetch_remote_result: Result<GitFetchResult, String>,
    fetch_remote_calls: Vec<FetchRemoteCall>,
    reset_worktree_selection_result: Result<GitResetWorktreeSelectionResult, String>,
    reset_worktree_selection_calls: Vec<ResetWorktreeSelectionCall>,
}

struct TestGitPort {
    state: Arc<Mutex<TestGitPortState>>,
}

impl TestGitPort {
    fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(TestGitPortState {
                worktree_status_result: Ok(Box::new(sample_worktree_status_data(
                    GitUpstreamAheadBehind::Tracking {
                        ahead: 0,
                        behind: 0,
                    },
                ))),
                worktree_status_calls: Vec::new(),
                worktree_status_summary_result: Ok(Box::new(sample_worktree_status_summary_data(
                    GitUpstreamAheadBehind::Tracking {
                        ahead: 0,
                        behind: 0,
                    },
                ))),
                worktree_status_summary_calls: Vec::new(),
                fetch_remote_result: Ok(GitFetchResult::Fetched {
                    output: "Fetched origin".to_string(),
                }),
                fetch_remote_calls: Vec::new(),
                reset_worktree_selection_result: Ok(GitResetWorktreeSelectionResult {
                    affected_paths: vec!["src/main.rs".to_string()],
                }),
                reset_worktree_selection_calls: Vec::new(),
            })),
        }
    }
}

fn sample_worktree_status_data(upstream: GitUpstreamAheadBehind) -> GitWorktreeStatusData {
    GitWorktreeStatusData {
        current_branch: GitCurrentBranch {
            name: Some("feature/command".to_string()),
            detached: false,
            revision: None,
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
        git_conflict: None,
    }
}

fn sample_worktree_status_summary_data(
    upstream: GitUpstreamAheadBehind,
) -> GitWorktreeStatusSummaryData {
    GitWorktreeStatusSummaryData {
        current_branch: GitCurrentBranch {
            name: Some("feature/command".to_string()),
            detached: false,
            revision: None,
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
        git_conflict: None,
    }
}

fn unique_temp_path(prefix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after UNIX_EPOCH")
        .as_nanos();
    std::env::temp_dir().join(format!("openducktor-headless-git-tests-{prefix}-{nanos}"))
}

fn init_repo(path: &Path) {
    fs::create_dir_all(path).expect("test repo should exist");
    let status = Command::new("git")
        .arg("init")
        .arg("--initial-branch=main")
        .current_dir(path)
        .status()
        .expect("git init should run");
    assert!(status.success(), "git init should succeed");
}

fn init_repo_with_commit(path: &Path) {
    init_repo(path);
    fs::write(path.join("README.md"), "init\n").expect("seed file should write");
    let add_status = Command::new("git")
        .args(["add", "."])
        .current_dir(path)
        .status()
        .expect("git add should run");
    assert!(add_status.success(), "git add should succeed");
    let commit_status = Command::new("git")
        .args([
            "-c",
            "user.name=OpenDucktor Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "-m",
            "init",
        ])
        .current_dir(path)
        .status()
        .expect("git commit should run");
    assert!(commit_status.success(), "git commit should succeed");
}

fn create_linked_worktree(repo_path: &Path, worktree_path: &Path, branch: &str) {
    let repo_path = repo_path.to_string_lossy().to_string();
    let worktree_path = worktree_path.to_string_lossy().to_string();
    let status = Command::new("git")
        .args([
            "-C",
            repo_path.as_str(),
            "worktree",
            "add",
            "-b",
            branch,
            worktree_path.as_str(),
        ])
        .status()
        .expect("git worktree add should run");
    assert!(status.success(), "git worktree add should succeed");
}

fn authorized_git_fixture(prefix: &str) -> TestGitFixture {
    test_git_fixture(prefix, true)
}

fn unauthorized_git_fixture(prefix: &str) -> TestGitFixture {
    test_git_fixture(prefix, false)
}

fn test_git_fixture(prefix: &str, authorize_repo: bool) -> TestGitFixture {
    let root = unique_temp_path(prefix);
    fs::create_dir_all(&root).expect("test root should exist");
    let repo = root.join("repo");
    init_repo_with_commit(&repo);

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    if authorize_repo {
        config_store
            .add_workspace("repo", "repo", repo.to_string_lossy().as_ref())
            .expect("workspace should be allowlisted");
    }

    let git_port = TestGitPort::new();
    let git_state = git_port.state.clone();
    let task_store: Arc<dyn TaskStore> = Arc::new(
        BeadsTaskStore::with_metadata_namespace_and_config("openducktor", config_store.clone()),
    );
    let service = Arc::new(AppService::with_git_port(
        task_store,
        config_store,
        Arc::new(git_port),
    ));

    TestGitFixture {
        state: HeadlessState {
            service,
            events: HeadlessEventBus::new(1),
            dev_server_events: HeadlessEventBus::new(1),
            task_events: HeadlessEventBus::new(1),
            pull_request_sync_stop_requested: Arc::new(AtomicBool::new(false)),
            registry: Arc::new(build_registry().expect("registry should build")),
            shutdown_signal: Arc::new(Notify::new()),
            shutdown_started: Arc::new(AtomicBool::new(false)),
            control_token: None,
            app_token: None,
        },
        root,
        repo_path: repo,
        git_state,
    }
}

async fn response_json(error: HeadlessCommandError) -> (StatusCode, Value) {
    let response = error.into_response();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("error response body should collect");
    let payload = serde_json::from_slice(&bytes).expect("error response should deserialize");
    (status, payload)
}

fn canonical_path_string(path: &Path) -> String {
    fs::canonicalize(path)
        .expect("path should canonicalize")
        .to_string_lossy()
        .to_string()
}

#[tokio::test]
async fn headless_git_get_worktree_status_keeps_snapshot_metadata_and_upstream_error() {
    let fixture = authorized_git_fixture("status");
    let worktree = fixture.root.join("repo-wt");
    let worktree_str = worktree.to_string_lossy().to_string();
    {
        let mut state = fixture
            .git_state
            .lock()
            .expect("git port state lock should not be poisoned");
        state.worktree_status_result = Ok(Box::new(sample_worktree_status_data(
            GitUpstreamAheadBehind::Error {
                message: "upstream not configured".to_string(),
            },
        )));
    }
    create_linked_worktree(&fixture.repo_path, &worktree, "feature/headless-git");

    let response = dispatch_command(
        &fixture.state,
        "git_get_worktree_status",
        json!({
            "repoPath": fixture.repo_path.to_string_lossy().to_string(),
            "targetBranch": "  origin/main  ",
            "diffScope": "uncommitted",
            "workingDir": worktree_str,
        }),
    )
    .await
    .expect("status command should succeed");
    let status: host_domain::GitWorktreeStatus =
        serde_json::from_value(response).expect("response should decode as GitWorktreeStatus");

    assert_eq!(
        status.upstream_ahead_behind,
        GitUpstreamAheadBehind::Error {
            message: "upstream not configured".to_string()
        }
    );
    assert_eq!(status.snapshot.target_branch, "origin/main");
    assert_eq!(status.snapshot.diff_scope, GitDiffScope::Uncommitted);
    assert_eq!(
        status.snapshot.hash_version,
        host_command_services::command_services::git::GIT_WORKTREE_HASH_VERSION
    );
    assert_eq!(status.snapshot.status_hash.len(), 16);
    assert_eq!(status.snapshot.diff_hash.len(), 16);

    let expected_worktree = canonical_path_string(&worktree);
    assert_eq!(status.snapshot.effective_working_dir, expected_worktree);

    let state = fixture
        .git_state
        .lock()
        .expect("git port state lock should not be poisoned");
    assert_eq!(state.worktree_status_calls.len(), 1);
    assert_eq!(
        state.worktree_status_calls[0],
        WorktreeStatusCall {
            repo_path: expected_worktree,
            target_branch: "origin/main".to_string(),
            diff_scope: GitDiffScope::Uncommitted,
        }
    );
}

#[tokio::test]
async fn headless_git_fetch_remote_forwards_trimmed_target_branch_and_effective_working_dir() {
    let fixture = authorized_git_fixture("fetch");
    let worktree = fixture.root.join("repo-wt-fetch");
    let worktree_str = worktree.to_string_lossy().to_string();
    create_linked_worktree(&fixture.repo_path, &worktree, "feature/headless-fetch");

    let response = dispatch_command(
        &fixture.state,
        "git_fetch_remote",
        json!({
            "repoPath": fixture.repo_path.to_string_lossy().to_string(),
            "targetBranch": "  origin/main  ",
            "workingDir": worktree_str,
        }),
    )
    .await
    .expect("fetch command should succeed");

    assert_eq!(response["outcome"], json!("fetched"));
    assert_eq!(response["output"], json!("Fetched origin"));

    let expected_worktree = canonical_path_string(&worktree);
    let state = fixture
        .git_state
        .lock()
        .expect("git port state lock should not be poisoned");
    assert_eq!(state.fetch_remote_calls.len(), 1);
    assert_eq!(
        state.fetch_remote_calls[0],
        FetchRemoteCall {
            repo_path: expected_worktree.clone(),
            working_dir: Some(expected_worktree),
            target_branch: "origin/main".to_string(),
        }
    );
}

#[tokio::test]
async fn headless_git_reset_worktree_selection_forwards_snapshot_selection_and_working_dir() {
    let fixture = authorized_git_fixture("reset");
    let worktree = fixture.root.join("repo-wt-reset");
    let worktree_str = worktree.to_string_lossy().to_string();
    create_linked_worktree(&fixture.repo_path, &worktree, "feature/headless-reset");

    let response = dispatch_command(
        &fixture.state,
        "git_reset_worktree_selection",
        json!({
            "repoPath": fixture.repo_path.to_string_lossy().to_string(),
            "targetBranch": "  origin/main  ",
            "workingDir": worktree_str,
            "snapshot": {
                "hashVersion": host_command_services::command_services::git::GIT_WORKTREE_HASH_VERSION,
                "statusHash": "status-hash",
                "diffHash": "diff-hash",
            },
            "selection": {
                "kind": "hunk",
                "filePath": "src/main.rs",
                "hunkIndex": 2,
            },
        }),
    )
    .await
    .expect("reset command should succeed");

    assert_eq!(response["affectedPaths"], json!(["src/main.rs"]));

    let expected_worktree = canonical_path_string(&worktree);
    let state = fixture
        .git_state
        .lock()
        .expect("git port state lock should not be poisoned");
    assert_eq!(state.reset_worktree_selection_calls.len(), 1);
    assert_eq!(
        state.reset_worktree_selection_calls[0],
        ResetWorktreeSelectionCall {
            repo_path: expected_worktree.clone(),
            working_dir: Some(expected_worktree),
            target_branch: "origin/main".to_string(),
            snapshot: GitResetSnapshot {
                hash_version:
                    host_command_services::command_services::git::GIT_WORKTREE_HASH_VERSION,
                status_hash: "status-hash".to_string(),
                diff_hash: "diff-hash".to_string(),
            },
            selection: GitResetWorktreeSelection::Hunk {
                file_path: "src/main.rs".to_string(),
                hunk_index: 2,
            },
        }
    );
}

#[tokio::test]
async fn headless_git_get_worktree_status_rejects_unauthorized_repo_without_calling_git_port() {
    let fixture = unauthorized_git_fixture("unauthorized");

    let error = dispatch_command(
        &fixture.state,
        "git_get_worktree_status",
        json!({
            "repoPath": fixture.repo_path.to_string_lossy().to_string(),
            "targetBranch": "origin/main"
        }),
    )
    .await
    .expect_err("unauthorized repo should fail");
    let (status, payload) = response_json(error).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(payload["error"]
        .as_str()
        .expect("error should be a string")
        .contains("Repository path is not in the configured workspace allowlist"));
    assert!(fixture
        .git_state
        .lock()
        .expect("git port state lock should not be poisoned")
        .worktree_status_calls
        .is_empty());
}

#[tokio::test]
async fn headless_git_get_worktree_status_rejects_unrelated_working_dir_without_calling_git_port() {
    let fixture = authorized_git_fixture("working-dir-reject");
    let external = fixture.root.join("external");
    fs::create_dir_all(&external).expect("external dir should exist");

    let error = dispatch_command(
        &fixture.state,
        "git_get_worktree_status",
        json!({
            "repoPath": fixture.repo_path.to_string_lossy().to_string(),
            "targetBranch": "origin/main",
            "workingDir": external.to_string_lossy().to_string(),
        }),
    )
    .await
    .expect_err("unrelated working dir should fail");
    let (status, payload) = response_json(error).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(payload["error"]
        .as_str()
        .expect("error should be a string")
        .contains("working_dir is not within authorized repository or linked worktrees"));
    assert!(fixture
        .git_state
        .lock()
        .expect("git port state lock should not be poisoned")
        .worktree_status_calls
        .is_empty());
}

#[tokio::test]
async fn headless_git_get_worktree_status_rejects_invalid_diff_scope_without_calling_git_port() {
    let fixture = authorized_git_fixture("invalid-scope");

    let error = dispatch_command(
        &fixture.state,
        "git_get_worktree_status",
        json!({
            "repoPath": fixture.repo_path.to_string_lossy().to_string(),
            "targetBranch": "origin/main",
            "diffScope": "staged"
        }),
    )
    .await
    .expect_err("invalid diff scope should fail");
    let (status, payload) = response_json(error).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(payload["error"]
        .as_str()
        .expect("error should be a string")
        .contains("diffScope must be either 'target' or 'uncommitted'"));
    assert!(fixture
        .git_state
        .lock()
        .expect("git port state lock should not be poisoned")
        .worktree_status_calls
        .is_empty());
}

#[tokio::test]
async fn headless_git_commits_ahead_behind_rejects_blank_target_branch_before_git_port() {
    let fixture = authorized_git_fixture("ahead-behind-blank-target");

    let error = dispatch_command(
        &fixture.state,
        "git_commits_ahead_behind",
        json!({
            "repoPath": fixture.repo_path.to_string_lossy().to_string(),
            "targetBranch": "   "
        }),
    )
    .await
    .expect_err("blank target branch should fail");
    let (status, payload) = response_json(error).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(payload["error"], "targetBranch is required");
}

impl GitPort for TestGitPort {
    fn get_branches(&self, _repo_path: &Path) -> anyhow::Result<Vec<GitBranch>> {
        panic!("unexpected call: get_branches");
    }

    fn get_current_branch(&self, _repo_path: &Path) -> anyhow::Result<GitCurrentBranch> {
        panic!("unexpected call: get_current_branch");
    }

    fn list_worktrees(&self, _repo_path: &Path) -> anyhow::Result<Vec<GitWorktreeSummary>> {
        panic!("unexpected call: list_worktrees");
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

    fn delete_local_branch(
        &self,
        _repo_path: &Path,
        _branch: &str,
        _force: bool,
    ) -> anyhow::Result<()> {
        panic!("unexpected call: delete_local_branch");
    }

    fn push_branch(
        &self,
        _repo_path: &Path,
        _remote: &str,
        _branch: &str,
        _set_upstream: bool,
        _force_with_lease: bool,
    ) -> anyhow::Result<GitPushResult> {
        panic!("unexpected call: push_branch");
    }

    fn pull_branch(
        &self,
        _repo_path: &Path,
        _request: GitPullRequest,
    ) -> anyhow::Result<GitPullResult> {
        panic!("unexpected call: pull_branch");
    }

    fn fetch_remote(
        &self,
        repo_path: &Path,
        request: GitFetchRequest,
    ) -> anyhow::Result<GitFetchResult> {
        let mut state = self
            .state
            .lock()
            .expect("git port state lock should not be poisoned");
        state.fetch_remote_calls.push(FetchRemoteCall {
            repo_path: repo_path.to_string_lossy().to_string(),
            working_dir: request.working_dir,
            target_branch: request.target_branch,
        });
        state
            .fetch_remote_result
            .clone()
            .map_err(|message| anyhow::anyhow!(message))
    }

    fn rebase_abort(
        &self,
        _repo_path: &Path,
        _request: GitRebaseAbortRequest,
    ) -> anyhow::Result<GitRebaseAbortResult> {
        panic!("unexpected call: rebase_abort");
    }

    fn abort_conflict(
        &self,
        _repo_path: &Path,
        _request: GitConflictAbortRequest,
    ) -> anyhow::Result<GitConflictAbortResult> {
        panic!("unexpected call: abort_conflict");
    }

    fn merge_branch(
        &self,
        _repo_path: &Path,
        _request: GitMergeBranchRequest,
    ) -> anyhow::Result<GitMergeBranchResult> {
        panic!("unexpected call: merge_branch");
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
            .expect("git port state lock should not be poisoned");
        state.worktree_status_calls.push(WorktreeStatusCall {
            repo_path: repo_path.to_string_lossy().to_string(),
            target_branch: target_branch.to_string(),
            diff_scope,
        });
        state
            .worktree_status_result
            .clone()
            .map(|payload| *payload)
            .map_err(|message| anyhow::anyhow!(message))
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
            .expect("git port state lock should not be poisoned");
        state
            .worktree_status_summary_calls
            .push(WorktreeStatusSummaryCall {
                repo_path: repo_path.to_string_lossy().to_string(),
                target_branch: target_branch.to_string(),
                diff_scope,
            });
        state
            .worktree_status_summary_result
            .clone()
            .map(|payload| *payload)
            .map_err(|message| anyhow::anyhow!(message))
    }

    fn resolve_upstream_target(&self, _repo_path: &Path) -> anyhow::Result<Option<String>> {
        panic!("unexpected call: resolve_upstream_target");
    }

    fn suggested_squash_commit_message(
        &self,
        _repo_path: &Path,
        _source_branch: &str,
        _target_branch: &str,
    ) -> anyhow::Result<Option<String>> {
        panic!("unexpected call: suggested_squash_commit_message");
    }

    fn is_ancestor(
        &self,
        _repo_path: &Path,
        _ancestor_ref: &str,
        _descendant_ref: &str,
    ) -> anyhow::Result<bool> {
        panic!("unexpected call: is_ancestor");
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
    ) -> anyhow::Result<host_domain::GitCommitAllResult> {
        panic!("unexpected call: commit_all");
    }

    fn reset_worktree_selection(
        &self,
        repo_path: &Path,
        request: GitResetWorktreeSelectionRequest,
    ) -> anyhow::Result<GitResetWorktreeSelectionResult> {
        let mut state = self
            .state
            .lock()
            .expect("git port state lock should not be poisoned");
        state
            .reset_worktree_selection_calls
            .push(ResetWorktreeSelectionCall {
                repo_path: repo_path.to_string_lossy().to_string(),
                working_dir: request.working_dir,
                target_branch: request.target_branch,
                snapshot: request.snapshot,
                selection: request.selection,
            });
        state
            .reset_worktree_selection_result
            .clone()
            .map_err(|message| anyhow::anyhow!(message))
    }

    fn rebase_branch(
        &self,
        _repo_path: &Path,
        _request: GitRebaseBranchRequest,
    ) -> anyhow::Result<GitRebaseBranchResult> {
        panic!("unexpected call: rebase_branch");
    }
}
