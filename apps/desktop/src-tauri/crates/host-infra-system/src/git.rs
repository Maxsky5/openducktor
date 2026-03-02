use anyhow::{anyhow, Context, Result};
use host_domain::{
    GitAheadBehind, GitBranch, GitCommitAllRequest, GitCommitAllResult, GitCurrentBranch,
    GitFileDiff, GitFileStatus, GitPort, GitPullRequest, GitPullResult, GitPushSummary,
    GitRebaseBranchRequest, GitRebaseBranchResult,
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
}

impl GitPort for GitCliPort {
    fn get_branches(&self, repo_path: &Path) -> Result<Vec<GitBranch>> {
        self.ensure_repository(repo_path)?;
        let output = self.run_git(
            repo_path,
            &[
                "for-each-ref",
                "--format=%(if)%(HEAD)%(then)1%(else)0%(end)|%(refname:short)|%(refname)",
                "refs/heads",
                "refs/remotes",
            ],
        )?;

        let mut branches = parse_branch_rows(output.as_str());
        branches.sort_by(|a, b| {
            b.is_current
                .cmp(&a.is_current)
                .then(a.is_remote.cmp(&b.is_remote))
                .then(a.name.cmp(&b.name))
        });
        Ok(branches)
    }

    fn get_current_branch(&self, repo_path: &Path) -> Result<GitCurrentBranch> {
        self.ensure_repository(repo_path)?;
        let output = self.run_git(repo_path, &["branch", "--show-current"])?;
        let name = output
            .lines()
            .find(|line| !line.trim().is_empty())
            .map(|line| line.trim().to_string());

        Ok(GitCurrentBranch {
            detached: name.is_none(),
            name,
        })
    }

    fn switch_branch(
        &self,
        repo_path: &Path,
        branch: &str,
        create: bool,
    ) -> Result<GitCurrentBranch> {
        self.ensure_repository(repo_path)?;
        let branch = normalize_non_empty(branch, "branch")?;

        if create {
            self.run_git(repo_path, &["switch", "-c", branch.as_str()])?;
        } else {
            self.run_git(repo_path, &["switch", branch.as_str()])?;
        }

        self.get_current_branch(repo_path)
    }

    fn create_worktree(
        &self,
        repo_path: &Path,
        worktree_path: &Path,
        branch: &str,
        create_branch: bool,
    ) -> Result<()> {
        self.ensure_repository(repo_path)?;
        let branch = normalize_non_empty(branch, "branch")?;
        let worktree_path = path_to_string(worktree_path, "worktree path")?;

        if create_branch {
            self.run_git(
                repo_path,
                &[
                    "worktree",
                    "add",
                    "-b",
                    branch.as_str(),
                    worktree_path.as_str(),
                ],
            )?;
        } else {
            self.run_git(
                repo_path,
                &["worktree", "add", worktree_path.as_str(), branch.as_str()],
            )?;
        }

        Ok(())
    }

    fn remove_worktree(&self, repo_path: &Path, worktree_path: &Path, force: bool) -> Result<()> {
        self.ensure_repository(repo_path)?;
        let worktree_path = path_to_string(worktree_path, "worktree path")?;
        let mut args = vec!["worktree".to_string(), "remove".to_string()];
        if force {
            args.push("--force".to_string());
        }
        args.push(worktree_path);
        let borrowed = args.iter().map(String::as_str).collect::<Vec<_>>();
        self.run_git(repo_path, borrowed.as_slice())?;
        Ok(())
    }

