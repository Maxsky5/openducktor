use super::super::authorization::{
    authorized_worktree_cache, cache_key, read_git_common_dir, read_worktree_state_token,
    resolve_working_dir,
};
use super::fixtures::{
    clear_authorized_worktree_cache_for_repo, init_repo, invoke_json, run_git,
    sample_worktree_status_data, seed_authorized_worktree_cache_with_subset,
    setup_command_git_fixture, setup_command_git_fixture_with_mutations, unique_test_dir,
    WorktreeStatusResult,
};
use crate::commands::workspace::workspace_select;
use host_domain::GitUpstreamAheadBehind;
use serde_json::json;
use std::{fs, path::Path};
use tauri::Manager;

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
fn git_create_worktree_invalidates_authorized_worktree_cache() {
    let fixture = setup_command_git_fixture_with_mutations(
        "git-command-create-worktree-cache-invalidate",
        WorktreeStatusResult::Ok(sample_worktree_status_data(
            GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        )),
        true,
    );
    let repo_path = Path::new(&fixture.repo_path);
    clear_authorized_worktree_cache_for_repo(repo_path);
    let worktree_one = fixture.root.join("repo-wt-create-one");
    let worktree_two = fixture.root.join("repo-wt-create-two");
    run_git(
        &[
            "-C",
            fixture.repo_path.as_str(),
            "worktree",
            "add",
            "-b",
            "feature/create-cache-one",
            worktree_one.to_string_lossy().as_ref(),
        ],
        repo_path,
    );
    run_git(
        &[
            "-C",
            fixture.repo_path.as_str(),
            "worktree",
            "add",
            "-b",
            "feature/create-cache-two",
            worktree_two.to_string_lossy().as_ref(),
        ],
        repo_path,
    );

    seed_authorized_worktree_cache_with_subset(repo_path, &[worktree_one.as_path()]);

    let worktree_two_str = worktree_two.to_string_lossy().to_string();
    let stale_error =
        resolve_working_dir(fixture.repo_path.as_str(), Some(worktree_two_str.as_str()))
            .expect_err("seeded cache should reject worktree omitted from subset");
    assert!(
        stale_error.contains("not within authorized repository or linked worktrees"),
        "unexpected stale cache error: {stale_error}"
    );

    let command_worktree_path = fixture.root.join("repo-wt-command-create");
    invoke_json(
        &fixture.webview,
        "git_create_worktree",
        json!({
            "repoPath": fixture.repo_path.as_str(),
            "worktreePath": command_worktree_path.to_string_lossy().to_string(),
            "branch": "feature/command-create",
            "createBranch": true,
        }),
    )
    .expect("git_create_worktree should succeed");

    let resolved = resolve_working_dir(fixture.repo_path.as_str(), Some(worktree_two_str.as_str()))
        .expect("worktree cache should refresh after create command invalidation");
    let expected = fs::canonicalize(&worktree_two)
        .expect("worktree should canonicalize")
        .to_string_lossy()
        .to_string();
    assert_eq!(resolved, expected);

    clear_authorized_worktree_cache_for_repo(repo_path);

    let state = fixture
        .git_state
        .lock()
        .expect("command git state lock should not be poisoned");
    assert_eq!(state.create_worktree_calls.len(), 1);
}

#[test]
fn git_remove_worktree_invalidates_authorized_worktree_cache() {
    let fixture = setup_command_git_fixture_with_mutations(
        "git-command-remove-worktree-cache-invalidate",
        WorktreeStatusResult::Ok(sample_worktree_status_data(
            GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        )),
        true,
    );
    let repo_path = Path::new(&fixture.repo_path);
    clear_authorized_worktree_cache_for_repo(repo_path);
    let worktree_one = fixture.root.join("repo-wt-remove-one");
    let worktree_two = fixture.root.join("repo-wt-remove-two");
    run_git(
        &[
            "-C",
            fixture.repo_path.as_str(),
            "worktree",
            "add",
            "-b",
            "feature/remove-cache-one",
            worktree_one.to_string_lossy().as_ref(),
        ],
        repo_path,
    );
    run_git(
        &[
            "-C",
            fixture.repo_path.as_str(),
            "worktree",
            "add",
            "-b",
            "feature/remove-cache-two",
            worktree_two.to_string_lossy().as_ref(),
        ],
        repo_path,
    );

    seed_authorized_worktree_cache_with_subset(repo_path, &[worktree_one.as_path()]);

    let worktree_two_str = worktree_two.to_string_lossy().to_string();
    let stale_error =
        resolve_working_dir(fixture.repo_path.as_str(), Some(worktree_two_str.as_str()))
            .expect_err("seeded cache should reject worktree omitted from subset");
    assert!(
        stale_error.contains("not within authorized repository or linked worktrees"),
        "unexpected stale cache error: {stale_error}"
    );

    invoke_json(
        &fixture.webview,
        "git_remove_worktree",
        json!({
            "repoPath": fixture.repo_path.as_str(),
            "worktreePath": worktree_one.to_string_lossy().to_string(),
            "force": false,
        }),
    )
    .expect("git_remove_worktree should succeed");

    let resolved = resolve_working_dir(fixture.repo_path.as_str(), Some(worktree_two_str.as_str()))
        .expect("worktree cache should refresh after remove command invalidation");
    let expected = fs::canonicalize(&worktree_two)
        .expect("worktree should canonicalize")
        .to_string_lossy()
        .to_string();
    assert_eq!(resolved, expected);

    clear_authorized_worktree_cache_for_repo(repo_path);

    let state = fixture
        .git_state
        .lock()
        .expect("command git state lock should not be poisoned");
    assert_eq!(state.remove_worktree_calls.len(), 1);
}

