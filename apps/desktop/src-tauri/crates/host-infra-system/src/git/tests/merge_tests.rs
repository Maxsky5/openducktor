use host_domain::{GitMergeBranchRequest, GitMergeBranchResult, GitMergeMethod, GitPort};
use std::fs;

use super::super::GitCliPort;
use super::support::{git_available, run_git_ok, setup_repo};

#[test]
fn merge_branch_accepts_canonical_remote_target_branch() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("merge-origin-target");
    let git = GitCliPort::new();

    run_git_ok(&repo.path, &["branch", "feature/merge-origin-target"]);
    run_git_ok(
        &repo.path,
        &[
            "update-ref",
            "refs/remotes/origin/main",
            &run_git_ok(&repo.path, &["rev-parse", "main"]),
        ],
    );

    git.switch_branch(&repo.path, "feature/merge-origin-target", false)
        .expect("feature branch should be selected");
    fs::write(repo.path.join("feature.txt"), "feature\n").expect("feature file should write");
    run_git_ok(&repo.path, &["add", "feature.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "feature commit"]);

    let result = git
        .merge_branch(
            &repo.path,
            GitMergeBranchRequest {
                source_branch: "feature/merge-origin-target".to_string(),
                target_branch: "origin/main".to_string(),
                source_working_directory: None,
                method: GitMergeMethod::MergeCommit,
                squash_commit_message: None,
            },
        )
        .expect("merge with canonical remote target should succeed");

    match result {
        GitMergeBranchResult::Merged { .. } | GitMergeBranchResult::UpToDate { .. } => {}
        other => panic!("expected merged/up-to-date result, got {other:?}"),
    }

    let current_branch = git
        .get_current_branch(&repo.path)
        .expect("current branch should resolve after merge");
    assert_eq!(current_branch.name.as_deref(), Some("main"));

    let feature_contents = fs::read_to_string(repo.path.join("feature.txt"))
        .expect("merged feature file should exist");
    assert_eq!(feature_contents, "feature\n");
}

#[test]
fn merge_branch_accepts_non_origin_remote_target_branch() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("merge-upstream-target");
    let git = GitCliPort::new();

    run_git_ok(&repo.path, &["branch", "release"]);
    run_git_ok(&repo.path, &["branch", "feature/merge-upstream-target"]);
    run_git_ok(
        &repo.path,
        &[
            "update-ref",
            "refs/remotes/upstream/release",
            &run_git_ok(&repo.path, &["rev-parse", "main"]),
        ],
    );

    git.switch_branch(&repo.path, "feature/merge-upstream-target", false)
        .expect("feature branch should be selected");
    fs::write(repo.path.join("feature.txt"), "feature\n").expect("feature file should write");
    run_git_ok(&repo.path, &["add", "feature.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "feature commit"]);

    let result = git
        .merge_branch(
            &repo.path,
            GitMergeBranchRequest {
                source_branch: "feature/merge-upstream-target".to_string(),
                target_branch: "upstream/release".to_string(),
                source_working_directory: None,
                method: GitMergeMethod::MergeCommit,
                squash_commit_message: None,
            },
        )
        .expect("merge with non-origin remote target should succeed");

    match result {
        GitMergeBranchResult::Merged { .. } | GitMergeBranchResult::UpToDate { .. } => {}
        other => panic!("expected merged/up-to-date result, got {other:?}"),
    }

    let current_branch = git
        .get_current_branch(&repo.path)
        .expect("current branch should resolve after merge");
    assert_eq!(current_branch.name.as_deref(), Some("release"));

    let feature_contents = fs::read_to_string(repo.path.join("feature.txt"))
        .expect("merged feature file should exist");
    assert_eq!(feature_contents, "feature\n");
}

#[test]
fn rebase_merge_succeeds_when_source_branch_is_checked_out_in_linked_worktree() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("merge-rebase-worktree");
    let git = GitCliPort::new();
    let worktree_root = super::support::TempPath::new("merge-rebase-worktree-linked");
    let worktree_dir = worktree_root.path.join("feature-rebase-worktree");

    run_git_ok(
        &repo.path,
        &[
            "worktree",
            "add",
            "-b",
            "feature/rebase-worktree",
            worktree_dir
                .to_str()
                .expect("worktree path should be valid utf-8"),
            "main",
        ],
    );
    run_git_ok(
        &repo.path,
        &[
            "update-ref",
            "refs/remotes/origin/main",
            &run_git_ok(&repo.path, &["rev-parse", "main"]),
        ],
    );

    fs::write(worktree_dir.join("feature.txt"), "feature\n").expect("feature file should write");
    run_git_ok(&worktree_dir, &["add", "feature.txt"]);
    run_git_ok(&worktree_dir, &["commit", "-m", "feature commit"]);

    let result = git
        .merge_branch(
            &repo.path,
            GitMergeBranchRequest {
                source_branch: "feature/rebase-worktree".to_string(),
                target_branch: "origin/main".to_string(),
                source_working_directory: Some(
                    worktree_dir
                        .to_str()
                        .expect("worktree path should be valid utf-8")
                        .to_string(),
                ),
                method: GitMergeMethod::Rebase,
                squash_commit_message: None,
            },
        )
        .expect(
            "rebase merge should succeed when source branch is checked out in a linked worktree",
        );

    match result {
        GitMergeBranchResult::Merged { .. } | GitMergeBranchResult::UpToDate { .. } => {}
        other => panic!("expected merged/up-to-date result, got {other:?}"),
    }

    let current_branch = git
        .get_current_branch(&repo.path)
        .expect("current branch should resolve after merge");
    assert_eq!(current_branch.name.as_deref(), Some("main"));
    let feature_contents = fs::read_to_string(repo.path.join("feature.txt"))
        .expect("rebased feature file should exist");
    assert_eq!(feature_contents, "feature\n");
}

#[test]
fn squash_merge_uses_explicit_commit_message() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("merge-squash-message");
    let git = GitCliPort::new();

    run_git_ok(&repo.path, &["branch", "feature/squash-message"]);
    git.switch_branch(&repo.path, "feature/squash-message", false)
        .expect("feature branch should be selected");
    fs::write(repo.path.join("feature.txt"), "feature\n").expect("feature file should write");
    run_git_ok(&repo.path, &["add", "feature.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "feat: add login"]);

    let result = git
        .merge_branch(
            &repo.path,
            GitMergeBranchRequest {
                source_branch: "feature/squash-message".to_string(),
                target_branch: "main".to_string(),
                source_working_directory: None,
                method: GitMergeMethod::Squash,
                squash_commit_message: Some("feat: add login".to_string()),
            },
        )
        .expect("squash merge should succeed");

    match result {
        GitMergeBranchResult::Merged { .. } | GitMergeBranchResult::UpToDate { .. } => {}
        other => panic!("expected merged/up-to-date result, got {other:?}"),
    }

    let commit_subject = run_git_ok(&repo.path, &["log", "-1", "--format=%s"]);
    assert_eq!(commit_subject.trim(), "feat: add login");
}

#[test]
fn squash_merge_requires_a_commit_message_when_it_creates_a_commit() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("merge-squash-message-required");
    let git = GitCliPort::new();

    run_git_ok(&repo.path, &["branch", "feature/squash-message-required"]);
    git.switch_branch(&repo.path, "feature/squash-message-required", false)
        .expect("feature branch should be selected");
    fs::write(repo.path.join("feature.txt"), "feature\n").expect("feature file should write");
    run_git_ok(&repo.path, &["add", "feature.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "feat: add login"]);

    let error = git
        .merge_branch(
            &repo.path,
            GitMergeBranchRequest {
                source_branch: "feature/squash-message-required".to_string(),
                target_branch: "main".to_string(),
                source_working_directory: None,
                method: GitMergeMethod::Squash,
                squash_commit_message: None,
            },
        )
        .expect_err("squash merge without a commit message should fail");

    assert!(error.to_string().contains("squash commit message"));
}

#[test]
fn suggested_squash_commit_message_uses_oldest_unique_commit_message() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("merge-suggested-squash-message");
    let git = GitCliPort::new();

    run_git_ok(&repo.path, &["branch", "feature/suggested-squash-message"]);
    git.switch_branch(&repo.path, "feature/suggested-squash-message", false)
        .expect("feature branch should be selected");

    fs::write(repo.path.join("feature-a.txt"), "first\n").expect("first feature file should write");
    run_git_ok(&repo.path, &["add", "feature-a.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "feat: first builder commit"]);

    fs::write(repo.path.join("feature-b.txt"), "second\n")
        .expect("second feature file should write");
    run_git_ok(&repo.path, &["add", "feature-b.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "fix: latest builder commit"]);

    let suggested = git
        .suggested_squash_commit_message(&repo.path, "feature/suggested-squash-message", "main")
        .expect("suggested squash commit message should resolve");

    assert_eq!(suggested.as_deref(), Some("feat: first builder commit"));
}
