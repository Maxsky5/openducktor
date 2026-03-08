use super::super::super::authorization::{read_git_common_dir, read_worktree_state_token};
use super::super::fixtures::{
    clear_authorized_worktree_cache_for_repo, init_repo, run_git, unique_test_dir,
};
use std::fs;

#[test]
fn worktree_state_token_changes_when_gitdir_content_changes() {
    let root = unique_test_dir("git-worktree-token-gitdir");
    let repo = root.join("repo");
    let worktree = root.join("repo-wt");
    init_repo(&repo);
    clear_authorized_worktree_cache_for_repo(&repo);

    let repo_str = repo.to_string_lossy().to_string();
    let worktree_str = worktree.to_string_lossy().to_string();
    run_git(
        &[
            "-C",
            repo_str.as_str(),
            "worktree",
            "add",
            "-b",
            "feature/token-gitdir",
            worktree_str.as_str(),
        ],
        &repo,
    );

    let canonical_repo = fs::canonicalize(&repo).expect("repo should canonicalize");
    let token_before = read_worktree_state_token(canonical_repo.as_path())
        .expect("worktree state token should be readable");

    let common_git_dir = read_git_common_dir(canonical_repo.as_path())
        .expect("git common directory should be readable");
    let worktrees_dir = common_git_dir.join("worktrees");
    let mut entry_names = fs::read_dir(&worktrees_dir)
        .expect("worktrees directory should be readable")
        .map(|entry| {
            entry
                .expect("worktree entry should be readable")
                .file_name()
                .to_string_lossy()
                .to_string()
        })
        .collect::<Vec<_>>();
    entry_names.sort_unstable();
    let first_entry = entry_names
        .first()
        .expect("worktrees directory should contain an entry");

    let gitdir_path = worktrees_dir.join(first_entry).join("gitdir");
    let original_gitdir =
        fs::read_to_string(&gitdir_path).expect("worktree entry gitdir should be readable");
    let mutated_gitdir = format!("{}-moved", original_gitdir.trim_end_matches(['\r', '\n']));
    fs::write(&gitdir_path, format!("{mutated_gitdir}\n"))
        .expect("worktree entry gitdir should be writable for token mutation test");

    let token_after = read_worktree_state_token(canonical_repo.as_path())
        .expect("worktree state token should be readable after gitdir mutation");

    assert_ne!(
        token_before, token_after,
        "worktree state token should change when entry gitdir content changes"
    );

    clear_authorized_worktree_cache_for_repo(&repo);
    fs::remove_dir_all(&root).expect("failed to remove test directory");
}
