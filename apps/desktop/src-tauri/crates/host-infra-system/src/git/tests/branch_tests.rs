use host_domain::GitPort;
use std::fs;

use super::super::GitCliPort;
use super::support::{git_available, run_git_ok, setup_bare_remote, setup_repo};

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
fn switch_branch_rejects_option_like_input() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("switch-option-like");
    let git = GitCliPort::new();

    let error = git
        .switch_branch(&repo.path, "--help", false)
        .expect_err("option-like input must not be interpreted as git switch options");
    let message = format!("{error:#}");
    assert!(
        message.contains("git switch"),
        "error should retain actionable switch context, got: {message}"
    );

    let current = git
        .get_current_branch(&repo.path)
        .expect("current branch should remain available");
    assert_eq!(current.name.as_deref(), Some("main"));
}
