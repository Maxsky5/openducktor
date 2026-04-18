use anyhow::{anyhow, Context, Result};
use host_domain::{
    GitAheadBehind, GitConflict, GitConflictOperation, GitCurrentBranch, GitDiffScope, GitFileDiff,
    GitFileStatus, GitFileStatusCounts, GitUpstreamAheadBehind, GitWorktreeStatusData,
    GitWorktreeStatusSummaryData,
};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use super::util::{combine_output, normalize_non_empty};
use super::GitCliPort;

const UPSTREAM_TARGET_BRANCH: &str = "@{upstream}";
const EMPTY_TREE_SHA1: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const EMPTY_TREE_SHA256: &str = "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321";
const REBASE_CONFLICT_OUTPUT_UNAVAILABLE: &str =
    "Git conflict is still in progress in this worktree. Previous command output is unavailable after reload.";

fn has_unmerged_files(file_statuses: &[GitFileStatus]) -> bool {
    file_statuses
        .iter()
        .any(|status| status.status == "unmerged")
}

fn normalize_head_name(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    Some(
        trimmed
            .strip_prefix("refs/heads/")
            .unwrap_or(trimmed)
            .to_string(),
    )
}

fn resolve_effective_target_branch(
    requested_target_branch: &str,
    upstream_target: Option<&str>,
) -> Option<String> {
    if requested_target_branch == UPSTREAM_TARGET_BRANCH {
        return upstream_target.map(ToOwned::to_owned);
    }

    Some(requested_target_branch.to_string())
}

fn commits_against_target_or_default(
    git: &GitCliPort,
    repo_path: &Path,
    target_branch: Option<&str>,
) -> Result<GitAheadBehind> {
    if let Some(target_branch) = target_branch {
        return git.commits_ahead_behind_unchecked(repo_path, target_branch);
    }

    Ok(GitAheadBehind {
        ahead: 0,
        behind: 0,
    })
}

impl GitCliPort {
    fn resolve_git_path_unchecked(&self, repo_path: &Path, suffix: &str) -> Result<String> {
        let output = self.run_git(
            repo_path,
            &["rev-parse", "--path-format=absolute", "--git-path", suffix],
        )?;
        output
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .map(|line| line.to_string())
            .ok_or_else(|| anyhow!("git rev-parse --git-path {suffix} returned no path"))
    }

    fn read_git_path_contents_if_exists(
        &self,
        repo_path: &Path,
        suffix: &str,
    ) -> Result<Option<String>> {
        let path = self.resolve_git_path_unchecked(repo_path, suffix)?;
        if !Path::new(path.as_str()).exists() {
            return Ok(None);
        }

        let contents = fs::read_to_string(path.as_str())
            .with_context(|| format!("Failed to read git metadata file at {path}"))?;
        let trimmed = contents.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }

