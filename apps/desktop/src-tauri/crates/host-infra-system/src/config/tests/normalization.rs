use super::{lock_env, workspace_identity, EnvVarGuard, RepoConfig, TestStoreHarness};
use crate::GitTargetBranch;
use host_domain::DEFAULT_BRANCH_PREFIX;
use serde_json::json;
use std::fs;
#[cfg(unix)]
use std::{fs::Permissions, os::unix::fs::PermissionsExt};

#[test]
fn load_missing_returns_default_config() {
    let harness = TestStoreHarness::new("load-default");
    let store = harness.store();
    let config = store.load().expect("load default");
    assert_eq!(config.version, 2);
    assert!(!config.chat.show_thinking_messages);
    assert_eq!(config.kanban.done_visible_days, 1);
    assert!(config.workspaces.is_empty());
}

#[test]
fn load_clamps_negative_kanban_done_visible_days() {
    let harness = TestStoreHarness::new("normalize-negative-kanban");
    let store = harness.store();

    fs::create_dir_all(store.path().parent().expect("config parent")).expect("create config dir");
    let payload = json!({
        "version": 2,
        "kanban": {
            "doneVisibleDays": -5
        },
        "recentWorkspaces": []
    });
    fs::write(
        store.path(),
        serde_json::to_string_pretty(&payload).expect("serialize payload"),
    )
    .expect("write config");
    #[cfg(unix)]
    {
        let parent = store.path().parent().expect("config parent");
        fs::set_permissions(parent, Permissions::from_mode(0o700))
            .expect("config directory should be private");
        fs::set_permissions(store.path(), Permissions::from_mode(0o600))
            .expect("config file should be private");
    }

    let config = store.load().expect("load normalized config");
    assert_eq!(config.kanban.done_visible_days, 0);
}

#[test]
fn load_normalizes_workspace_order_and_appends_missing_workspaces() {
    let _env_lock = lock_env();
    let harness = TestStoreHarness::new("normalize-workspace-order");
    let store = harness.store();
    let root = harness.root();
    let _home_guard = EnvVarGuard::set("HOME", root.to_string_lossy().as_ref());
    let repo_a = root.join("repo-a");
    let repo_b = root.join("repo-b");
    fs::create_dir_all(repo_a.join(".git")).expect("repo a");
    fs::create_dir_all(repo_b.join(".git")).expect("repo b");
    let (workspace_a_id, workspace_a_name, repo_a_path) = workspace_identity(&repo_a);
    let (workspace_b_id, workspace_b_name, repo_b_path) = workspace_identity(&repo_b);

    fs::create_dir_all(store.path().parent().expect("config parent")).expect("create config dir");
    let payload = json!({
        "version": 2,
        "workspaces": {
            workspace_a_id.clone(): {
                "workspaceId": workspace_a_id,
                "workspaceName": workspace_a_name,
                "repoPath": repo_a_path,
                "defaultRuntimeKind": "opencode"
            },
            workspace_b_id.clone(): {
                "workspaceId": workspace_b_id,
                "workspaceName": workspace_b_name,
                "repoPath": repo_b_path,
                "defaultRuntimeKind": "opencode"
            }
        },
        "workspaceOrder": [" ", workspace_b_id.as_str(), workspace_b_id.as_str(), "missing"]
    });
    fs::write(
        store.path(),
        serde_json::to_string_pretty(&payload).expect("serialize payload"),
    )
    .expect("write config");
    #[cfg(unix)]
    {
        let parent = store.path().parent().expect("config parent");
        fs::set_permissions(parent, Permissions::from_mode(0o700))
            .expect("config directory should be private");
        fs::set_permissions(store.path(), Permissions::from_mode(0o600))
            .expect("config file should be private");
    }

    let config = store.load().expect("load normalized config");
    assert_eq!(config.workspace_order.len(), 2);
    assert_eq!(config.workspace_order[0], workspace_b_id);
    assert_eq!(config.workspace_order[1], workspace_a_id);
}

