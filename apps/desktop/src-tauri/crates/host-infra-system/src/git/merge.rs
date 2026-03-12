use anyhow::{anyhow, Result};
use host_domain::{GitMergeBranchRequest, GitMergeBranchResult, GitMergeMethod};
use std::path::Path;

use super::util::{checkout_branch_from_target_ref, combine_output, normalize_non_empty};
use super::GitCliPort;

impl GitCliPort {
    pub(super) fn merge_branch_impl(
        &self,
        repo_path: &Path,
        request: GitMergeBranchRequest,
    ) -> Result<GitMergeBranchResult> {
        self.ensure_repository(repo_path)?;

        let source_branch = normalize_non_empty(request.source_branch.as_str(), "source branch")?;
        let target_branch = normalize_non_empty(request.target_branch.as_str(), "target branch")?;
        let branches = self.get_branches_impl(repo_path)?;
        let checkout_target_branch = if branches
            .iter()
            .any(|branch| branch.is_remote && branch.name == target_branch)
        {
            checkout_branch_from_target_ref(target_branch.as_str())
        } else {
            target_branch.clone()
        };
        if source_branch == target_branch {
            return Ok(GitMergeBranchResult::UpToDate {
                output: "Source and target branches are identical".to_string(),
            });
        }

        if !self.get_status_impl(repo_path)?.is_empty() {
            return Err(anyhow!("Cannot merge with uncommitted changes"));
        }

        self.switch_branch_impl(repo_path, checkout_target_branch.as_str(), false)?;
        let before_head = self.run_git(repo_path, &["rev-parse", "HEAD"])?;

        match request.method {
            GitMergeMethod::MergeCommit => {
                self.merge_with_commit(repo_path, source_branch.as_str(), before_head.as_str())
            }
            GitMergeMethod::Squash => {
                self.merge_with_squash(repo_path, source_branch.as_str(), before_head.as_str())
            }
            GitMergeMethod::Rebase => self.merge_with_rebase(
                repo_path,
                request.source_working_directory.as_deref(),
                source_branch.as_str(),
                checkout_target_branch.as_str(),
                before_head.as_str(),
            ),
        }
    }

    fn merge_with_commit(
        &self,
        repo_path: &Path,
        source_branch: &str,
        before_head: &str,
    ) -> Result<GitMergeBranchResult> {
        let args = ["merge", "--no-ff", source_branch];
        let (ok, stdout, stderr) = self.run_git_allow_failure(repo_path, &args)?;
        let output = combine_output(stdout, stderr);
        if !ok {
            return self.merge_conflict_or_error(repo_path, "git merge --no-ff", output);
        }

        self.finish_merge_result(repo_path, before_head, output)
    }

    fn merge_with_squash(
        &self,
        repo_path: &Path,
        source_branch: &str,
        before_head: &str,
    ) -> Result<GitMergeBranchResult> {
        let args = ["merge", "--squash", source_branch];
        let (ok, stdout, stderr) = self.run_git_allow_failure(repo_path, &args)?;
        let output = combine_output(stdout, stderr);
        if !ok {
            return self.merge_conflict_or_error(repo_path, "git merge --squash", output);
        }

        let (has_no_staged_changes, _, _) =
            self.run_git_allow_failure(repo_path, &["diff", "--cached", "--quiet"])?;
        if has_no_staged_changes {
            return Ok(GitMergeBranchResult::UpToDate { output });
        }

        let commit_message = format!("Squash merge branch '{source_branch}'");
        let (commit_ok, commit_stdout, commit_stderr) =
            self.run_git_allow_failure(repo_path, &["commit", "-m", commit_message.as_str()])?;
        let commit_output = combine_output(commit_stdout, commit_stderr);
        if !commit_ok {
            return Err(anyhow!(
                "git commit failed after squash merge: {}",
                commit_output
            ));
        }

        let merged_output = if output.is_empty() {
            commit_output
        } else if commit_output.is_empty() {
            output
        } else {
            format!("{output}\n{commit_output}")
        };

        self.finish_merge_result(repo_path, before_head, merged_output)
    }

    fn merge_with_rebase(
        &self,
        repo_path: &Path,
        source_working_directory: Option<&str>,
        source_branch: &str,
        target_branch: &str,
        before_head: &str,
    ) -> Result<GitMergeBranchResult> {
        let rebase_repo_path = source_working_directory.map(Path::new).unwrap_or(repo_path);
        let rebase_args = ["rebase", target_branch];
        let (rebase_ok, rebase_stdout, rebase_stderr) =
            self.run_git_allow_failure(rebase_repo_path, &rebase_args)?;
        let rebase_output = combine_output(rebase_stdout, rebase_stderr);
        if !rebase_ok {
            return self.merge_conflict_or_error(rebase_repo_path, "git rebase", rebase_output);
        }

        let ff_args = ["merge", "--ff-only", source_branch];
        let (ff_ok, ff_stdout, ff_stderr) = self.run_git_allow_failure(repo_path, &ff_args)?;
        let ff_output = combine_output(ff_stdout, ff_stderr);
        if !ff_ok {
            return Err(anyhow!(
                "git merge --ff-only failed after rebase: {}",
                ff_output
            ));
        }

        let output = if rebase_output.is_empty() {
            ff_output
        } else if ff_output.is_empty() {
            rebase_output
        } else {
            format!("{rebase_output}\n{ff_output}")
        };

        self.finish_merge_result(repo_path, before_head, output)
    }

    fn merge_conflict_or_error(
        &self,
        repo_path: &Path,
        command_name: &str,
        output: String,
    ) -> Result<GitMergeBranchResult> {
        let detail = if output.is_empty() {
            format!("No output from {command_name}")
        } else {
            output
        };

        let conflicted_files = self.conflicted_files(repo_path)?;
        if !conflicted_files.is_empty() {
            return Ok(GitMergeBranchResult::Conflicts {
                conflicted_files,
                output: detail,
            });
        }

        Err(anyhow!("{command_name} failed: {detail}"))
    }

    fn finish_merge_result(
        &self,
        repo_path: &Path,
        before_head: &str,
        output: String,
    ) -> Result<GitMergeBranchResult> {
        let after_head = self.run_git(repo_path, &["rev-parse", "HEAD"])?;
        if before_head == after_head {
            return Ok(GitMergeBranchResult::UpToDate { output });
        }

        Ok(GitMergeBranchResult::Merged { output })
    }
}
