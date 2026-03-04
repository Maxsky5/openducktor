use super::{
    hook_set_fingerprint, touch_recent, AppConfigStore, GlobalConfig, HookSet,
    OpencodeStartupReadinessConfig, RepoConfig,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

mod constructors_and_io;
mod normalization;
mod trust_fingerprint;
mod workspace_config;

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