#[test]
fn update_repo_config_normalizes_blank_worktree_path() {
    let _env_lock = lock_env();
    let harness = TestStoreHarness::new("normalize-worktree");
    let store = harness.store();
    let root = harness.root();
    let _home_guard = EnvVarGuard::set("HOME", root.to_string_lossy().as_ref());
    let repo = root.join("repo");
    fs::create_dir_all(repo.join(".git")).expect("repo");
    let repo_str = repo.to_string_lossy().to_string();
    let (workspace_id, workspace_name, repo_path) = workspace_identity(&repo);

    store
        .add_workspace(&workspace_id, &workspace_name, &repo_str)
        .expect("add workspace");
    let updated = store
        .update_repo_config(
            &workspace_id,
            RepoConfig {
                workspace_id: workspace_id.clone(),
                workspace_name,
                repo_path,
                default_runtime_kind: "opencode".to_string(),
                worktree_base_path: Some("   ".to_string()),
                branch_prefix: "duck".to_string(),
                default_target_branch: GitTargetBranch {
                    remote: None,
                    branch: "   ".to_string(),
                },
                git: Default::default(),
                hooks: Default::default(),
                dev_servers: Vec::new(),
                worktree_copy_paths: Vec::new(),
                prompt_overrides: Default::default(),
                agent_defaults: Default::default(),
            },
        )
        .expect("update config");

    assert!(updated.has_config);
    assert!(updated.configured_worktree_base_path.is_none());
    assert!(updated
        .effective_worktree_base_path
        .as_deref()
        .is_some_and(|path| path.contains(".openducktor/worktrees/")));

    let loaded = store.repo_config(&workspace_id).expect("load repo config");
    assert!(loaded.worktree_base_path.is_none());
    assert_eq!(loaded.branch_prefix, "duck");
    assert_eq!(loaded.default_target_branch.canonical(), "origin/main");
}

#[test]
fn update_repo_config_rejects_duplicate_dev_server_ids() {
    let _env_lock = lock_env();
    let harness = TestStoreHarness::new("duplicate-dev-server-ids");
    let store = harness.store();
    let root = harness.root();
    let _home_guard = EnvVarGuard::set("HOME", root.to_string_lossy().as_ref());
    let repo = root.join("repo");
    fs::create_dir_all(repo.join(".git")).expect("repo");
    let repo_str = repo.to_string_lossy().to_string();
    let (workspace_id, workspace_name, repo_path) = workspace_identity(&repo);

    store
        .add_workspace(&workspace_id, &workspace_name, &repo_str)
        .expect("add workspace");
    let error = store
        .update_repo_config(
            &workspace_id,
            RepoConfig {
                workspace_name,
                repo_path,
                dev_servers: vec![
                    crate::RepoDevServerScript {
                        id: "frontend".to_string(),
                        name: "Frontend".to_string(),
                        command: "bun run dev".to_string(),
                    },
                    crate::RepoDevServerScript {
                        id: " frontend ".to_string(),
                        name: "Backend".to_string(),
                        command: "bun run api".to_string(),
                    },
                ],
                ..RepoConfig::default()
            },
        )
        .expect_err("duplicate ids should fail");

    assert!(error
        .to_string()
        .contains("Duplicate dev server id: frontend"));
}

