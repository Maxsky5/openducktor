use host_domain::GitPort;
use host_domain::{GitPullRequest, GitPullResult};
use std::fs;

use super::super::GitCliPort;
use super::support::{git_available, run_git_ok, setup_bare_remote, setup_repo, TempPath};

#[test]
fn push_branch_pushes_to_remote_with_summary() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("push");
    let remote = setup_bare_remote("push-remote");
    let remote_path = remote.path.to_string_lossy().to_string();
    run_git_ok(
        &repo.path,
        &["remote", "add", "origin", remote_path.as_str()],
    );
    let git = GitCliPort::new();

    git.switch_branch(&repo.path, "feature/push", true)
        .expect("feature branch should be created");
    fs::write(repo.path.join("push.txt"), "push data\n").expect("push file should write");
    run_git_ok(&repo.path, &["add", "push.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "push commit"]);

    let summary = git
        .push_branch(&repo.path, "origin", "feature/push", true, false)
        .expect("push should succeed");
    assert_eq!(summary.remote, "origin");
    assert_eq!(summary.branch, "feature/push");

    let ls_remote = run_git_ok(
        &repo.path,
        &["ls-remote", "--heads", "origin", "feature/push"],
    );
    assert!(
        ls_remote.contains("refs/heads/feature/push"),
        "remote should contain pushed branch"
    );
}

#[test]
fn push_branch_rejects_option_like_remote_input() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("push-option-like-remote");
    let git = GitCliPort::new();

    let error = git
        .push_branch(&repo.path, "--help", "main", false, false)
        .expect_err("option-like remote must not be interpreted as git push option");
    let message = format!("{error:#}");
    assert!(
        message.contains("git push failed"),
        "error should retain actionable push context, got: {message}"
    );
}

#[test]
fn pull_branch_pulls_new_upstream_commits() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("pull");
    let remote = setup_bare_remote("pull-remote");
    let remote_path = remote.path.to_string_lossy().to_string();
    run_git_ok(
        &repo.path,
        &["remote", "add", "origin", remote_path.as_str()],
    );
    run_git_ok(&repo.path, &["push", "-u", "origin", "main"]);

    let clone_root = TempPath::new("pull-clone");
    let clone_repo = clone_root.path.join("repo");
    run_git_ok(
        &clone_root.path,
        &[
            "clone",
            remote_path.as_str(),
            clone_repo.to_string_lossy().as_ref(),
        ],
    );
    run_git_ok(
        &clone_repo,
        &["config", "user.email", "tests@openducktor.local"],
    );
    run_git_ok(&clone_repo, &["config", "user.name", "OpenDucktor Tests"]);
    fs::write(clone_repo.join("upstream.txt"), "upstream\n").expect("upstream file should write");
    run_git_ok(&clone_repo, &["add", "upstream.txt"]);
    run_git_ok(&clone_repo, &["commit", "-m", "upstream update"]);
    run_git_ok(&clone_repo, &["push", "origin", "main"]);

    let git = GitCliPort::new();
    let result = git
        .pull_branch(&repo.path, GitPullRequest { working_dir: None })
        .expect("pull should succeed");
    assert!(matches!(result, GitPullResult::Pulled { .. }));

    let pulled_file = repo.path.join("upstream.txt");
    assert!(
        pulled_file.exists(),
        "pulled commit should update local working tree"
    );
}

#[test]
fn pull_branch_returns_up_to_date_when_no_upstream_commits_exist() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("pull-up-to-date");
    let remote = setup_bare_remote("pull-up-to-date-remote");
    let remote_path = remote.path.to_string_lossy().to_string();
    run_git_ok(
        &repo.path,
        &["remote", "add", "origin", remote_path.as_str()],
    );
    run_git_ok(&repo.path, &["push", "-u", "origin", "main"]);

    let git = GitCliPort::new();
    let result = git
        .pull_branch(&repo.path, GitPullRequest { working_dir: None })
        .expect("pull should report up-to-date when upstream has no new commits");

    match result {
        GitPullResult::UpToDate { output } => {
            assert!(
                !output.trim().is_empty(),
                "up-to-date pull should provide actionable output"
            );
        }
        GitPullResult::Pulled { .. } => {
            panic!("expected up-to-date outcome when upstream has no new commits");
        }
        GitPullResult::Conflicts { .. } => {
            panic!("expected up-to-date outcome when upstream has no new commits");
        }
    }
}

