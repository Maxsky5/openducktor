use host_domain::GitCurrentBranch;
use host_infra_system::{HookSet, RepoConfig};
use std::path::Path;

pub(super) const TEST_TASK_ID: &str = "task-1";
pub(super) const TEST_RUNTIME_KIND: &str = "opencode";
pub(super) const TEST_REMOTE_NAME: &str = "origin";
pub(super) const TEST_MAIN_BRANCH: &str = "main";
pub(super) const TEST_BRANCH_PREFIX: &str = "odt";

pub(super) fn test_git_current_branch() -> GitCurrentBranch {
    GitCurrentBranch {
        name: Some(TEST_MAIN_BRANCH.to_string()),
        detached: false,
        revision: None,
    }
}

pub(super) fn test_repo_config(worktree_base: Option<&Path>) -> RepoConfig {
    RepoConfig {
        default_runtime_kind: TEST_RUNTIME_KIND.to_string(),
        worktree_base_path: worktree_base.map(|path| path.to_string_lossy().to_string()),
        branch_prefix: TEST_BRANCH_PREFIX.to_string(),
        default_target_branch: host_infra_system::GitTargetBranch {
            remote: Some(TEST_REMOTE_NAME.to_string()),
            branch: TEST_MAIN_BRANCH.to_string(),
        },
        git: Default::default(),
        trusted_hooks: true,
        trusted_hooks_fingerprint: None,
        hooks: HookSet::default(),
        dev_servers: Vec::new(),
        worktree_file_copies: Vec::new(),
        prompt_overrides: Default::default(),
        agent_defaults: Default::default(),
        ..Default::default()
    }
}
