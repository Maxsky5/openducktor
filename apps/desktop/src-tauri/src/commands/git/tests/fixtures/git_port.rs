use std::{
    path::Path,
    sync::{Arc, Mutex},
};

use anyhow::anyhow;
use host_domain::GitPort;
use host_domain::{
    GitAheadBehind, GitBranch, GitCommitAllRequest, GitConflictAbortRequest,
    GitConflictAbortResult, GitCurrentBranch, GitDiffScope, GitFileDiff, GitFileStatus,
    GitMergeBranchRequest, GitMergeBranchResult, GitPullRequest, GitPullResult, GitPushResult,
    GitRebaseAbortRequest, GitRebaseAbortResult, GitRebaseBranchRequest, GitRebaseBranchResult,
    GitResetWorktreeSelection, GitResetWorktreeSelectionRequest, GitResetWorktreeSelectionResult,
    GitWorktreeStatusData, GitWorktreeStatusSummaryData,
};

#[derive(Clone)]
pub(crate) enum WorktreeStatusResult {
    Ok(GitWorktreeStatusData),
    Err(String),
}

#[derive(Clone)]
pub(crate) enum WorktreeStatusSummaryResult {
    Ok(GitWorktreeStatusSummaryData),
    Err(String),
}

#[derive(Clone)]
pub(crate) enum ResetWorktreeSelectionResult {
    Ok(GitResetWorktreeSelectionResult),
    Err(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorktreeStatusCall {
    pub(crate) repo_path: String,
    pub(crate) target_branch: String,
    pub(crate) diff_scope: GitDiffScope,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorktreeStatusSummaryCall {
    pub(crate) repo_path: String,
    pub(crate) target_branch: String,
    pub(crate) diff_scope: GitDiffScope,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CreateWorktreeCall {
    pub(crate) repo_path: String,
    pub(crate) worktree_path: String,
    pub(crate) branch: String,
    pub(crate) create_branch: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RemoveWorktreeCall {
    pub(crate) repo_path: String,
    pub(crate) worktree_path: String,
    pub(crate) force: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResetWorktreeSelectionCall {
    pub(crate) repo_path: String,
    pub(crate) working_dir: Option<String>,
    pub(crate) target_branch: String,
    pub(crate) selection: GitResetWorktreeSelection,
}

pub(crate) struct CommandGitPortState {
    pub(crate) worktree_status_result: WorktreeStatusResult,
    pub(crate) worktree_status_calls: Vec<WorktreeStatusCall>,
    pub(crate) worktree_status_summary_result: WorktreeStatusSummaryResult,
    pub(crate) worktree_status_summary_calls: Vec<WorktreeStatusSummaryCall>,
    pub(crate) reset_worktree_selection_result: ResetWorktreeSelectionResult,
    pub(crate) reset_worktree_selection_calls: Vec<ResetWorktreeSelectionCall>,
    pub(crate) worktree_mutation_allowed: bool,
    pub(crate) create_worktree_calls: Vec<CreateWorktreeCall>,
    pub(crate) remove_worktree_calls: Vec<RemoveWorktreeCall>,
}

pub(crate) struct CommandGitPort {
    pub(crate) state: Arc<Mutex<CommandGitPortState>>,
}

impl CommandGitPort {
    pub(crate) fn new_with_summary_result(
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
                reset_worktree_selection_result: ResetWorktreeSelectionResult::Ok(
                    GitResetWorktreeSelectionResult {
                        affected_paths: vec!["src/main.rs".to_string()],
                    },
                ),
                reset_worktree_selection_calls: Vec::new(),
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
            .expect("command git port state lock should not be poisoned");
        state
            .reset_worktree_selection_calls
            .push(ResetWorktreeSelectionCall {
                repo_path: repo_path.to_string_lossy().to_string(),
                working_dir: request.working_dir,
                target_branch: request.target_branch,
                selection: request.selection,
            });
        match state.reset_worktree_selection_result.clone() {
            ResetWorktreeSelectionResult::Ok(payload) => Ok(payload),
            ResetWorktreeSelectionResult::Err(message) => Err(anyhow!(message)),
        }
    }

    fn rebase_branch(
        &self,
        _repo_path: &Path,
        _request: GitRebaseBranchRequest,
    ) -> anyhow::Result<GitRebaseBranchResult> {
        panic!("unexpected call: rebase_branch");
    }
}
