use super::super::super::authorization::{
    authorized_worktree_cache, cache_key, resolve_working_dir,
};
use super::super::fixtures::{
    clear_authorized_worktree_cache_for_repo, init_repo, invoke_json, run_git,
    sample_worktree_status_data, seed_authorized_worktree_cache_with_subset,
    setup_command_git_fixture, setup_command_git_fixture_with_mutations, WorktreeStatusResult,
};
use crate::commands::workspace::{
    workspace_save_repo_settings, workspace_select, workspace_update_repo_config,
};
use crate::{RepoConfigPayload, RepoSettingsPayload};
use host_domain::GitUpstreamAheadBehind;
use serde_json::json;
use std::{fs, path::Path};
use tauri::Manager;

const WORKSPACE_ID: &str = "repo";

#[test]
fn git_create_worktree_invalidates_authorized_worktree_cache() {
    let fixture = setup_command_git_fixture_with_mutations(
        "git-command-create-worktree-cache-invalidate",
        WorktreeStatusResult::Ok(Box::new(sample_worktree_status_data(
            GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        ))),
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
        WorktreeStatusResult::Ok(Box::new(sample_worktree_status_data(
            GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        ))),
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
        WorktreeStatusResult::Ok(Box::new(sample_worktree_status_data(
            GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        ))),
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
        WORKSPACE_ID.to_string(),
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
        WorktreeStatusResult::Ok(Box::new(sample_worktree_status_data(
            GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        ))),
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
        WORKSPACE_ID.to_string(),
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
fn workspace_update_repo_config_invalidates_authorized_worktree_cache() {
    let fixture = setup_command_git_fixture(
        "workspace-update-repo-config-cache-invalidate",
        WorktreeStatusResult::Ok(Box::new(sample_worktree_status_data(
            GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        ))),
        true,
    );
    let repo_path = Path::new(&fixture.repo_path);
    clear_authorized_worktree_cache_for_repo(repo_path);
    let worktree_one = fixture.root.join("repo-wt-config-one");
    let worktree_two = fixture.root.join("repo-wt-config-two");
    run_git(
        &[
            "-C",
            fixture.repo_path.as_str(),
            "worktree",
            "add",
            "-b",
            "feature/config-cache-one",
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
            "feature/config-cache-two",
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

    tauri::async_runtime::block_on(workspace_update_repo_config(
        fixture.app.state(),
        WORKSPACE_ID.to_string(),
        RepoConfigPayload {
            default_runtime_kind: None,
            worktree_base_path: Some(
                fixture
                    .root
                    .join("updated-base")
                    .to_string_lossy()
                    .to_string(),
            ),
            branch_prefix: None,
            default_target_branch: None,
            git: None,
            dev_servers: None,
            worktree_file_copies: None,
            prompt_overrides: None,
            agent_defaults: None,
        },
    ))
    .expect("workspace_update_repo_config should succeed");

    let resolved = resolve_working_dir(fixture.repo_path.as_str(), Some(worktree_two_str.as_str()))
        .expect("worktree cache should refresh after repo config update invalidation");
    let expected = fs::canonicalize(&worktree_two)
        .expect("worktree should canonicalize")
        .to_string_lossy()
        .to_string();
    assert_eq!(resolved, expected);

    clear_authorized_worktree_cache_for_repo(repo_path);
}

#[test]
fn workspace_save_repo_settings_invalidates_authorized_worktree_cache() {
    let fixture = setup_command_git_fixture(
        "workspace-save-repo-settings-cache-invalidate",
        WorktreeStatusResult::Ok(Box::new(sample_worktree_status_data(
            GitUpstreamAheadBehind::Tracking {
                ahead: 0,
                behind: 0,
            },
        ))),
        true,
    );
    let repo_path = Path::new(&fixture.repo_path);
    clear_authorized_worktree_cache_for_repo(repo_path);
    let worktree_one = fixture.root.join("repo-wt-settings-one");
    let worktree_two = fixture.root.join("repo-wt-settings-two");
    run_git(
        &[
            "-C",
            fixture.repo_path.as_str(),
            "worktree",
            "add",
            "-b",
            "feature/settings-cache-one",
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
            "feature/settings-cache-two",
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

    tauri::async_runtime::block_on(workspace_save_repo_settings(
        fixture.app.state(),
        fixture.app.handle().clone(),
        WORKSPACE_ID.to_string(),
        RepoSettingsPayload {
            default_runtime_kind: None,
            worktree_base_path: Some(
                fixture
                    .root
                    .join("updated-settings-base")
                    .to_string_lossy()
                    .to_string(),
            ),
            branch_prefix: None,
            default_target_branch: None,
            git: None,
            trusted_hooks: false,
            hooks: None,
            dev_servers: None,
            worktree_file_copies: None,
            prompt_overrides: None,
            agent_defaults: None,
        },
    ))
    .expect("workspace_save_repo_settings should succeed");

    let resolved = resolve_working_dir(fixture.repo_path.as_str(), Some(worktree_two_str.as_str()))
        .expect("worktree cache should refresh after repo settings save invalidation");
    let expected = fs::canonicalize(&worktree_two)
        .expect("worktree should canonicalize")
        .to_string_lossy()
        .to_string();
    assert_eq!(resolved, expected);

    clear_authorized_worktree_cache_for_repo(repo_path);
}