        Ok(Some(trimmed.to_string()))
    }

    fn has_git_path(&self, repo_path: &Path, suffix: &str) -> Result<bool> {
        let path = self.resolve_git_path_unchecked(repo_path, suffix)?;
        Ok(Path::new(path.as_str()).exists())
    }

    fn load_rebase_conflict_context(
        &self,
        repo_path: &Path,
        current_branch: &GitCurrentBranch,
        fallback_target_branch: Option<&str>,
        file_statuses: &[GitFileStatus],
    ) -> Result<Option<GitConflict>> {
        if !has_unmerged_files(file_statuses) {
            return Ok(None);
        }

        let is_rebase_in_progress = self.has_git_path(repo_path, "rebase-merge")?
            || self.has_git_path(repo_path, "rebase-apply")?;
        if !is_rebase_in_progress {
            return Ok(None);
        }

        let merge_head_name =
            self.read_git_path_contents_if_exists(repo_path, "rebase-merge/head-name")?;
        let apply_head_name =
            self.read_git_path_contents_if_exists(repo_path, "rebase-apply/head-name")?;
        let current_branch_name = current_branch
            .name
            .clone()
            .or_else(|| merge_head_name.as_deref().and_then(normalize_head_name))
            .or_else(|| apply_head_name.as_deref().and_then(normalize_head_name));

        let target_branch = fallback_target_branch
            .map(ToOwned::to_owned)
            .ok_or_else(|| {
                anyhow!("Cannot determine rebase target branch while a git conflict is in progress")
            })?;

        let conflicted_files = file_statuses
            .iter()
            .filter(|status| status.status == "unmerged")
            .map(|status| status.path.clone())
            .collect::<Vec<_>>();
        let conflict_output = self
            .run_git_allow_failure(repo_path, &["status", "--untracked-files=no"])
            .map(|(_, stdout, stderr)| combine_output(stdout, stderr))
            .unwrap_or_else(|_| REBASE_CONFLICT_OUTPUT_UNAVAILABLE.to_string());
        let output = if conflict_output.trim().is_empty() {
            REBASE_CONFLICT_OUTPUT_UNAVAILABLE.to_string()
        } else {
            conflict_output
        };

        Ok(Some(GitConflict {
            operation: GitConflictOperation::Rebase,
            current_branch: current_branch_name,
            target_branch,
            conflicted_files,
            output,
            working_dir: None,
        }))
    }

    pub(super) fn get_status_impl(&self, repo_path: &Path) -> Result<Vec<GitFileStatus>> {
        self.ensure_repository(repo_path)?;
        self.get_status_unchecked(repo_path)
    }

    pub(super) fn get_diff_impl(
        &self,
        repo_path: &Path,
        target_branch: Option<&str>,
    ) -> Result<Vec<GitFileDiff>> {
        self.ensure_repository(repo_path)?;
        let file_statuses = self.get_status_unchecked(repo_path)?;
        self.get_diff_unchecked(repo_path, target_branch, file_statuses.as_slice())
    }

    pub(super) fn commits_ahead_behind_impl(
        &self,
        repo_path: &Path,
        target_branch: &str,
    ) -> Result<GitAheadBehind> {
        self.ensure_repository(repo_path)?;
        self.commits_ahead_behind_unchecked(repo_path, target_branch)
    }

    pub(super) fn get_worktree_status_impl(
        &self,
        repo_path: &Path,
        target_branch: &str,
        diff_scope: GitDiffScope,
    ) -> Result<GitWorktreeStatusData> {
        self.ensure_repository(repo_path)?;
        let target_branch = normalize_non_empty(target_branch, "target branch")?;
        let current_branch = self.get_current_branch_unchecked(repo_path)?;
        let current_branch_name = current_branch.name.clone();
        let upstream_target_result = self
            .resolve_upstream_target_for_branch_impl(repo_path, current_branch_name.as_deref())?;
        let effective_target_branch = resolve_effective_target_branch(
            target_branch.as_str(),
            upstream_target_result.as_deref(),
        );
        let diff_target = match diff_scope {
            GitDiffScope::Target => effective_target_branch.as_deref(),
            GitDiffScope::Uncommitted => None,
        };

        let joined = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            rayon::join(
                || {
                    rayon::join(
                        || self.get_status_unchecked(repo_path),
                        || match diff_scope {
                            GitDiffScope::Target if effective_target_branch.is_none() => Ok(None),
                            GitDiffScope::Target => self
                                .load_branch_changes_diff_payload_unchecked(
                                    repo_path,
                                    effective_target_branch.as_deref().ok_or_else(|| {
                                        anyhow!("target scope requires an effective target branch")
                                    })?,
                                )
                                .map(Some),
                            GitDiffScope::Uncommitted => self
                                .load_diff_payload_unchecked(repo_path, diff_target)
                                .map(Some),
                        },
                    )
                },
                || {
                    rayon::join(
                        || {
                            commits_against_target_or_default(
                                self,
                                repo_path,
                                effective_target_branch.as_deref(),
                            )
                        },
                        || Ok::<Option<String>, anyhow::Error>(upstream_target_result.clone()),
                    )
                },
            )
        }))
        .map_err(|payload| {
            anyhow!(
                "git worktree status worker panicked: {}",
                panic_payload_message(&*payload)
            )
        })?;

        let ((file_statuses, raw_diff_payload), (target_ahead_behind, upstream_target_result)) =
            joined;
        let file_statuses = file_statuses?;
        let raw_diff_payload = raw_diff_payload?;
        let file_diffs = match raw_diff_payload {
            Some((numstat_stdout, diff_stdout)) => build_file_diffs(
                self,
                repo_path,
                file_statuses.as_slice(),
                &numstat_stdout,
                &diff_stdout,
            )?,
            None => Vec::new(),
        };
        let target_ahead_behind = target_ahead_behind?;
        let git_conflict = self.load_rebase_conflict_context(
            repo_path,
            &current_branch,
            effective_target_branch.as_deref(),
            file_statuses.as_slice(),
        )?;

        let upstream_ahead_behind = match upstream_target_result {
            Ok(Some(upstream_target)) => {
                match self.commits_ahead_behind_unchecked(repo_path, upstream_target.as_str()) {
                    Ok(counts) => GitUpstreamAheadBehind::Tracking {
                        ahead: counts.ahead,
                        behind: counts.behind,
                    },
                    Err(error) => GitUpstreamAheadBehind::Error {
                        message: format!("{error:#}"),
                    },
                }
            }
            Ok(None) => GitUpstreamAheadBehind::Untracked {
                ahead: target_ahead_behind.ahead,
            },
            Err(error) => GitUpstreamAheadBehind::Error {
                message: format!("{error:#}"),
            },
        };

        Ok(GitWorktreeStatusData {
            current_branch,
            file_statuses,
            file_diffs,
            target_ahead_behind,
            upstream_ahead_behind,
            git_conflict,
        })
    }

    pub(super) fn get_worktree_status_summary_impl(
        &self,
        repo_path: &Path,
        target_branch: &str,
        _diff_scope: GitDiffScope,
    ) -> Result<GitWorktreeStatusSummaryData> {
        self.ensure_repository(repo_path)?;
        let target_branch = normalize_non_empty(target_branch, "target branch")?;
        let current_branch = self.get_current_branch_unchecked(repo_path)?;
        let current_branch_name = current_branch.name.clone();
        let upstream_target_result = self
            .resolve_upstream_target_for_branch_impl(repo_path, current_branch_name.as_deref())?;
        let effective_target_branch = resolve_effective_target_branch(
            target_branch.as_str(),
            upstream_target_result.as_deref(),
        );

        let joined = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            rayon::join(
                || {
                    rayon::join(
                        || self.get_status_unchecked(repo_path),
                        || {
                            commits_against_target_or_default(
                                self,
                                repo_path,
                                effective_target_branch.as_deref(),
                            )
                        },
                    )
                },
                || Ok::<Option<String>, anyhow::Error>(upstream_target_result.clone()),
            )
        }))
        .map_err(|payload| {
            anyhow!(
                "git worktree status summary worker panicked: {}",
                panic_payload_message(&*payload)
            )
        })?;

        let ((file_statuses, target_ahead_behind), upstream_target_result) = joined;
        let file_statuses = file_statuses?;
        let file_status_counts = build_file_status_counts(file_statuses.as_slice())?;
        let target_ahead_behind = target_ahead_behind?;
        let git_conflict = self.load_rebase_conflict_context(
            repo_path,
            &current_branch,
            effective_target_branch.as_deref(),
            file_statuses.as_slice(),
        )?;

        let upstream_ahead_behind = match upstream_target_result {
            Ok(Some(upstream_target)) => {
                match self.commits_ahead_behind_unchecked(repo_path, upstream_target.as_str()) {
                    Ok(counts) => GitUpstreamAheadBehind::Tracking {
                        ahead: counts.ahead,
                        behind: counts.behind,
                    },
                    Err(error) => GitUpstreamAheadBehind::Error {
                        message: format!("{error:#}"),
                    },
                }
            }
            Ok(None) => GitUpstreamAheadBehind::Untracked {
                ahead: target_ahead_behind.ahead,
            },
            Err(error) => GitUpstreamAheadBehind::Error {
                message: format!("{error:#}"),
            },
        };

        Ok(GitWorktreeStatusSummaryData {
            current_branch,
            file_statuses,
            file_status_counts,
            target_ahead_behind,
            upstream_ahead_behind,
            git_conflict,
        })
    }

    pub(super) fn get_status_unchecked(&self, repo_path: &Path) -> Result<Vec<GitFileStatus>> {
        let output = self.run_git(
            repo_path,
            &["status", "--porcelain=v1", "--untracked-files=all"],
        )?;
        Ok(parse_status_porcelain(&output))
    }

    pub(super) fn get_diff_unchecked(
        &self,
        repo_path: &Path,
        target_branch: Option<&str>,
        file_statuses: &[GitFileStatus],
    ) -> Result<Vec<GitFileDiff>> {
        let (numstat_stdout, diff_stdout) =
            self.load_diff_payload_unchecked(repo_path, target_branch)?;

        build_file_diffs(
            self,
            repo_path,
            file_statuses,
            &numstat_stdout,
            &diff_stdout,
        )
    }

    fn load_diff_payload_unchecked(
        &self,
        repo_path: &Path,
        target_branch: Option<&str>,
    ) -> Result<(String, String)> {
        let diff_spec = target_branch
            .map(|value| value.trim().to_string())
            .unwrap_or_default();
        let diff_target = if diff_spec.is_empty() {
            "HEAD"
        } else {
            diff_spec.as_str()
        };

        let numstat_args: Vec<&str> = vec!["diff", "--numstat", "--end-of-options", diff_target];
        let (numstat_ok, numstat_stdout, numstat_stderr) =
            self.run_git_allow_failure(repo_path, &numstat_args)?;
        if !numstat_ok {
            return Err(anyhow!(
                "git diff --numstat {diff_target} failed: {}",
                combine_output(numstat_stdout, numstat_stderr)
            ));
        }

        let diff_args: Vec<&str> = vec!["diff", "--end-of-options", diff_target];
        let (diff_ok, diff_stdout, diff_stderr) =
            self.run_git_allow_failure(repo_path, &diff_args)?;
        if !diff_ok {
            return Err(anyhow!(
                "git diff {diff_target} failed: {}",
                combine_output(diff_stdout, diff_stderr)
            ));
        }

        Ok((numstat_stdout, diff_stdout))
    }

    fn load_branch_changes_diff_payload_unchecked(
        &self,
        repo_path: &Path,
        target_branch: &str,
    ) -> Result<(String, String)> {
        let diff_base = self.resolve_branch_diff_base_unchecked(repo_path, target_branch)?;
        self.load_diff_payload_unchecked(repo_path, Some(diff_base.as_str()))
    }

    fn resolve_branch_diff_base_unchecked(
        &self,
        repo_path: &Path,
        target_branch: &str,
    ) -> Result<String> {
        let target = normalize_non_empty(target_branch, "target branch")?;
        let (ok, stdout, stderr) = self.run_git_allow_failure(
            repo_path,
            &["merge-base", "--end-of-options", &target, "HEAD"],
        )?;

        if !ok {
            if stdout.trim().is_empty() && stderr.trim().is_empty() {
                return self.empty_tree_oid_unchecked(repo_path).with_context(|| {
                    format!("Failed to resolve branch diff base for unrelated histories against {target}")
                });
            }

            return Err(anyhow!(
                "git merge-base {target} HEAD failed for target branch '{target}': {}",
                combine_output(stdout, stderr)
            ));
        }

        let merge_base = stdout
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .ok_or_else(|| anyhow!("git merge-base {target} HEAD returned no merge base"))?;

        Ok(merge_base.to_string())
    }

    fn empty_tree_oid_unchecked(&self, repo_path: &Path) -> Result<String> {
        let object_format = self
            .run_git(repo_path, &["rev-parse", "--show-object-format"])
            .context("Failed to read git object format for branch diff base")?;
        let object_format = object_format.trim();

        match object_format {
            "sha1" => Ok(EMPTY_TREE_SHA1.to_string()),
            "sha256" => Ok(EMPTY_TREE_SHA256.to_string()),
            _ => Err(anyhow!(
                "Unsupported git object format for empty tree branch diff base: {object_format}"
            )),
        }
    }

    pub(super) fn commits_ahead_behind_unchecked(
        &self,
        repo_path: &Path,
        target_branch: &str,
    ) -> Result<GitAheadBehind> {
        let target = normalize_non_empty(target_branch, "target branch")?;
        let range = format!("{target}...HEAD");
        let (ok, stdout, stderr) = self.run_git_allow_failure(
            repo_path,
            &[
                "rev-list",
                "--count",
                "--left-right",
                "--end-of-options",
                &range,
            ],
        )?;

        if !ok {
            return Err(anyhow!(
                "git rev-list --count --left-right {range} failed: {}",
                combine_output(stdout, stderr)
            ));
        }

        parse_ahead_behind(&stdout)
    }
}

