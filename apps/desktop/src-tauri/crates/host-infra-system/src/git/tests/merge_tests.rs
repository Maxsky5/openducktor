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
