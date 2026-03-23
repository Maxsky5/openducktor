use host_domain::{GitDiffScope, GitPort, GitUpstreamAheadBehind};

use super::super::GitCliPort;
use super::support::{git_available, run_git_ok, setup_bare_remote, setup_repo};
use std::fs;
use std::path::Path;

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

#[test]
fn get_worktree_status_returns_tracking_counts_when_upstream_exists() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("worktree-status-tracking");
    let remote = setup_bare_remote("worktree-status-tracking-remote");
    let remote_path = remote.path.to_string_lossy().to_string();
    run_git_ok(
        &repo.path,
        &["remote", "add", "origin", remote_path.as_str()],
    );
    run_git_ok(&repo.path, &["push", "-u", "origin", "main"]);

    fs::write(repo.path.join("tracking.txt"), "ahead\n").expect("tracking file should write");
    run_git_ok(&repo.path, &["add", "tracking.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "ahead of origin"]);

    let git = GitCliPort::new();
    let status = git
        .get_worktree_status(&repo.path, "origin/main", GitDiffScope::Target)
        .expect("composite worktree status should resolve");

    assert_eq!(status.current_branch.name.as_deref(), Some("main"));
    assert_eq!(status.target_ahead_behind.ahead, 1);
    assert_eq!(status.target_ahead_behind.behind, 0);
    assert_eq!(
        status.upstream_ahead_behind,
        GitUpstreamAheadBehind::Tracking {
            ahead: 1,
            behind: 0,
        }
    );
}

#[test]
fn get_worktree_status_reports_untracked_when_upstream_is_missing() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("worktree-status-untracked");
    let git = GitCliPort::new();
    let status = git
        .get_worktree_status(&repo.path, "main", GitDiffScope::Target)
        .expect("composite worktree status should resolve");

    assert_eq!(
        status.upstream_ahead_behind,
        GitUpstreamAheadBehind::Untracked { ahead: 0 }
    );
}

#[test]
fn get_worktree_status_supports_upstream_target_without_tracking_branch() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("worktree-status-target-upstream-untracked");
    let git = GitCliPort::new();
    let status = git
        .get_worktree_status(&repo.path, "@{upstream}", GitDiffScope::Target)
        .expect("worktree status should resolve without an upstream branch");

    assert!(status.file_diffs.is_empty());
    assert_eq!(status.target_ahead_behind.ahead, 0);
    assert_eq!(status.target_ahead_behind.behind, 0);
    assert_eq!(
        status.upstream_ahead_behind,
        GitUpstreamAheadBehind::Untracked { ahead: 0 }
    );
}

#[test]
fn get_worktree_status_uses_existing_remote_branch_when_tracking_is_missing() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("worktree-status-origin-fallback");
    let remote = setup_bare_remote("worktree-status-origin-fallback-remote");
    let remote_path = remote.path.to_string_lossy().to_string();
    run_git_ok(
        &repo.path,
        &["remote", "add", "origin", remote_path.as_str()],
    );
    run_git_ok(&repo.path, &["push", "-u", "origin", "main"]);

    let git = GitCliPort::new();
    git.switch_branch(&repo.path, "feature/worktree-origin-fallback", true)
        .expect("feature branch should be created");

    fs::write(repo.path.join("worktree-origin-fallback.txt"), "seed\n")
        .expect("fallback file should write");
    run_git_ok(&repo.path, &["add", "worktree-origin-fallback.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "push branch without tracking"]);
    run_git_ok(
        &repo.path,
        &["push", "origin", "feature/worktree-origin-fallback"],
    );

    let status = git
        .get_worktree_status(&repo.path, "main", GitDiffScope::Target)
        .expect("fallback upstream worktree status should resolve");

    assert_eq!(
        status.upstream_ahead_behind,
        GitUpstreamAheadBehind::Tracking {
            ahead: 0,
            behind: 0,
        }
    );
}

#[test]
fn get_worktree_status_keeps_upstream_compare_empty_when_repo_is_dirty_and_untracked() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("worktree-status-target-upstream-dirty-untracked");
    fs::write(repo.path.join("README.md"), "# OpenDucktor\nlocal change\n")
        .expect("dirty file should write");

    let git = GitCliPort::new();
    let status = git
        .get_worktree_status(&repo.path, "@{upstream}", GitDiffScope::Target)
        .expect("worktree status should resolve without an upstream branch");

    assert!(
        !status.file_statuses.is_empty(),
        "dirty repository status should still be reported"
    );
    assert!(
        status.file_diffs.is_empty(),
        "upstream compare should stay empty instead of falling back to uncommitted diff"
    );
    assert_eq!(
        status.upstream_ahead_behind,
        GitUpstreamAheadBehind::Untracked { ahead: 0 }
    );
}

