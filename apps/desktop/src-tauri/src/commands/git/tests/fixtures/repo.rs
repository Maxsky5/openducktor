use std::{
    collections::HashSet,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use host_domain::{
    GitAheadBehind, GitCurrentBranch, GitFileDiff, GitFileStatus, GitFileStatusCounts,
    GitUpstreamAheadBehind, GitWorktreeStatusData, GitWorktreeStatusSummaryData,
};

use super::super::super::authorization::{
    authorized_worktree_cache, cache_key, invalidate_worktree_resolution_cache_for_repo,
    read_worktree_state_token, AuthorizedWorktreeCacheEntry,
};

pub(crate) fn unique_test_dir(prefix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before unix epoch")
        .as_nanos();
    let dir = env::temp_dir().join(format!("openducktor-{prefix}-{nanos}"));
    fs::create_dir_all(&dir).expect("failed to create test directory");
    dir
}

pub(crate) fn run_git(args: &[&str], cwd: &Path) {
    let status = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .status()
        .expect("failed to run git command");
    assert!(status.success(), "git command failed: {:?}", args);
}

pub(crate) fn init_repo(path: &Path) {
    fs::create_dir_all(path).expect("failed to create repo directory");
    run_git(&["init", "--initial-branch=main"], path);
    fs::write(path.join("README.md"), "init\n").expect("failed to write seed file");
    run_git(&["add", "."], path);
    run_git(
        &[
            "-c",
            "user.name=OpenDucktor Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "-m",
            "init",
        ],
        path,
    );
}

pub(crate) fn seed_authorized_worktree_cache_with_subset(repo: &Path, allowed_worktrees: &[&Path]) {
    let canonical_repo = fs::canonicalize(repo).expect("repo should canonicalize for cache seed");
    let worktree_state_token = read_worktree_state_token(canonical_repo.as_path())
        .expect("worktree state token should be readable for cache seed");
    let seeded_worktrees = allowed_worktrees
        .iter()
        .map(|path| fs::canonicalize(path).expect("worktree should canonicalize for cache seed"))
        .collect::<HashSet<_>>();
    let mut cache = authorized_worktree_cache()
        .lock()
        .expect("authorized worktree cache lock should not be poisoned");
    cache.insert(
        cache_key(canonical_repo.as_path()),
        AuthorizedWorktreeCacheEntry {
            cached_at: Instant::now(),
            worktree_state_token,
            worktrees: seeded_worktrees,
        },
    );
}

pub(crate) fn clear_authorized_worktree_cache_for_repo(repo: &Path) {
    invalidate_worktree_resolution_cache_for_repo(repo.to_string_lossy().as_ref())
        .expect("worktree cache should clear for repository");
}

pub(crate) fn sample_worktree_status_data(
    upstream: GitUpstreamAheadBehind,
) -> GitWorktreeStatusData {
    GitWorktreeStatusData {
        current_branch: GitCurrentBranch {
            name: Some("feature/command".to_string()),
            detached: false,
            revision: None,
        },
        file_statuses: vec![GitFileStatus {
            path: "src/main.rs".to_string(),
            status: "M".to_string(),
            staged: false,
        }],
        file_diffs: vec![GitFileDiff {
            file: "src/main.rs".to_string(),
            diff_type: "modified".to_string(),
            additions: 1,
            deletions: 0,
            diff: "@@ -1 +1 @@\n-old\n+new\n".to_string(),
        }],
        target_ahead_behind: GitAheadBehind {
            ahead: 1,
            behind: 0,
        },
        upstream_ahead_behind: upstream,
        git_conflict: None,
    }
}

pub(crate) fn sample_worktree_status_summary_data(
    upstream: GitUpstreamAheadBehind,
) -> GitWorktreeStatusSummaryData {
    GitWorktreeStatusSummaryData {
        current_branch: GitCurrentBranch {
            name: Some("feature/command".to_string()),
            detached: false,
            revision: None,
        },
        file_statuses: vec![GitFileStatus {
            path: "src/main.rs".to_string(),
            status: "M".to_string(),
            staged: false,
        }],
        file_status_counts: GitFileStatusCounts {
            total: 1,
            staged: 0,
            unstaged: 1,
        },
        target_ahead_behind: GitAheadBehind {
            ahead: 1,
            behind: 0,
        },
        upstream_ahead_behind: upstream,
        git_conflict: None,
    }
}
