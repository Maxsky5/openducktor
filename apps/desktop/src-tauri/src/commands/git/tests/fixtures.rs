use super::super::authorization::{
    authorized_worktree_cache, cache_key, invalidate_worktree_resolution_cache_for_repo,
    read_worktree_state_token, AuthorizedWorktreeCacheEntry,
};
use crate::AppState;
use anyhow::anyhow;
use host_application::AppService;
use host_domain::GitPort;
use host_domain::{
    AgentSessionDocument, CreateTaskInput, GitAheadBehind, GitBranch, GitCommitAllRequest,
    GitCommitAllResult, GitCurrentBranch, GitDiffScope, GitFileDiff, GitFileStatus,
    GitFileStatusCounts, GitPullRequest, GitPullResult, GitPushResult, GitRebaseAbortRequest,
    GitRebaseAbortResult, GitRebaseBranchRequest, GitRebaseBranchResult, GitUpstreamAheadBehind,
    GitWorktreeStatusData, GitWorktreeStatusSummaryData, QaReportDocument, QaVerdict, SpecDocument,
    TaskCard, TaskMetadata, TaskStatus, TaskStore, UpdateTaskPatch,
};
use host_infra_system::AppConfigStore;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{
    ipc::{CallbackFn, InvokeBody},
    test::{mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY},
    webview::InvokeRequest,
    App, Webview, WebviewWindow, WebviewWindowBuilder,
};

#[derive(Clone)]
pub(super) enum WorktreeStatusResult {
    Ok(GitWorktreeStatusData),
    Err(String),
}

