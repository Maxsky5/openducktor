use host_domain::GitPort;
use host_domain::{
    GitCommitAllRequest, GitCommitAllResult, GitRebaseBranchRequest, GitRebaseBranchResult,
};
use std::fs;

use super::super::GitCliPort;
use super::support::{git_available, run_git_ok, setup_repo};

#[test]
fn commit_all_commits_all_changes_with_message() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("commit-all-success");
    let git = GitCliPort::new();

    fs::write(repo.path.join("change.txt"), "change\n").expect("change file should write");
    let result = git
        .commit_all(
            &repo.path,
            GitCommitAllRequest {
                working_dir: None,
                message: "add change file".to_string(),
            },
        )
        .expect("commit-all should succeed");

    let latest = match result {
        GitCommitAllResult::Committed {
            commit_hash,
            output,
        } => {
            assert!(!commit_hash.is_empty());
            assert!(!output.is_empty());
            commit_hash
        }
        other => panic!("expected committed result, got {other:?}"),
    };

    let repo_head = run_git_ok(&repo.path, &["rev-parse", "HEAD"]);
    assert_eq!(latest, repo_head);
    assert!(git
        .get_status(&repo.path)
        .expect("status should check out")
        .is_empty());
}

#[test]
fn commit_all_returns_no_changes_without_modifications() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("commit-all-no-changes");
    let git = GitCliPort::new();

    let result = git
        .commit_all(
            &repo.path,
            GitCommitAllRequest {
                working_dir: None,
                message: "nothing new".to_string(),
            },
        )
        .expect("empty working tree should return typed no-changes result");

    match result {
        GitCommitAllResult::NoChanges { output } => {
            assert!(output.contains("No staged changes"));
        }
        other => panic!("expected no-changes result, got {other:?}"),
    }
}

#[test]
fn rebase_branch_rewrites_branch_onto_target() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("rebase-success");
    let git = GitCliPort::new();

    git.switch_branch(&repo.path, "feature/rebase-success", true)
        .expect("feature branch should be created");
    fs::write(repo.path.join("feature.txt"), "feature\n").expect("feature file should write");
    run_git_ok(&repo.path, &["add", "feature.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "feature commit"]);

    git.switch_branch(&repo.path, "main", false)
        .expect("return to main");
    fs::write(repo.path.join("main.txt"), "main\n").expect("main file should write");
    run_git_ok(&repo.path, &["add", "main.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "main commit"]);

    git.switch_branch(&repo.path, "feature/rebase-success", false)
        .expect("return to feature branch");
    let result = git
        .rebase_branch(
            &repo.path,
            GitRebaseBranchRequest {
                working_dir: None,
                target_branch: "main".to_string(),
            },
        )
        .expect("rebase onto target should succeed");

    match result {
        GitRebaseBranchResult::Rebased { output } => {
            assert!(!output.is_empty());
        }
        other => panic!("expected rebased result, got {other:?}"),
    }

    let log = run_git_ok(&repo.path, &["log", "--oneline", "-3"]);
    assert!(log.contains("main commit"));
    assert!(log.contains("feature commit"));
}

#[test]
fn rebase_branch_reports_up_to_date_when_target_is_current_base() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("rebase-up-to-date");
    let git = GitCliPort::new();
    let result = git
        .rebase_branch(
            &repo.path,
            GitRebaseBranchRequest {
                working_dir: None,
                target_branch: "main".to_string(),
            },
        )
        .expect("rebase should report up-to-date outcome");

    match result {
        GitRebaseBranchResult::UpToDate { output } => {
            assert!(output.contains("already contains target history"));
        }
        GitRebaseBranchResult::Rebased { output } => {
            assert!(!output.is_empty());
        }
        other => panic!("expected up-to-date or rebased-no-op result, got {other:?}"),
    }
}

#[test]
fn rebase_branch_reports_conflicts_when_merge_conflicts_occur() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("rebase-conflict");
    let git = GitCliPort::new();

    fs::write(repo.path.join("shared.txt"), "initial\n").expect("base file should write");
    run_git_ok(&repo.path, &["add", "shared.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "shared base"]);

    git.switch_branch(&repo.path, "feature/rebase-conflict", true)
        .expect("feature branch should be created");
    fs::write(repo.path.join("shared.txt"), "feature value\n")
        .expect("feature change should write");
    run_git_ok(&repo.path, &["add", "shared.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "feature change"]);

    git.switch_branch(&repo.path, "main", false)
        .expect("return to main");
    fs::write(repo.path.join("shared.txt"), "main value\n").expect("main change should write");
    run_git_ok(&repo.path, &["add", "shared.txt"]);
    run_git_ok(&repo.path, &["commit", "-m", "main change"]);

    git.switch_branch(&repo.path, "feature/rebase-conflict", false)
        .expect("return to feature branch");

    let result = git
        .rebase_branch(
            &repo.path,
            GitRebaseBranchRequest {
                working_dir: None,
                target_branch: "main".to_string(),
            },
        )
        .expect("conflict should be surfaced as typed conflict result");

    match result {
        GitRebaseBranchResult::Conflicts {
            conflicted_files,
            output: _,
        } => {
            assert!(
                !conflicted_files.is_empty(),
                "conflict result should include conflicted files"
            );
            assert!(conflicted_files.iter().any(|file| file == "shared.txt"));
        }
        other => panic!("expected conflicts result, got {other:?}"),
    }

    run_git_ok(&repo.path, &["rebase", "--abort"]);
}

#[test]
fn rebase_branch_rejects_option_like_target() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("rebase-option-like");
    let git = GitCliPort::new();

    let error = git
        .rebase_branch(
            &repo.path,
            GitRebaseBranchRequest {
                working_dir: None,
                target_branch: "--help".to_string(),
            },
        )
        .expect_err("option-like target branch must not be interpreted as rebase options");

    let message = format!("{error:#}");
    assert!(
        message.contains("git rebase"),
        "error should retain actionable rebase context, got: {message}"
    );
}