fn panic_payload_message(payload: &(dyn std::any::Any + Send)) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|message| (*message).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic payload".to_string())
}

fn parse_status_porcelain(output: &str) -> Vec<GitFileStatus> {
    output
        .lines()
        .filter_map(|line| {
            if line.len() < 4 {
                return None;
            }
            let mut status_chars = line.chars();
            let index = status_chars.next()?;
            let worktree = status_chars.next()?;
            let path = line[3..].to_string();

            let (status, staged) = match (index, worktree) {
                ('?', '?') => ("untracked".to_string(), false),
                ('!', '!') => ("ignored".to_string(), false),
                (i, ' ') if i != ' ' => (porcelain_char_to_status(i), true),
                (' ', w) if w != ' ' => (porcelain_char_to_status(w), false),
                (i, _w) => (porcelain_char_to_status(i), true),
            };

            Some(GitFileStatus {
                path,
                status,
                staged,
            })
        })
        .collect()
}

fn porcelain_char_to_status(ch: char) -> String {
    match ch {
        'M' => "modified",
        'A' => "added",
        'D' => "deleted",
        'R' => "renamed",
        'C' => "copied",
        'U' => "unmerged",
        'T' => "typechange",
        _ => "unknown",
    }
    .to_string()
}

fn build_file_diffs(
    git: &GitCliPort,
    repo_path: &Path,
    file_statuses: &[GitFileStatus],
    numstat: &str,
    full_diff: &str,
) -> Result<Vec<GitFileDiff>> {
    let stats: HashMap<String, (u32, u32)> = numstat
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 3 {
                return None;
            }
            let adds = parts[0].parse::<u32>().unwrap_or(0);
            let dels = parts[1].parse::<u32>().unwrap_or(0);
            let file = normalize_numstat_file_path(parts[2..].join("\t"));
            Some((file, (adds, dels)))
        })
        .collect();

    let file_diffs = split_diff_by_file(full_diff);

    let mut results: Vec<GitFileDiff> = Vec::new();
    for (file, diff_text) in &file_diffs {
        let (additions, deletions) = stats.get(file).copied().unwrap_or((0, 0));
        let diff_type = infer_diff_type(diff_text);
        results.push(GitFileDiff {
            file: file.clone(),
            diff_type,
            additions,
            deletions,
            diff: diff_text.clone(),
        });
    }

    for (file, (adds, dels)) in &stats {
        if !file_diffs.iter().any(|(f, _)| f == file) {
            results.push(GitFileDiff {
                file: file.clone(),
                diff_type: "modified".to_string(),
                additions: *adds,
                deletions: *dels,
                diff: String::new(),
            });
        }
    }

    let existing_files = results
        .iter()
        .map(|diff| diff.file.clone())
        .collect::<HashSet<_>>();
    results.extend(build_untracked_file_diffs(
        git,
        repo_path,
        file_statuses,
        &existing_files,
    )?);

    results.sort_by(|a, b| a.file.cmp(&b.file));
    Ok(results)
}

