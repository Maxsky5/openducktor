use host_domain::GitPort;
use host_domain::{GitPullRequest, GitPullResult, GitPushResult};
use std::fs;

use super::super::GitCliPort;
use super::support::{git_available, run_git_ok, setup_bare_remote, setup_repo, TempPath};

#[test]
fn push_branch_pushes_to_remote_with_typed_result() {
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

    let result = git
        .push_branch(&repo.path, "origin", "feature/push", true, false)
        .expect("push should succeed");
    match result {
        GitPushResult::Pushed {
            remote,
            branch,
            output,
        } => {
            assert_eq!(remote, "origin");
            assert_eq!(branch, "feature/push");
            assert!(
                !output.trim().is_empty(),
                "successful push should include actionable output"
            );
        }
        other => panic!("expected pushed result, got {other:?}"),
    }

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
fn push_branch_returns_non_fast_forward_rejection() {
    if !git_available() {
        return;
    }

    let remote = setup_bare_remote("push-non-fast-forward-remote");
    let remote_path = remote.path.to_string_lossy().to_string();

    let source = setup_repo("push-non-fast-forward-source");
    run_git_ok(
        &source.path,
        &["remote", "add", "origin", remote_path.as_str()],
    );
    run_git_ok(&source.path, &["push", "-u", "origin", "main"]);

    let clone_root = TempPath::new("push-non-fast-forward-clone");
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

    fs::write(source.path.join("source.txt"), "source\n").expect("source file should write");
    run_git_ok(&source.path, &["add", "source.txt"]);
    run_git_ok(&source.path, &["commit", "-m", "source change"]);
    run_git_ok(&source.path, &["push", "origin", "main"]);

    fs::write(clone_repo.join("clone.txt"), "clone\n").expect("clone file should write");
    run_git_ok(&clone_repo, &["add", "clone.txt"]);
    run_git_ok(&clone_repo, &["commit", "-m", "clone change"]);

    let git = GitCliPort::new();
    let result = git
        .push_branch(&clone_repo, "origin", "main", false, false)
        .expect("non-fast-forward push should return typed rejection");

    match result {
        GitPushResult::RejectedNonFastForward {
            remote,
            branch,
            output,
        } => {
            assert_eq!(remote, "origin");
            assert_eq!(branch, "main");
            assert!(
                output.contains("non-fast-forward"),
                "rejection should keep actionable git output"
            );
        }
        other => panic!("expected non-fast-forward rejection, got {other:?}"),
    }
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
fn pull_branch_preserves_multiple_local_commits_when_rebasing_diverged_history() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("pull-diverged-multiple-local");
    let remote = setup_bare_remote("pull-diverged-multiple-local-remote");
    let remote_path = remote.path.to_string_lossy().to_string();
    run_git_ok(
        &repo.path,
        &["remote", "add", "origin", remote_path.as_str()],
    );
    run_git_ok(&repo.path, &["push", "-u", "origin", "main"]);

    fs::write(repo.path.join("local-one.txt"), "local one\n").expect("local-one file should write");
    run_git_ok(&repo.path, &["add", "local-one.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "local change 1"]);

    fs::write(repo.path.join("local-two.txt"), "local two\n").expect("local-two file should write");
    run_git_ok(&repo.path, &["add", "local-two.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "local change 2"]);

    let clone_root = TempPath::new("pull-diverged-multiple-local-clone");
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
        .expect("diverged pull with multiple local commits should succeed");
    assert!(matches!(result, GitPullResult::Pulled { .. }));

    let head_subjects = run_git_ok(&repo.path, &["log", "--pretty=%s", "-n", "3"]);
    let subject_lines = head_subjects.lines().collect::<Vec<_>>();
    assert_eq!(
        subject_lines.as_slice(),
        ["local change 2", "local change 1", "upstream change"],
        "pull --rebase should preserve both local commits above the fetched upstream change"
    );

    let head_with_parents = run_git_ok(&repo.path, &["rev-list", "--parents", "-n", "1", "HEAD"]);
    let parent_count = head_with_parents.split_whitespace().count();
    assert_eq!(
        parent_count, 2,
        "rebased pull should keep linear history instead of creating merge commit"
    );

    assert!(
        repo.path.join("local-one.txt").exists(),
        "first local commit should remain in the worktree after rebase pull"
    );
    assert!(
        repo.path.join("local-two.txt").exists(),
        "second local commit should remain in the worktree after rebase pull"
    );
    assert!(
        repo.path.join("upstream.txt").exists(),
        "upstream commit should remain in the worktree after rebase pull"
    );
}

#[test]
fn pull_branch_preserves_local_commits_after_upstream_force_push() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("pull-force-pushed-upstream");
    let remote = setup_bare_remote("pull-force-pushed-upstream-remote");
    let remote_path = remote.path.to_string_lossy().to_string();
    run_git_ok(
        &repo.path,
        &["remote", "add", "origin", remote_path.as_str()],
    );

    let git = GitCliPort::new();
    git.switch_branch(&repo.path, "feature/force-push-rebase", true)
        .expect("feature branch should be created");
    run_git_ok(
        &repo.path,
        &["push", "-u", "origin", "feature/force-push-rebase"],
    );

    fs::write(repo.path.join("local-meta.txt"), "local-meta\n")
        .expect("local metadata file should write");
    run_git_ok(&repo.path, &["add", "local-meta.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "local metadata"]);

    fs::write(repo.path.join("feature-work.txt"), "builder work\n")
        .expect("builder work file should write");
    run_git_ok(&repo.path, &["add", "feature-work.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "builder work"]);
    run_git_ok(&repo.path, &["push", "origin", "feature/force-push-rebase"]);

    let clone_root = TempPath::new("pull-force-pushed-upstream-clone");
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
    run_git_ok(&clone_repo, &["switch", "feature/force-push-rebase"]);
    run_git_ok(&clone_repo, &["reset", "--hard", "HEAD~2"]);
    fs::write(clone_repo.join("agents.md"), "other-clone-agents\n")
        .expect("other clone agents file should write");
    run_git_ok(&clone_repo, &["add", "agents.md"]);
    run_git_ok(&clone_repo, &["commit", "-m", "other clone metadata"]);
    run_git_ok(
        &clone_repo,
        &[
            "push",
            "--force-with-lease",
            "origin",
            "feature/force-push-rebase",
        ],
    );

    let result = git
        .pull_branch(&repo.path, GitPullRequest { working_dir: None })
        .expect("pull should preserve local commits after upstream force push");
    assert!(matches!(result, GitPullResult::Pulled { .. }));

    let head_subjects = run_git_ok(&repo.path, &["log", "--pretty=%s", "-n", "3"]);
    let subject_lines = head_subjects.lines().collect::<Vec<_>>();
    assert_eq!(
        subject_lines.as_slice(),
        ["builder work", "local metadata", "other clone metadata"],
        "force-pushed upstream should not cause rebase pull to drop local commits"
    );

    assert!(
        repo.path.join("feature-work.txt").exists(),
        "builder work file should still exist after pull"
    );
    assert!(
        repo.path.join("local-meta.txt").exists(),
        "local metadata file should still exist after pull"
    );

    let head_with_parents = run_git_ok(&repo.path, &["rev-list", "--parents", "-n", "1", "HEAD"]);
    let parent_count = head_with_parents.split_whitespace().count();
    assert_eq!(
        parent_count, 2,
        "force-pushed upstream pull should still keep linear history"
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
