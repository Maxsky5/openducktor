use anyhow::{anyhow, Result};
use host_domain::{GitFetchRequest, GitFetchResult, GitPullResult, GitPushResult};
use std::collections::HashSet;
use std::path::Path;

use super::util::{combine_output, normalize_merge_ref, normalize_non_empty, resolve_upstream_ref};
use super::GitCliPort;

struct UpstreamTargetConfig {
    remote: String,
    merge_ref: String,
    upstream_ref: String,
}

const UPSTREAM_TARGET_BRANCH: &str = "@{upstream}";

impl GitCliPort {
    fn matches_remote_branch_name(remote_ref: &str, branch: &str) -> bool {
        let Some(remainder) = remote_ref.strip_prefix("refs/remotes/") else {
            return false;
        };
        let Some((_, remote_branch)) = remainder.split_once('/') else {
            return false;
        };
        remote_branch == branch
    }

    fn resolve_fallback_remote_ref_for_branch_impl(
        &self,
        repo_path: &Path,
        branch: &str,
    ) -> Result<Option<String>> {
        let (ok, stdout, stderr) = self.run_git_allow_failure(
            repo_path,
            &["for-each-ref", "--format=%(refname)", "refs/remotes"],
        )?;
        if !ok {
            return Err(anyhow!(
                "Failed to list remote refs while resolving upstream for branch {}: {}",
                branch,
                combine_output(stdout, stderr)
            ));
        }

        let mut matches = stdout
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .filter(|line| Self::matches_remote_branch_name(line, branch))
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        if matches.is_empty() {
            return Ok(None);
        }

        let preferred_origin_ref = format!("refs/remotes/origin/{branch}");
        if let Some(origin_ref) = matches
            .iter()
            .find(|candidate| candidate.as_str() == preferred_origin_ref.as_str())
        {
            return Ok(Some(origin_ref.clone()));
        }

        if matches.len() == 1 {
            return Ok(matches.pop());
        }

        Ok(None)
    }

    fn is_non_fast_forward_push_rejection(output: &str) -> bool {
        output
            .lines()
            .any(|line| line.contains("[rejected]") && line.contains("non-fast-forward"))
            || (output.contains("rejected") && output.contains("non-fast-forward"))
    }

    fn remote_name_from_tracking_ref(target_ref: &str) -> Option<String> {
        let remainder = target_ref.strip_prefix("refs/remotes/")?;
        let (remote, _) = remainder.split_once('/')?;
        Some(remote.to_string())
    }