fn normalize_numstat_file_path(file: String) -> String {
    let mut normalized = file.trim().to_string();

    while let Some(start) = normalized.find('{') {
        let Some(relative_end) = normalized[start..].find('}') else {
            break;
        };
        let end = start + relative_end;
        let segment = &normalized[start + 1..end];
        let Some((_, replacement)) = segment.split_once(" => ") else {
            break;
        };

        normalized = format!(
            "{}{}{}",
            &normalized[..start],
            replacement,
            &normalized[end + 1..]
        );
    }

    if let Some(stripped) = normalized.strip_prefix("/dev/null => ") {
        return stripped.to_string();
    }

    if let Some(stripped) = normalized.strip_suffix(" => /dev/null") {
        return stripped.to_string();
    }

    if normalized.contains(" => ") {
        let mut parts = normalized.rsplitn(2, " => ");
        let right = parts.next().unwrap_or_default();
        let left = parts.next().unwrap_or_default();
        if !right.is_empty() {
            return right.to_string();
        }
        if !left.is_empty() {
            return left.to_string();
        }
    }

    normalized
}

fn build_untracked_file_diffs(
    git: &GitCliPort,
    repo_path: &Path,
    file_statuses: &[GitFileStatus],
    existing_files: &HashSet<String>,
) -> Result<Vec<GitFileDiff>> {
    let mut results = Vec::new();
    let mut seen_files = existing_files.clone();

    for status in file_statuses {
        if status.status != "untracked" {
            continue;
        }

        for file_path in expand_untracked_status_paths(git, repo_path, status.path.as_str())? {
            if seen_files.contains(&file_path) {
                continue;
            }

            results.push(build_untracked_file_diff(
                git,
                repo_path,
                file_path.as_str(),
            )?);
            seen_files.insert(file_path);
        }
    }

    Ok(results)
}

