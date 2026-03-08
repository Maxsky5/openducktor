use super::super::super::authorization::resolve_working_dir;
use super::super::fixtures::{
    clear_authorized_worktree_cache_for_repo, init_repo, run_git, unique_test_dir,
};
use std::fs;

#[test]
fn resolve_working_dir_accepts_repo_root() {
    let root = unique_test_dir("git-root");
    let repo = root.join("repo");
    init_repo(&repo);

    let resolved = resolve_working_dir(
        repo.to_string_lossy().as_ref(),
        Some(repo.to_string_lossy().as_ref()),
    )
    .expect("repo root should be accepted");
    let expected = fs::canonicalize(&repo)
        .expect("repo should be canonicalizable")
        .to_string_lossy()
        .to_string();
    assert_eq!(resolved, expected);

    fs::remove_dir_all(&root).expect("failed to remove test directory");
}

#[test]
fn resolve_working_dir_accepts_registered_worktree() {
    let root = unique_test_dir("git-worktree");
    let repo = root.join("repo");
    let worktree = root.join("repo-wt");
    init_repo(&repo);

    let repo_str = repo.to_string_lossy().to_string();
    let worktree_str = worktree.to_string_lossy().to_string();
    run_git(
        &[
            "-C",
            repo_str.as_str(),
            "worktree",
            "add",
            "-b",
            "feature/test",
            worktree_str.as_str(),
        ],
        &repo,
    );

    let resolved = resolve_working_dir(repo_str.as_str(), Some(worktree_str.as_str()))
        .expect("registered worktree should be accepted");
    let expected = fs::canonicalize(&worktree)
        .expect("worktree should be canonicalizable")
        .to_string_lossy()
        .to_string();
    assert_eq!(resolved, expected);

    fs::remove_dir_all(&root).expect("failed to remove test directory");
}

#[test]
fn resolve_working_dir_refreshes_when_worktree_metadata_changes() {
    let root = unique_test_dir("git-worktree-cache");
    let repo = root.join("repo");
    let worktree_one = root.join("repo-wt-1");
    let worktree_two = root.join("repo-wt-2");
    init_repo(&repo);
    clear_authorized_worktree_cache_for_repo(&repo);

    let repo_str = repo.to_string_lossy().to_string();
    let worktree_one_str = worktree_one.to_string_lossy().to_string();
    let worktree_two_str = worktree_two.to_string_lossy().to_string();

    run_git(
        &[
            "-C",
            repo_str.as_str(),
            "worktree",
            "add",
            "-b",
            "feature/cache-one",
            worktree_one_str.as_str(),
        ],
        &repo,
    );

    let resolved_one = resolve_working_dir(repo_str.as_str(), Some(worktree_one_str.as_str()))
        .expect("initial worktree should resolve and populate cache");
    let expected_one = fs::canonicalize(&worktree_one)
        .expect("first worktree should canonicalize")
        .to_string_lossy()
        .to_string();
    assert_eq!(resolved_one, expected_one);

    run_git(
        &[
            "-C",
            repo_str.as_str(),
            "worktree",
            "add",
            "-b",
            "feature/cache-two",
            worktree_two_str.as_str(),
        ],
        &repo,
    );

    let resolved_two = resolve_working_dir(repo_str.as_str(), Some(worktree_two_str.as_str()))
        .expect("worktree should resolve once metadata coherency forces a refresh");
    let expected_two = fs::canonicalize(&worktree_two)
        .expect("second worktree should canonicalize")
        .to_string_lossy()
        .to_string();
    assert_eq!(resolved_two, expected_two);

    clear_authorized_worktree_cache_for_repo(&repo);
    fs::remove_dir_all(&root).expect("failed to remove test directory");
}

#[test]
fn resolve_working_dir_ignores_prunable_worktree_entries() {
    let root = unique_test_dir("git-worktree-prunable");
    let repo = root.join("repo");
    let removed_worktree = root.join("repo-wt-removed");
    let active_worktree = root.join("repo-wt-active");
    init_repo(&repo);
    clear_authorized_worktree_cache_for_repo(&repo);

    let repo_str = repo.to_string_lossy().to_string();
    let removed_worktree_str = removed_worktree.to_string_lossy().to_string();
    let active_worktree_str = active_worktree.to_string_lossy().to_string();

    run_git(
        &[
            "-C",
            repo_str.as_str(),
            "worktree",
            "add",
            "-b",
            "feature/prunable-removed",
            removed_worktree_str.as_str(),
        ],
        &repo,
    );
    run_git(
        &[
            "-C",
            repo_str.as_str(),
            "worktree",
            "add",
            "-b",
            "feature/prunable-active",
            active_worktree_str.as_str(),
        ],
        &repo,
    );

    fs::remove_dir_all(&removed_worktree)
        .expect("removed worktree directory should be deleted for prunable test");

    let resolved_active =
        resolve_working_dir(repo_str.as_str(), Some(active_worktree_str.as_str()))
            .expect("active worktree should resolve even when another entry is prunable");
    let expected_active = fs::canonicalize(&active_worktree)
        .expect("active worktree should canonicalize")
        .to_string_lossy()
        .to_string();
    assert_eq!(resolved_active, expected_active);

    clear_authorized_worktree_cache_for_repo(&repo);
    fs::remove_dir_all(&root).expect("failed to remove test directory");
}

#[test]
fn resolve_working_dir_rejects_unrelated_external_repo() {
    let root = unique_test_dir("git-external");
    let authorized_repo = root.join("authorized");
    let external_repo = root.join("external");
    init_repo(&authorized_repo);
    init_repo(&external_repo);

    let error = resolve_working_dir(
        authorized_repo.to_string_lossy().as_ref(),
        Some(external_repo.to_string_lossy().as_ref()),
    )
    .expect_err("unrelated external repo must be rejected");
    assert!(
        error.contains("not within authorized repository or linked worktrees"),
        "unexpected error: {error}"
    );

    fs::remove_dir_all(&root).expect("failed to remove test directory");
}
