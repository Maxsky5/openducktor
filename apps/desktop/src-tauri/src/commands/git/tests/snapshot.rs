use super::super::snapshot::{
    build_worktree_status_summary_with_snapshot, build_worktree_status_with_snapshot,
    hash_worktree_diff_payload, hash_worktree_diff_summary_payload, hash_worktree_status_payload,
    WorktreeSnapshotMetadata, GIT_WORKTREE_HASH_VERSION,
};
use host_domain::{
    GitAheadBehind, GitCurrentBranch, GitDiffScope, GitFileDiff, GitFileStatus,
    GitFileStatusCounts, GitUpstreamAheadBehind, GitWorktreeStatusData,
};

#[test]
fn build_worktree_status_with_snapshot_preserves_payload_and_snapshot_fields() {
    let status_data = GitWorktreeStatusData {
        current_branch: GitCurrentBranch {
            name: Some("feature/snapshot".to_string()),
            detached: false,
            revision: None,
        },
        file_statuses: vec![GitFileStatus {
            path: "src/main.rs".to_string(),
            status: "modified".to_string(),
            staged: false,
        }],
        file_diffs: vec![GitFileDiff {
            file: "src/main.rs".to_string(),
            diff_type: "modified".to_string(),
            additions: 3,
            deletions: 1,
            diff: "@@ -1 +1 @@\n-old\n+new\n".to_string(),
        }],
        target_ahead_behind: GitAheadBehind {
            ahead: 2,
            behind: 0,
        },
        upstream_ahead_behind: GitUpstreamAheadBehind::Tracking {
            ahead: 1,
            behind: 4,
        },
    };

    let built = build_worktree_status_with_snapshot(
        status_data,
        WorktreeSnapshotMetadata {
            effective_working_dir: "/tmp/openducktor-worktree".to_string(),
            target_branch: "origin/main".to_string(),
            diff_scope: GitDiffScope::Target,
            observed_at_ms: 42,
            hash_version: GIT_WORKTREE_HASH_VERSION,
            status_hash: "0123456789abcdef".to_string(),
            diff_hash: "fedcba9876543210".to_string(),
        },
    );

    assert_eq!(
        built.current_branch.name.as_deref(),
        Some("feature/snapshot")
    );
    assert_eq!(built.file_statuses.len(), 1);
    assert_eq!(built.file_diffs.len(), 1);
    assert_eq!(built.target_ahead_behind.ahead, 2);
    assert_eq!(
        built.upstream_ahead_behind,
        GitUpstreamAheadBehind::Tracking {
            ahead: 1,
            behind: 4
        }
    );
    assert_eq!(
        built.snapshot.effective_working_dir,
        "/tmp/openducktor-worktree"
    );
    assert_eq!(built.snapshot.target_branch, "origin/main");
    assert_eq!(built.snapshot.diff_scope, GitDiffScope::Target);
    assert_eq!(built.snapshot.observed_at_ms, 42);
    assert_eq!(built.snapshot.hash_version, GIT_WORKTREE_HASH_VERSION);
    assert_eq!(built.snapshot.status_hash, "0123456789abcdef");
    assert_eq!(built.snapshot.diff_hash, "fedcba9876543210");
}

#[test]
fn status_hash_changes_when_status_payload_changes() {
    let current_branch = GitCurrentBranch {
        name: Some("feature/task-1".to_string()),
        detached: false,
        revision: None,
    };
    let file_statuses = vec![GitFileStatus {
        path: "src/main.rs".to_string(),
        status: "M".to_string(),
        staged: false,
    }];
    let target_ahead_behind = GitAheadBehind {
        ahead: 1,
        behind: 0,
    };
    let baseline_upstream = GitUpstreamAheadBehind::Tracking {
        ahead: 1,
        behind: 0,
    };
    let changed_upstream = GitUpstreamAheadBehind::Tracking {
        ahead: 2,
        behind: 0,
    };

    let baseline_hash = hash_worktree_status_payload(
        &current_branch,
        file_statuses.as_slice(),
        &target_ahead_behind,
        &baseline_upstream,
    );
    let changed_hash = hash_worktree_status_payload(
        &current_branch,
        file_statuses.as_slice(),
        &target_ahead_behind,
        &changed_upstream,
    );

    assert_ne!(baseline_hash, changed_hash);
}