fn expand_untracked_status_paths(
    git: &GitCliPort,
    repo_path: &Path,
    status_path: &str,
) -> Result<Vec<String>> {
    let trimmed_path = status_path.trim();
    if trimmed_path.is_empty() {
        return Ok(Vec::new());
    }

    if !repo_path.join(trimmed_path).is_dir() {
        return Ok(vec![trimmed_path.to_string()]);
    }

    let args = [
        "ls-files",
        "--others",
        "--exclude-standard",
        "--",
        trimmed_path,
    ];
    let (ok, stdout, stderr) = git.run_git_allow_failure(repo_path, &args)?;
    if !ok {
        return Err(anyhow!(
            "git ls-files --others --exclude-standard -- {trimmed_path} failed: {}",
            combine_output(stdout, stderr)
        ));
    }

    let file_paths = stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();

    if file_paths.is_empty() {
        return Err(anyhow!(
            "git ls-files --others --exclude-standard -- {trimmed_path} returned no files"
        ));
    }

    Ok(file_paths)
}

fn build_untracked_file_diff(
    git: &GitCliPort,
    repo_path: &Path,
    file_path: &str,
) -> Result<GitFileDiff> {
    let (numstat_stdout, diff_stdout) = load_no_index_diff_payload(git, repo_path, file_path)?;
    let diffs = build_file_diffs(git, repo_path, &[], &numstat_stdout, &diff_stdout)?;
    let diff = diffs
        .into_iter()
        .find(|candidate| candidate.file == file_path)
        .ok_or_else(|| {
            anyhow!("git diff --no-index produced no matching diff entry for {file_path}")
        })?;

    Ok(diff)
}