    fn list_remotes_impl(&self, repo_path: &Path) -> Result<HashSet<String>> {
        let (ok, stdout, stderr) = self.run_git_allow_failure(repo_path, &["remote"])?;
        if !ok {
            return Err(anyhow!(
                "Failed to list git remotes: {}",
                combine_output(stdout, stderr)
            ));
        }

        Ok(stdout
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToOwned::to_owned)
            .collect())
    }

    fn push_fallback_remote_for_branch_impl(
        &self,
        repo_path: &Path,
        branch_name: &str,
        remotes: &mut Vec<String>,
        seen: &mut HashSet<String>,
    ) -> Result<bool> {
        let Some(fallback_remote_ref) =
            self.resolve_fallback_remote_ref_for_branch_impl(repo_path, branch_name)?
        else {
            return Ok(false);
        };
        let Some(remote) = Self::remote_name_from_tracking_ref(fallback_remote_ref.as_str()) else {
            return Ok(false);
        };

        Self::push_unique_remote(remotes, seen, remote);
        Ok(true)
    }

    fn resolve_current_branch_fetch_remote_impl(
        &self,
        repo_path: &Path,
        current_branch_name: Option<&str>,
        available_remotes: &HashSet<String>,
        remotes: &mut Vec<String>,
        seen: &mut HashSet<String>,
    ) -> Result<bool> {
        if let Some(upstream_target) =
            self.resolve_upstream_target_config_for_branch_impl(repo_path, current_branch_name)?
        {
            if upstream_target.remote != "." {
                if !available_remotes.contains(upstream_target.remote.as_str()) {
                    return Err(anyhow!(
                        "Cannot refresh changes because the current branch upstream uses unknown remote `{}`",
                        upstream_target.remote
                    ));
                }

                Self::push_unique_remote(remotes, seen, upstream_target.remote);
                return Ok(true);
            }

            if let Some(branch_name) = current_branch_name {
                return self.push_fallback_remote_for_branch_impl(
                    repo_path,
                    branch_name,
                    remotes,
                    seen,
                );
            }

            return Ok(false);
        }

        if let Some(branch_name) = current_branch_name {
            return self.push_fallback_remote_for_branch_impl(
                repo_path,
                branch_name,
                remotes,
                seen,
            );
        }

        Ok(false)
    }

    fn resolve_target_remote_name_impl(
        &self,
        repo_path: &Path,
        target_branch: &str,
        available_remotes: &HashSet<String>,
    ) -> Result<Option<String>> {
        if target_branch == UPSTREAM_TARGET_BRANCH {
            return Ok(None);
        }

        if let Some(remainder) = target_branch.strip_prefix("refs/remotes/") {
            let Some((remote, _)) = remainder.split_once('/') else {
                return Ok(None);
            };
            if available_remotes.contains(remote) {
                return Ok(Some(remote.to_string()));
            }
            return Err(anyhow!(
                "Cannot refresh changes because compare target `{target_branch}` uses unknown remote `{remote}`"
            ));
        }

        let Some((remote, _)) = target_branch.split_once('/') else {
            return Ok(None);
        };
        if available_remotes.contains(remote) {
            return Ok(Some(remote.to_string()));
        }

        // Short-form `foo/bar` targets are ambiguous: they may be remote refs or local branches
        // with slashes, so only explicit `refs/remotes/...` targets hard-fail on unknown remotes.
        Ok(None)
    }

    fn push_unique_remote(remotes: &mut Vec<String>, seen: &mut HashSet<String>, remote: String) {
        if seen.insert(remote.clone()) {
            remotes.push(remote);
        }
    }

    fn resolve_refresh_fetch_remotes_impl(
        &self,
        repo_path: &Path,
        target_branch: &str,
    ) -> Result<Vec<String>> {
        let target_branch = normalize_non_empty(target_branch, "target branch")?;
        let current_branch = self.get_current_branch_unchecked(repo_path)?;
        let current_branch_name = current_branch.name.as_deref();
        let available_remotes = self.list_remotes_impl(repo_path)?;
        let mut remotes = Vec::new();
        let mut seen = HashSet::new();
        let has_current_branch_remote = self.resolve_current_branch_fetch_remote_impl(
            repo_path,
            current_branch_name,
            &available_remotes,
            &mut remotes,
            &mut seen,
        )?;

        if target_branch == UPSTREAM_TARGET_BRANCH
            && !has_current_branch_remote
            && !available_remotes.is_empty()
        {
            return Err(anyhow!(
                "Cannot refresh changes because compare target `@{{upstream}}` requires an upstream remote for the current branch"
            ));
        }

        if let Some(remote) = self.resolve_target_remote_name_impl(
            repo_path,
            target_branch.as_str(),
            &available_remotes,
        )? {
            Self::push_unique_remote(&mut remotes, &mut seen, remote);
        }

        Ok(remotes)
    }

    pub(super) fn fetch_remote_impl(
        &self,
        repo_path: &Path,
        request: GitFetchRequest,
    ) -> Result<GitFetchResult> {
        self.ensure_repository(repo_path)?;
        let remotes =
            self.resolve_refresh_fetch_remotes_impl(repo_path, request.target_branch.as_str())?;
        if remotes.is_empty() {
            return Ok(GitFetchResult::SkippedNoRemote {
                output: "Skipped git fetch because no applicable remote is configured for this repo or branch.".to_string(),
            });
        }
        let mut outputs = Vec::new();

        for remote in remotes {
            let fetch_args = ["fetch", "--prune", "--", remote.as_str()];
            let (ok, stdout, stderr) = self.run_git_allow_failure(repo_path, &fetch_args)?;
            let output = combine_output(stdout, stderr);
            if !ok {
                return Err(anyhow!("git fetch --prune {remote} failed: {output}"));
            }
            if output.is_empty() {
                outputs.push(format!("Fetched {remote}"));
            } else {
                outputs.push(output);
            }
        }

        Ok(GitFetchResult::Fetched {
            output: outputs.join("\n"),
        })
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
            return self.resolve_fallback_remote_ref_for_branch_impl(repo_path, branch);
        }
        let remote = remote_stdout.trim();
        if remote.is_empty() {
            return self.resolve_fallback_remote_ref_for_branch_impl(repo_path, branch);
        }

        let (merge_ok, merge_stdout, _) =
            self.run_git_allow_failure(repo_path, &["config", "--get", merge_key.as_str()])?;
        if !merge_ok {
            return self.resolve_fallback_remote_ref_for_branch_impl(repo_path, branch);
        }
        let merge_ref = merge_stdout.trim();
        if merge_ref.is_empty() {
            return self.resolve_fallback_remote_ref_for_branch_impl(repo_path, branch);
        }

        let upstream_ref = resolve_upstream_ref(remote, merge_ref);
        let (exists_ok, _, _) = self.run_git_allow_failure(
            repo_path,
            &["show-ref", "--verify", "--quiet", upstream_ref.as_str()],
        )?;
        if !exists_ok {
            return self.resolve_fallback_remote_ref_for_branch_impl(repo_path, branch);
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

#[cfg(test)]
mod tests {
    use super::GitCliPort;

    #[test]
    fn non_fast_forward_detection_requires_rejection_signal_in_fallback_output() {
        let output = "remote: hook blocked update because non-fast-forward updates are disallowed";
        assert!(!GitCliPort::is_non_fast_forward_push_rejection(output));
    }

    #[test]
    fn non_fast_forward_detection_accepts_combined_rejected_fallback_output() {
        let output = "error: rejected because non-fast-forward updates were rejected";
        assert!(GitCliPort::is_non_fast_forward_push_rejection(output));
    }
}
