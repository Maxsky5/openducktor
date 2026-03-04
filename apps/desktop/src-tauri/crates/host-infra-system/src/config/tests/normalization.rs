use super::*;
use serde_json::json;

#[test]
fn load_missing_returns_default_config() {
    let (store, root) = test_store("load-default");
    let config = store.load().expect("load default");
    assert_eq!(config.version, 1);
    assert_eq!(config.opencode_startup.timeout_ms, 8_000);
    assert_eq!(config.opencode_startup.connect_timeout_ms, 250);
    assert!(config.repos.is_empty());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn opencode_startup_readiness_defaults_and_normalizes() {
    let (store, root) = test_store("opencode-startup-readiness");
    let config = GlobalConfig {
        opencode_startup: OpencodeStartupReadinessConfig {
            timeout_ms: 10,
            connect_timeout_ms: 0,
            initial_retry_delay_ms: 3_000,
            max_retry_delay_ms: 20,
            child_check_interval_ms: 1,
        },
        ..GlobalConfig::default()
    };
    store.save(&config).expect("save config");

    let readiness = store
        .opencode_startup_readiness()
        .expect("readiness policy should load");
    assert_eq!(readiness.timeout_ms, 250);
    assert_eq!(readiness.connect_timeout_ms, 25);
    assert_eq!(readiness.initial_retry_delay_ms, 3_000);
    assert_eq!(readiness.max_retry_delay_ms, 3_000);
    assert_eq!(readiness.child_check_interval_ms, 10);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn update_repo_config_normalizes_blank_worktree_path() {
    let (store, root) = test_store("normalize-worktree");
    let repo = root.join("repo");
    fs::create_dir_all(repo.join(".git")).expect("repo");
    let repo_str = repo.to_string_lossy().to_string();

    store.add_workspace(&repo_str).expect("add workspace");
    let updated = store
        .update_repo_config(
            &repo_str,
            RepoConfig {
                worktree_base_path: Some("   ".to_string()),
                branch_prefix: "duck".to_string(),
                default_target_branch: "   ".to_string(),
                trusted_hooks: false,
                trusted_hooks_fingerprint: None,
                hooks: Default::default(),
                prompt_overrides: Default::default(),
                agent_defaults: Default::default(),
            },
        )
        .expect("update config");

    assert!(!updated.has_config);
    assert!(updated.configured_worktree_base_path.is_none());

    let loaded = store.repo_config(&repo_str).expect("load repo config");
    assert!(loaded.worktree_base_path.is_none());
    assert_eq!(loaded.branch_prefix, "duck");
    assert_eq!(loaded.default_target_branch, "origin/main");

    let _ = fs::remove_dir_all(root);
}

#[test]
fn update_repo_config_canonicalizes_default_target_branch_without_remote() {
    let (store, root) = test_store("canonical-target-branch");
    let repo = root.join("repo");
    fs::create_dir_all(repo.join(".git")).expect("repo");
    let repo_str = repo.to_string_lossy().to_string();

    store.add_workspace(&repo_str).expect("add workspace");
    store
        .update_repo_config(
            &repo_str,
            RepoConfig {
                worktree_base_path: None,
                branch_prefix: "duck".to_string(),
                default_target_branch: "main".to_string(),
                trusted_hooks: false,
                trusted_hooks_fingerprint: None,
                hooks: Default::default(),
                prompt_overrides: Default::default(),
                agent_defaults: Default::default(),
            },
        )
        .expect("update config");

    let loaded = store.repo_config(&repo_str).expect("load repo config");
    assert_eq!(loaded.default_target_branch, "origin/main");

    let _ = fs::remove_dir_all(root);
}

#[test]
fn load_normalizes_legacy_blank_repo_config_values() {
    let (store, root) = test_store("normalize-legacy");
    let repo = root.join("repo");
    let repo_str = repo.to_string_lossy().to_string();

    fs::create_dir_all(store.path.parent().expect("config parent")).expect("create config dir");
    let mut repos = serde_json::Map::new();
    repos.insert(
        repo_str.clone(),
        json!({
            "worktreeBasePath": "",
            "branchPrefix": "   ",
            "defaultTargetBranch": "   ",
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
        "recentRepos": [],
        "scheduler": {
            "softGuardrails": {
                "cpuHighWatermarkPercent": 85,
                "minFreeMemoryMb": 2048,
                "backoffSeconds": 30
            }
        }
    });
    fs::write(
        &store.path,
        serde_json::to_string_pretty(&payload).expect("serialize payload"),
    )
    .expect("write config");

    let workspaces = store.list_workspaces().expect("list workspaces");
    assert_eq!(workspaces.len(), 1);
    assert!(!workspaces[0].has_config);
    assert!(workspaces[0].configured_worktree_base_path.is_none());

    let repo_config = store
        .repo_config(workspaces[0].path.as_str())
        .expect("repo config");
    assert!(repo_config.worktree_base_path.is_none());
    assert_eq!(repo_config.branch_prefix, "obp");
    assert_eq!(repo_config.default_target_branch, "origin/main");
    assert_eq!(repo_config.hooks.pre_start, vec!["echo pre".to_string()]);
    assert_eq!(
        repo_config.hooks.post_complete,
        vec!["echo post".to_string()]
    );

    let spec = repo_config.agent_defaults.spec.expect("spec default");
    assert_eq!(spec.provider_id, "openai");
    assert_eq!(spec.model_id, "gpt-5");
    assert!(spec.variant.is_none());
    assert!(spec.opencode_agent.is_none());
    let kickoff_override = repo_config
        .prompt_overrides
        .get("kickoff.spec_initial")
        .expect("kickoff override");
    assert_eq!(kickoff_override.template, "custom kickoff {{task.id}}");
    assert_eq!(kickoff_override.base_version, 1);
    assert!(
        !repo_config
            .prompt_overrides
            .contains_key("kickoff.qa_review"),
        "blank templates should be removed"
    );

    let _ = fs::remove_dir_all(root);
}
