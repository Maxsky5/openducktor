use super::{
    fake_git_workspace, lock_env, workspace_identity, EnvVarGuard, RepoConfig, TestStoreHarness,
};
use crate::{
    compute_beads_database_name, compute_beads_database_name_for_workspace,
    resolve_repo_beads_attachment_dir, resolve_repo_live_database_dir,
    resolve_workspace_beads_attachment_dir, resolve_workspace_live_database_dir, GitTargetBranch,
};
use serde_json::json;
use std::ffi::OsString;
use std::fs;
#[cfg(unix)]
use std::os::unix::ffi::OsStringExt;

#[test]
fn workspace_add_select_and_update_persist_state() {
    let _env_lock = lock_env();
    let harness = TestStoreHarness::new("workspace-flow");
    let store = harness.store();
    let root = harness.root();
    let _home_guard = EnvVarGuard::set("HOME", root.to_string_lossy().as_ref());
    let repo_a = root.join("repo-a");
    let repo_b = root.join("repo-b");
    fs::create_dir_all(repo_a.join(".git")).expect("repo a");
    fs::create_dir_all(repo_b.join(".git")).expect("repo b");

    let repo_a_str = repo_a.to_string_lossy().to_string();
    let repo_b_str = repo_b.to_string_lossy().to_string();
    let worktrees_path = root.join("worktrees").to_string_lossy().to_string();
    let (workspace_a_id, workspace_a_name, repo_a_canonical) = workspace_identity(&repo_a);
    let (workspace_b_id, workspace_b_name, _repo_b_canonical) = workspace_identity(&repo_b);

    let added = store
        .add_workspace(&workspace_a_id, &workspace_a_name, &repo_a_str)
        .expect("add workspace");
    assert!(added.is_active);
    assert!(added.has_config);
    assert_eq!(added.workspace_id, workspace_a_id);
    assert_eq!(added.workspace_name, workspace_a_name);
    assert_eq!(added.repo_path, repo_a_canonical);
    assert!(added
        .effective_worktree_base_path
        .as_deref()
        .is_some_and(|path| path.contains(".openducktor/worktrees/")));

    store
        .add_workspace(&workspace_b_id, &workspace_b_name, &repo_b_str)
        .expect("add second");
    let selected = store.select_workspace(&workspace_a_id).expect("select");
    assert!(selected.is_active);
    assert_eq!(selected.workspace_id, workspace_a_id);
    assert_eq!(selected.repo_path, repo_a_canonical);

    let updated = store
        .update_repo_config(
            &workspace_a_id,
            RepoConfig {
                workspace_id: workspace_a_id.clone(),
                workspace_name: workspace_a_name.clone(),
                repo_path: repo_a_canonical.clone(),
                default_runtime_kind: "opencode".to_string(),
                worktree_base_path: Some(worktrees_path.clone()),
                branch_prefix: "duck".to_string(),
                default_target_branch: GitTargetBranch {
                    remote: Some("origin".to_string()),
                    branch: "main".to_string(),
                },
                git: Default::default(),
                trusted_hooks: true,
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
    assert_eq!(
        updated.configured_worktree_base_path.as_deref(),
        Some(worktrees_path.as_str())
    );
    assert_eq!(
        updated.effective_worktree_base_path.as_deref(),
        Some(worktrees_path.as_str())
    );

    let workspaces = store.list_workspaces().expect("list workspaces");
    assert_eq!(workspaces.len(), 2);
    assert!(workspaces.iter().any(|workspace| {
        workspace.workspace_id == workspace_a_id && workspace.repo_path == repo_a_canonical
    }));

    let loaded = store.load().expect("load final");
    assert_eq!(
        loaded.recent_workspaces.first().map(String::as_str),
        Some(workspace_a_id.as_str())
    );
    assert_eq!(
        loaded
            .workspaces
            .get(&workspace_a_id)
            .and_then(|entry| entry.worktree_base_path.as_deref()),
        Some(worktrees_path.as_str())
    );
}

#[test]
fn add_workspace_rejects_missing_and_non_git_paths() {
    let _env_lock = lock_env();
    let harness = TestStoreHarness::new("workspace-invalid");
    let store = harness.store();
    let root = harness.root();
    let missing = root.join("missing");
    let (missing_workspace_id, missing_workspace_name, missing_repo_path) = (
        "missing".to_string(),
        "missing".to_string(),
        missing.to_string_lossy().to_string(),
    );
    let missing_error = store
        .add_workspace(
            &missing_workspace_id,
            &missing_workspace_name,
            &missing_repo_path,
        )
        .expect_err("missing path should fail");
    assert!(missing_error.to_string().contains("does not exist"));

    let non_git = root.join("plain-folder");
    fs::create_dir_all(&non_git).expect("plain folder should be created");
    let non_git_repo_path = non_git.to_string_lossy().to_string();
    let non_git_error = store
        .add_workspace("plain-folder", "plain-folder", &non_git_repo_path)
        .expect_err("non-git path should fail");
    assert!(non_git_error.to_string().contains("not a git repository"));
}

#[test]
fn select_and_repo_config_accessors_report_missing_entries() {
    let _env_lock = lock_env();
    let harness = TestStoreHarness::new("workspace-missing-config");
    let store = harness.store();
    let missing_workspace_id = "missing-repo".to_string();

    let select_error = store
        .select_workspace(missing_workspace_id.as_str())
        .expect_err("missing workspace select should fail");
    assert!(select_error
        .to_string()
        .contains("Workspace not found in config"));

    let config_error = store
        .repo_config(missing_workspace_id.as_str())
        .expect_err("repo config should fail when missing");
    assert!(config_error
        .to_string()
        .contains("Workspace is not configured"));

    let optional = store
        .repo_config_optional(missing_workspace_id.as_str())
        .expect("optional lookup should succeed");
    assert!(optional.is_none());

    let trust_error = store
        .set_repo_trust_hooks(
            missing_workspace_id.as_str(),
            true,
            Some("fingerprint".to_string()),
        )
        .expect_err("set trust should fail when repo missing");
    assert!(trust_error
        .to_string()
        .contains("Workspace is not configured"));
}

#[test]
fn update_repo_config_rejects_unknown_workspace() {
    let _env_lock = lock_env();
    let harness = TestStoreHarness::new("update-repo-config-missing-workspace");
    let store = harness.store();
    let root = harness.root();
    let repo = root.join("missing-repo");
    fake_git_workspace(&repo);
    let (workspace_id, _workspace_name, _repo_path) = workspace_identity(&repo);

    let error = store
        .update_repo_config(
            workspace_id.as_str(),
            RepoConfig {
                workspace_id: workspace_id.clone(),
                workspace_name: "Missing Repo".to_string(),
                repo_path: repo.to_string_lossy().to_string(),
                ..RepoConfig::default()
            },
        )
        .expect_err("unknown workspace should be rejected");

    assert!(error.to_string().contains("Workspace not found in config"));
}

#[cfg(unix)]
#[test]
fn explicit_worktree_override_does_not_require_home_for_workspace_records() {
    let _env_lock = lock_env();

    let harness = TestStoreHarness::new("workspace-explicit-override-without-home");
    let store = harness.store();
    let root = harness.root();
    let repo = root.join("repo");
    fs::create_dir_all(repo.join(".git")).expect("repo");
    let repo_str = repo.to_string_lossy().to_string();
    let override_path = root.join("custom-worktrees").to_string_lossy().to_string();
    let (workspace_id, workspace_name, repo_path) = workspace_identity(&repo);

    {
        let _home_guard = EnvVarGuard::set("HOME", root.to_string_lossy().as_ref());
        store
            .add_workspace(&workspace_id, &workspace_name, &repo_str)
            .expect("add workspace");
    }
    let _home_guard = EnvVarGuard::set_os("HOME", OsString::from_vec(vec![0xFF]));
    let updated = store
        .update_repo_config(
            &workspace_id,
            RepoConfig {
                workspace_name,
                repo_path,
                worktree_base_path: Some(override_path.clone()),
                ..RepoConfig::default()
            },
        )
        .expect("explicit override should not require HOME");

    assert!(updated.has_config);
    assert_eq!(
        updated.configured_worktree_base_path.as_deref(),
        Some(override_path.as_str())
    );
    assert_eq!(updated.default_worktree_base_path, None);
    assert_eq!(
        updated.effective_worktree_base_path.as_deref(),
        Some(override_path.as_str())
    );
}

#[test]
fn explicit_worktree_override_expands_home_shorthand_for_effective_path() {
    let _env_lock = lock_env();

    let harness = TestStoreHarness::new("workspace-explicit-override-home-shorthand");
    let store = harness.store();
    let root = harness.root();
    let repo = root.join("repo");
    fs::create_dir_all(repo.join(".git")).expect("repo");
    let repo_str = repo.to_string_lossy().to_string();
    let (workspace_id, workspace_name, repo_path) = workspace_identity(&repo);

    let _home_guard = EnvVarGuard::set("HOME", root.to_string_lossy().as_ref());
    store
        .add_workspace(&workspace_id, &workspace_name, &repo_str)
        .expect("add workspace");

    let updated = store
        .update_repo_config(
            &workspace_id,
            RepoConfig {
                workspace_name,
                repo_path,
                worktree_base_path: Some("~/custom-worktrees".to_string()),
                ..RepoConfig::default()
            },
        )
        .expect("explicit override should resolve");

    assert_eq!(
        updated.configured_worktree_base_path.as_deref(),
        Some("~/custom-worktrees")
    );
    assert_eq!(
        updated.effective_worktree_base_path.as_deref(),
        Some(root.join("custom-worktrees").to_string_lossy().as_ref())
    );
}

#[test]
fn load_adopts_legacy_beads_namespace_into_workspace_identity() {
    let _env_lock = lock_env();
    let harness = TestStoreHarness::new("workspace-adopt-legacy-beads");
    let store = harness.store();
    let root = harness.root();
    let _home_guard = EnvVarGuard::set("HOME", root.to_string_lossy().as_ref());
    let repo = root.join("repo");
    fake_git_workspace(&repo);

    let repo_str = repo.to_string_lossy().to_string();
    let (workspace_id, workspace_name, repo_path) = workspace_identity(&repo);
    store
        .add_workspace(&workspace_id, &workspace_name, &repo_str)
        .expect("add workspace");

    let legacy_attachment_dir =
        resolve_repo_beads_attachment_dir(repo.as_path()).expect("legacy attachment dir");
    let legacy_live_database_dir =
        resolve_repo_live_database_dir(repo.as_path()).expect("legacy live db dir");
    fs::create_dir_all(&legacy_attachment_dir).expect("create legacy attachment dir");
    fs::create_dir_all(&legacy_live_database_dir).expect("create legacy live db dir");
    fs::write(
        legacy_attachment_dir.join("metadata.json"),
        json!({
            "backend": "dolt",
            "dolt_mode": "server",
            "dolt_server_host": "127.0.0.1",
            "dolt_server_port": 3307,
            "dolt_server_user": "root",
            "dolt_database": compute_beads_database_name(repo.as_path()).expect("legacy db name"),
        })
        .to_string(),
    )
    .expect("write legacy metadata");
    fs::write(legacy_attachment_dir.join("task.json"), "legacy-task").expect("write marker");
    fs::write(legacy_live_database_dir.join("db.txt"), "legacy-db").expect("write db marker");

    let workspace_record = store
        .list_workspaces()
        .expect("list workspaces after adoption")
        .into_iter()
        .find(|workspace| workspace.workspace_id == workspace_id)
        .expect("workspace should exist");

    let workspace_attachment_dir =
        resolve_workspace_beads_attachment_dir(&workspace_id).expect("workspace attachment dir");
    let workspace_live_database_dir =
        resolve_workspace_live_database_dir(&workspace_id).expect("workspace live db dir");

    assert_eq!(workspace_record.repo_path, repo_path);
    assert!(!legacy_attachment_dir.exists());
    assert!(!legacy_live_database_dir.exists());
    assert_eq!(
        fs::read_to_string(workspace_attachment_dir.join("task.json")).expect("task marker"),
        "legacy-task"
    );
    assert_eq!(
        fs::read_to_string(workspace_live_database_dir.join("db.txt")).expect("db marker"),
        "legacy-db"
    );

    let metadata: serde_json::Value = serde_json::from_str(
        fs::read_to_string(workspace_attachment_dir.join("metadata.json"))
            .expect("workspace metadata")
            .as_str(),
    )
    .expect("parse workspace metadata");
    assert_eq!(
        metadata
            .get("dolt_database")
            .and_then(|value| value.as_str()),
        Some(
            compute_beads_database_name_for_workspace(&workspace_id)
                .expect("workspace db name")
                .as_str()
        )
    );
}

#[test]
fn load_rejects_conflicting_legacy_and_workspace_beads_namespaces() {
    let _env_lock = lock_env();
    let harness = TestStoreHarness::new("workspace-adopt-legacy-conflict");
    let store = harness.store();
    let root = harness.root();
    let _home_guard = EnvVarGuard::set("HOME", root.to_string_lossy().as_ref());
    let repo = root.join("repo");
    fake_git_workspace(&repo);

    let repo_str = repo.to_string_lossy().to_string();
    let (workspace_id, workspace_name, _) = workspace_identity(&repo);
    store
        .add_workspace(&workspace_id, &workspace_name, &repo_str)
        .expect("add workspace");

    let legacy_attachment_dir =
        resolve_repo_beads_attachment_dir(repo.as_path()).expect("legacy attachment dir");
    let workspace_attachment_dir =
        resolve_workspace_beads_attachment_dir(&workspace_id).expect("workspace attachment dir");
    fs::create_dir_all(&legacy_attachment_dir).expect("create legacy dir");
    fs::create_dir_all(&workspace_attachment_dir).expect("create workspace dir");

    let error = store
        .load()
        .expect_err("conflicting namespaces should fail");
    let error_message = format!("{error:#}");
    assert!(error_message.contains("Cannot adopt legacy Beads attachment root"));
}
