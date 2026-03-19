use anyhow::{anyhow, Context, Result};
use host_domain::{
    GitDiffScope, GitFileDiff, GitResetSnapshot, GitResetWorktreeSelection,
    GitResetWorktreeSelectionRequest, GitResetWorktreeSelectionResult,
};
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use super::hash::{
    hash_worktree_diff_payload, hash_worktree_status_payload, GIT_WORKTREE_HASH_VERSION,
};
use super::util::{combine_output, normalize_non_empty};
use super::{GitCliPort, GIT_NON_INTERACTIVE_ENV};

#[derive(Debug, Clone, PartialEq, Eq)]
struct HunkSpec {
    old_start: u32,
    old_count: u32,
    new_start: u32,
    new_count: u32,
}

#[derive(Debug, Clone)]
struct ParsedHunk {
    text: String,
    spec: HunkSpec,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RenamePaths {
    old_path: String,
    new_path: String,
}

#[derive(Debug)]
struct ParsedPatch {
    header: String,
    hunks: Vec<ParsedHunk>,
    rename_paths: Option<RenamePaths>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PatchApplicationTarget {
    Worktree,
    Cached,
}

fn parse_patch_hunks(patch: &str) -> Result<ParsedPatch> {
    let mut header = String::new();
    let mut hunks = Vec::new();
    let mut current_hunk = String::new();
    let mut current_spec: Option<HunkSpec> = None;
    let mut in_hunk = false;

    for line in patch.split_inclusive('\n') {
        if line.starts_with("@@ ") {
            if in_hunk && !current_hunk.is_empty() {
                let Some(spec) = current_spec.take() else {
                    return Err(anyhow!("Patch hunk is missing parsed hunk metadata"));
                };
                hunks.push(ParsedHunk {
                    text: std::mem::take(&mut current_hunk),
                    spec,
                });
            }

            current_spec = Some(parse_hunk_spec(line)?);
            in_hunk = true;
        }

        if in_hunk {
            current_hunk.push_str(line);
        } else {
            header.push_str(line);
        }
    }

    if in_hunk && !current_hunk.is_empty() {
        let Some(spec) = current_spec.take() else {
            return Err(anyhow!("Patch hunk is missing parsed hunk metadata"));
        };
        hunks.push(ParsedHunk {
            text: current_hunk,
            spec,
        });
    }

    Ok(ParsedPatch {
        rename_paths: parse_rename_paths(&header)
            .or_else(|| parse_rename_paths_from_diff_header(&header)),
        header,
        hunks,
    })
}

fn parse_hunk_spec(line: &str) -> Result<HunkSpec> {
    let rest = line
        .strip_prefix("@@ -")
        .ok_or_else(|| anyhow!("Invalid hunk header: {line}"))?;
    let (old_part, remaining) = rest
        .split_once(" +")
        .ok_or_else(|| anyhow!("Invalid hunk header: {line}"))?;
    let (new_part, _tail) = remaining
        .split_once(" @@")
        .ok_or_else(|| anyhow!("Invalid hunk header: {line}"))?;

    let (old_start, old_count) = parse_hunk_range(old_part)?;
    let (new_start, new_count) = parse_hunk_range(new_part)?;
    Ok(HunkSpec {
        old_start,
        old_count,
        new_start,
        new_count,
    })
}

fn parse_hunk_range(input: &str) -> Result<(u32, u32)> {
    let trimmed = input.trim();
    let (start, count) = match trimmed.split_once(',') {
        Some((start, count)) => (start, count),
        None => (trimmed, "1"),
    };
    let start = start
        .parse::<u32>()
        .with_context(|| format!("Invalid hunk range start: {trimmed}"))?;
    let count = count
        .parse::<u32>()
        .with_context(|| format!("Invalid hunk range count: {trimmed}"))?;
    Ok((start, count))
}

fn parse_rename_paths(header: &str) -> Option<RenamePaths> {
    let mut old_path: Option<String> = None;
    let mut new_path: Option<String> = None;

    for line in header.lines() {
        if let Some(path) = line.strip_prefix("rename from ") {
            old_path = Some(path.trim().to_string());
        } else if let Some(path) = line.strip_prefix("rename to ") {
            new_path = Some(path.trim().to_string());
        }
    }

    Some(RenamePaths {
        old_path: old_path?,
        new_path: new_path?,
    })
}

fn parse_rename_paths_from_diff_header(header: &str) -> Option<RenamePaths> {
    let diff_line = header
        .lines()
        .find(|line| line.starts_with("diff --git "))?;
    let rest = diff_line.strip_prefix("diff --git ")?;
    let (old_path, remaining) = parse_diff_git_header_token(rest)?;
    let (new_path, _tail) = parse_diff_git_header_token(remaining)?;
    let old_path = old_path.strip_prefix("a/")?.to_string();
    let new_path = new_path.strip_prefix("b/")?.to_string();
    if old_path == new_path {
        return None;
    }
    Some(RenamePaths { old_path, new_path })
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

fn combine_patch_hunk(header: &str, hunk: &ParsedHunk) -> String {
    let mut patch = String::with_capacity(header.len() + hunk.text.len());
    patch.push_str(header);
    patch.push_str(&hunk.text);
    patch
}

fn hunk_specs_overlap(left: &HunkSpec, right: &HunkSpec) -> bool {
    range_overlaps(
        left.old_start,
        left.old_count,
        right.old_start,
        right.old_count,
    ) || range_overlaps(
        left.new_start,
        left.new_count,
        right.new_start,
        right.new_count,
    )
}

fn range_overlaps(start_a: u32, count_a: u32, start_b: u32, count_b: u32) -> bool {
    let end_a = start_a.saturating_add(count_a.max(1)).saturating_sub(1);
    let end_b = start_b.saturating_add(count_b.max(1)).saturating_sub(1);
    !(end_a < start_b || end_b < start_a)
}

fn find_matching_cached_hunk<'a>(
    cached_patch: &'a ParsedPatch,
    selected_hunk: &ParsedHunk,
) -> Result<Option<&'a ParsedHunk>> {
    if let Some(exact_match) = cached_patch.hunks.iter().find(|candidate| {
        candidate.spec == selected_hunk.spec
            && hunk_body(candidate.text.as_str()) == hunk_body(selected_hunk.text.as_str())
    }) {
        return Ok(Some(exact_match));
    }