fn load_no_index_diff_payload(
    git: &GitCliPort,
    repo_path: &Path,
    file_path: &str,
) -> Result<(String, String)> {
    let numstat_args = [
        "diff",
        "--no-index",
        "--numstat",
        "--",
        "/dev/null",
        file_path,
    ];
    let (numstat_ok, numstat_stdout, numstat_stderr) =
        git.run_git_allow_failure(repo_path, &numstat_args)?;
    let numstat_stdout = ensure_non_index_diff_output(
        numstat_ok,
        numstat_stdout,
        numstat_stderr,
        format!("git diff --no-index --numstat /dev/null {file_path}"),
    )?;

    let diff_args = ["diff", "--no-index", "--", "/dev/null", file_path];
    let (diff_ok, diff_stdout, diff_stderr) = git.run_git_allow_failure(repo_path, &diff_args)?;
    let diff_stdout = ensure_non_index_diff_output(
        diff_ok,
        diff_stdout,
        diff_stderr,
        format!("git diff --no-index /dev/null {file_path}"),
    )?;

    Ok((numstat_stdout, diff_stdout))
}

fn ensure_non_index_diff_output(
    ok: bool,
    stdout: String,
    stderr: String,
    command_description: String,
) -> Result<String> {
    if ok || !stdout.trim().is_empty() {
        return Ok(stdout);
    }

    Err(anyhow!(
        "{command_description} failed: {}",
        combine_output(stdout, stderr)
    ))
}

