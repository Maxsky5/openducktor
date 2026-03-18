use super::support::{git_available, run_git_ok, setup_repo};
use crate::git::GitCliPort;
use host_domain::{
    GitAheadBehind, GitCurrentBranch, GitDiffScope, GitFileDiff, GitFileStatus, GitPort,
    GitResetSnapshot, GitResetWorktreeSelection, GitResetWorktreeSelectionRequest,
    GitUpstreamAheadBehind,
};
use std::fs;
use std::path::Path;

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

fn snapshot_for_uncommitted(repo_path: &Path, target_branch: &str) -> GitResetSnapshot {
    let git = GitCliPort;
    let status = git
        .get_worktree_status(repo_path, target_branch, GitDiffScope::Uncommitted)
        .expect("worktree status should load");

    GitResetSnapshot {
        hash_version: GIT_WORKTREE_HASH_VERSION,
        status_hash: hash_worktree_status_payload(
            &status.current_branch,
            &status.file_statuses,
            &status.target_ahead_behind,
            &status.upstream_ahead_behind,
        ),
        diff_hash: hash_worktree_diff_payload(&status.file_diffs),
    }
}

#[test]
fn reset_file_selection_restores_tracked_file_to_head() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("reset-tracked-file");
    let git = GitCliPort;
    let readme = repo.path.join("README.md");
    fs::write(&readme, "# OpenDucktor\nupdated\n").expect("tracked change should write");

    let result = git
        .reset_worktree_selection(
            &repo.path,
            GitResetWorktreeSelectionRequest {
                working_dir: None,
                target_branch: "main".to_string(),
                snapshot: snapshot_for_uncommitted(&repo.path, "main"),
                selection: GitResetWorktreeSelection::File {
                    file_path: "README.md".to_string(),
                },
            },
        )
        .expect("tracked file reset should succeed");

    assert_eq!(result.affected_paths, vec!["README.md".to_string()]);
    assert_eq!(
        fs::read_to_string(&readme).expect("README should read"),
        "# OpenDucktor\n"
    );
    assert_eq!(run_git_ok(&repo.path, &["status", "--short"]), "");
}

#[test]
fn reset_file_selection_removes_untracked_file() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("reset-untracked-file");
    let git = GitCliPort;
    let temp_file = repo.path.join("scratch.txt");
    fs::write(&temp_file, "temporary\n").expect("untracked file should write");

    let result = git
        .reset_worktree_selection(
            &repo.path,
            GitResetWorktreeSelectionRequest {
                working_dir: None,
                target_branch: "main".to_string(),
                snapshot: snapshot_for_uncommitted(&repo.path, "main"),
                selection: GitResetWorktreeSelection::File {
                    file_path: "scratch.txt".to_string(),
                },
            },
        )
        .expect("untracked file reset should succeed");

    assert_eq!(result.affected_paths, vec!["scratch.txt".to_string()]);
    assert!(!temp_file.exists(), "untracked file should be removed");
}

#[test]
fn reset_hunk_selection_reverts_only_the_selected_hunk() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("reset-hunk-selection");
    let git = GitCliPort;
    let notes = repo.path.join("notes.txt");
    let original = (1..=12)
        .map(|index| format!("line {index}"))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    fs::write(&notes, &original).expect("notes file should write");
    run_git_ok(&repo.path, &["add", "notes.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "add notes"]);

    let updated = [
        "line 1",
        "line 2 updated",
        "line 3",
        "line 4",
        "line 5",
        "line 6",
        "line 7",
        "line 8",
        "line 9",
        "line 10",
        "line 11 updated",
        "line 12",
    ]
    .join("\n")
        + "\n";
    fs::write(&notes, updated).expect("notes update should write");

    let result = git
        .reset_worktree_selection(
            &repo.path,
            GitResetWorktreeSelectionRequest {
                working_dir: None,
                target_branch: "main".to_string(),
                snapshot: snapshot_for_uncommitted(&repo.path, "main"),
                selection: GitResetWorktreeSelection::Hunk {
                    file_path: "notes.txt".to_string(),
                    hunk_index: 0,
                },
            },
        )
        .expect("hunk reset should succeed");

    assert_eq!(result.affected_paths, vec!["notes.txt".to_string()]);
    let contents = fs::read_to_string(&notes).expect("notes should read");
    assert!(
        contents.contains("line 2\n"),
        "first hunk should be restored"
    );
    assert!(
        contents.contains("line 11 updated\n"),
        "second hunk should remain"
    );
}

#[test]
fn reset_worktree_selection_rejects_stale_snapshot_before_mutation() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("reset-stale-snapshot");
    let git = GitCliPort;
    let readme = repo.path.join("README.md");
    fs::write(&readme, "# OpenDucktor\nfirst change\n").expect("first change should write");
    let stale_snapshot = snapshot_for_uncommitted(&repo.path, "main");
    fs::write(&readme, "# OpenDucktor\nfirst change\nsecond change\n")
        .expect("second change should write");

    let error = git
        .reset_worktree_selection(
            &repo.path,
            GitResetWorktreeSelectionRequest {
                working_dir: None,
                target_branch: "main".to_string(),
                snapshot: stale_snapshot,
                selection: GitResetWorktreeSelection::File {
                    file_path: "README.md".to_string(),
                },
            },
        )
        .expect_err("stale snapshot should fail");

    assert!(
        error
            .to_string()
            .contains("Displayed diff is stale. Refresh and try again."),
        "unexpected error: {error}"
    );
    assert!(
        fs::read_to_string(&readme)
            .expect("README should read")
            .contains("second change"),
        "stale rejection should leave file untouched"
    );
}

#[test]
fn reset_hunk_selection_rejects_invalid_hunk_index() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("reset-invalid-hunk-index");
    let git = GitCliPort;
    let readme = repo.path.join("README.md");
    fs::write(&readme, "# OpenDucktor\ninvalid hunk\n").expect("tracked change should write");

    let error = git
        .reset_worktree_selection(
            &repo.path,
            GitResetWorktreeSelectionRequest {
                working_dir: None,
                target_branch: "main".to_string(),
                snapshot: snapshot_for_uncommitted(&repo.path, "main"),
                selection: GitResetWorktreeSelection::Hunk {
                    file_path: "README.md".to_string(),
                    hunk_index: 3,
                },
            },
        )
        .expect_err("invalid hunk index should fail");

    assert!(
        error
            .to_string()
            .contains("Requested hunk 3 does not exist for README.md."),
        "unexpected error: {error}"
    );
}