    if cached_patch
        .hunks
        .iter()
        .any(|candidate| hunk_specs_overlap(&candidate.spec, &selected_hunk.spec))
    {
        return Err(anyhow!(
            "Cannot reset a hunk that mixes staged and unstaged changes. Unstage it or reset the whole file instead."
        ));
    }

    Ok(None)
}

fn hunk_body(text: &str) -> &str {
    match text.find('\n') {
        Some(index) => &text[index + 1..],
        None => text,
    }
}

impl GitCliPort {
    pub(super) fn reset_worktree_selection_impl(
        &self,
        repo_path: &Path,
        request: GitResetWorktreeSelectionRequest,
    ) -> Result<GitResetWorktreeSelectionResult> {
        self.ensure_repository(repo_path)?;

        let target_branch = normalize_non_empty(&request.target_branch, "target branch")?;
        validate_snapshot_hash_version(&request.snapshot)?;

        let authoritative = self.get_worktree_status_impl(
            repo_path,
            target_branch.as_str(),
            GitDiffScope::Uncommitted,
        )?;
        validate_snapshot_matches(&request.snapshot, &authoritative)?;

        match request.selection {
            GitResetWorktreeSelection::File { file_path } => {
                self.reset_file_selection(repo_path, &authoritative.file_diffs, &file_path)
            }
            GitResetWorktreeSelection::Hunk {
                file_path,
                hunk_index,
            } => self.reset_hunk_selection(
                repo_path,
                &authoritative.file_diffs,
                &file_path,
                hunk_index,
            ),
        }
    }

    fn reset_file_selection(
        &self,
        repo_path: &Path,
        file_diffs: &[GitFileDiff],
        file_path: &str,
    ) -> Result<GitResetWorktreeSelectionResult> {
        let normalized_file = normalize_non_empty(file_path, "file path")?;
        let file_diff = find_file_diff(file_diffs, normalized_file.as_str())?;

        if file_diff.diff_type == "renamed" {
            let parsed_patch = parse_patch_hunks(&file_diff.diff)?;
            let rename_paths = parsed_patch.rename_paths.ok_or_else(|| {
                anyhow!(
                    "Cannot reset renamed file {} because rename metadata is unavailable.",
                    normalized_file
                )
            })?;
            self.reset_renamed_file_selection(repo_path, &rename_paths)
        } else if self.is_tracked_path(repo_path, normalized_file.as_str())? {
            let args = [
                "restore",
                "--source=HEAD",
                "--staged",
                "--worktree",
                "--",
                normalized_file.as_str(),
            ];
            let (ok, stdout, stderr) = self.run_git_allow_failure(repo_path, &args)?;
            if !ok {
                return Err(anyhow!(combine_output(stdout, stderr)));
            }

            Ok(GitResetWorktreeSelectionResult {
                affected_paths: vec![normalized_file],
            })
        } else {
            let args = ["clean", "-f", "--", normalized_file.as_str()];
            let (ok, stdout, stderr) = self.run_git_allow_failure(repo_path, &args)?;
            if !ok {
                return Err(anyhow!(combine_output(stdout, stderr)));
            }

            Ok(GitResetWorktreeSelectionResult {
                affected_paths: vec![normalized_file],
            })
        }
    }

