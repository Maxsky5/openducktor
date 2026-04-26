use super::{
    touch_recent, AppConfigStore, GlobalConfig, OpencodeStartupReadinessConfig, RepoConfig,
    RuntimeConfig, RuntimeConfigStore,
};
use host_domain::RuntimeRegistry;
pub(super) use host_test_support::{lock_env, EnvVarGuard};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

mod constructors_and_io;
mod normalization;
mod permissions;
mod runtime_config;
mod workspace_config;
mod workspace_icons;

pub(super) struct TestStoreHarness {
    store: AppConfigStore,
    root: PathBuf,
}

impl TestStoreHarness {
    pub(super) fn new(name: &str) -> Self {
        let root = unique_temp_path(name);
        let path = root.join("config.json");
        Self {
            store: AppConfigStore::from_path(path),
            root,
        }
    }

    pub(super) fn store(&self) -> &AppConfigStore {
        &self.store
    }

    pub(super) fn root(&self) -> &Path {
        &self.root
    }
}

impl Drop for TestStoreHarness {
    fn drop(&mut self) {
        cleanup_temp_root(&self.root);
    }
}

pub(super) struct TestRuntimeStoreHarness {
    store: RuntimeConfigStore,
    root: PathBuf,
}

impl TestRuntimeStoreHarness {
    pub(super) fn new(name: &str) -> Self {
        Self::new_with_runtime_registry(name, host_domain::builtin_runtime_registry().clone())
    }

    pub(super) fn new_with_runtime_registry(name: &str, runtime_registry: RuntimeRegistry) -> Self {
        let root = unique_temp_path(name);
        let path = root.join("runtime-config.json");
        Self {
            store: RuntimeConfigStore::from_path_with_runtime_registry(path, runtime_registry),
            root,
        }
    }

    pub(super) fn store(&self) -> &RuntimeConfigStore {
        &self.store
    }
}

impl Drop for TestRuntimeStoreHarness {
    fn drop(&mut self) {
        cleanup_temp_root(&self.root);
    }
}

fn cleanup_temp_root(root: &Path) {
    if let Err(error) = fs::remove_dir_all(root) {
        if error.kind() != std::io::ErrorKind::NotFound {
            panic!(
                "failed removing test temp directory {}: {error}",
                root.display()
            );
        }
    }
}

pub(super) fn unique_temp_path(name: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    std::env::temp_dir().join(format!("openducktor-{name}-{nonce}"))
}

pub(super) fn fake_git_workspace(path: &Path) {
    fs::create_dir_all(path.join(".git")).expect("git directory should be created");
}

pub(super) fn workspace_identity(path: &Path) -> (String, String, String) {
    let repo_path = fs::canonicalize(path)
        .expect("workspace path should canonicalize")
        .to_string_lossy()
        .to_string();
    let workspace_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .expect("workspace path should have a file name")
        .to_string();
    let workspace_id = workspace_name.to_lowercase();
    (workspace_id, workspace_name, repo_path)
}
