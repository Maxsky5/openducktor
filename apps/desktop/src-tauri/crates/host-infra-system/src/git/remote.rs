use anyhow::{anyhow, Result};
use host_domain::{GitPullResult, GitPushResult};
use std::path::Path;

use super::util::{combine_output, normalize_merge_ref, normalize_non_empty, resolve_upstream_ref};
use super::GitCliPort;

struct UpstreamTargetConfig {
    remote: String,
    merge_ref: String,
    upstream_ref: String,
}

impl GitCliPort {
    fn is_non_fast_forward_push_rejection(output: &str) -> bool {
        output
            .lines()
            .any(|line| line.contains("[rejected]") && line.contains("non-fast-forward"))
            || output.contains("non-fast-forward")
    }

    pub(super) fn push_branch_impl(
        &self,
        repo_path: &Path,
        remote: &str,
        branch: &str,
        set_upstream: bool,
        force_with_lease: bool,
    ) -> Result<GitPushResult> {
        self.ensure_repository(repo_path)?;
        let remote = normalize_non_empty(remote, "remote")?;
        let branch = normalize_non_empty(branch, "branch")?;

        let mut args = vec!["push".to_string(), "--porcelain".to_string()];
        if set_upstream {
            args.push("-u".to_string());
        }
        if force_with_lease {
            args.push("--force-with-lease".to_string());
        }
        args.push("--".to_string());
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
            if Self::is_non_fast_forward_push_rejection(detail.as_str()) {
                return Ok(GitPushResult::RejectedNonFastForward {
                    remote,
                    branch,
                    output: detail,
                });
            }
            return Err(anyhow!(
                "git push failed for {}/{}: {}",
                remote,
                branch,
                detail
            ));
        }

        Ok(GitPushResult::Pushed {
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
            .resolve_upstream_target_config_impl(repo_path)?
            .ok_or_else(|| {
                anyhow!("Cannot pull because current branch does not track an upstream branch")
            })?;

        if !self.get_status_impl(repo_path)?.is_empty() {
            return Err(anyhow!("Cannot pull with uncommitted changes"));
        }

        if upstream_target.remote != "." {
            let fetch_refspec = format!(
                "+{}:{}",
                upstream_target.merge_ref, upstream_target.upstream_ref
            );
            let fetch_args = [
                "fetch",
                "--prune",
                "--",
                upstream_target.remote.as_str(),
                fetch_refspec.as_str(),
            ];
            let (fetch_ok, fetch_stdout, fetch_stderr) =
                self.run_git_allow_failure(repo_path, &fetch_args)?;
            if !fetch_ok {
                return Err(anyhow!(
                    "git fetch --prune {} failed: {}",
                    upstream_target.remote,
                    combine_output(fetch_stdout, fetch_stderr)
                ));
            }
        }

        let upstream_counts =
            self.commits_ahead_behind_impl(repo_path, upstream_target.upstream_ref.as_str())?;
        if upstream_counts.behind == 0 {
            return Ok(GitPullResult::UpToDate {
                output: "No upstream commits to pull".to_string(),
            });
        }

        let before_head = self.run_git(repo_path, &["rev-parse", "HEAD"])?;

        let command = if upstream_counts.ahead == 0 {
            (
                "git merge --ff-only",
                vec!["merge", "--ff-only", upstream_target.upstream_ref.as_str()],
            )
        } else {
            (
                "git rebase --no-fork-point",
                vec![
                    "rebase",
                    "--no-fork-point",
                    upstream_target.upstream_ref.as_str(),
                ],
            )
        };

        let (command_name, command_args) = command;
        let (ok, stdout, stderr) =
            self.run_git_allow_failure(repo_path, command_args.as_slice())?;
        let output = combine_output(stdout, stderr);
        if !ok {
            let detail = if output.is_empty() {
                format!("No output from {command_name}")
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

            return Err(anyhow!("{command_name} failed: {}", detail));
        }

        let after_head = self.run_git(repo_path, &["rev-parse", "HEAD"])?;
        if before_head == after_head {
            return Ok(GitPullResult::UpToDate { output });
        }

        Ok(GitPullResult::Pulled { output })
    }

    pub(super) fn resolve_upstream_target_impl(&self, repo_path: &Path) -> Result<Option<String>> {
        self.ensure_repository(repo_path)?;
        let current_branch = self.get_current_branch_unchecked(repo_path)?;
        self.resolve_upstream_target_for_branch_impl(repo_path, current_branch.name.as_deref())
    }

    fn resolve_upstream_target_config_impl(
        &self,
        repo_path: &Path,
    ) -> Result<Option<UpstreamTargetConfig>> {
        self.ensure_repository(repo_path)?;
        let current_branch = self.get_current_branch_unchecked(repo_path)?;
        self.resolve_upstream_target_config_for_branch_impl(
            repo_path,
            current_branch.name.as_deref(),
        )
    }

    pub(super) fn resolve_upstream_target_for_branch_impl(
        &self,
        repo_path: &Path,
        branch_name: Option<&str>,
    ) -> Result<Option<String>> {
        let branch = match branch_name {
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

    fn resolve_upstream_target_config_for_branch_impl(
        &self,
        repo_path: &Path,
        branch_name: Option<&str>,
    ) -> Result<Option<UpstreamTargetConfig>> {
        let branch = match branch_name {
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

        let normalized_merge_ref = normalize_merge_ref(merge_ref);
        let upstream_ref = resolve_upstream_ref(remote, normalized_merge_ref.as_str());
        Ok(Some(UpstreamTargetConfig {
            remote: remote.to_string(),
            merge_ref: normalized_merge_ref,
            upstream_ref,
        }))
    }
}