#[test]
fn update_repo_config_preserves_explicit_local_default_target_branch() {
    let _env_lock = lock_env();
    let harness = TestStoreHarness::new("canonical-target-branch");
    let store = harness.store();
    let root = harness.root();
    let _home_guard = EnvVarGuard::set("HOME", root.to_string_lossy().as_ref());
    let repo = root.join("repo");
    fs::create_dir_all(repo.join(".git")).expect("repo");
    let repo_str = repo.to_string_lossy().to_string();
    let (workspace_id, workspace_name, repo_path) = workspace_identity(&repo);

    store
        .add_workspace(&workspace_id, &workspace_name, &repo_str)
        .expect("add workspace");
    store
        .update_repo_config(
            &workspace_id,
            RepoConfig {
                workspace_id: workspace_id.clone(),
                workspace_name,
                repo_path,
                default_runtime_kind: "opencode".to_string(),
                worktree_base_path: None,
                branch_prefix: "duck".to_string(),
                default_target_branch: GitTargetBranch {
                    remote: None,
                    branch: "main".to_string(),
                },
                git: Default::default(),
                hooks: Default::default(),
                dev_servers: Vec::new(),
                worktree_copy_paths: Vec::new(),
                prompt_overrides: Default::default(),
                agent_defaults: Default::default(),
            },
        )
        .expect("update config");

    let loaded = store.repo_config(&workspace_id).expect("load repo config");
    assert_eq!(loaded.default_target_branch.canonical(), "main");
}

#[test]
fn update_repo_config_normalizes_remote_qualified_default_target_branch_values() {
    let _env_lock = lock_env();
    let harness = TestStoreHarness::new("normalize-remote-qualified-target-branch");
    let store = harness.store();
    let root = harness.root();
    let _home_guard = EnvVarGuard::set("HOME", root.to_string_lossy().as_ref());
    let repo = root.join("repo");
    fs::create_dir_all(repo.join(".git")).expect("repo");
    let repo_str = repo.to_string_lossy().to_string();
    let (workspace_id, workspace_name, repo_path) = workspace_identity(&repo);

    store
        .add_workspace(&workspace_id, &workspace_name, &repo_str)
        .expect("add workspace");
    store
        .update_repo_config(
            &workspace_id,
            RepoConfig {
                workspace_id: workspace_id.clone(),
                workspace_name,
                repo_path,
                default_runtime_kind: "opencode".to_string(),
                worktree_base_path: None,
                branch_prefix: "duck".to_string(),
                default_target_branch: GitTargetBranch {
                    remote: Some("origin".to_string()),
                    branch: "origin/main".to_string(),
                },
                git: Default::default(),
                hooks: Default::default(),
                dev_servers: Vec::new(),
                worktree_copy_paths: Vec::new(),
                prompt_overrides: Default::default(),
                agent_defaults: Default::default(),
            },
        )
        .expect("update config");

    let loaded = store.repo_config(&workspace_id).expect("load repo config");
    assert_eq!(
        loaded.default_target_branch.remote.as_deref(),
        Some("origin")
    );
    assert_eq!(loaded.default_target_branch.branch, "main");
    assert_eq!(loaded.default_target_branch.canonical(), "origin/main");
}

