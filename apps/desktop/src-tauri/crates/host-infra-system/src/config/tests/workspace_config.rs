use super::{fake_git_workspace, RepoConfig, TestStoreHarness};
use crate::GitTargetBranch;
use std::ffi::OsString;
use std::fs;
#[cfg(unix)]
use std::os::unix::ffi::OsStringExt;
use std::sync::{Mutex, MutexGuard, OnceLock};

fn lock_env() -> MutexGuard<'static, ()> {
    static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    ENV_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

struct EnvVarGuard {
    key: &'static str,
    previous: Option<OsString>,
}

impl EnvVarGuard {
    #[cfg(unix)]
    fn set_os(key: &'static str, value: OsString) -> Self {
        let previous = std::env::var_os(key);
        std::env::set_var(key, &value);
        Self { key, previous }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        if let Some(previous) = self.previous.clone() {
            std::env::set_var(self.key, previous);
        } else {
            std::env::remove_var(self.key);
        }
    }
}

#[test]
fn workspace_add_select_and_update_persist_state() {
    let _env_lock = lock_env();
    let harness = TestStoreHarness::new("workspace-flow");
    let store = harness.store();
    let root = harness.root();
    let repo_a = root.join("repo-a");
    let repo_b = root.join("repo-b");
    fs::create_dir_all(repo_a.join(".git")).expect("repo a");
    fs::create_dir_all(repo_b.join(".git")).expect("repo b");

    let repo_a_str = repo_a.to_string_lossy().to_string();
    let repo_b_str = repo_b.to_string_lossy().to_string();
    let worktrees_path = root.join("worktrees").to_string_lossy().to_string();
    // Canonical form (resolved absolute path)
    let repo_a_canonical = fs::canonicalize(&repo_a)
        .unwrap()
        .to_string_lossy()
        .to_string();

    let added = store.add_workspace(&repo_a_str).expect("add workspace");
    assert!(added.is_active);
    assert!(added.has_config);
    // Path should now be in canonical form
    assert_eq!(added.path, repo_a_canonical);
    assert!(added
        .effective_worktree_base_path
        .as_deref()
        .is_some_and(|path| path.contains(".openducktor/worktrees/")));

    store.add_workspace(&repo_b_str).expect("add second");
    let selected = store.select_workspace(&repo_a_str).expect("select");
    assert!(selected.is_active);
    assert_eq!(selected.path, repo_a_canonical);

    let updated = store
        .update_repo_config(
            &repo_a_str,
            RepoConfig {
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
}

#[test]
fn select_and_repo_config_accessors_report_missing_entries() {
    let _env_lock = lock_env();
    let harness = TestStoreHarness::new("workspace-missing-config");
    let store = harness.store();
    let root = harness.root();
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
}

#[test]
fn update_repo_config_rejects_unknown_workspace() {
    let _env_lock = lock_env();
    let harness = TestStoreHarness::new("update-repo-config-missing-workspace");
    let store = harness.store();
    let root = harness.root();
    let repo = root.join("missing-repo");
    fake_git_workspace(&repo);
    let repo_str = repo.to_string_lossy().to_string();

    let error = store
        .update_repo_config(repo_str.as_str(), RepoConfig::default())
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

    store.add_workspace(&repo_str).expect("add workspace");
    let _home_guard = EnvVarGuard::set_os("HOME", OsString::from_vec(vec![0xFF]));
    let updated = store
        .update_repo_config(
            &repo_str,
            RepoConfig {
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