#[test]
fn get_worktree_status_requires_non_empty_target_branch() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("worktree-status-empty-target");
    let git = GitCliPort::new();
    let error = git
        .get_worktree_status(&repo.path, "   ", GitDiffScope::Target)
        .expect_err("empty target branch should return error");
    let message = format!("{error:#}");
    assert!(
        message.contains("target branch"),
        "error should preserve target branch context, got: {message}"
    );
}

#[test]
fn get_worktree_status_honors_diff_scope_uncommitted_vs_target() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("worktree-status-diff-scope");
    run_git_ok(&repo.path, &["switch", "-c", "feature/diff-scope"]);

    fs::write(repo.path.join("committed_only.txt"), "committed\n")
        .expect("committed file should write");
    run_git_ok(&repo.path, &["add", "committed_only.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "add committed-only file"]);

    fs::write(
        repo.path.join("README.md"),
        "# OpenDucktor\ntracked-uncommitted-change\n",
    )
    .expect("tracked uncommitted file should write");
    fs::write(repo.path.join("untracked_only.txt"), "new file\n")
        .expect("untracked file should write");
    fs::create_dir_all(repo.path.join("dir")).expect("untracked directory should write");
    fs::write(repo.path.join("dir/nested.txt"), "nested file\n")
        .expect("nested untracked file should write");

    let git = GitCliPort::new();
    let target_scope = git
        .get_worktree_status(&repo.path, "main", GitDiffScope::Target)
        .expect("target scope should resolve");
    let uncommitted_scope = git
        .get_worktree_status(&repo.path, "main", GitDiffScope::Uncommitted)
        .expect("uncommitted scope should resolve");

    assert!(
        target_scope
            .file_diffs
            .iter()
            .any(|diff| diff.file == "committed_only.txt"),
        "target scope should include committed changes against main"
    );
    assert!(
        target_scope
            .file_diffs
            .iter()
            .any(|diff| diff.file == "README.md"),
        "target scope should include tracked uncommitted working tree changes"
    );
    assert!(
        target_scope.file_diffs.iter().any(|diff| {
            diff.file == "untracked_only.txt"
                && diff.diff_type == "added"
                && diff.additions == 1
                && diff.deletions == 0
        }),
        "target scope should include untracked working tree files"
    );
    assert!(
        target_scope.file_diffs.iter().any(|diff| {
            diff.file == "dir/nested.txt"
                && diff.diff_type == "added"
                && diff.additions == 1
                && diff.deletions == 0
        }),
        "target scope should expand untracked directories into file diffs"
    );
    assert!(
        uncommitted_scope
            .file_diffs
            .iter()
            .any(|diff| diff.file == "README.md"),
        "uncommitted scope should include tracked working tree changes"
    );
    assert!(
        uncommitted_scope.file_diffs.iter().any(|diff| {
            diff.file == "untracked_only.txt"
                && diff.diff_type == "added"
                && diff.additions == 1
                && diff.deletions == 0
                && diff.diff.contains("+++ b/untracked_only.txt")
        }),
        "uncommitted scope should include untracked file diffs"
    );
    assert!(
        uncommitted_scope.file_diffs.iter().any(|diff| {
            diff.file == "dir/nested.txt"
                && diff.diff_type == "added"
                && diff.additions == 1
                && diff.deletions == 0
                && diff.diff.contains("+++ b/dir/nested.txt")
        }),
        "uncommitted scope should expand untracked directories into file diffs"
    );
    assert!(
        !uncommitted_scope
            .file_diffs
            .iter()
            .any(|diff| diff.file == "committed_only.txt"),
        "uncommitted scope should exclude already committed feature-only changes"
    );
    assert!(
        uncommitted_scope
            .file_statuses
            .iter()
            .any(|status| status.path == "dir/nested.txt" && status.status == "untracked"),
        "status output should report untracked files individually"
    );
    assert!(
        !uncommitted_scope
            .file_statuses
            .iter()
            .any(|status| status.path == "dir/"),
        "status output should not collapse untracked directories"
    );
}

#[test]
fn get_worktree_status_target_scope_uses_branch_point_when_branch_is_ahead_and_behind() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("worktree-status-branch-point");
    run_git_ok(&repo.path, &["switch", "-c", "feature/branch-point"]);

    fs::write(repo.path.join("feature_only.txt"), "feature change\n")
        .expect("feature file should write");
    run_git_ok(&repo.path, &["add", "feature_only.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "feature commit"]);

    run_git_ok(&repo.path, &["switch", "main"]);
    fs::write(repo.path.join("main_only.txt"), "main change\n").expect("main file should write");
    run_git_ok(&repo.path, &["add", "main_only.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "main commit"]);

    run_git_ok(&repo.path, &["switch", "feature/branch-point"]);
    fs::write(
        repo.path.join("README.md"),
        "# OpenDucktor\nbranch point dirty change\n",
    )
    .expect("dirty file should write");

    let git = GitCliPort::new();
    let status = git
        .get_worktree_status(&repo.path, "main", GitDiffScope::Target)
        .expect("target scope should resolve from branch point");

    assert_eq!(status.target_ahead_behind.ahead, 1);
    assert_eq!(status.target_ahead_behind.behind, 1);
    assert!(
        status
            .file_diffs
            .iter()
            .any(|diff| diff.file == "feature_only.txt"),
        "target scope should include feature commits after the merge base"
    );
    assert!(
        status
            .file_diffs
            .iter()
            .any(|diff| diff.file == "README.md"),
        "target scope should keep uncommitted worktree changes on top of branch changes"
    );
    assert!(
        !status
            .file_diffs
            .iter()
            .any(|diff| diff.file == "main_only.txt"),
        "target scope should exclude target-only commits after the merge base"
    );
}

#[test]
fn get_worktree_status_target_scope_uses_empty_tree_when_histories_are_unrelated() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("worktree-status-unrelated-histories");
    run_git_ok(&repo.path, &["switch", "--orphan", "feature/unrelated"]);
    run_git_ok(&repo.path, &["rm", "-rf", "--ignore-unmatch", "."]);

    fs::write(repo.path.join("orphan.txt"), "orphan branch\n").expect("orphan file should write");
    run_git_ok(&repo.path, &["add", "orphan.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "orphan root"]);

    let git = GitCliPort::new();
    let status = git
        .get_worktree_status(&repo.path, "main", GitDiffScope::Target)
        .expect("target scope should resolve for unrelated histories");

    assert!(
        status.file_diffs.iter().any(|diff| {
            diff.file == "orphan.txt"
                && diff.diff_type == "added"
                && diff.additions == 1
                && diff.deletions == 0
        }),
        "target scope should diff against the empty tree when there is no merge base"
    );
}

#[test]
fn get_worktree_status_surfaces_non_fatal_upstream_count_error() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("worktree-status-upstream-error");
    let remote = setup_bare_remote("worktree-status-upstream-error-remote");
    let remote_path = remote.path.to_string_lossy().to_string();
    run_git_ok(
        &repo.path,
        &["remote", "add", "origin", remote_path.as_str()],
    );
    run_git_ok(&repo.path, &["push", "-u", "origin", "main"]);

    let git_dir = run_git_ok(&repo.path, &["rev-parse", "--git-dir"]);
    let git_dir_path = Path::new(git_dir.as_str());
    let git_dir_abs = if git_dir_path.is_absolute() {
        git_dir_path.to_path_buf()
    } else {
        repo.path.join(git_dir_path)
    };
    let broken_upstream_ref = git_dir_abs.join("refs/remotes/origin/main");
    if let Some(parent) = broken_upstream_ref.parent() {
        fs::create_dir_all(parent).expect("upstream ref parent directory should exist");
    }

    let blob_oid = run_git_ok(&repo.path, &["hash-object", "-w", "README.md"]);
    fs::write(&broken_upstream_ref, format!("{blob_oid}\n"))
        .expect("upstream ref should be overwritten with blob oid");

    let git = GitCliPort::new();
    let status = git
        .get_worktree_status(&repo.path, "main", GitDiffScope::Target)
        .expect("worktree status should stay non-fatal when upstream count fails");

    match status.upstream_ahead_behind {
        GitUpstreamAheadBehind::Error { message } => {
            assert!(
                message.contains("git rev-list --count --left-right"),
                "upstream count error should preserve actionable command context, got: {message}"
            );
        }
        other => panic!("expected upstream error outcome, got: {other:?}"),
    }
}