#[test]
fn load_normalizes_repo_config_values_when_runtime_kinds_are_explicit() {
    let _env_lock = lock_env();
    let harness = TestStoreHarness::new("normalize-persisted-workspace-config");
    let store = harness.store();
    let root = harness.root();
    let _home_guard = EnvVarGuard::set("HOME", root.to_string_lossy().as_ref());
    let repo = root.join("repo");
    fs::create_dir_all(repo.join(".git")).expect("repo");
    let (workspace_id, workspace_name, repo_path) = workspace_identity(&repo);

    fs::create_dir_all(store.path().parent().expect("config parent")).expect("create config dir");
    let mut workspaces = serde_json::Map::new();
    workspaces.insert(
        workspace_id.clone(),
        json!({
            "workspaceId": workspace_id,
            "workspaceName": workspace_name,
            "repoPath": repo_path,
            "defaultRuntimeKind": " opencode ",
            "worktreeBasePath": "",
            "branchPrefix": "   ",
            "defaultTargetBranch": {
                "branch": "   "
            },
            "trustedHooks": false,
            "hooks": {
                "preStart": ["  echo pre  ", "   "],
                "postComplete": ["  echo post  "]
            },
            "agentDefaults": {
                "spec": {
                    "runtimeKind": " claude-code ",
                    "providerId": " openai ",
                    "modelId": " gpt-5 ",
                    "variant": "  ",
                    "opencodeAgent": "  "
                }
            },
            "promptOverrides": {
                " kickoff.spec_initial ": {
                    "template": "  custom kickoff {{task.id}}  ",
                    "baseVersion": 0
                },
                "kickoff.qa_review": {
                    "template": "   ",
                    "baseVersion": 2
                }
            }
        }),
    );
    let payload = json!({
        "version": 2,
        "activeWorkspace": "repo",
        "workspaces": workspaces,
        "recentWorkspaces": []
    });
    fs::write(
        store.path(),
        serde_json::to_string_pretty(&payload).expect("serialize payload"),
    )
    .expect("write config");
    #[cfg(unix)]
    {
        let parent = store.path().parent().expect("config parent");
        fs::set_permissions(parent, Permissions::from_mode(0o700))
            .expect("config directory should be private");
        fs::set_permissions(store.path(), Permissions::from_mode(0o600))
            .expect("config file should be private");
    }

    let workspaces = store.list_workspaces().expect("list workspaces");
    assert_eq!(workspaces.len(), 1);
    assert!(workspaces[0].has_config);
    assert_eq!(workspaces[0].workspace_id, "repo");
    assert_eq!(workspaces[0].workspace_name, "repo");
    assert_eq!(workspaces[0].repo_path, repo_path);
    assert!(workspaces[0].configured_worktree_base_path.is_none());
    assert!(workspaces[0]
        .effective_worktree_base_path
        .as_deref()
        .is_some_and(|path| path.contains(".openducktor/worktrees/")));

    let config = store.load().expect("persisted config should load");
    assert!(!config.chat.show_thinking_messages);
    assert_eq!(config.kanban.done_visible_days, 1);

    let repo_config = store
        .repo_config(workspaces[0].workspace_id.as_str())
        .expect("repo config");
    assert!(repo_config.worktree_base_path.is_none());
    assert_eq!(repo_config.branch_prefix, DEFAULT_BRANCH_PREFIX);
    assert_eq!(repo_config.default_target_branch.canonical(), "origin/main");
    assert_eq!(repo_config.default_runtime_kind, "opencode");
    assert_eq!(repo_config.hooks.pre_start, vec!["echo pre".to_string()]);
    assert_eq!(
        repo_config.hooks.post_complete,
        vec!["echo post".to_string()]
    );

    let spec = repo_config.agent_defaults.spec.expect("spec default");
    assert_eq!(spec.runtime_kind, "claude-code");
    assert_eq!(spec.provider_id, "openai");
    assert_eq!(spec.model_id, "gpt-5");
    assert!(spec.variant.is_none());
    assert!(spec.profile_id.is_none());
    let kickoff_override = repo_config
        .prompt_overrides
        .get("kickoff.spec_initial")
        .expect("kickoff override");
    assert_eq!(kickoff_override.template, "custom kickoff {{task.id}}");
    assert_eq!(kickoff_override.base_version, 1);
    let qa_review_override = repo_config
        .prompt_overrides
        .get("kickoff.qa_review")
        .expect("qa review override");
    assert_eq!(qa_review_override.template, "");
    assert_eq!(qa_review_override.base_version, 2);
}

#[test]
fn load_rejects_missing_default_runtime_kind_in_persisted_repo_config() {
    let _env_lock = lock_env();
    let harness = TestStoreHarness::new("reject-missing-default-runtime-kind");
    let store = harness.store();
    let root = harness.root();
    let _home_guard = EnvVarGuard::set("HOME", root.to_string_lossy().as_ref());
    let repo = root.join("repo");
    fs::create_dir_all(repo.join(".git")).expect("repo");
    let (workspace_id, workspace_name, repo_path) = workspace_identity(&repo);

    fs::create_dir_all(store.path().parent().expect("config parent")).expect("create config dir");
    let payload = json!({
        "version": 2,
        "activeWorkspace": workspace_id,
        "workspaces": {
            "repo": {
                "workspaceId": "repo",
                "workspaceName": workspace_name,
                "repoPath": repo_path,
                "branchPrefix": "duck",
                "trustedHooks": false,
                "hooks": {
                    "preStart": [],
                    "postComplete": []
                }
            }
        },
        "recentWorkspaces": []
    });
    fs::write(
        store.path(),
        serde_json::to_string_pretty(&payload).expect("serialize payload"),
    )
    .expect("write config");
    #[cfg(unix)]
    {
        let parent = store.path().parent().expect("config parent");
        fs::set_permissions(parent, Permissions::from_mode(0o700))
            .expect("config directory should be private");
        fs::set_permissions(store.path(), Permissions::from_mode(0o600))
            .expect("config file should be private");
    }

    let error = store
        .load()
        .expect_err("missing default runtime kind should fail");
    assert!(error.to_string().contains("Failed parsing config file"));
}

