use super::support::{git_available, run_git_ok, setup_repo};
use crate::git::hash::{
    hash_worktree_diff_payload, hash_worktree_status_payload, GIT_WORKTREE_HASH_VERSION,
};
use crate::git::GitCliPort;
use host_domain::{
    GitDiffScope, GitPort, GitResetSnapshot, GitResetWorktreeSelection,
    GitResetWorktreeSelectionRequest,
};
use std::fs;
use std::path::Path;

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

#[test]
fn reset_hunk_selection_clears_staged_changes_from_index_and_worktree() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("reset-staged-hunk-selection");
    let git = GitCliPort;
    let readme = repo.path.join("README.md");
    fs::write(&readme, "# OpenDucktor\nstaged change\n").expect("tracked change should write");
    run_git_ok(&repo.path, &["add", "README.md"]);

    let result = git
        .reset_worktree_selection(
            &repo.path,
            GitResetWorktreeSelectionRequest {
                working_dir: None,
                target_branch: "main".to_string(),
                snapshot: snapshot_for_uncommitted(&repo.path, "main"),
                selection: GitResetWorktreeSelection::Hunk {
                    file_path: "README.md".to_string(),
                    hunk_index: 0,
                },
            },
        )
        .expect("staged hunk reset should succeed");

    assert_eq!(result.affected_paths, vec!["README.md".to_string()]);
    assert_eq!(
        fs::read_to_string(&readme).expect("README should read"),
        "# OpenDucktor\n"
    );
    assert_eq!(run_git_ok(&repo.path, &["status", "--short"]), "");
}

#[test]
fn reset_hunk_selection_rejects_mixed_staged_and_unstaged_hunk_changes() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("reset-mixed-hunk-selection");
    let git = GitCliPort;
    let readme = repo.path.join("README.md");
    fs::write(&readme, "# OpenDucktor\nstaged change\n").expect("tracked change should write");
    run_git_ok(&repo.path, &["add", "README.md"]);
    fs::write(&readme, "# OpenDucktor\nunstaged change\n").expect("second change should write");

    let error = git
        .reset_worktree_selection(
            &repo.path,
            GitResetWorktreeSelectionRequest {
                working_dir: None,
                target_branch: "main".to_string(),
                snapshot: snapshot_for_uncommitted(&repo.path, "main"),
                selection: GitResetWorktreeSelection::Hunk {
                    file_path: "README.md".to_string(),
                    hunk_index: 0,
                },
            },
        )
        .expect_err("mixed staged and unstaged hunk should fail safely");

    assert!(
        error
            .to_string()
            .contains("mixes staged and unstaged changes"),
        "unexpected error: {error}"
    );
}

#[test]
fn reset_file_selection_restores_renamed_file_to_head() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("reset-renamed-file");
    let git = GitCliPort;
    let original = repo.path.join("notes.txt");
    fs::write(&original, "first\nsecond\n").expect("notes file should write");
    run_git_ok(&repo.path, &["add", "notes.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "add notes"]);
    run_git_ok(&repo.path, &["mv", "notes.txt", "renamed.txt"]);

    let result = git
        .reset_worktree_selection(
            &repo.path,
            GitResetWorktreeSelectionRequest {
                working_dir: None,
                target_branch: "main".to_string(),
                snapshot: snapshot_for_uncommitted(&repo.path, "main"),
                selection: GitResetWorktreeSelection::File {
                    file_path: "renamed.txt".to_string(),
                },
            },
        )
        .expect("renamed file reset should succeed");

    assert_eq!(
        result.affected_paths,
        vec!["notes.txt".to_string(), "renamed.txt".to_string()]
    );
    assert!(original.exists(), "original path should be restored");
    assert!(
        !repo.path.join("renamed.txt").exists(),
        "renamed path should be removed"
    );
    assert_eq!(run_git_ok(&repo.path, &["status", "--short"]), "");
}

#[test]
fn reset_hunk_selection_rejects_renamed_file_hunks() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("reset-renamed-hunk-reject");
    let git = GitCliPort;
    let original = repo.path.join("notes.txt");
    let initial_contents = (1..=12)
        .map(|index| format!("line {index}"))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    fs::write(&original, initial_contents).expect("notes file should write");
    run_git_ok(&repo.path, &["add", "notes.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "add notes"]);
    run_git_ok(&repo.path, &["mv", "notes.txt", "renamed.txt"]);
    let updated_contents = (1..=12)
        .map(|index| {
            if index == 7 {
                "line 7 updated".to_string()
            } else {
                format!("line {index}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    fs::write(repo.path.join("renamed.txt"), updated_contents).expect("renamed file should update");

    let error = git
        .reset_worktree_selection(
            &repo.path,
            GitResetWorktreeSelectionRequest {
                working_dir: None,
                target_branch: "main".to_string(),
                snapshot: snapshot_for_uncommitted(&repo.path, "main"),
                selection: GitResetWorktreeSelection::Hunk {
                    file_path: "renamed.txt".to_string(),
                    hunk_index: 0,
                },
            },
        )
        .expect_err("renamed hunk reset should fail safely");

    assert!(
        error
            .to_string()
            .contains("Cannot reset an individual hunk for a renamed file."),
        "unexpected error: {error}"
    );
}