#[test]
fn workspace_select_invalidates_authorized_worktree_cache() {
    let fixture = setup_command_git_fixture(
        "workspace-select-cache-invalidate",
        WorktreeStatusResult::Ok(sample_worktree_status_data(
            GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        )),
        true,
    );
    let repo_path = Path::new(&fixture.repo_path);
    clear_authorized_worktree_cache_for_repo(repo_path);
    let worktree_one = fixture.root.join("repo-wt-workspace-one");
    let worktree_two = fixture.root.join("repo-wt-workspace-two");
    run_git(
        &[
            "-C",
            fixture.repo_path.as_str(),
            "worktree",
            "add",
            "-b",
            "feature/workspace-cache-one",
            worktree_one.to_string_lossy().as_ref(),
        ],
        repo_path,
    );
    run_git(
        &[
            "-C",
            fixture.repo_path.as_str(),
            "worktree",
            "add",
            "-b",
            "feature/workspace-cache-two",
            worktree_two.to_string_lossy().as_ref(),
        ],
        repo_path,
    );

    seed_authorized_worktree_cache_with_subset(repo_path, &[worktree_one.as_path()]);

    let worktree_two_str = worktree_two.to_string_lossy().to_string();
    let stale_error =
        resolve_working_dir(fixture.repo_path.as_str(), Some(worktree_two_str.as_str()))
            .expect_err("seeded cache should reject worktree omitted from subset");
    assert!(
        stale_error.contains("not within authorized repository or linked worktrees"),
        "unexpected stale cache error: {stale_error}"
    );

    tauri::async_runtime::block_on(workspace_select(
        fixture.app.state(),
        fixture.repo_path.clone(),
    ))
    .expect("workspace_select should succeed");

    let resolved = resolve_working_dir(fixture.repo_path.as_str(), Some(worktree_two_str.as_str()))
        .expect("worktree cache should refresh after workspace selection invalidation");
    let expected = fs::canonicalize(&worktree_two)
        .expect("worktree should canonicalize")
        .to_string_lossy()
        .to_string();
    assert_eq!(resolved, expected);

    clear_authorized_worktree_cache_for_repo(repo_path);
}

#[test]
fn workspace_select_invalidates_only_selected_repo_cache_entry() {
    let fixture = setup_command_git_fixture(
        "workspace-select-cache-invalidate-selected-only",
        WorktreeStatusResult::Ok(sample_worktree_status_data(
            GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        )),
        true,
    );
    let selected_repo = Path::new(&fixture.repo_path);
    clear_authorized_worktree_cache_for_repo(selected_repo);

    let secondary_repo = fixture.root.join("secondary-repo");
    init_repo(&secondary_repo);
    clear_authorized_worktree_cache_for_repo(&secondary_repo);

    seed_authorized_worktree_cache_with_subset(selected_repo, &[]);
    seed_authorized_worktree_cache_with_subset(&secondary_repo, &[]);

    let selected_repo_key = cache_key(
        fs::canonicalize(selected_repo)
            .expect("selected repo should canonicalize")
            .as_path(),
    );
    let secondary_repo_key = cache_key(
        fs::canonicalize(&secondary_repo)
            .expect("secondary repo should canonicalize")
            .as_path(),
    );
    {
        let cache = authorized_worktree_cache()
            .lock()
            .expect("authorized worktree cache lock should not be poisoned");
        assert!(
            cache.contains_key(&selected_repo_key),
            "selected repo cache entry should exist before workspace_select"
        );
        assert!(
            cache.contains_key(&secondary_repo_key),
            "secondary repo cache entry should exist before workspace_select"
        );
    }

    tauri::async_runtime::block_on(workspace_select(
        fixture.app.state(),
        fixture.repo_path.clone(),
    ))
    .expect("workspace_select should succeed");

    let cache = authorized_worktree_cache()
        .lock()
        .expect("authorized worktree cache lock should not be poisoned");
    assert!(
        !cache.contains_key(&selected_repo_key),
        "workspace_select should invalidate selected repo cache entry"
    );
    assert!(
        cache.contains_key(&secondary_repo_key),
        "workspace_select should not invalidate unrelated repo cache entries"
    );
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