#[test]
fn load_rejects_missing_agent_default_runtime_kind_in_persisted_repo_config() {
    let _env_lock = lock_env();
    let harness = TestStoreHarness::new("reject-missing-agent-default-runtime-kind");
    let store = harness.store();
    let root = harness.root();
    let _home_guard = EnvVarGuard::set("HOME", root.to_string_lossy().as_ref());
    let repo = root.join("repo");
    fs::create_dir_all(repo.join(".git")).expect("repo");
    let (workspace_id, workspace_name, repo_path) = workspace_identity(&repo);

    fs::create_dir_all(store.path().parent().expect("config parent")).expect("create config dir");
    let payload = json!({
        "version": 2,
        "activeWorkspace": workspace_id,
        "workspaces": {
            "repo": {
                "workspaceId": "repo",
                "workspaceName": workspace_name,
                "repoPath": repo_path,
                "defaultRuntimeKind": "opencode",
                "branchPrefix": "duck",
                "trustedHooks": false,
                "hooks": {
                    "preStart": [],
                    "postComplete": []
                },
                "agentDefaults": {
                    "spec": {
                        "providerId": "openai",
                        "modelId": "gpt-5"
                    }
                }
            }
        },
        "recentWorkspaces": []
    });
    fs::write(
        store.path(),
        serde_json::to_string_pretty(&payload).expect("serialize payload"),
    )
    .expect("write config");
    #[cfg(unix)]
    {
        let parent = store.path().parent().expect("config parent");
        fs::set_permissions(parent, Permissions::from_mode(0o700))
            .expect("config directory should be private");
        fs::set_permissions(store.path(), Permissions::from_mode(0o600))
            .expect("config file should be private");
    }

    let error = store
        .load()
        .expect_err("missing agent default runtime kind should fail");
    assert!(error.to_string().contains("Failed parsing config file"));
}

#[test]
fn update_repo_config_rejects_blank_runtime_kinds() {
    let _env_lock = lock_env();
    let harness = TestStoreHarness::new("reject-blank-runtime-kind");
    let store = harness.store();
    let root = harness.root();
    let _home_guard = EnvVarGuard::set("HOME", root.to_string_lossy().as_ref());
    let repo = root.join("repo");
    fs::create_dir_all(repo.join(".git")).expect("repo");
    let repo_str = repo.to_string_lossy().to_string();
    let (workspace_id, workspace_name, repo_path) = workspace_identity(&repo);

    store
        .add_workspace(&workspace_id, &workspace_name, &repo_str)
        .expect("add workspace");

    let blank_repo_runtime_error = store
        .update_repo_config(
            &workspace_id,
            RepoConfig {
                workspace_name: workspace_name.clone(),
                repo_path: repo_path.clone(),
                default_runtime_kind: "   ".to_string(),
                ..RepoConfig::default()
            },
        )
        .expect_err("blank repo runtime kind should fail");
    assert!(blank_repo_runtime_error
        .to_string()
        .contains("Default runtime kind cannot be blank."));

    let blank_agent_runtime_error = store
        .update_repo_config(
            &workspace_id,
            RepoConfig {
                workspace_name,
                repo_path,
                agent_defaults: crate::AgentDefaults {
                    spec: Some(crate::AgentModelDefault {
                        runtime_kind: "   ".to_string(),
                        provider_id: "openai".to_string(),
                        model_id: "gpt-5".to_string(),
                        variant: None,
                        profile_id: None,
                    }),
                    ..Default::default()
                },
                ..RepoConfig::default()
            },
        )
        .expect_err("blank agent runtime kind should fail");
    assert!(blank_agent_runtime_error
        .to_string()
        .contains("Specification agent default runtime kind is required when provider and model are configured."));
}

