use anyhow::{anyhow, Context, Result};
use host_domain::{
    GitAheadBehind, GitCurrentBranch, GitDiffScope, GitFileDiff, GitFileStatus, GitResetSnapshot,
    GitResetWorktreeSelection, GitResetWorktreeSelectionRequest, GitResetWorktreeSelectionResult,
    GitUpstreamAheadBehind,
};
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use super::util::{combine_output, normalize_non_empty};
use super::{GitCliPort, GIT_NON_INTERACTIVE_ENV};

const GIT_WORKTREE_HASH_VERSION: u32 = 1;
const FNV1A_64_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV1A_64_PRIME: u64 = 0x100000001b3;

struct Fnv1a64Hasher {
    state: u64,
}

impl Fnv1a64Hasher {
    fn new() -> Self {
        Self {
            state: FNV1A_64_OFFSET_BASIS,
        }
    }

    fn update_byte(&mut self, byte: u8) {
        self.state ^= u64::from(byte);
        self.state = self.state.wrapping_mul(FNV1A_64_PRIME);
    }

    fn update_bytes(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.update_byte(*byte);
        }
    }

    fn update_bool(&mut self, value: bool) {
        self.update_byte(u8::from(value));
    }

    fn update_u32(&mut self, value: u32) {
        self.update_bytes(&value.to_le_bytes());
    }

    fn update_u64(&mut self, value: u64) {
        self.update_bytes(&value.to_le_bytes());
    }

    fn update_str(&mut self, value: &str) {
        self.update_u64(value.len() as u64);
        self.update_bytes(value.as_bytes());
    }

    fn finish_hex(self) -> String {
        format!("{:016x}", self.state)
    }
}

fn hash_optional_str(hasher: &mut Fnv1a64Hasher, value: Option<&str>) {
    match value {
        Some(value) => {
            hasher.update_byte(1);
            hasher.update_str(value);
        }
        None => hasher.update_byte(0),
    }
}

fn hash_upstream_ahead_behind(
    hasher: &mut Fnv1a64Hasher,
    upstream_ahead_behind: &GitUpstreamAheadBehind,
) {
    match upstream_ahead_behind {
        GitUpstreamAheadBehind::Tracking { ahead, behind } => {
            hasher.update_str("tracking");
            hasher.update_u32(*ahead);
            hasher.update_u32(*behind);
        }
        GitUpstreamAheadBehind::Untracked { ahead } => {
            hasher.update_str("untracked");
            hasher.update_u32(*ahead);
        }
        GitUpstreamAheadBehind::Error { message } => {
            hasher.update_str("error");
            hasher.update_str(message);
        }
    }
}

fn hash_worktree_status_payload(
    current_branch: &GitCurrentBranch,
    file_statuses: &[GitFileStatus],
    target_ahead_behind: &GitAheadBehind,
    upstream_ahead_behind: &GitUpstreamAheadBehind,
) -> String {
    let mut hasher = Fnv1a64Hasher::new();
    hash_optional_str(&mut hasher, current_branch.name.as_deref());
    hasher.update_bool(current_branch.detached);

    hasher.update_u64(file_statuses.len() as u64);
    for status in file_statuses {
        hasher.update_str(&status.path);
        hasher.update_str(&status.status);
        hasher.update_bool(status.staged);
    }

    hasher.update_u32(target_ahead_behind.ahead);
    hasher.update_u32(target_ahead_behind.behind);
    hash_upstream_ahead_behind(&mut hasher, upstream_ahead_behind);
    hasher.finish_hex()
}

fn hash_worktree_diff_payload(file_diffs: &[GitFileDiff]) -> String {
    let mut hasher = Fnv1a64Hasher::new();
    hasher.update_u64(file_diffs.len() as u64);

    for diff in file_diffs {
        hasher.update_str(&diff.file);
        hasher.update_str(&diff.diff_type);
        hasher.update_u32(diff.additions);
        hasher.update_u32(diff.deletions);
        hasher.update_str(&diff.diff);
    }

    hasher.finish_hex()
}

#[derive(Debug)]
struct ParsedPatch {
    header: String,
    hunks: Vec<String>,
}

fn parse_patch_hunks(patch: &str) -> ParsedPatch {
    let mut header = String::new();
    let mut hunks = Vec::new();
    let mut current_hunk = String::new();
    let mut in_hunk = false;

    for line in patch.split_inclusive('\n') {
        if line.starts_with("@@ ") {
            if in_hunk && !current_hunk.is_empty() {
                hunks.push(std::mem::take(&mut current_hunk));
            }
            in_hunk = true;
        }

        if in_hunk {
            current_hunk.push_str(line);
        } else {
            header.push_str(line);
        }
    }

    if in_hunk && !current_hunk.is_empty() {
        hunks.push(current_hunk);
    }

    ParsedPatch { header, hunks }
}

fn combine_patch_hunk(header: &str, hunk: &str) -> String {
    let mut patch = String::with_capacity(header.len() + hunk.len());
    patch.push_str(header);
    patch.push_str(hunk);
    patch
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
        ensure_file_present(file_diffs, normalized_file.as_str())?;

        if self.is_tracked_path(repo_path, normalized_file.as_str())? {
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
        } else {
            let args = ["clean", "-f", "--", normalized_file.as_str()];
            let (ok, stdout, stderr) = self.run_git_allow_failure(repo_path, &args)?;
            if !ok {
                return Err(anyhow!(combine_output(stdout, stderr)));
            }
        }

        Ok(GitResetWorktreeSelectionResult {
            affected_paths: vec![normalized_file],
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
        let file_diff = file_diffs
            .iter()
            .find(|candidate| candidate.file == normalized_file)
            .ok_or_else(|| anyhow!("Displayed diff is stale. Refresh and try again."))?;

        if file_diff.diff.trim().is_empty() {
            return Err(anyhow!(
                "Cannot reset chunk because diff content is unavailable for {}.",
                normalized_file
            ));
        }

        let parsed_patch = parse_patch_hunks(&file_diff.diff);
        let Some(hunk) = parsed_patch.hunks.get(hunk_index as usize) else {
            return Err(anyhow!(
                "Requested hunk {} does not exist for {}.",
                hunk_index,
                normalized_file
            ));
        };

        let patch = combine_patch_hunk(&parsed_patch.header, hunk);
        self.apply_reverse_patch(repo_path, &patch)?;

        Ok(GitResetWorktreeSelectionResult {
            affected_paths: vec![normalized_file],
        })
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

    fn apply_reverse_patch(&self, repo_path: &Path, patch: &str) -> Result<()> {
        let mut command = Command::new("git");
        command
            .args(["apply", "--reverse", "--recount", "-"])
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

fn ensure_file_present(file_diffs: &[GitFileDiff], file_path: &str) -> Result<()> {
    if file_diffs.iter().any(|diff| diff.file == file_path) {
        return Ok(());
    }

    Err(anyhow!("Displayed diff is stale. Refresh and try again."))
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
