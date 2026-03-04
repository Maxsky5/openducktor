use super::*;

#[test]
fn update_repo_config_sets_active_repo_and_trust_roundtrip() {
    let (store, root) = test_store("repo-config-roundtrip");
    let repo = root.join("repo-main");
    fake_git_workspace(&repo);
    let repo_str = repo.to_string_lossy().to_string();
    store
        .add_workspace(repo_str.as_str())
        .expect("workspace should be added before updating config");

    let updated = store
        .update_repo_config(
            repo_str.as_str(),
            RepoConfig {
                worktree_base_path: Some(root.join("worktrees").to_string_lossy().to_string()),
                branch_prefix: "duck".to_string(),
                default_target_branch: "origin/release".to_string(),
                trusted_hooks: false,
                trusted_hooks_fingerprint: None,
                hooks: Default::default(),
                prompt_overrides: Default::default(),
                agent_defaults: Default::default(),
            },
        )
        .expect("repo config update should succeed");
    assert!(updated.is_active, "first update should mark repo active");
    assert!(updated.has_config);

    let trusted = store
        .set_repo_trust_hooks(
            repo_str.as_str(),
            true,
            Some(hook_set_fingerprint(&Default::default())),
        )
        .expect("set trust should succeed");
    assert!(trusted.is_active);
    assert!(trusted.has_config);
    assert!(trusted.configured_worktree_base_path.is_some());

    let repo_config = store
        .repo_config(repo_str.as_str())
        .expect("repo config should exist");
    assert!(repo_config.trusted_hooks);
    assert_eq!(repo_config.default_target_branch, "origin/release");

    let optional = store
        .repo_config_optional(repo_str.as_str())
        .expect("optional lookup should succeed");
    assert!(optional.is_some());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn update_repo_hooks_revokes_trust_when_commands_change() {
    let (store, root) = test_store("hooks-revoke-trust");
    let repo = root.join("repo");
    fake_git_workspace(&repo);
    let repo_str = repo.to_string_lossy().to_string();
    store
        .add_workspace(repo_str.as_str())
        .expect("workspace should be added before updating config");

    store
        .update_repo_config(
            repo_str.as_str(),
            RepoConfig {
                worktree_base_path: Some(root.join("worktrees").to_string_lossy().to_string()),
                branch_prefix: "duck".to_string(),
                default_target_branch: "origin/main".to_string(),
                trusted_hooks: false,
                trusted_hooks_fingerprint: None,
                hooks: Default::default(),
                prompt_overrides: Default::default(),
                agent_defaults: Default::default(),
            },
        )
        .expect("repo config update should succeed");

    store
        .set_repo_trust_hooks(
            repo_str.as_str(),
            true,
            Some(hook_set_fingerprint(&Default::default())),
        )
        .expect("set trust should succeed");

    store
        .update_repo_hooks(
            repo_str.as_str(),
            HookSet {
                pre_start: vec!["echo pre".to_string()],
                post_complete: Vec::new(),
            },
        )
        .expect("updating hooks should succeed");

    let repo_config = store
        .repo_config(repo_str.as_str())
        .expect("repo config should exist");
    assert!(!repo_config.trusted_hooks);
    assert!(repo_config.trusted_hooks_fingerprint.is_none());

    let _ = fs::remove_dir_all(root);
}
