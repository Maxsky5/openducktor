use host_domain::GitPort;

use super::super::GitCliPort;
use super::support::{git_available, run_git_ok, setup_bare_remote, setup_repo};
use std::fs;

#[test]
fn get_diff_returns_error_when_target_branch_is_invalid() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("diff-invalid-target");
    let git = GitCliPort::new();

    let error = git
        .get_diff(&repo.path, Some("refs/heads/does-not-exist"))
        .expect_err("invalid target branch should return error");
    let message = format!("{error:#}");
    assert!(
        message.contains("git diff --numstat"),
        "error should preserve actionable git command context, got: {message}"
    );
}

#[test]
fn commits_ahead_behind_reads_upstream_counts_when_tracking_is_configured() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("ahead-behind-upstream");
    let remote = setup_bare_remote("ahead-behind-upstream-remote");
    let remote_path = remote.path.to_string_lossy().to_string();
    run_git_ok(
        &repo.path,
        &["remote", "add", "origin", remote_path.as_str()],
    );
    run_git_ok(&repo.path, &["push", "-u", "origin", "main"]);

    let git = GitCliPort::new();
    git.switch_branch(&repo.path, "feature/upstream-ahead", true)
        .expect("feature branch should be created");

    fs::write(repo.path.join("upstream.txt"), "seed\n").expect("seed file should write");
    run_git_ok(&repo.path, &["add", "upstream.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "seed upstream branch"]);
    run_git_ok(
        &repo.path,
        &["push", "-u", "origin", "feature/upstream-ahead"],
    );

    fs::write(repo.path.join("upstream.txt"), "seed\nahead\n").expect("ahead file should write");
    run_git_ok(&repo.path, &["add", "upstream.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "ahead of upstream"]);

    let counts = git
        .commits_ahead_behind(&repo.path, "@{upstream}")
        .expect("upstream ahead/behind should resolve");
    assert_eq!(counts.ahead, 1);
    assert_eq!(counts.behind, 0);
}

#[test]
fn commits_ahead_behind_returns_error_when_upstream_is_missing() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("ahead-behind-no-upstream");
    let git = GitCliPort::new();

    let error = git
        .commits_ahead_behind(&repo.path, "@{upstream}")
        .expect_err("missing upstream should return an error");
    let message = format!("{error:#}");
    assert!(
        message.contains("git rev-list --count --left-right"),
        "error message should include upstream/rev-list context, got: {message}"
    );
}

#[test]
fn get_diff_rejects_option_like_target_and_does_not_write_output_file() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("diff-option-like-target");
    let git = GitCliPort::new();
    let output_path = repo.path.join("injected.diff");
    let option_like_target = format!("--output={}", output_path.to_string_lossy());

    let error = git
        .get_diff(&repo.path, Some(option_like_target.as_str()))
        .expect_err("option-like target must not be interpreted as git diff option");
    let message = format!("{error:#}");
    assert!(
        message.contains("git diff --numstat"),
        "error should retain actionable diff context, got: {message}"
    );
    assert!(
        !output_path.exists(),
        "option-like target must not create an output file"
    );
}