fn split_diff_by_file(full_diff: &str) -> Vec<(String, String)> {
    let mut results: Vec<(String, String)> = Vec::new();
    let mut current_file: Option<String> = None;
    let mut current_diff = String::new();

    for line in full_diff.lines() {
        if line.starts_with("diff --git ") {
            if let Some(file) = current_file.take() {
                results.push((file, current_diff.clone()));
            }
            current_diff.clear();

            let file = parse_diff_git_new_path(line).unwrap_or_default();
            current_file = Some(file);
            current_diff.push_str(line);
            current_diff.push('\n');
        } else {
            current_diff.push_str(line);
            current_diff.push('\n');
        }
    }

    if let Some(file) = current_file {
        results.push((file, current_diff));
    }

    results
}

fn parse_diff_git_new_path(line: &str) -> Option<String> {
    let rest = line.strip_prefix("diff --git ")?;
    let (_old_path, remaining) = parse_diff_git_header_token(rest)?;
    let (new_path, _tail) = parse_diff_git_header_token(remaining)?;
    new_path.strip_prefix("b/").map(ToString::to_string)
}

fn parse_diff_git_header_token(input: &str) -> Option<(String, &str)> {
    let input = input.trim_start();
    if input.is_empty() {
        return None;
    }

    if let Some(quoted) = input.strip_prefix('"') {
        let mut escaped = false;
        for (index, ch) in quoted.char_indices() {
            if ch == '"' && !escaped {
                let token = quoted[..index].to_string();
                let remaining = &quoted[index + 1..];
                return Some((token, remaining));
            }

            escaped = ch == '\\' && !escaped;
        }
        return None;
    }

    let token_end = input.find(' ').unwrap_or(input.len());
    Some((input[..token_end].to_string(), &input[token_end..]))
}

fn infer_diff_type(diff: &str) -> String {
    for line in diff.lines() {
        if line.starts_with("new file mode") {
            return "added".to_string();
        }
        if line.starts_with("deleted file mode") {
            return "deleted".to_string();
        }
        if line.starts_with("rename from") {
            return "renamed".to_string();
        }
    }
    "modified".to_string()
}

fn build_file_status_counts(file_statuses: &[GitFileStatus]) -> Result<GitFileStatusCounts> {
    let total = u32::try_from(file_statuses.len()).map_err(|_| {
        anyhow!(
            "too many file statuses to summarize: {}",
            file_statuses.len()
        )
    })?;
    let staged = u32::try_from(file_statuses.iter().filter(|status| status.staged).count())
        .map_err(|_| anyhow!("staged file status count overflowed u32"))?;
    let unstaged = total
        .checked_sub(staged)
        .ok_or_else(|| anyhow!("unstaged file status count underflowed"))?;

    Ok(GitFileStatusCounts {
        total,
        staged,
        unstaged,
    })
}