#[test]
fn status_hash_is_stable_for_identical_payload() {
    let current_branch = GitCurrentBranch {
        name: Some("feature/task-1".to_string()),
        detached: false,
        revision: None,
    };
    let file_statuses = vec![GitFileStatus {
        path: "src/main.rs".to_string(),
        status: "M".to_string(),
        staged: false,
    }];
    let target_ahead_behind = GitAheadBehind {
        ahead: 1,
        behind: 0,
    };
    let upstream = GitUpstreamAheadBehind::Tracking {
        ahead: 1,
        behind: 0,
    };

    let first_hash = hash_worktree_status_payload(
        &current_branch,
        file_statuses.as_slice(),
        &target_ahead_behind,
        &upstream,
    );
    let second_hash = hash_worktree_status_payload(
        &current_branch,
        file_statuses.as_slice(),
        &target_ahead_behind,
        &upstream,
    );

    assert_eq!(first_hash, second_hash);
}

#[test]
fn diff_hash_changes_when_diff_payload_changes() {
    let baseline_diff = vec![GitFileDiff {
        file: "src/main.rs".to_string(),
        diff_type: "modified".to_string(),
        additions: 1,
        deletions: 0,
        diff: "@@ -1 +1 @@".to_string(),
    }];
    let changed_diff = vec![GitFileDiff {
        file: "src/main.rs".to_string(),
        diff_type: "modified".to_string(),
        additions: 2,
        deletions: 1,
        diff: "@@ -1 +1,2 @@".to_string(),
    }];

    let baseline_hash = hash_worktree_diff_payload(baseline_diff.as_slice());
    let changed_hash = hash_worktree_diff_payload(changed_diff.as_slice());

    assert_ne!(baseline_hash, changed_hash);
}

#[test]
fn diff_summary_hash_changes_when_scope_or_counts_change() {
    let target_ahead_behind = GitAheadBehind {
        ahead: 1,
        behind: 0,
    };
    let baseline_counts = GitFileStatusCounts {
        total: 2,
        staged: 1,
        unstaged: 1,
    };
    let changed_counts = GitFileStatusCounts {
        total: 3,
        staged: 1,
        unstaged: 2,
    };

    let baseline_hash = hash_worktree_diff_summary_payload(
        &GitDiffScope::Target,
        &target_ahead_behind,
        &baseline_counts,
    );
    let changed_counts_hash = hash_worktree_diff_summary_payload(
        &GitDiffScope::Target,
        &target_ahead_behind,
        &changed_counts,
    );
    let changed_scope_hash = hash_worktree_diff_summary_payload(
        &GitDiffScope::Uncommitted,
        &target_ahead_behind,
        &baseline_counts,
    );

    assert_ne!(baseline_hash, changed_counts_hash);
    assert_ne!(baseline_hash, changed_scope_hash);
}

#[test]
fn build_worktree_status_summary_with_snapshot_preserves_payload_and_snapshot_fields() {
    let built = build_worktree_status_summary_with_snapshot(
        GitCurrentBranch {
            name: Some("feature/snapshot".to_string()),
            detached: false,
            revision: None,
        },
        GitFileStatusCounts {
            total: 4,
            staged: 2,
            unstaged: 2,
        },
        GitAheadBehind {
            ahead: 3,
            behind: 1,
        },
        GitUpstreamAheadBehind::Tracking {
            ahead: 5,
            behind: 0,
        },
        WorktreeSnapshotMetadata {
            effective_working_dir: "/tmp/openducktor-worktree".to_string(),
            target_branch: "origin/main".to_string(),
            diff_scope: GitDiffScope::Uncommitted,
            observed_at_ms: 99,
            hash_version: GIT_WORKTREE_HASH_VERSION,
            status_hash: "0123456789abcdef".to_string(),
            diff_hash: "fedcba9876543210".to_string(),
        },
    );

    assert_eq!(
        built.current_branch.name.as_deref(),
        Some("feature/snapshot")
    );
    assert_eq!(built.file_status_counts.total, 4);
    assert_eq!(built.file_status_counts.staged, 2);
    assert_eq!(built.file_status_counts.unstaged, 2);
    assert_eq!(built.target_ahead_behind.ahead, 3);
    assert_eq!(
        built.upstream_ahead_behind,
        GitUpstreamAheadBehind::Tracking {
            ahead: 5,
            behind: 0
        }
    );
    assert_eq!(built.snapshot.diff_scope, GitDiffScope::Uncommitted);
    assert_eq!(built.snapshot.observed_at_ms, 99);
    assert_eq!(built.snapshot.hash_version, GIT_WORKTREE_HASH_VERSION);
    assert_eq!(built.snapshot.status_hash, "0123456789abcdef");
    assert_eq!(built.snapshot.diff_hash, "fedcba9876543210");
}