    fn push_branch(
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

    fn pull_branch(&self, repo_path: &Path, _request: GitPullRequest) -> Result<GitPullResult> {
        self.ensure_repository(repo_path)?;

        let current = self.get_current_branch(repo_path)?;
        if current.detached {
            return Err(anyhow!("Cannot pull while detached"));
        }

        let upstream_target = self.resolve_upstream_target(repo_path)?.ok_or_else(|| {
            anyhow!("Cannot pull because current branch does not track an upstream branch")
        })?;

        if !self.get_status(repo_path)?.is_empty() {
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

        let upstream_counts = self.commits_ahead_behind(repo_path, upstream_target.as_str())?;
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
            return Err(anyhow!("git pull failed: {}", detail));
        }

        let after_head = self.run_git(repo_path, &["rev-parse", "HEAD"])?;
        if before_head == after_head {
            return Ok(GitPullResult::UpToDate { output });
        }

        Ok(GitPullResult::Pulled { output })
    }

    fn get_status(&self, repo_path: &Path) -> Result<Vec<GitFileStatus>> {
        self.ensure_repository(repo_path)?;
        let output = self.run_git(repo_path, &["status", "--porcelain=v1"])?;
        Ok(parse_status_porcelain(&output))
    }

    fn get_diff(&self, repo_path: &Path, target_branch: Option<&str>) -> Result<Vec<GitFileDiff>> {
        self.ensure_repository(repo_path)?;

        let diff_spec = target_branch
            .map(|b| b.trim().to_string())
            .unwrap_or_default();

        // Get numstat for additions/deletions counts
        let numstat_args: Vec<&str> = if diff_spec.is_empty() {
            vec!["diff", "--numstat", "HEAD"]
        } else {
            vec!["diff", "--numstat", diff_spec.as_str()]
        };
        let (numstat_ok, numstat_stdout, _) =
            self.run_git_allow_failure(repo_path, &numstat_args)?;
        let numstat = if numstat_ok {
            numstat_stdout
        } else {
            String::new()
        };

        // Get full unified diff
        let diff_args: Vec<&str> = if diff_spec.is_empty() {
            vec!["diff", "HEAD"]
        } else {
            vec!["diff", diff_spec.as_str()]
        };
        let (diff_ok, diff_stdout, _) = self.run_git_allow_failure(repo_path, &diff_args)?;
        let full_diff = if diff_ok { diff_stdout } else { String::new() };

        Ok(build_file_diffs(&numstat, &full_diff))
    }

    fn resolve_upstream_target(&self, repo_path: &Path) -> Result<Option<String>> {
        self.ensure_repository(repo_path)?;
        let branch = match self.get_current_branch(repo_path)?.name {
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

    fn commits_ahead_behind(
        &self,
        repo_path: &Path,
        target_branch: &str,
    ) -> Result<GitAheadBehind> {
        self.ensure_repository(repo_path)?;
        let target = normalize_non_empty(target_branch, "target branch")?;
        let range = format!("{target}...HEAD");
        let (ok, stdout, stderr) = self
            .run_git_allow_failure(repo_path, &["rev-list", "--count", "--left-right", &range])?;

        if !ok {
            return Err(anyhow!(
                "git rev-list --count --left-right {range} failed: {}",
                combine_output(stdout, stderr)
            ));
        }

        parse_ahead_behind(&stdout)
    }

    fn commit_all(
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

    fn rebase_branch(
        &self,
        repo_path: &Path,
        request: GitRebaseBranchRequest,
    ) -> Result<GitRebaseBranchResult> {
        self.ensure_repository(repo_path)?;
        let target_branch = normalize_non_empty(request.target_branch.as_str(), "target branch")?;

        let current = self.get_current_branch(repo_path)?;
        if current.detached {
            return Err(anyhow!("Cannot rebase while detached"));
        }

        if !self.get_status(repo_path)?.is_empty() {
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

        let (_, conflicted_stdout, _conflicted_stderr) =
            self.run_git_allow_failure(repo_path, &["diff", "--name-only", "--diff-filter=U"])?;
        let conflicted_files = conflicted_stdout
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToString::to_string)
            .collect::<Vec<_>>();

        if !conflicted_files.is_empty() {
            return Ok(GitRebaseBranchResult::Conflicts {
                conflicted_files,
                output,
            });
        }

        Err(anyhow!("git rebase failed: {}", output))
    }
}

fn normalize_non_empty(value: &str, label: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("git {label} cannot be empty"));
    }
    Ok(trimmed.to_string())
}

fn path_to_string(path: &Path, label: &str) -> Result<String> {
    path.to_str()
        .map(|value| value.to_string())
        .ok_or_else(|| anyhow!("Invalid {label}: {}", path.display()))
}

fn normalize_merge_ref(merge_ref: &str) -> String {
    if merge_ref.starts_with("refs/") {
        merge_ref.to_string()
    } else {
        format!("refs/heads/{merge_ref}")
    }
}

fn resolve_upstream_ref(remote: &str, merge_ref: &str) -> String {
    let normalized_merge = normalize_merge_ref(merge_ref);
    if remote == "." {
        return normalized_merge;
    }
    let branch_ref = normalized_merge
        .strip_prefix("refs/heads/")
        .unwrap_or(normalized_merge.as_str());
    format!("refs/remotes/{remote}/{branch_ref}")
}

fn combine_output(stdout: String, stderr: String) -> String {
    match (stdout.trim(), stderr.trim()) {
        ("", "") => String::new(),
        ("", stderr) => stderr.to_string(),
        (stdout, "") => stdout.to_string(),
        (stdout, stderr) => format!("{stdout}\n{stderr}"),
    }
}

fn parse_branch_rows(output: &str) -> Vec<GitBranch> {
    output
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return None;
            }

            let mut parts = trimmed.splitn(3, '|');
            let head_marker = parts.next()?.trim();
            let name = parts.next()?.trim();
            let full_ref = parts.next()?.trim();
            if name.is_empty() || full_ref.is_empty() {
                return None;
            }

            let is_remote = full_ref.starts_with("refs/remotes/");
            if is_remote && full_ref.ends_with("/HEAD") {
                return None;
            }

            Some(GitBranch {
                name: name.to_string(),
                is_current: head_marker == "1" || head_marker == "*",
                is_remote,
            })
        })
        .collect()
}

