use super::{
    fake_git_workspace, hook_set_fingerprint, workspace_identity, HookSet, RepoConfig,
    TestStoreHarness,
};
use crate::GitTargetBranch;

#[test]
fn update_repo_config_sets_active_repo_and_trust_roundtrip() {
    let harness = TestStoreHarness::new("repo-config-roundtrip");
    let store = harness.store();
    let root = harness.root();
    let repo = root.join("repo-main");
    fake_git_workspace(&repo);
    let repo_str = repo.to_string_lossy().to_string();
    let (workspace_id, workspace_name, repo_path) = workspace_identity(&repo);
    store
        .add_workspace(&workspace_id, &workspace_name, repo_str.as_str())
        .expect("workspace should be added before updating config");

    let updated = store
        .update_repo_config(
            workspace_id.as_str(),
            RepoConfig {
                workspace_id: workspace_id.clone(),
                workspace_name: workspace_name.clone(),
                repo_path: repo_path.clone(),
                default_runtime_kind: "opencode".to_string(),
                worktree_base_path: Some(root.join("worktrees").to_string_lossy().to_string()),
                branch_prefix: "duck".to_string(),
                default_target_branch: GitTargetBranch {
                    remote: Some("origin".to_string()),
                    branch: "release".to_string(),
                },
                git: Default::default(),
                trusted_hooks: false,
                trusted_hooks_fingerprint: None,
                hooks: Default::default(),
                dev_servers: Vec::new(),
                worktree_file_copies: Vec::new(),
                prompt_overrides: Default::default(),
                agent_defaults: Default::default(),
            },
        )
        .expect("repo config update should succeed");
    assert!(updated.is_active, "first update should mark repo active");
    assert!(updated.has_config);
    assert_eq!(
        updated.effective_worktree_base_path.as_deref(),
        updated.configured_worktree_base_path.as_deref()
    );

    let trusted = store
        .set_repo_trust_hooks(
            workspace_id.as_str(),
            true,
            Some(hook_set_fingerprint(&Default::default())),
        )
        .expect("set trust should succeed");
    assert!(trusted.is_active);
    assert!(trusted.has_config);
    assert!(trusted.configured_worktree_base_path.is_some());
    assert_eq!(
        trusted.effective_worktree_base_path.as_deref(),
        trusted.configured_worktree_base_path.as_deref()
    );

    let repo_config = store
        .repo_config(workspace_id.as_str())
        .expect("repo config should exist");
    assert!(repo_config.trusted_hooks);
    assert_eq!(
        repo_config.default_target_branch.canonical(),
        "origin/release"
    );

    let optional = store
        .repo_config_optional(workspace_id.as_str())
        .expect("optional lookup should succeed");
    assert!(optional.is_some());
}

#[test]
fn update_repo_hooks_revokes_trust_when_commands_change() {
    let harness = TestStoreHarness::new("hooks-revoke-trust");
    let store = harness.store();
    let root = harness.root();
    let repo = root.join("repo");
    fake_git_workspace(&repo);
    let repo_str = repo.to_string_lossy().to_string();
    let (workspace_id, workspace_name, repo_path) = workspace_identity(&repo);
    store
        .add_workspace(&workspace_id, &workspace_name, repo_str.as_str())
        .expect("workspace should be added before updating config");

    store
        .update_repo_config(
            workspace_id.as_str(),
            RepoConfig {
                workspace_id: workspace_id.clone(),
                workspace_name,
                repo_path,
                default_runtime_kind: "opencode".to_string(),
                worktree_base_path: Some(root.join("worktrees").to_string_lossy().to_string()),
                branch_prefix: "duck".to_string(),
                default_target_branch: GitTargetBranch {
                    remote: Some("origin".to_string()),
                    branch: "main".to_string(),
                },
                git: Default::default(),
                trusted_hooks: false,
                trusted_hooks_fingerprint: None,
                hooks: Default::default(),
                dev_servers: Vec::new(),
                worktree_file_copies: Vec::new(),
                prompt_overrides: Default::default(),
                agent_defaults: Default::default(),
            },
        )
        .expect("repo config update should succeed");

    store
        .set_repo_trust_hooks(
            workspace_id.as_str(),
            true,
            Some(hook_set_fingerprint(&Default::default())),
        )
        .expect("set trust should succeed");

    store
        .update_repo_hooks(
            workspace_id.as_str(),
            HookSet {
                pre_start: vec!["echo pre".to_string()],
                post_complete: Vec::new(),
            },
        )
        .expect("updating hooks should succeed");

    let repo_config = store
        .repo_config(workspace_id.as_str())
        .expect("repo config should exist");
    assert!(!repo_config.trusted_hooks);
    assert!(repo_config.trusted_hooks_fingerprint.is_none());
}
