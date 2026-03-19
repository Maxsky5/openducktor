mod branch;
mod commit;
mod hash;
mod merge;
mod remote;
mod reset;
mod status;
#[cfg(test)]
mod tests;
mod util;
mod worktree;

use anyhow::{Context, Result};
use host_domain::{
    GitAheadBehind, GitBranch, GitCommitAllRequest, GitCommitAllResult, GitConflictAbortRequest,
    GitConflictAbortResult, GitCurrentBranch, GitDiffScope, GitFileDiff, GitFileStatus,
    GitMergeBranchRequest, GitMergeBranchResult, GitPort, GitPullRequest, GitPullResult,
    GitPushResult, GitRebaseAbortRequest, GitRebaseAbortResult, GitRebaseBranchRequest,
    GitRebaseBranchResult, GitResetWorktreeSelectionRequest, GitResetWorktreeSelectionResult,
    GitWorktreeStatusData, GitWorktreeStatusSummaryData,
};
use std::path::Path;

use crate::process::{run_command_allow_failure_with_env, run_command_with_env};

const GIT_NON_INTERACTIVE_ENV: [(&str, &str); 1] = [("GIT_TERMINAL_PROMPT", "0")];

#[derive(Debug, Clone, Copy, Default)]
pub struct GitCliPort;

impl GitCliPort {
    pub fn new() -> Self {
        Self
    }

    fn ensure_repository(&self, repo_path: &Path) -> Result<()> {
        self.run_git(repo_path, &["rev-parse", "--is-inside-work-tree"])
            .with_context(|| format!("Not a git repository: {}", repo_path.display()))?;
        Ok(())
    }

    fn run_git(&self, repo_path: &Path, args: &[&str]) -> Result<String> {
        run_command_with_env("git", args, Some(repo_path), &GIT_NON_INTERACTIVE_ENV)
    }

    fn run_git_allow_failure(
        &self,
        repo_path: &Path,
        args: &[&str],
    ) -> Result<(bool, String, String)> {
        run_command_allow_failure_with_env("git", args, Some(repo_path), &GIT_NON_INTERACTIVE_ENV)
    }

    fn conflicted_files(&self, repo_path: &Path) -> Result<Vec<String>> {
        let (_, conflicted_stdout, _) =
            self.run_git_allow_failure(repo_path, &["diff", "--name-only", "--diff-filter=U"])?;
        Ok(conflicted_stdout
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToString::to_string)
            .collect::<Vec<_>>())
    }
}

impl GitPort for GitCliPort {
    fn get_branches(&self, repo_path: &Path) -> Result<Vec<GitBranch>> {
        self.get_branches_impl(repo_path)
    }

    fn get_current_branch(&self, repo_path: &Path) -> Result<GitCurrentBranch> {
        self.get_current_branch_impl(repo_path)
    }

    fn switch_branch(
        &self,
        repo_path: &Path,
        branch: &str,
        create: bool,
    ) -> Result<GitCurrentBranch> {
        self.switch_branch_impl(repo_path, branch, create)
    }

    fn create_worktree(
        &self,
        repo_path: &Path,
        worktree_path: &Path,
        branch: &str,
        create_branch: bool,
    ) -> Result<()> {
        self.create_worktree_impl(repo_path, worktree_path, branch, create_branch)
    }

    fn remove_worktree(&self, repo_path: &Path, worktree_path: &Path, force: bool) -> Result<()> {
        self.remove_worktree_impl(repo_path, worktree_path, force)
    }

    fn delete_local_branch(&self, repo_path: &Path, branch: &str, force: bool) -> Result<()> {
        self.delete_local_branch_impl(repo_path, branch, force)
    }

    fn push_branch(
        &self,
        repo_path: &Path,
        remote: &str,
        branch: &str,
        set_upstream: bool,
        force_with_lease: bool,
    ) -> Result<GitPushResult> {
        self.push_branch_impl(repo_path, remote, branch, set_upstream, force_with_lease)
    }

    fn pull_branch(&self, repo_path: &Path, _request: GitPullRequest) -> Result<GitPullResult> {
        self.pull_branch_impl(repo_path)
    }

    fn get_status(&self, repo_path: &Path) -> Result<Vec<GitFileStatus>> {
        self.get_status_impl(repo_path)
    }

    fn get_diff(&self, repo_path: &Path, target_branch: Option<&str>) -> Result<Vec<GitFileDiff>> {
        self.get_diff_impl(repo_path, target_branch)
    }

    fn get_worktree_status(
        &self,
        repo_path: &Path,
        target_branch: &str,
        diff_scope: GitDiffScope,
    ) -> Result<GitWorktreeStatusData> {
        self.get_worktree_status_impl(repo_path, target_branch, diff_scope)
    }

    fn get_worktree_status_summary(
        &self,
        repo_path: &Path,
        target_branch: &str,
        diff_scope: GitDiffScope,
    ) -> Result<GitWorktreeStatusSummaryData> {
        self.get_worktree_status_summary_impl(repo_path, target_branch, diff_scope)
    }

    fn resolve_upstream_target(&self, repo_path: &Path) -> Result<Option<String>> {
        self.resolve_upstream_target_impl(repo_path)
    }

    fn suggested_squash_commit_message(
        &self,
        repo_path: &Path,
        source_branch: &str,
        target_branch: &str,
    ) -> Result<Option<String>> {
        self.suggested_squash_commit_message_impl(repo_path, source_branch, target_branch)
    }

    fn is_ancestor(
        &self,
        repo_path: &Path,
        ancestor_ref: &str,
        descendant_ref: &str,
    ) -> Result<bool> {
        self.is_ancestor_impl(repo_path, ancestor_ref, descendant_ref)
    }

    fn commits_ahead_behind(
        &self,
        repo_path: &Path,
        target_branch: &str,
    ) -> Result<GitAheadBehind> {
        self.commits_ahead_behind_impl(repo_path, target_branch)
    }

    fn commit_all(
        &self,
        repo_path: &Path,
        request: GitCommitAllRequest,
    ) -> Result<GitCommitAllResult> {
        self.commit_all_impl(repo_path, request)
    }

    fn reset_worktree_selection(
        &self,
        repo_path: &Path,
        request: GitResetWorktreeSelectionRequest,
    ) -> Result<GitResetWorktreeSelectionResult> {
        self.reset_worktree_selection_impl(repo_path, request)
    }

    fn rebase_branch(
        &self,
        repo_path: &Path,
        request: GitRebaseBranchRequest,
    ) -> Result<GitRebaseBranchResult> {
        self.rebase_branch_impl(repo_path, request)
    }

    fn rebase_abort(
        &self,
        repo_path: &Path,
        request: GitRebaseAbortRequest,
    ) -> Result<GitRebaseAbortResult> {
        self.rebase_abort_impl(repo_path, request)
    }

    fn abort_conflict(
        &self,
        repo_path: &Path,
        request: GitConflictAbortRequest,
    ) -> Result<GitConflictAbortResult> {
        self.abort_conflict_impl(repo_path, request)
    }

    fn merge_branch(
        &self,
        repo_path: &Path,
        request: GitMergeBranchRequest,
    ) -> Result<GitMergeBranchResult> {
        self.merge_branch_impl(repo_path, request)
    }
}