fn parse_ahead_behind(output: &str) -> Result<GitAheadBehind> {
    let trimmed = output.trim();
    let parts: Vec<&str> = trimmed.split_whitespace().collect();
    if parts.len() != 2 {
        return Err(anyhow!(
            "Unexpected output from git rev-list --count --left-right: {trimmed}"
        ));
    }
    let behind = parts[0]
        .parse::<u32>()
        .with_context(|| format!("Failed to parse behind count: {}", parts[0]))?;
    let ahead = parts[1]
        .parse::<u32>()
        .with_context(|| format!("Failed to parse ahead count: {}", parts[1]))?;
    Ok(GitAheadBehind { ahead, behind })
}

#[cfg(test)]
mod tests {
    use super::{
        panic_payload_message, parse_ahead_behind, parse_diff_git_header_token, split_diff_by_file,
        GitAheadBehind,
    };

    #[test]
    fn split_diff_by_file_parses_quoted_paths_with_b_slash_segment() {
        let full_diff = "diff --git \"a/src/space b/path.ts\" \"b/src/space b/path.ts\"\nindex 123..456 100644\n--- \"a/src/space b/path.ts\"\n+++ \"b/src/space b/path.ts\"\n@@ -1 +1 @@\n-old\n+new\n";

        let split = split_diff_by_file(full_diff);
        assert_eq!(split.len(), 1);
        assert_eq!(split[0].0, "src/space b/path.ts");
        assert!(split[0].1.contains("@@ -1 +1 @@"));
    }

    #[test]
    fn parse_diff_git_header_token_parses_escaped_quote_sequence() {
        let input = "\"b/quote\\\"name.rs\" rest";
        let parsed = parse_diff_git_header_token(input).expect("quoted token should parse");
        assert_eq!(parsed.0, "b/quote\\\"name.rs");
        assert_eq!(parsed.1, " rest");
    }

    #[test]
    fn parse_diff_git_header_token_rejects_unterminated_quoted_token() {
        let input = "\"b/unterminated path";
        assert!(parse_diff_git_header_token(input).is_none());
    }

    #[test]
    fn parse_ahead_behind_returns_error_for_non_numeric_counts() {
        let error =
            parse_ahead_behind("1 only-one").expect_err("non-numeric output should fail parsing");
        assert!(
            format!("{error:#}").contains("Failed to parse ahead count"),
            "error should preserve ahead-count parsing context: {error:#}"
        );
    }

    #[test]
    fn parse_ahead_behind_returns_error_for_unexpected_token_count() {
        let error =
            parse_ahead_behind("1").expect_err("missing ahead/behind token should fail parsing");
        assert!(
            format!("{error:#}").contains("Unexpected output"),
            "error should preserve rev-list parsing context: {error:#}"
        );
    }

    #[test]
    fn parse_ahead_behind_parses_valid_counts() {
        let parsed = parse_ahead_behind("4 2").expect("counts should parse");
        assert_eq!(
            parsed,
            GitAheadBehind {
                ahead: 2,
                behind: 4
            }
        );
    }

    #[test]
    fn panic_payload_message_reads_str_and_string_payloads() {
        let str_payload: Box<dyn std::any::Any + Send> = Box::new("panic from &str");
        assert_eq!(panic_payload_message(&*str_payload), "panic from &str");

        let string_payload: Box<dyn std::any::Any + Send> =
            Box::new("panic from String".to_string());
        assert_eq!(panic_payload_message(&*string_payload), "panic from String");
    }

    #[test]
    fn panic_payload_message_falls_back_for_unknown_payload_types() {
        let unknown_payload: Box<dyn std::any::Any + Send> = Box::new(42u32);
        assert_eq!(
            panic_payload_message(&*unknown_payload),
            "unknown panic payload"
        );
    }
}
