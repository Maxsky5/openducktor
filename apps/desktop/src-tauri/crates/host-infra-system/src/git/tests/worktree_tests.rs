use host_domain::GitPort;
use std::fs;

use super::super::GitCliPort;
use super::support::{git_available, run_git_ok, setup_repo, TempPath};

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
fn create_worktree_rejects_option_like_branch_input() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("worktree-option-like-branch");
    let git = GitCliPort::new();
    let worktree = TempPath::new("worktree-option-like-branch-target");

    let error = git
        .create_worktree(&repo.path, &worktree.path, "--detach", false)
        .expect_err("option-like branch must not be interpreted as worktree option");
    let message = format!("{error:#}");
    assert!(
        message.contains("git worktree add"),
        "error should retain actionable worktree context, got: {message}"
    );
    assert!(
        !worktree.path.join(".git").exists(),
        "option-like branch must not create a worktree"
    );
}
