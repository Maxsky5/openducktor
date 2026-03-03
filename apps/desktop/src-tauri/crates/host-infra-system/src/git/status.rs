use anyhow::{anyhow, Context, Result};
use host_domain::{
    GitAheadBehind, GitDiffScope, GitFileDiff, GitFileStatus, GitUpstreamAheadBehind,
    GitWorktreeStatusData,
};
use std::collections::HashMap;
use std::path::Path;

use super::util::{combine_output, normalize_non_empty};
use super::GitCliPort;

impl GitCliPort {
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
        self.get_diff_unchecked(repo_path, target_branch)
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
        let diff_target = match diff_scope {
            GitDiffScope::Target => Some(target_branch.as_str()),
            GitDiffScope::Uncommitted => None,
        };

        let joined = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            rayon::join(
                || {
                    rayon::join(
                        || self.get_status_unchecked(repo_path),
                        || self.get_diff_unchecked(repo_path, diff_target),
                    )
                },
                || {
                    rayon::join(
                        || self.commits_ahead_behind_unchecked(repo_path, target_branch.as_str()),
                        || {
                            self.resolve_upstream_target_for_branch_impl(
                                repo_path,
                                current_branch_name.as_deref(),
                            )
                        },
                    )
                },
            )
        }))
        .map_err(|_| anyhow!("git worktree status worker join failure"))?;

        let ((file_statuses, file_diffs), (target_ahead_behind, upstream_target_result)) = joined;
        let file_statuses = file_statuses?;
        let file_diffs = file_diffs?;
        let target_ahead_behind = target_ahead_behind?;

        let upstream_ahead_behind = match upstream_target_result {
            Ok(Some(upstream_target)) => match self
                .commits_ahead_behind_unchecked(repo_path, upstream_target.as_str())
            {
                Ok(counts) => GitUpstreamAheadBehind::Tracking {
                    ahead: counts.ahead,
                    behind: counts.behind,
                },
                Err(error) => GitUpstreamAheadBehind::Error {
                    message: format!("{error:#}"),
                },
            },
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
        })
    }

    pub(super) fn get_status_unchecked(&self, repo_path: &Path) -> Result<Vec<GitFileStatus>> {
        let output = self.run_git(repo_path, &["status", "--porcelain=v1"])?;
        Ok(parse_status_porcelain(&output))
    }

    pub(super) fn get_diff_unchecked(
        &self,
        repo_path: &Path,
        target_branch: Option<&str>,
    ) -> Result<Vec<GitFileDiff>> {
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

        Ok(build_file_diffs(&numstat_stdout, &diff_stdout))
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

fn parse_status_porcelain(output: &str) -> Vec<GitFileStatus> {
    output
        .lines()
        .filter_map(|line| {
            if line.len() < 4 {
                return None;
            }
            let index = line.chars().nth(0)?;
            let worktree = line.chars().nth(1)?;
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

fn build_file_diffs(numstat: &str, full_diff: &str) -> Vec<GitFileDiff> {
    let stats: HashMap<String, (u32, u32)> = numstat
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 3 {
                return None;
            }
            let adds = parts[0].parse::<u32>().unwrap_or(0);
            let dels = parts[1].parse::<u32>().unwrap_or(0);
            let file = parts[2..].join("\t");
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

    results.sort_by(|a, b| a.file.cmp(&b.file));
    results
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

            if ch == '\\' && !escaped {
                escaped = true;
            } else {
                escaped = false;
            }
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
        parse_ahead_behind, parse_diff_git_header_token, split_diff_by_file, GitAheadBehind,
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
}