fn parse_status_porcelain(output: &str) -> Vec<GitFileStatus> {
    use host_domain::GitFileStatus;
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
    use host_domain::GitFileDiff;
    use std::collections::HashMap;

    // Parse numstat: "additions\tdeletions\tfile"
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

    // Split full diff by file
    let file_diffs = split_diff_by_file(full_diff);

    // Merge numstat with file diffs
    let mut results: Vec<GitFileDiff> = Vec::new();
    for (file, diff_text) in &file_diffs {
        let (additions, deletions) = stats.get(file).copied().unwrap_or((0, 0));
        let diff_type = infer_diff_type(&diff_text);
        results.push(GitFileDiff {
            file: file.clone(),
            diff_type,
            additions,
            deletions,
            diff: diff_text.clone(),
        });
    }

    // Add files from numstat that had no diff section (e.g., binary files)
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
            // Save previous file's diff
            if let Some(file) = current_file.take() {
                results.push((file, current_diff.clone()));
            }
            current_diff.clear();

            // Extract file path from "diff --git a/path b/path"
            let file = line
                .strip_prefix("diff --git a/")
                .and_then(|rest| rest.split(" b/").last())
                .unwrap_or("")
                .to_string();
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
    use host_domain::GitAheadBehind;
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
    use super::{combine_output, parse_branch_rows, GitCliPort};
    use host_domain::GitPort;
    use host_domain::{
        GitCommitAllRequest, GitCommitAllResult, GitPullRequest, GitPullResult,
        GitRebaseBranchRequest, GitRebaseBranchResult,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Output, Stdio};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempPath {
        path: PathBuf,
    }

    impl TempPath {
        fn new(prefix: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "openducktor-git-{prefix}-{}-{nanos}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("temporary directory should be created");
            Self { path }
        }
    }

    impl Drop for TempPath {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn git_available() -> bool {
        Command::new("git")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    fn run_git(cwd: &Path, args: &[&str]) -> Output {
        Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("git command should execute")
    }

    fn run_git_ok(cwd: &Path, args: &[&str]) -> String {
        let output = run_git(cwd, args);
        assert!(
            output.status.success(),
            "git {} failed\nstdout: {}\nstderr: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn setup_repo(prefix: &str) -> TempPath {
        let repo = TempPath::new(prefix);
        run_git_ok(&repo.path, &["init"]);
        run_git_ok(
            &repo.path,
            &["config", "user.email", "tests@openducktor.local"],
        );
        run_git_ok(&repo.path, &["config", "user.name", "OpenDucktor Tests"]);
        fs::write(repo.path.join("README.md"), "# OpenDucktor\n").expect("seed file should write");
        run_git_ok(&repo.path, &["add", "README.md"]);
        run_git_ok(&repo.path, &["commit", "-m", "initial"]);
        run_git_ok(&repo.path, &["branch", "-M", "main"]);
        repo
    }

    fn setup_bare_remote(prefix: &str) -> TempPath {
        let remote = TempPath::new(prefix);
        run_git_ok(&remote.path, &["init", "--bare"]);
        remote
    }

    #[test]
    fn parse_branch_rows_marks_current_local_and_remote_branches() {
        let parsed = parse_branch_rows(
            "1|main|refs/heads/main\n0|feature/a|refs/heads/feature/a\n0|origin/main|refs/remotes/origin/main\n",
        );

        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].name, "main");
        assert!(parsed[0].is_current);
        assert!(!parsed[0].is_remote);
        assert_eq!(parsed[2].name, "origin/main");
        assert!(parsed[2].is_remote);
    }

    #[test]
    fn parse_branch_rows_skips_remote_head_symbolic_ref() {
        let parsed = parse_branch_rows(
            "0|origin/HEAD|refs/remotes/origin/HEAD\n0|origin/main|refs/remotes/origin/main\n",
        );

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "origin/main");
    }

    #[test]
    fn combine_output_prefers_non_empty_streams_and_preserves_both() {
        assert_eq!(combine_output("".to_string(), "".to_string()), "");
        assert_eq!(
            combine_output("stdout".to_string(), "".to_string()),
            "stdout"
        );
        assert_eq!(
            combine_output("".to_string(), "stderr".to_string()),
            "stderr"
        );
        assert_eq!(
            combine_output("stdout".to_string(), "stderr".to_string()),
            "stdout\nstderr"
        );
    }

    #[test]
    fn get_current_branch_reports_attached_and_detached_states() {
        if !git_available() {
            return;
        }

        let repo = setup_repo("current-branch");
        let git = GitCliPort::new();
        let current = git
            .get_current_branch(&repo.path)
            .expect("current branch should resolve");
        assert_eq!(current.name.as_deref(), Some("main"));
        assert!(!current.detached);

        run_git_ok(&repo.path, &["switch", "--detach", "HEAD"]);
        let detached = git
            .get_current_branch(&repo.path)
            .expect("detached branch state should resolve");
        assert!(detached.name.is_none());
        assert!(detached.detached);
    }

    #[test]
    fn commit_all_commits_all_changes_with_message() {
        if !git_available() {
            return;
        }

        let repo = setup_repo("commit-all-success");
        let git = GitCliPort::new();

        fs::write(repo.path.join("change.txt"), "change\n").expect("change file should write");
        let result = git
            .commit_all(
                &repo.path,
                GitCommitAllRequest {
                    working_dir: None,
                    message: "add change file".to_string(),
                },
            )
            .expect("commit-all should succeed");

        let latest = match result {
            GitCommitAllResult::Committed {
                commit_hash,
                output,
            } => {
                assert!(!commit_hash.is_empty());
                assert!(!output.is_empty());
                commit_hash
            }
            other => panic!("expected committed result, got {other:?}"),
        };

        let repo_head = run_git_ok(&repo.path, &["rev-parse", "HEAD"]);
        assert_eq!(latest, repo_head);
        assert!(git
            .get_status(&repo.path)
            .expect("status should check out")
            .is_empty());
    }

    #[test]
    fn commit_all_returns_no_changes_without_modifications() {
        if !git_available() {
            return;
        }

        let repo = setup_repo("commit-all-no-changes");
        let git = GitCliPort::new();

        let result = git
            .commit_all(
                &repo.path,
                GitCommitAllRequest {
                    working_dir: None,
                    message: "nothing new".to_string(),
                },
            )
            .expect("empty working tree should return typed no-changes result");

        match result {
            GitCommitAllResult::NoChanges { output } => {
                assert!(output.contains("No staged changes"));
            }
            other => panic!("expected no-changes result, got {other:?}"),
        }
    }

    #[test]
    fn rebase_branch_rewrites_branch_onto_target() {
        if !git_available() {
            return;
        }

        let repo = setup_repo("rebase-success");
        let git = GitCliPort::new();

        git.switch_branch(&repo.path, "feature/rebase-success", true)
            .expect("feature branch should be created");
        fs::write(repo.path.join("feature.txt"), "feature\n").expect("feature file should write");
        run_git_ok(&repo.path, &["add", "feature.txt"]);
        run_git_ok(&repo.path, &["commit", "-m", "feature commit"]);

        git.switch_branch(&repo.path, "main", false)
            .expect("return to main");
        fs::write(repo.path.join("main.txt"), "main\n").expect("main file should write");
        run_git_ok(&repo.path, &["add", "main.txt"]);
        run_git_ok(&repo.path, &["commit", "-m", "main commit"]);

        git.switch_branch(&repo.path, "feature/rebase-success", false)
            .expect("return to feature branch");
        let result = git
            .rebase_branch(
                &repo.path,
                GitRebaseBranchRequest {
                    working_dir: None,
                    target_branch: "main".to_string(),
                },
            )
            .expect("rebase onto target should succeed");

        match result {
            GitRebaseBranchResult::Rebased { output } => {
                assert!(!output.is_empty());
            }
            other => panic!("expected rebased result, got {other:?}"),
        }

        let log = run_git_ok(&repo.path, &["log", "--oneline", "-3"]);
        assert!(log.contains("main commit"));
        assert!(log.contains("feature commit"));
    }

    #[test]
    fn rebase_branch_reports_up_to_date_when_target_is_current_base() {
        if !git_available() {
            return;
        }

        let repo = setup_repo("rebase-up-to-date");
        let git = GitCliPort::new();
        let result = git
            .rebase_branch(
                &repo.path,
                GitRebaseBranchRequest {
                    working_dir: None,
                    target_branch: "main".to_string(),
                },
            )
            .expect("rebase should report up-to-date outcome");

        match result {
            GitRebaseBranchResult::UpToDate { output } => {
                assert!(output.contains("already contains target history"));
            }
            GitRebaseBranchResult::Rebased { output } => {
                assert!(!output.is_empty());
            }
            other => panic!("expected up-to-date or rebased-no-op result, got {other:?}"),
        }
    }

    #[test]
    fn rebase_branch_reports_conflicts_when_merge_conflicts_occur() {
        if !git_available() {
            return;
        }

        let repo = setup_repo("rebase-conflict");
        let git = GitCliPort::new();

        fs::write(repo.path.join("shared.txt"), "initial\n").expect("base file should write");
        run_git_ok(&repo.path, &["add", "shared.txt"]);
        run_git_ok(&repo.path, &["commit", "-m", "shared base"]);

        git.switch_branch(&repo.path, "feature/rebase-conflict", true)
            .expect("feature branch should be created");
        fs::write(repo.path.join("shared.txt"), "feature value\n")
            .expect("feature change should write");
        run_git_ok(&repo.path, &["add", "shared.txt"]);
        run_git_ok(&repo.path, &["commit", "-m", "feature change"]);

        git.switch_branch(&repo.path, "main", false)
            .expect("return to main");
        fs::write(repo.path.join("shared.txt"), "main value\n").expect("main change should write");
        run_git_ok(&repo.path, &["add", "shared.txt"]);
        run_git_ok(&repo.path, &["commit", "-m", "main change"]);

        git.switch_branch(&repo.path, "feature/rebase-conflict", false)
            .expect("return to feature branch");

        let result = git
            .rebase_branch(
                &repo.path,
                GitRebaseBranchRequest {
                    working_dir: None,
                    target_branch: "main".to_string(),
                },
            )
            .expect("conflict should be surfaced as typed conflict result");

        match result {
            GitRebaseBranchResult::Conflicts {
                conflicted_files,
                output: _,
            } => {
                assert!(
                    !conflicted_files.is_empty(),
                    "conflict result should include conflicted files"
                );
                assert!(conflicted_files.iter().any(|file| file == "shared.txt"));
            }
            other => panic!("expected conflicts result, got {other:?}"),
        }

        run_git_ok(&repo.path, &["rebase", "--abort"]);
    }

    #[test]
    fn get_branches_lists_local_and_remote_and_prioritizes_current() {
        if !git_available() {
            return;
        }

        let repo = setup_repo("branches");
        let remote = setup_bare_remote("branches-remote");
        let remote_path = remote.path.to_string_lossy().to_string();
        run_git_ok(
            &repo.path,
            &["remote", "add", "origin", remote_path.as_str()],
        );
        run_git_ok(&repo.path, &["push", "-u", "origin", "main"]);
        run_git_ok(&repo.path, &["switch", "-c", "feature/list"]);
        fs::write(repo.path.join("feature.txt"), "feature\n").expect("feature file should write");
        run_git_ok(&repo.path, &["add", "feature.txt"]);
        run_git_ok(&repo.path, &["commit", "-m", "feature"]);
        run_git_ok(&repo.path, &["push", "-u", "origin", "feature/list"]);
        run_git_ok(&repo.path, &["switch", "main"]);
        run_git_ok(&repo.path, &["fetch", "origin"]);

        let git = GitCliPort::new();
        let branches = git
            .get_branches(&repo.path)
            .expect("branches should list successfully");
        assert!(!branches.is_empty());
        assert_eq!(branches[0].name, "main");
        assert!(branches[0].is_current);
        assert!(!branches[0].is_remote);
        assert!(branches
            .iter()
            .any(|entry| entry.name == "feature/list" && !entry.is_remote));
        assert!(branches
            .iter()
            .any(|entry| entry.name == "origin/main" && entry.is_remote));
        assert!(!branches
            .iter()
            .any(|entry| entry.name == "origin/HEAD" && entry.is_remote));
    }

    #[test]
    fn switch_branch_supports_create_and_existing_targets() {
        if !git_available() {
            return;
        }

        let repo = setup_repo("switch");
        let git = GitCliPort::new();

        let created = git
            .switch_branch(&repo.path, "feature/switch", true)
            .expect("branch creation should succeed");
        assert_eq!(created.name.as_deref(), Some("feature/switch"));
        assert!(!created.detached);

        let existing = git
            .switch_branch(&repo.path, "main", false)
            .expect("switching to existing branch should succeed");
        assert_eq!(existing.name.as_deref(), Some("main"));
        assert!(!existing.detached);
    }

    #[test]
    fn create_and_remove_worktree_support_existing_and_new_branches() {
        if !git_available() {
            return;
        }

        let repo = setup_repo("worktree");
        let git = GitCliPort::new();

        let worktree_new = TempPath::new("worktree-new");
        git.create_worktree(&repo.path, &worktree_new.path, "feature/worktree-new", true)
            .expect("new branch worktree should be created");
        let branch_new = run_git_ok(&worktree_new.path, &["branch", "--show-current"]);
        assert_eq!(branch_new, "feature/worktree-new");
        git.remove_worktree(&repo.path, &worktree_new.path, true)
            .expect("worktree should be removed with force");
        assert!(!worktree_new.path.exists());

        run_git_ok(&repo.path, &["branch", "feature/worktree-existing"]);
        let worktree_existing = TempPath::new("worktree-existing");
        git.create_worktree(
            &repo.path,
            &worktree_existing.path,
            "feature/worktree-existing",
            false,
        )
        .expect("existing branch worktree should be created");
        let branch_existing = run_git_ok(&worktree_existing.path, &["branch", "--show-current"]);
        assert_eq!(branch_existing, "feature/worktree-existing");
        git.remove_worktree(&repo.path, &worktree_existing.path, true)
            .expect("existing branch worktree should be removed");
    }

    #[test]
    fn remove_worktree_requires_force_when_dirty() {
        if !git_available() {
            return;
        }

        let repo = setup_repo("worktree-dirty");
        let git = GitCliPort::new();
        let worktree = TempPath::new("worktree-dirty-tree");
        git.create_worktree(&repo.path, &worktree.path, "feature/worktree-dirty", true)
            .expect("worktree should be created");
        fs::write(worktree.path.join("dirty.txt"), "pending changes\n")
            .expect("dirty file should write");

        let no_force = git.remove_worktree(&repo.path, &worktree.path, false);
        assert!(
            no_force.is_err(),
            "dirty worktree removal without force should fail"
        );

        git.remove_worktree(&repo.path, &worktree.path, true)
            .expect("dirty worktree removal with force should succeed");
    }

    #[test]
    fn push_branch_pushes_to_remote_with_summary() {
        if !git_available() {
            return;
        }

        let repo = setup_repo("push");
        let remote = setup_bare_remote("push-remote");
        let remote_path = remote.path.to_string_lossy().to_string();
        run_git_ok(
            &repo.path,
            &["remote", "add", "origin", remote_path.as_str()],
        );
        let git = GitCliPort::new();

        git.switch_branch(&repo.path, "feature/push", true)
            .expect("feature branch should be created");
        fs::write(repo.path.join("push.txt"), "push data\n").expect("push file should write");
        run_git_ok(&repo.path, &["add", "push.txt"]);
        run_git_ok(&repo.path, &["commit", "-m", "push commit"]);

        let summary = git
            .push_branch(&repo.path, "origin", "feature/push", true, false)
            .expect("push should succeed");
        assert_eq!(summary.remote, "origin");
        assert_eq!(summary.branch, "feature/push");

        let ls_remote = run_git_ok(
            &repo.path,
            &["ls-remote", "--heads", "origin", "feature/push"],
        );
        assert!(
            ls_remote.contains("refs/heads/feature/push"),
            "remote should contain pushed branch"
        );
    }

    #[test]
    fn pull_branch_pulls_new_upstream_commits() {
        if !git_available() {
            return;
        }

        let repo = setup_repo("pull");
        let remote = setup_bare_remote("pull-remote");
        let remote_path = remote.path.to_string_lossy().to_string();
        run_git_ok(
            &repo.path,
            &["remote", "add", "origin", remote_path.as_str()],
        );
        run_git_ok(&repo.path, &["push", "-u", "origin", "main"]);

        let clone_root = TempPath::new("pull-clone");
        let clone_repo = clone_root.path.join("repo");
        run_git_ok(
            &clone_root.path,
            &[
                "clone",
                remote_path.as_str(),
                clone_repo.to_string_lossy().as_ref(),
            ],
        );
        run_git_ok(
            &clone_repo,
            &["config", "user.email", "tests@openducktor.local"],
        );
        run_git_ok(&clone_repo, &["config", "user.name", "OpenDucktor Tests"]);
        fs::write(clone_repo.join("upstream.txt"), "upstream\n")
            .expect("upstream file should write");
        run_git_ok(&clone_repo, &["add", "upstream.txt"]);
        run_git_ok(&clone_repo, &["commit", "-m", "upstream update"]);
        run_git_ok(&clone_repo, &["push", "origin", "main"]);

        let git = GitCliPort::new();
        let result = git
            .pull_branch(&repo.path, GitPullRequest { working_dir: None })
            .expect("pull should succeed");
        assert!(matches!(result, GitPullResult::Pulled { .. }));

        let pulled_file = repo.path.join("upstream.txt");
        assert!(
            pulled_file.exists(),
            "pulled commit should update local working tree"
        );
    }

    #[test]
    fn pull_branch_returns_up_to_date_when_no_upstream_commits_exist() {
        if !git_available() {
            return;
        }

        let repo = setup_repo("pull-up-to-date");
        let remote = setup_bare_remote("pull-up-to-date-remote");
        let remote_path = remote.path.to_string_lossy().to_string();
        run_git_ok(
            &repo.path,
            &["remote", "add", "origin", remote_path.as_str()],
        );
        run_git_ok(&repo.path, &["push", "-u", "origin", "main"]);

        let git = GitCliPort::new();
        let result = git
            .pull_branch(&repo.path, GitPullRequest { working_dir: None })
            .expect("pull should report up-to-date when upstream has no new commits");

        match result {
            GitPullResult::UpToDate { output } => {
                assert!(
                    !output.trim().is_empty(),
                    "up-to-date pull should provide actionable output"
                );
            }
            GitPullResult::Pulled { .. } => {
                panic!("expected up-to-date outcome when upstream has no new commits");
            }
        }
    }

    #[test]
    fn pull_branch_rebases_when_local_and_upstream_have_new_commits() {
        if !git_available() {
            return;
        }

        let repo = setup_repo("pull-diverged");
        let remote = setup_bare_remote("pull-diverged-remote");
        let remote_path = remote.path.to_string_lossy().to_string();
        run_git_ok(
            &repo.path,
            &["remote", "add", "origin", remote_path.as_str()],
        );
        run_git_ok(&repo.path, &["push", "-u", "origin", "main"]);

        fs::write(repo.path.join("local.txt"), "local\n").expect("local file should write");
        run_git_ok(&repo.path, &["add", "local.txt"]);
        run_git_ok(&repo.path, &["commit", "-m", "local change"]);

        let clone_root = TempPath::new("pull-diverged-clone");
        let clone_repo = clone_root.path.join("repo");
        run_git_ok(
            &clone_root.path,
            &[
                "clone",
                remote_path.as_str(),
                clone_repo.to_string_lossy().as_ref(),
            ],
        );
        run_git_ok(
            &clone_repo,
            &["config", "user.email", "tests@openducktor.local"],
        );
        run_git_ok(&clone_repo, &["config", "user.name", "OpenDucktor Tests"]);
        fs::write(clone_repo.join("upstream.txt"), "upstream\n")
            .expect("upstream file should write");
        run_git_ok(&clone_repo, &["add", "upstream.txt"]);
        run_git_ok(&clone_repo, &["commit", "-m", "upstream change"]);
        run_git_ok(&clone_repo, &["push", "origin", "main"]);

        let git = GitCliPort::new();
        let result = git
            .pull_branch(&repo.path, GitPullRequest { working_dir: None })
            .expect("diverged pull should succeed");
        assert!(matches!(result, GitPullResult::Pulled { .. }));

        let latest_subject = run_git_ok(&repo.path, &["log", "-1", "--pretty=%s"]);
        assert_eq!(latest_subject, "local change");

        let head_with_parents =
            run_git_ok(&repo.path, &["rev-list", "--parents", "-n", "1", "HEAD"]);
        let parent_count = head_with_parents.split_whitespace().count();
        assert_eq!(
            parent_count, 2,
            "rebase pull should keep linear history instead of creating merge commit"
        );

        let pulled_file = repo.path.join("upstream.txt");
        assert!(
            pulled_file.exists(),
            "rebased pull should include upstream commit changes"
        );
    }

    #[test]
    fn commits_ahead_behind_reads_upstream_counts_when_tracking_is_configured() {
        if !git_available() {
            return;
        }

        let repo = setup_repo("ahead-behind-upstream");
        let remote = setup_bare_remote("ahead-behind-upstream-remote");
        let remote_path = remote.path.to_string_lossy().to_string();
        run_git_ok(
            &repo.path,
            &["remote", "add", "origin", remote_path.as_str()],
        );
        run_git_ok(&repo.path, &["push", "-u", "origin", "main"]);

        let git = GitCliPort::new();
        git.switch_branch(&repo.path, "feature/upstream-ahead", true)
            .expect("feature branch should be created");

        fs::write(repo.path.join("upstream.txt"), "seed\n").expect("seed file should write");
        run_git_ok(&repo.path, &["add", "upstream.txt"]);
        run_git_ok(&repo.path, &["commit", "-m", "seed upstream branch"]);
        run_git_ok(
            &repo.path,
            &["push", "-u", "origin", "feature/upstream-ahead"],
        );

        fs::write(repo.path.join("upstream.txt"), "seed\nahead\n")
            .expect("ahead file should write");
        run_git_ok(&repo.path, &["add", "upstream.txt"]);
        run_git_ok(&repo.path, &["commit", "-m", "ahead of upstream"]);

        let counts = git
            .commits_ahead_behind(&repo.path, "@{upstream}")
            .expect("upstream ahead/behind should resolve");
        assert_eq!(counts.ahead, 1);
        assert_eq!(counts.behind, 0);
    }

    #[test]
    fn commits_ahead_behind_returns_error_when_upstream_is_missing() {
        if !git_available() {
            return;
        }

        let repo = setup_repo("ahead-behind-no-upstream");
        let git = GitCliPort::new();

        let error = git
            .commits_ahead_behind(&repo.path, "@{upstream}")
            .expect_err("missing upstream should return an error");
        let message = format!("{error:#}");
        assert!(
            message.contains("git rev-list --count --left-right"),
            "error message should include upstream/rev-list context, got: {message}"
        );
    }

    #[test]
    fn resolve_upstream_target_returns_none_when_not_configured() {
        if !git_available() {
            return;
        }

        let repo = setup_repo("resolve-upstream-none");
        let git = GitCliPort::new();

        let upstream = git
            .resolve_upstream_target(&repo.path)
            .expect("upstream resolution should not fail");
        assert!(upstream.is_none());
    }

    #[test]
    fn resolve_upstream_target_returns_tracking_ref_when_available() {
        if !git_available() {
            return;
        }

        let repo = setup_repo("resolve-upstream-tracking");
        let remote = setup_bare_remote("resolve-upstream-tracking-remote");
        let remote_path = remote.path.to_string_lossy().to_string();
        run_git_ok(
            &repo.path,
            &["remote", "add", "origin", remote_path.as_str()],
        );
        run_git_ok(&repo.path, &["push", "-u", "origin", "main"]);

        let git = GitCliPort::new();
        git.switch_branch(&repo.path, "feature/upstream-track", true)
            .expect("feature branch should be created");

        fs::write(repo.path.join("track.txt"), "track\n").expect("track file should write");
        run_git_ok(&repo.path, &["add", "track.txt"]);
        run_git_ok(&repo.path, &["commit", "-m", "track upstream"]);
        run_git_ok(
            &repo.path,
            &["push", "-u", "origin", "feature/upstream-track"],
        );

        let upstream = git
            .resolve_upstream_target(&repo.path)
            .expect("upstream resolution should succeed");
        assert_eq!(
            upstream,
            Some("refs/remotes/origin/feature/upstream-track".to_string())
        );
    }

    #[test]
    fn resolve_upstream_target_returns_none_when_remote_ref_is_deleted() {
        if !git_available() {
            return;
        }

        let repo = setup_repo("resolve-upstream-deleted");
        let remote = setup_bare_remote("resolve-upstream-deleted-remote");
        let remote_path = remote.path.to_string_lossy().to_string();
        run_git_ok(
            &repo.path,
            &["remote", "add", "origin", remote_path.as_str()],
        );
        run_git_ok(&repo.path, &["push", "-u", "origin", "main"]);

        let git = GitCliPort::new();
        git.switch_branch(&repo.path, "feature/upstream-deleted", true)
            .expect("feature branch should be created");

        fs::write(repo.path.join("deleted.txt"), "deleted\n").expect("deleted file should write");
        run_git_ok(&repo.path, &["add", "deleted.txt"]);
        run_git_ok(&repo.path, &["commit", "-m", "upstream deleted setup"]);
        run_git_ok(
            &repo.path,
            &["push", "-u", "origin", "feature/upstream-deleted"],
        );
        run_git_ok(
            &repo.path,
            &["push", "origin", "--delete", "feature/upstream-deleted"],
        );
        run_git_ok(&repo.path, &["fetch", "--prune", "origin"]);

        let upstream = git
            .resolve_upstream_target(&repo.path)
            .expect("upstream resolution should succeed");
        assert!(upstream.is_none());
    }

    #[test]
    fn git_port_validates_non_empty_inputs_and_non_repo_paths() {
        if !git_available() {
            return;
        }

        let repo = setup_repo("validation");
        let git = GitCliPort::new();
        let non_repo = TempPath::new("non-repo");

        assert!(git.get_branches(&non_repo.path).is_err());
        assert!(git.switch_branch(&repo.path, "   ", false).is_err());
        assert!(git
            .create_worktree(&repo.path, &TempPath::new("w").path, " ", true)
            .is_err());
        assert!(git
            .push_branch(&repo.path, "", "main", false, false)
            .is_err());
        assert!(git
            .push_branch(&repo.path, "origin", " ", false, false)
            .is_err());
    }
}
