mod migrate;
mod normalize;
mod store;
mod types;

pub use store::AppConfigStore;
pub use types::{
    hook_set_fingerprint, AgentDefaults, AgentModelDefault, GlobalConfig, HookSet,
    OpencodeStartupReadinessConfig, RepoConfig, SchedulerConfig, SoftGuardrails,
};

#[cfg(test)]
pub(super) use store::touch_recent;

#[cfg(test)]
mod tests {
    use super::{
        hook_set_fingerprint, touch_recent, AppConfigStore, GlobalConfig,
        OpencodeStartupReadinessConfig, RepoConfig,
    };
    use serde_json::json;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_path(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir().join(format!("openducktor-{name}-{nonce}"))
    }

    fn test_store(name: &str) -> (AppConfigStore, PathBuf) {
        let root = unique_temp_path(name);
        let path = root.join("config.json");
        (AppConfigStore { path }, root)
    }

    fn fake_git_workspace(path: &Path) {
        fs::create_dir_all(path.join(".git")).expect("git directory should be created");
    }

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
    fn workspace_add_select_and_update_persist_state() {
        let (store, root) = test_store("workspace-flow");
        let repo_a = root.join("repo-a");
        let repo_b = root.join("repo-b");
        fs::create_dir_all(repo_a.join(".git")).expect("repo a");
        fs::create_dir_all(repo_b.join(".git")).expect("repo b");

        let repo_a_str = repo_a.to_string_lossy().to_string();
        let repo_b_str = repo_b.to_string_lossy().to_string();
        // Canonical form (resolved absolute path)
        let repo_a_canonical = fs::canonicalize(&repo_a)
            .unwrap()
            .to_string_lossy()
            .to_string();

        let added = store.add_workspace(&repo_a_str).expect("add workspace");
        assert!(added.is_active);
        // Path should now be in canonical form
        assert_eq!(added.path, repo_a_canonical);

        store.add_workspace(&repo_b_str).expect("add second");
        let selected = store.select_workspace(&repo_a_str).expect("select");
        assert!(selected.is_active);
        assert_eq!(selected.path, repo_a_canonical);

        let updated = store
            .update_repo_config(
                &repo_a_str,
                RepoConfig {
                    worktree_base_path: Some("/tmp/worktrees".to_string()),
                    branch_prefix: "duck".to_string(),
                    default_target_branch: "origin/main".to_string(),
                    trusted_hooks: true,
                    trusted_hooks_fingerprint: None,
                    hooks: Default::default(),
                    agent_defaults: Default::default(),
                },
            )
            .expect("update config");
        assert!(updated.has_config);
        assert_eq!(
            updated.configured_worktree_base_path.as_deref(),
            Some("/tmp/worktrees")
        );

        let workspaces = store.list_workspaces().expect("list workspaces");
        assert_eq!(workspaces.len(), 2);
        // Paths should be in canonical form
        assert_eq!(workspaces[0].path, repo_a_canonical);
        assert!(workspaces[0].is_active);

        let loaded = store.load().expect("load final");
        assert_eq!(
            loaded.recent_repos.first().map(String::as_str),
            Some(repo_a_canonical.as_str())
        );
        assert_eq!(
            loaded
                .repos
                .get(&repo_a_canonical)
                .and_then(|entry| entry.worktree_base_path.as_deref()),
            Some("/tmp/worktrees")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn add_workspace_rejects_missing_and_non_git_paths() {
        let (store, root) = test_store("workspace-invalid");
        let missing = root.join("missing");
        let missing_error = store
            .add_workspace(missing.to_string_lossy().as_ref())
            .expect_err("missing path should fail");
        assert!(missing_error.to_string().contains("does not exist"));

        let non_git = root.join("plain-folder");
        fs::create_dir_all(&non_git).expect("plain folder should be created");
        let non_git_error = store
            .add_workspace(non_git.to_string_lossy().as_ref())
            .expect_err("non-git path should fail");
        assert!(non_git_error.to_string().contains("not a git repository"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn select_and_repo_config_accessors_report_missing_entries() {
        let (store, root) = test_store("workspace-missing-config");
        let missing_repo = root.join("missing-repo");
        let missing_repo_str = missing_repo.to_string_lossy().to_string();

        let select_error = store
            .select_workspace(missing_repo_str.as_str())
            .expect_err("missing workspace select should fail");
        assert!(select_error
            .to_string()
            .contains("Workspace not found in config"));

        let config_error = store
            .repo_config(missing_repo_str.as_str())
            .expect_err("repo config should fail when missing");
        assert!(config_error
            .to_string()
            .contains("Repository is not configured"));

        let optional = store
            .repo_config_optional(missing_repo_str.as_str())
            .expect("optional lookup should succeed");
        assert!(optional.is_none());

        let trust_error = store
            .set_repo_trust_hooks(
                missing_repo_str.as_str(),
                true,
                Some("fingerprint".to_string()),
            )
            .expect_err("set trust should fail when repo missing");
        assert!(trust_error
            .to_string()
            .contains("Repository is not configured"));
        let _ = fs::remove_dir_all(root);
    }

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
    fn update_repo_config_rejects_unknown_workspace() {
        let (store, root) = test_store("update-repo-config-missing-workspace");
        let repo = root.join("missing-repo");
        fake_git_workspace(&repo);
        let repo_str = repo.to_string_lossy().to_string();

        let error = store
            .update_repo_config(repo_str.as_str(), RepoConfig::default())
            .expect_err("unknown workspace should be rejected");

        assert!(error.to_string().contains("Workspace not found in config"));
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
                    agent_defaults: Default::default(),
                },
            )
            .expect("update config");

        let loaded = store.repo_config(&repo_str).expect("load repo config");
        assert_eq!(loaded.default_target_branch, "origin/main");

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
                super::HookSet {
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

    #[test]
    fn save_and_load_report_io_and_parse_errors() {
        let (store, root) = test_store("config-io-errors");

        fs::create_dir_all(&root).expect("temp root should exist");
        fs::write(store.path(), "{ invalid json").expect("invalid config should write");
        let parse_error = store.load().expect_err("invalid json should fail parsing");
        assert!(parse_error
            .to_string()
            .contains("Failed parsing config file"));

        let blocked_parent = root.join("not-a-directory");
        fs::write(&blocked_parent, "file").expect("blocking file should write");
        let blocked_store = AppConfigStore::from_path(blocked_parent.join("config.json"));
        let save_error = blocked_store
            .save(&GlobalConfig::default())
            .expect_err("save should fail when parent is a file");
        assert!(save_error
            .to_string()
            .contains("Failed creating config directory"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn app_config_store_constructors_expose_expected_paths() {
        let store = AppConfigStore::new().expect("new store should resolve home path");
        let resolved = store.path().to_string_lossy().to_string();
        assert!(
            resolved.ends_with("/.openducktor/config.json"),
            "unexpected config path: {resolved}"
        );

        let custom_path = unique_temp_path("custom-path").join("custom-config.json");
        let from_path = AppConfigStore::from_path(custom_path.clone());
        assert_eq!(from_path.path(), custom_path.as_path());
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

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn touch_recent_keeps_latest_first_and_caps_size() {
        let mut recent = (0..25)
            .map(|index| format!("/tmp/repo-{index}"))
            .collect::<Vec<_>>();
        touch_recent(&mut recent, "/tmp/repo-3");

        assert_eq!(recent.first().map(String::as_str), Some("/tmp/repo-3"));
        assert_eq!(recent.len(), 20);
        assert_eq!(
            recent
                .iter()
                .filter(|entry| entry.as_str() == "/tmp/repo-3")
                .count(),
            1
        );
    }
}
