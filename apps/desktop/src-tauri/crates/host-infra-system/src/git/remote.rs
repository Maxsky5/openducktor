use anyhow::{anyhow, Result};
use host_domain::{GitPullResult, GitPushSummary};
use std::path::Path;

use super::util::{combine_output, normalize_non_empty, resolve_upstream_ref};
use super::GitCliPort;

impl GitCliPort {
    pub(super) fn push_branch_impl(
        &self,
        repo_path: &Path,
        remote: &str,
        branch: &str,
        set_upstream: bool,
        force_with_lease: bool,
    ) -> Result<GitPushSummary> {
        self.ensure_repository(repo_path)?;
        let remote = normalize_non_empty(remote, "remote")?;
        let branch = normalize_non_empty(branch, "branch")?;

        let mut args = vec!["push".to_string()];
        if set_upstream {
            args.push("-u".to_string());
        }
        if force_with_lease {
            args.push("--force-with-lease".to_string());
        }
        args.push(remote.clone());
        args.push(branch.clone());

        let borrowed = args.iter().map(String::as_str).collect::<Vec<_>>();
        let (ok, stdout, stderr) = self.run_git_allow_failure(repo_path, borrowed.as_slice())?;
        let output = combine_output(stdout, stderr);
        if !ok {
            let detail = if output.is_empty() {
                "No output from git push".to_string()
            } else {
                output
            };
            return Err(anyhow!(
                "git push failed for {}/{}: {}",
                remote,
                branch,
                detail
            ));
        }

        Ok(GitPushSummary {
            remote,
            branch,
            output,
        })
    }

    pub(super) fn pull_branch_impl(&self, repo_path: &Path) -> Result<GitPullResult> {
        self.ensure_repository(repo_path)?;

        let current = self.get_current_branch_impl(repo_path)?;
        if current.detached {
            return Err(anyhow!("Cannot pull while detached"));
        }

        let upstream_target = self
            .resolve_upstream_target_impl(repo_path)?
            .ok_or_else(|| {
                anyhow!("Cannot pull because current branch does not track an upstream branch")
            })?;

        if !self.get_status_impl(repo_path)?.is_empty() {
            return Err(anyhow!("Cannot pull with uncommitted changes"));
        }

        let (fetch_ok, fetch_stdout, fetch_stderr) =
            self.run_git_allow_failure(repo_path, &["fetch", "--prune"])?;
        if !fetch_ok {
            return Err(anyhow!(
                "git fetch --prune failed: {}",
                combine_output(fetch_stdout, fetch_stderr)
            ));
        }

        let upstream_counts =
            self.commits_ahead_behind_impl(repo_path, upstream_target.as_str())?;
        if upstream_counts.behind == 0 {
            return Ok(GitPullResult::UpToDate {
                output: "No upstream commits to pull".to_string(),
            });
        }

        let before_head = self.run_git(repo_path, &["rev-parse", "HEAD"])?;

        let pull_args: [&str; 2] = if upstream_counts.ahead == 0 {
            ["pull", "--ff-only"]
        } else {
            ["pull", "--rebase"]
        };

        let (ok, stdout, stderr) = self.run_git_allow_failure(repo_path, &pull_args)?;
        let output = combine_output(stdout, stderr);
        if !ok {
            let detail = if output.is_empty() {
                "No output from git pull".to_string()
            } else {
                output
            };

            let conflicted_files = self.conflicted_files(repo_path)?;
            if !conflicted_files.is_empty() {
                return Ok(GitPullResult::Conflicts {
                    conflicted_files,
                    output: detail,
                });
            }

            return Err(anyhow!("git pull failed: {}", detail));
        }

        let after_head = self.run_git(repo_path, &["rev-parse", "HEAD"])?;
        if before_head == after_head {
            return Ok(GitPullResult::UpToDate { output });
        }

        Ok(GitPullResult::Pulled { output })
    }

    pub(super) fn resolve_upstream_target_impl(&self, repo_path: &Path) -> Result<Option<String>> {
        self.ensure_repository(repo_path)?;
        let branch = match self.get_current_branch_impl(repo_path)?.name {
            Some(name) => name,
            None => return Ok(None),
        };

        let remote_key = format!("branch.{branch}.remote");
        let merge_key = format!("branch.{branch}.merge");

        let (remote_ok, remote_stdout, _) =
            self.run_git_allow_failure(repo_path, &["config", "--get", remote_key.as_str()])?;
        if !remote_ok {
            return Ok(None);
        }
        let remote = remote_stdout.trim();
        if remote.is_empty() {
            return Ok(None);
        }

        let (merge_ok, merge_stdout, _) =
            self.run_git_allow_failure(repo_path, &["config", "--get", merge_key.as_str()])?;
        if !merge_ok {
            return Ok(None);
        }
        let merge_ref = merge_stdout.trim();
        if merge_ref.is_empty() {
            return Ok(None);
        }

        let upstream_ref = resolve_upstream_ref(remote, merge_ref);
        let (exists_ok, _, _) = self.run_git_allow_failure(
            repo_path,
            &["show-ref", "--verify", "--quiet", upstream_ref.as_str()],
        )?;
        if !exists_ok {
            return Ok(None);
        }

        Ok(Some(upstream_ref))
    }
}