    fn reset_renamed_file_selection(
        &self,
        repo_path: &Path,
        rename_paths: &RenamePaths,
    ) -> Result<GitResetWorktreeSelectionResult> {
        let restore_args = [
            "restore",
            "--source=HEAD",
            "--staged",
            "--worktree",
            "--",
            rename_paths.old_path.as_str(),
        ];
        let (restore_ok, restore_stdout, restore_stderr) =
            self.run_git_allow_failure(repo_path, &restore_args)?;
        if !restore_ok {
            return Err(anyhow!(combine_output(restore_stdout, restore_stderr)));
        }

        let remove_cached_args = [
            "rm",
            "--force",
            "--cached",
            "--ignore-unmatch",
            "--",
            rename_paths.new_path.as_str(),
        ];
        let (remove_ok, remove_stdout, remove_stderr) =
            self.run_git_allow_failure(repo_path, &remove_cached_args)?;
        if !remove_ok {
            return Err(anyhow!(combine_output(remove_stdout, remove_stderr)));
        }

        remove_worktree_path(repo_path.join(rename_paths.new_path.as_str()))?;

        Ok(GitResetWorktreeSelectionResult {
            affected_paths: vec![rename_paths.old_path.clone(), rename_paths.new_path.clone()],
        })
    }

    fn reset_hunk_selection(
        &self,
        repo_path: &Path,
        file_diffs: &[GitFileDiff],
        file_path: &str,
        hunk_index: u32,
    ) -> Result<GitResetWorktreeSelectionResult> {
        let normalized_file = normalize_non_empty(file_path, "file path")?;
        let file_diff = find_file_diff(file_diffs, normalized_file.as_str())?;

        if file_diff.diff.trim().is_empty() {
            return Err(anyhow!(
                "Cannot reset hunk because diff content is unavailable for {}.",
                normalized_file
            ));
        }

        if file_diff.diff_type == "renamed" {
            return Err(anyhow!(
                "Cannot reset an individual hunk for a renamed file. Reset the whole file instead."
            ));
        }

        let parsed_patch = parse_patch_hunks(&file_diff.diff)?;
        if parsed_patch.rename_paths.is_some() {
            return Err(anyhow!(
                "Cannot reset an individual hunk for a renamed file. Reset the whole file instead."
            ));
        }

        let Some(selected_hunk) = parsed_patch.hunks.get(hunk_index as usize) else {
            return Err(anyhow!(
                "Requested hunk {} does not exist for {}.",
                hunk_index,
                normalized_file
            ));
        };

        let worktree_patch = combine_patch_hunk(&parsed_patch.header, selected_hunk);
        self.check_reverse_patch(repo_path, &worktree_patch, PatchApplicationTarget::Worktree)?;

        let cached_patch_text = self.load_cached_patch(repo_path, normalized_file.as_str())?;
        let unstaged_patch_text = self.load_unstaged_patch(repo_path, normalized_file.as_str())?;
        let mut cached_reverse_patch: Option<String> = None;
        if !cached_patch_text.trim().is_empty() {
            if unstaged_patch_text.trim().is_empty() {
                self.check_reverse_patch(
                    repo_path,
                    &worktree_patch,
                    PatchApplicationTarget::Cached,
                )?;
                cached_reverse_patch = Some(worktree_patch.clone());
            } else {
                let cached_patch = parse_patch_hunks(&cached_patch_text)?;
                if cached_patch.rename_paths.is_some() {
                    return Err(anyhow!(
                        "Cannot reset an individual hunk for a renamed file while staged changes are present. Reset the whole file instead."
                    ));
                }

                if let Some(cached_hunk) = find_matching_cached_hunk(&cached_patch, selected_hunk)?
                {
                    let patch = combine_patch_hunk(&cached_patch.header, cached_hunk);
                    self.check_reverse_patch(repo_path, &patch, PatchApplicationTarget::Cached)?;
                    cached_reverse_patch = Some(patch);
                }
            }
        }

        if let Some(cached_patch) = cached_reverse_patch.as_deref() {
            self.apply_reverse_patch(repo_path, cached_patch, PatchApplicationTarget::Cached)?;
        }
        self.apply_reverse_patch(repo_path, &worktree_patch, PatchApplicationTarget::Worktree)?;

        Ok(GitResetWorktreeSelectionResult {
            affected_paths: vec![normalized_file],
        })
    }