#[test]
fn load_rejects_string_default_target_branch_values_in_persisted_config() {
    let harness = TestStoreHarness::new("reject-legacy-target-branch");
    let store = harness.store();
    let root = harness.root();
    let repo = root.join("repo");
    fs::create_dir_all(repo.join(".git")).expect("repo");
    let (workspace_id, workspace_name, repo_path) = workspace_identity(&repo);

    fs::create_dir_all(store.path().parent().expect("config parent")).expect("create config dir");
    let payload = json!({
        "version": 2,
        "activeWorkspace": workspace_id,
        "workspaces": {
            "repo": {
                "workspaceId": "repo",
                "workspaceName": workspace_name,
                "repoPath": repo_path,
                "defaultRuntimeKind": "opencode",
                "defaultTargetBranch": "origin/main"
            }
        },
        "recentWorkspaces": []
    });
    fs::write(
        store.path(),
        serde_json::to_string_pretty(&payload).expect("serialize payload"),
    )
    .expect("write config");
    #[cfg(unix)]
    {
        let parent = store.path().parent().expect("config parent");
        fs::set_permissions(parent, Permissions::from_mode(0o700))
            .expect("config directory should be private");
        fs::set_permissions(store.path(), Permissions::from_mode(0o600))
            .expect("config file should be private");
    }

    let error = store
        .load()
        .expect_err("legacy string target branch should fail");
    assert!(
        error.to_string().contains("Failed parsing config file"),
        "expected parse failure, got: {error}"
    );
}

#[test]
fn load_rejects_invalid_persisted_dev_server_rows() {
    let _env_lock = lock_env();
    let harness = TestStoreHarness::new("reject-invalid-dev-server-row");
    let store = harness.store();
    let root = harness.root();
    let _home_guard = EnvVarGuard::set("HOME", root.to_string_lossy().as_ref());
    let repo = root.join("repo");
    fs::create_dir_all(repo.join(".git")).expect("repo");
    let (workspace_id, workspace_name, repo_path) = workspace_identity(&repo);

    fs::create_dir_all(store.path().parent().expect("config parent")).expect("create config dir");
    let payload = json!({
        "version": 2,
        "activeWorkspace": workspace_id,
        "workspaces": {
            "repo": {
                "workspaceId": "repo",
                "workspaceName": workspace_name,
                "repoPath": repo_path,
                "defaultRuntimeKind": "opencode",
                "trustedHooks": false,
                "hooks": { "preStart": [], "postComplete": [] },
                "devServers": [
                    {
                        "id": "  ",
                        "name": "Frontend",
                        "command": "bun run dev"
                    }
                ]
            }
        },
        "recentWorkspaces": []
    });
    fs::write(
        store.path(),
        serde_json::to_string_pretty(&payload).expect("serialize payload"),
    )
    .expect("write config");
    #[cfg(unix)]
    {
        let parent = store.path().parent().expect("config parent");
        fs::set_permissions(parent, Permissions::from_mode(0o700))
            .expect("config directory should be private");
        fs::set_permissions(store.path(), Permissions::from_mode(0o600))
            .expect("config file should be private");
    }

    let error = store
        .load()
        .expect_err("invalid persisted dev server rows should fail");
    let display = format!("{error:#}");
    assert!(
        display.contains("Failed normalizing config file")
            && display.contains("Dev server id cannot be blank when a command is configured."),
        "expected normalization failure context, got: {display}"
    );
}