#[test]
fn pull_branch_rebases_when_local_and_upstream_have_new_commits() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("pull-diverged");
    let remote = setup_bare_remote("pull-diverged-remote");
    let remote_path = remote.path.to_string_lossy().to_string();
    run_git_ok(
        &repo.path,
        &["remote", "add", "origin", remote_path.as_str()],
    );
    run_git_ok(&repo.path, &["push", "-u", "origin", "main"]);

    fs::write(repo.path.join("local.txt"), "local\n").expect("local file should write");
    run_git_ok(&repo.path, &["add", "local.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "local change"]);

    let clone_root = TempPath::new("pull-diverged-clone");
    let clone_repo = clone_root.path.join("repo");
    run_git_ok(
        &clone_root.path,
        &[
            "clone",
            remote_path.as_str(),
            clone_repo.to_string_lossy().as_ref(),
        ],
    );
    run_git_ok(
        &clone_repo,
        &["config", "user.email", "tests@openducktor.local"],
    );
    run_git_ok(&clone_repo, &["config", "user.name", "OpenDucktor Tests"]);
    fs::write(clone_repo.join("upstream.txt"), "upstream\n").expect("upstream file should write");
    run_git_ok(&clone_repo, &["add", "upstream.txt"]);
    run_git_ok(&clone_repo, &["commit", "-m", "upstream change"]);
    run_git_ok(&clone_repo, &["push", "origin", "main"]);

    let git = GitCliPort::new();
    let result = git
        .pull_branch(&repo.path, GitPullRequest { working_dir: None })
        .expect("diverged pull should succeed");
    assert!(matches!(result, GitPullResult::Pulled { .. }));

    let latest_subject = run_git_ok(&repo.path, &["log", "-1", "--pretty=%s"]);
    assert_eq!(latest_subject, "local change");

    let head_with_parents = run_git_ok(&repo.path, &["rev-list", "--parents", "-n", "1", "HEAD"]);
    let parent_count = head_with_parents.split_whitespace().count();
    assert_eq!(
        parent_count, 2,
        "rebase pull should keep linear history instead of creating merge commit"
    );

    let pulled_file = repo.path.join("upstream.txt");
    assert!(
        pulled_file.exists(),
        "rebased pull should include upstream commit changes"
    );
}

#[test]
fn pull_branch_returns_conflicts_when_rebase_encounters_conflicts() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("pull-diverged-conflicts");
    let remote = setup_bare_remote("pull-diverged-conflicts-remote");
    let remote_path = remote.path.to_string_lossy().to_string();
    run_git_ok(
        &repo.path,
        &["remote", "add", "origin", remote_path.as_str()],
    );
    run_git_ok(&repo.path, &["push", "-u", "origin", "main"]);

    fs::write(repo.path.join("conflict.txt"), "local\n").expect("local conflict file should write");
    run_git_ok(&repo.path, &["add", "conflict.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "local conflict change"]);

    let clone_root = TempPath::new("pull-diverged-conflicts-clone");
    let clone_repo = clone_root.path.join("repo");
    run_git_ok(
        &clone_root.path,
        &[
            "clone",
            remote_path.as_str(),
            clone_repo.to_string_lossy().as_ref(),
        ],
    );
    run_git_ok(
        &clone_repo,
        &["config", "user.email", "tests@openducktor.local"],
    );
    run_git_ok(&clone_repo, &["config", "user.name", "OpenDucktor Tests"]);
    fs::write(clone_repo.join("conflict.txt"), "upstream\n")
        .expect("upstream conflict file should write");
    run_git_ok(&clone_repo, &["add", "conflict.txt"]);
    run_git_ok(&clone_repo, &["commit", "-m", "upstream conflict change"]);
    run_git_ok(&clone_repo, &["push", "origin", "main"]);

    let git = GitCliPort::new();
    let result = git
        .pull_branch(&repo.path, GitPullRequest { working_dir: None })
        .expect("diverged pull with conflicts should return typed conflict result");

    match result {
        GitPullResult::Conflicts {
            conflicted_files,
            output,
        } => {
            assert!(
                conflicted_files.iter().any(|path| path == "conflict.txt"),
                "conflict list should include conflict.txt"
            );
            assert!(
                !output.trim().is_empty(),
                "conflict outcome should include actionable output"
            );
        }
        GitPullResult::Pulled { .. } | GitPullResult::UpToDate { .. } => {
            panic!("expected pull conflicts outcome for diverged conflicting histories");
        }
    }
}

#[test]
fn resolve_upstream_target_returns_none_when_not_configured() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("resolve-upstream-none");
    let git = GitCliPort::new();

    let upstream = git
        .resolve_upstream_target(&repo.path)
        .expect("upstream resolution should not fail");
    assert!(upstream.is_none());
}

#[test]
fn resolve_upstream_target_returns_tracking_ref_when_available() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("resolve-upstream-tracking");
    let remote = setup_bare_remote("resolve-upstream-tracking-remote");
    let remote_path = remote.path.to_string_lossy().to_string();
    run_git_ok(
        &repo.path,
        &["remote", "add", "origin", remote_path.as_str()],
    );
    run_git_ok(&repo.path, &["push", "-u", "origin", "main"]);

    let git = GitCliPort::new();
    git.switch_branch(&repo.path, "feature/upstream-track", true)
        .expect("feature branch should be created");

    fs::write(repo.path.join("track.txt"), "track\n").expect("track file should write");
    run_git_ok(&repo.path, &["add", "track.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "track upstream"]);
    run_git_ok(
        &repo.path,
        &["push", "-u", "origin", "feature/upstream-track"],
    );

    let upstream = git
        .resolve_upstream_target(&repo.path)
        .expect("upstream resolution should succeed");
    assert_eq!(
        upstream,
        Some("refs/remotes/origin/feature/upstream-track".to_string())
    );
}

#[test]
fn resolve_upstream_target_returns_none_when_remote_ref_is_deleted() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("resolve-upstream-deleted");
    let remote = setup_bare_remote("resolve-upstream-deleted-remote");
    let remote_path = remote.path.to_string_lossy().to_string();
    run_git_ok(
        &repo.path,
        &["remote", "add", "origin", remote_path.as_str()],
    );
    run_git_ok(&repo.path, &["push", "-u", "origin", "main"]);

    let git = GitCliPort::new();
    git.switch_branch(&repo.path, "feature/upstream-deleted", true)
        .expect("feature branch should be created");

    fs::write(repo.path.join("deleted.txt"), "deleted\n").expect("deleted file should write");
    run_git_ok(&repo.path, &["add", "deleted.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "upstream deleted setup"]);
    run_git_ok(
        &repo.path,
        &["push", "-u", "origin", "feature/upstream-deleted"],
    );
    run_git_ok(
        &repo.path,
        &["push", "origin", "--delete", "feature/upstream-deleted"],
    );
    run_git_ok(&repo.path, &["fetch", "--prune", "origin"]);

    let upstream = git
        .resolve_upstream_target(&repo.path)
        .expect("upstream resolution should succeed");
    assert!(upstream.is_none());
}