    fn load_cached_patch(&self, repo_path: &Path, file_path: &str) -> Result<String> {
        let args = ["diff", "--cached", "--", file_path];
        let (ok, stdout, stderr) = self.run_git_allow_failure(repo_path, &args)?;
        if ok {
            return Ok(stdout);
        }

        Err(anyhow!(combine_output(stdout, stderr)))
    }

    fn load_unstaged_patch(&self, repo_path: &Path, file_path: &str) -> Result<String> {
        let args = ["diff", "--", file_path];
        let (ok, stdout, stderr) = self.run_git_allow_failure(repo_path, &args)?;
        if ok {
            return Ok(stdout);
        }

        Err(anyhow!(combine_output(stdout, stderr)))
    }

    fn is_tracked_path(&self, repo_path: &Path, file_path: &str) -> Result<bool> {
        let args = ["ls-files", "--error-unmatch", "--", file_path];
        let (ok, stdout, stderr) = self.run_git_allow_failure(repo_path, &args)?;
        if ok {
            return Ok(true);
        }

        let output = combine_output(stdout, stderr);
        if output.contains("did not match any file") || output.contains("error: pathspec") {
            return Ok(false);
        }

        Err(anyhow!(output))
    }

    fn apply_reverse_patch(
        &self,
        repo_path: &Path,
        patch: &str,
        target: PatchApplicationTarget,
    ) -> Result<()> {
        self.run_reverse_patch(repo_path, patch, target, false)
    }

    fn check_reverse_patch(
        &self,
        repo_path: &Path,
        patch: &str,
        target: PatchApplicationTarget,
    ) -> Result<()> {
        self.run_reverse_patch(repo_path, patch, target, true)
    }

    fn run_reverse_patch(
        &self,
        repo_path: &Path,
        patch: &str,
        target: PatchApplicationTarget,
        check_only: bool,
    ) -> Result<()> {
        let mut command = Command::new("git");
        let mut args = vec!["apply", "--reverse"];
        if target == PatchApplicationTarget::Cached {
            args.push("--cached");
        }
        if check_only {
            args.push("--check");
        }
        args.push("-");

        command
            .args(args)
            .current_dir(repo_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        for (key, value) in GIT_NON_INTERACTIVE_ENV {
            command.env(key, value);
        }

        let mut child = command
            .spawn()
            .with_context(|| format!("Failed spawning git apply for {}", repo_path.display()))?;
        let Some(mut stdin) = child.stdin.take() else {
            return Err(anyhow!("Failed opening stdin for git apply"));
        };
        stdin
            .write_all(patch.as_bytes())
            .context("Failed writing patch to git apply stdin")?;
        drop(stdin);

        let output = child
            .wait_with_output()
            .context("Failed waiting for git apply process")?;

        if output.status.success() {
            return Ok(());
        }

        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        Err(anyhow!(combine_output(stdout, stderr)))
    }
}

fn find_file_diff<'a>(file_diffs: &'a [GitFileDiff], file_path: &str) -> Result<&'a GitFileDiff> {
    file_diffs
        .iter()
        .find(|diff| diff.file == file_path)
        .ok_or_else(|| anyhow!("Displayed diff is stale. Refresh and try again."))
}

fn remove_worktree_path(path: impl AsRef<Path>) -> Result<()> {
    let path = path.as_ref();
    if !path.exists() {
        return Ok(());
    }

    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("Failed reading file metadata for {}", path.display()))?;
    if metadata.is_dir() {
        fs::remove_dir_all(path)
            .with_context(|| format!("Failed removing directory {}", path.display()))?;
    } else {
        fs::remove_file(path)
            .with_context(|| format!("Failed removing file {}", path.display()))?;
    }

    Ok(())
}

fn validate_snapshot_hash_version(snapshot: &GitResetSnapshot) -> Result<()> {
    if snapshot.hash_version == GIT_WORKTREE_HASH_VERSION {
        return Ok(());
    }

    Err(anyhow!("Displayed diff is stale. Refresh and try again."))
}

fn validate_snapshot_matches(
    snapshot: &GitResetSnapshot,
    authoritative: &host_domain::GitWorktreeStatusData,
) -> Result<()> {
    let current_status_hash = hash_worktree_status_payload(
        &authoritative.current_branch,
        authoritative.file_statuses.as_slice(),
        &authoritative.target_ahead_behind,
        &authoritative.upstream_ahead_behind,
    );
    let current_diff_hash = hash_worktree_diff_payload(authoritative.file_diffs.as_slice());

    if snapshot.status_hash == current_status_hash && snapshot.diff_hash == current_diff_hash {
        return Ok(());
    }

    Err(anyhow!("Displayed diff is stale. Refresh and try again."))
}
