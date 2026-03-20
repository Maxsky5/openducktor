use super::{lock_env, EnvVarGuard, RepoConfig, TestStoreHarness};
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
    assert_eq!(config.version, 1);
    assert!(!config.chat.show_thinking_messages);
    assert!(config.repos.is_empty());
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

    store.add_workspace(&repo_str).expect("add workspace");
    let updated = store
        .update_repo_config(
            &repo_str,
            RepoConfig {
                default_runtime_kind: "opencode".to_string(),
                worktree_base_path: Some("   ".to_string()),
                branch_prefix: "duck".to_string(),
                default_target_branch: GitTargetBranch {
                    remote: None,
                    branch: "   ".to_string(),
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
        .expect("update config");

    assert!(updated.has_config);
    assert!(updated.configured_worktree_base_path.is_none());
    assert!(updated
        .effective_worktree_base_path
        .as_deref()
        .is_some_and(|path| path.contains(".openducktor/worktrees/")));

    let loaded = store.repo_config(&repo_str).expect("load repo config");
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

    store.add_workspace(&repo_str).expect("add workspace");
    let error = store
        .update_repo_config(
            &repo_str,
            RepoConfig {
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

    store.add_workspace(&repo_str).expect("add workspace");
    store
        .update_repo_config(
            &repo_str,
            RepoConfig {
                default_runtime_kind: "opencode".to_string(),
                worktree_base_path: None,
                branch_prefix: "duck".to_string(),
                default_target_branch: GitTargetBranch {
                    remote: None,
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
        .expect("update config");

    let loaded = store.repo_config(&repo_str).expect("load repo config");
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

    store.add_workspace(&repo_str).expect("add workspace");
    store
        .update_repo_config(
            &repo_str,
            RepoConfig {
                default_runtime_kind: "opencode".to_string(),
                worktree_base_path: None,
                branch_prefix: "duck".to_string(),
                default_target_branch: GitTargetBranch {
                    remote: Some("origin".to_string()),
                    branch: "origin/main".to_string(),
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
        .expect("update config");

    let loaded = store.repo_config(&repo_str).expect("load repo config");
    assert_eq!(
        loaded.default_target_branch.remote.as_deref(),
        Some("origin")
    );
    assert_eq!(loaded.default_target_branch.branch, "main");
    assert_eq!(loaded.default_target_branch.canonical(), "origin/main");
}

#[test]
fn load_normalizes_legacy_blank_repo_config_values() {
    let _env_lock = lock_env();
    let harness = TestStoreHarness::new("normalize-legacy");
    let store = harness.store();
    let root = harness.root();
    let _home_guard = EnvVarGuard::set("HOME", root.to_string_lossy().as_ref());
    let repo = root.join("repo");
    let repo_str = repo.to_string_lossy().to_string();

    fs::create_dir_all(store.path().parent().expect("config parent")).expect("create config dir");
    let mut repos = serde_json::Map::new();
    repos.insert(
        repo_str.clone(),
        json!({
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
        "version": 1,
        "activeRepo": repo_str,
        "repos": repos,
        "recentRepos": []
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
    assert!(workspaces[0].configured_worktree_base_path.is_none());
    assert!(workspaces[0]
        .effective_worktree_base_path
        .as_deref()
        .is_some_and(|path| path.contains(".openducktor/worktrees/")));

    let config = store.load().expect("legacy config should load");
    assert!(!config.chat.show_thinking_messages);

    let repo_config = store
        .repo_config(workspaces[0].path.as_str())
        .expect("repo config");
    assert!(repo_config.worktree_base_path.is_none());
    assert_eq!(repo_config.branch_prefix, DEFAULT_BRANCH_PREFIX);
    assert_eq!(repo_config.default_target_branch.canonical(), "origin/main");
    assert_eq!(repo_config.hooks.pre_start, vec!["echo pre".to_string()]);
    assert_eq!(
        repo_config.hooks.post_complete,
        vec!["echo post".to_string()]
    );

    let spec = repo_config.agent_defaults.spec.expect("spec default");
    assert_eq!(spec.runtime_kind, "opencode");
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
fn load_rejects_legacy_string_default_target_branch_values() {
    let harness = TestStoreHarness::new("reject-legacy-target-branch");
    let store = harness.store();
    let root = harness.root();
    let repo = root.join("repo");
    let repo_str = repo.to_string_lossy().to_string();

    fs::create_dir_all(store.path().parent().expect("config parent")).expect("create config dir");
    let payload = json!({
        "version": 1,
        "activeRepo": repo_str,
        "repos": {
            repo_str.clone(): {
                "defaultTargetBranch": "origin/main"
            }
        },
        "recentRepos": []
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
    let repo_str = repo.to_string_lossy().to_string();

    fs::create_dir_all(store.path().parent().expect("config parent")).expect("create config dir");
    let payload = json!({
        "version": 1,
        "activeRepo": repo_str,
        "repos": {
            repo_str.clone(): {
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
        }
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