#[derive(Clone)]
pub(super) enum WorktreeStatusSummaryResult {
    Ok(GitWorktreeStatusSummaryData),
    Err(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct WorktreeStatusCall {
    pub(super) repo_path: String,
    pub(super) target_branch: String,
    pub(super) diff_scope: GitDiffScope,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct WorktreeStatusSummaryCall {
    pub(super) repo_path: String,
    pub(super) target_branch: String,
    pub(super) diff_scope: GitDiffScope,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CreateWorktreeCall {
    pub(super) repo_path: String,
    pub(super) worktree_path: String,
    pub(super) branch: String,
    pub(super) create_branch: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct RemoveWorktreeCall {
    pub(super) repo_path: String,
    pub(super) worktree_path: String,
    pub(super) force: bool,
}

pub(super) struct CommandGitPortState {
    pub(super) worktree_status_result: WorktreeStatusResult,
    pub(super) worktree_status_calls: Vec<WorktreeStatusCall>,
    pub(super) worktree_status_summary_result: WorktreeStatusSummaryResult,
    pub(super) worktree_status_summary_calls: Vec<WorktreeStatusSummaryCall>,
    pub(super) worktree_mutation_allowed: bool,
    pub(super) create_worktree_calls: Vec<CreateWorktreeCall>,
    pub(super) remove_worktree_calls: Vec<RemoveWorktreeCall>,
}

struct CommandGitPort {
    state: Arc<Mutex<CommandGitPortState>>,
}

struct CommandTaskStore;

fn empty_spec_document() -> SpecDocument {
    SpecDocument {
        markdown: String::new(),
        updated_at: None,
    }
}

impl TaskStore for CommandTaskStore {
    fn ensure_repo_initialized(&self, _repo_path: &Path) -> anyhow::Result<()> {
        Ok(())
    }

    fn list_tasks(&self, _repo_path: &Path) -> anyhow::Result<Vec<TaskCard>> {
        Ok(Vec::new())
    }

    fn create_task(&self, _repo_path: &Path, _input: CreateTaskInput) -> anyhow::Result<TaskCard> {
        Err(anyhow!(
            "unexpected task store create_task call in git command tests"
        ))
    }

    fn update_task(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        _patch: UpdateTaskPatch,
    ) -> anyhow::Result<TaskCard> {
        Err(anyhow!(
            "unexpected task store update_task call in git command tests"
        ))
    }

    fn delete_task(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        _delete_subtasks: bool,
    ) -> anyhow::Result<bool> {
        Err(anyhow!(
            "unexpected task store delete_task call in git command tests"
        ))
    }

    fn get_spec(&self, _repo_path: &Path, _task_id: &str) -> anyhow::Result<SpecDocument> {
        Ok(empty_spec_document())
    }

    fn set_spec(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        markdown: &str,
    ) -> anyhow::Result<SpecDocument> {
        Ok(SpecDocument {
            markdown: markdown.to_string(),
            updated_at: None,
        })
    }

    fn get_plan(&self, _repo_path: &Path, _task_id: &str) -> anyhow::Result<SpecDocument> {
        Ok(empty_spec_document())
    }

    fn set_plan(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        markdown: &str,
    ) -> anyhow::Result<SpecDocument> {
        Ok(SpecDocument {
            markdown: markdown.to_string(),
            updated_at: None,
        })
    }

    fn get_latest_qa_report(
        &self,
        _repo_path: &Path,
        _task_id: &str,
    ) -> anyhow::Result<Option<QaReportDocument>> {
        Ok(None)
    }

    fn append_qa_report(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        markdown: &str,
        verdict: QaVerdict,
    ) -> anyhow::Result<QaReportDocument> {
        Ok(QaReportDocument {
            markdown: markdown.to_string(),
            verdict,
            updated_at: String::new(),
            revision: 0,
        })
    }

    fn record_qa_outcome(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        _target_status: TaskStatus,
        _markdown: &str,
        _verdict: QaVerdict,
    ) -> anyhow::Result<TaskCard> {
        Err(anyhow!(
            "unexpected task store record_qa_outcome call in git command tests"
        ))
    }

    fn list_agent_sessions(
        &self,
        _repo_path: &Path,
        _task_id: &str,
    ) -> anyhow::Result<Vec<AgentSessionDocument>> {
        Ok(Vec::new())
    }

    fn upsert_agent_session(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        _session: AgentSessionDocument,
    ) -> anyhow::Result<()> {
        Ok(())
    }

    fn get_task_metadata(&self, _repo_path: &Path, _task_id: &str) -> anyhow::Result<TaskMetadata> {
        Ok(TaskMetadata {
            spec: empty_spec_document(),
            plan: empty_spec_document(),
            qa_report: None,
            agent_sessions: Vec::new(),
        })
    }
}

impl CommandGitPort {
    fn new_with_summary_result(
        result: WorktreeStatusResult,
        summary_result: WorktreeStatusSummaryResult,
        worktree_mutation_allowed: bool,
    ) -> Self {
        Self {
            state: Arc::new(Mutex::new(CommandGitPortState {
                worktree_status_result: result,
                worktree_status_calls: Vec::new(),
                worktree_status_summary_result: summary_result,
                worktree_status_summary_calls: Vec::new(),
                worktree_mutation_allowed,
                create_worktree_calls: Vec::new(),
                remove_worktree_calls: Vec::new(),
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
        repo_path: &Path,
        worktree_path: &Path,
        branch: &str,
        create_branch: bool,
    ) -> anyhow::Result<()> {
        let mut state = self
            .state
            .lock()
            .expect("command git port state lock should not be poisoned");
        if !state.worktree_mutation_allowed {
            panic!("unexpected call: create_worktree");
        }
        state.create_worktree_calls.push(CreateWorktreeCall {
            repo_path: repo_path.to_string_lossy().to_string(),
            worktree_path: worktree_path.to_string_lossy().to_string(),
            branch: branch.to_string(),
            create_branch,
        });
        Ok(())
    }

    fn remove_worktree(
        &self,
        repo_path: &Path,
        worktree_path: &Path,
        force: bool,
    ) -> anyhow::Result<()> {
        let mut state = self
            .state
            .lock()
            .expect("command git port state lock should not be poisoned");
        if !state.worktree_mutation_allowed {
            panic!("unexpected call: remove_worktree");
        }
        state.remove_worktree_calls.push(RemoveWorktreeCall {
            repo_path: repo_path.to_string_lossy().to_string(),
            worktree_path: worktree_path.to_string_lossy().to_string(),
            force,
        });
        Ok(())
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

    fn rebase_abort(
        &self,
        _repo_path: &Path,
        _request: GitRebaseAbortRequest,
    ) -> anyhow::Result<GitRebaseAbortResult> {
        panic!("unexpected call: rebase_abort");
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

pub(super) struct CommandGitFixture {
    pub(super) app: App<MockRuntime>,
    pub(super) webview: WebviewWindow<MockRuntime>,
    pub(super) repo_path: String,
    pub(super) git_state: Arc<Mutex<CommandGitPortState>>,
    pub(super) root: PathBuf,
}

impl Drop for CommandGitFixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

pub(super) fn unique_test_dir(prefix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before unix epoch")
        .as_nanos();
    let dir = env::temp_dir().join(format!("openducktor-{prefix}-{nanos}"));
    fs::create_dir_all(&dir).expect("failed to create test directory");
    dir
}

pub(super) fn run_git(args: &[&str], cwd: &Path) {
    let status = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .status()
        .expect("failed to run git command");
    assert!(status.success(), "git command failed: {:?}", args);
}

pub(super) fn init_repo(path: &Path) {
    fs::create_dir_all(path).expect("failed to create repo directory");
    run_git(&["init", "--initial-branch=main"], path);
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

pub(super) fn setup_command_git_fixture(
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
        false,
    )
}

pub(super) fn setup_command_git_fixture_with_mutations(
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
        true,
    )
}

pub(super) fn setup_command_git_fixture_with_summary(
    prefix: &str,
    result: WorktreeStatusResult,
    summary_result: WorktreeStatusSummaryResult,
    authorize_repo: bool,
    worktree_mutation_allowed: bool,
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

    let git_port =
        CommandGitPort::new_with_summary_result(result, summary_result, worktree_mutation_allowed);
    let git_state = git_port.state.clone();
    let task_store: Arc<dyn TaskStore> = Arc::new(CommandTaskStore);
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
            super::super::command_handlers::git_get_worktree_status,
            super::super::command_handlers::git_get_worktree_status_summary,
            super::super::command_handlers::git_create_worktree,
            super::super::command_handlers::git_remove_worktree
        ])
        .build(mock_context(noop_assets()))
        .expect("test app should build");
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("test webview should build");

    CommandGitFixture {
        app,
        webview,
        repo_path: repo.to_string_lossy().to_string(),
        git_state,
        root,
    }
}

pub(super) fn invoke_json<W: AsRef<Webview<MockRuntime>>>(
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

pub(super) fn seed_authorized_worktree_cache_with_subset(repo: &Path, allowed_worktrees: &[&Path]) {
    let canonical_repo = fs::canonicalize(repo).expect("repo should canonicalize for cache seed");
    let worktree_state_token = read_worktree_state_token(canonical_repo.as_path())
        .expect("worktree state token should be readable for cache seed");
    let seeded_worktrees = allowed_worktrees
        .iter()
        .map(|path| fs::canonicalize(path).expect("worktree should canonicalize for cache seed"))
        .collect::<HashSet<_>>();
    let mut cache = authorized_worktree_cache()
        .lock()
        .expect("authorized worktree cache lock should not be poisoned");
    cache.insert(
        cache_key(canonical_repo.as_path()),
        AuthorizedWorktreeCacheEntry {
            cached_at: Instant::now(),
            worktree_state_token,
            worktrees: seeded_worktrees,
        },
    );
}

pub(super) fn clear_authorized_worktree_cache_for_repo(repo: &Path) {
    invalidate_worktree_resolution_cache_for_repo(repo.to_string_lossy().as_ref())
        .expect("worktree cache should clear for repository");
}

pub(super) fn sample_worktree_status_data(
    upstream: GitUpstreamAheadBehind,
) -> GitWorktreeStatusData {
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
    }
}

pub(super) fn sample_worktree_status_summary_data(
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
    }
}
