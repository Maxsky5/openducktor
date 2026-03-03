use super::branch::parse_branch_rows;
use super::status::split_diff_by_file;
use super::util::combine_output;
use super::GitCliPort;
use host_domain::GitPort;
use host_domain::{
    GitCommitAllRequest, GitCommitAllResult, GitPullRequest, GitPullResult, GitRebaseBranchRequest,
    GitRebaseBranchResult,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

struct TempPath {
    path: PathBuf,
}

impl TempPath {
    fn new(prefix: &str) -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "openducktor-git-{prefix}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("temporary directory should be created");
        Self { path }
    }
}

impl Drop for TempPath {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn run_git(cwd: &Path, args: &[&str]) -> Output {
    Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("git command should execute")
}

fn run_git_ok(cwd: &Path, args: &[&str]) -> String {
    let output = run_git(cwd, args);
    assert!(
        output.status.success(),
        "git {} failed\nstdout: {}\nstderr: {}",
        args.join(" "),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn setup_repo(prefix: &str) -> TempPath {
    let repo = TempPath::new(prefix);
    run_git_ok(&repo.path, &["init"]);
    run_git_ok(
        &repo.path,
        &["config", "user.email", "tests@openducktor.local"],
    );
    run_git_ok(&repo.path, &["config", "user.name", "OpenDucktor Tests"]);
    fs::write(repo.path.join("README.md"), "# OpenDucktor\n").expect("seed file should write");
    run_git_ok(&repo.path, &["add", "README.md"]);
    run_git_ok(&repo.path, &["commit", "-m", "initial"]);
    run_git_ok(&repo.path, &["branch", "-M", "main"]);
    repo
}

fn setup_bare_remote(prefix: &str) -> TempPath {
    let remote = TempPath::new(prefix);
    run_git_ok(&remote.path, &["init", "--bare"]);
    remote
}

#[test]
fn parse_branch_rows_marks_current_local_and_remote_branches() {
    let parsed = parse_branch_rows(
        "1|main|refs/heads/main\n0|feature/a|refs/heads/feature/a\n0|origin/main|refs/remotes/origin/main\n",
    );

    assert_eq!(parsed.len(), 3);
    assert_eq!(parsed[0].name, "main");
    assert!(parsed[0].is_current);
    assert!(!parsed[0].is_remote);
    assert_eq!(parsed[2].name, "origin/main");
    assert!(parsed[2].is_remote);
}

#[test]
fn parse_branch_rows_skips_remote_head_symbolic_ref() {
    let parsed = parse_branch_rows(
        "0|origin/HEAD|refs/remotes/origin/HEAD\n0|origin/main|refs/remotes/origin/main\n",
    );

    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].name, "origin/main");
}

#[test]
fn combine_output_prefers_non_empty_streams_and_preserves_both() {
    assert_eq!(combine_output("".to_string(), "".to_string()), "");
    assert_eq!(
        combine_output("stdout".to_string(), "".to_string()),
        "stdout"
    );
    assert_eq!(
        combine_output("".to_string(), "stderr".to_string()),
        "stderr"
    );
    assert_eq!(
        combine_output("stdout".to_string(), "stderr".to_string()),
        "stdout\nstderr"
    );
}

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
fn split_diff_by_file_parses_quoted_paths_with_b_slash_segment() {
    let full_diff = "diff --git \"a/src/space b/path.ts\" \"b/src/space b/path.ts\"\nindex 123..456 100644\n--- \"a/src/space b/path.ts\"\n+++ \"b/src/space b/path.ts\"\n@@ -1 +1 @@\n-old\n+new\n";

    let split = split_diff_by_file(full_diff);
    assert_eq!(split.len(), 1);
    assert_eq!(split[0].0, "src/space b/path.ts");
    assert!(split[0].1.contains("@@ -1 +1 @@"));
}

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

#[test]
fn git_port_validates_non_empty_inputs_and_non_repo_paths() {
    if !git_available() {
        return;
    }

    let repo = setup_repo("validation");
    let git = GitCliPort::new();
    let non_repo = TempPath::new("non-repo");

    assert!(git.get_branches(&non_repo.path).is_err());
    assert!(git.switch_branch(&repo.path, "   ", false).is_err());
    assert!(git
        .create_worktree(&repo.path, &TempPath::new("w").path, " ", true)
        .is_err());
    assert!(git
        .push_branch(&repo.path, "", "main", false, false)
        .is_err());
    assert!(git
        .push_branch(&repo.path, "origin", " ", false, false)
        .is_err());
}
