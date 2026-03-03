use anyhow::{anyhow, Result};
use host_domain::{
    GitCommitAllRequest, GitCommitAllResult, GitRebaseBranchRequest, GitRebaseBranchResult,
};
use std::path::Path;

use super::util::{combine_output, normalize_non_empty};
use super::GitCliPort;

impl GitCliPort {
    pub(super) fn commit_all_impl(
        &self,
        repo_path: &Path,
        request: GitCommitAllRequest,
    ) -> Result<GitCommitAllResult> {
        self.ensure_repository(repo_path)?;
        let message = normalize_non_empty(request.message.as_str(), "commit message")?;

        let (add_ok, add_stdout, add_stderr) =
            self.run_git_allow_failure(repo_path, &["add", "-A"])?;
        if !add_ok {
            return Err(anyhow!(
                "git add -A failed: {}",
                combine_output(add_stdout, add_stderr)
            ));
        }

        let staged_after_add = self.run_git(repo_path, &["diff", "--cached", "--name-only"])?;
        if staged_after_add.lines().all(|line| line.trim().is_empty()) {
            return Ok(GitCommitAllResult::NoChanges {
                output: "No staged changes to commit".to_string(),
            });
        }

        let (commit_ok, commit_stdout, commit_stderr) =
            self.run_git_allow_failure(repo_path, &["commit", "-m", message.as_str()])?;
        let output = combine_output(commit_stdout, commit_stderr);
        if commit_ok {
            let commit_hash = self.run_git(repo_path, &["rev-parse", "HEAD"])?;
            return Ok(GitCommitAllResult::Committed {
                commit_hash,
                output,
            });
        }

        Err(anyhow!("git commit-all failed: {}", output))
    }

    pub(super) fn rebase_branch_impl(
        &self,
        repo_path: &Path,
        request: GitRebaseBranchRequest,
    ) -> Result<GitRebaseBranchResult> {
        self.ensure_repository(repo_path)?;
        let target_branch = normalize_non_empty(request.target_branch.as_str(), "target branch")?;

        let current = self.get_current_branch_impl(repo_path)?;
        if current.detached {
            return Err(anyhow!("Cannot rebase while detached"));
        }

        if !self.get_status_impl(repo_path)?.is_empty() {
            return Err(anyhow!("Cannot rebase with uncommitted changes"));
        }

        let (already_based, _, _) = self.run_git_allow_failure(
            repo_path,
            &[
                "merge-base",
                "--is-ancestor",
                target_branch.as_str(),
                "HEAD",
            ],
        )?;
        if already_based {
            return Ok(GitRebaseBranchResult::UpToDate {
                output: "Branch already contains target history".to_string(),
            });
        }

        let (rebase_ok, rebase_stdout, rebase_stderr) =
            self.run_git_allow_failure(repo_path, &["rebase", target_branch.as_str()])?;
        let output = combine_output(rebase_stdout, rebase_stderr);
        if rebase_ok {
            return Ok(GitRebaseBranchResult::Rebased { output });
        }

        let conflicted_files = self.conflicted_files(repo_path)?;

        if !conflicted_files.is_empty() {
            return Ok(GitRebaseBranchResult::Conflicts {
                conflicted_files,
                output,
            });
        }

        Err(anyhow!("git rebase failed: {}", output))
    }
}
