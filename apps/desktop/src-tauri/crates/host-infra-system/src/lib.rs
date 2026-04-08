mod beads;
mod config;
mod git;
mod process;
mod user_paths;
mod worktree;

pub use beads::{
    compute_beads_database_name, compute_repo_id, compute_repo_slug,
    ensure_shared_dolt_server_running, read_shared_dolt_server_state, resolve_beads_root,
    resolve_default_worktree_base_dir, resolve_dolt_config_dir, resolve_dolt_config_file,
    resolve_effective_worktree_base_dir, resolve_repo_beads_attachment_dir,
    resolve_repo_beads_attachment_root, resolve_repo_beads_paths, resolve_repo_live_database_dir,
    resolve_server_lock_file, resolve_server_state_file, resolve_shared_dolt_root,
    resolve_shared_server_root, stop_shared_dolt_server_for_current_owner, RepoBeadsPaths,
    SharedDoltServerState, SHARED_DOLT_SERVER_HOST, SHARED_DOLT_SERVER_USER,
};
pub use config::{
    hook_set_fingerprint, normalize_hook_set, normalize_repo_dev_servers, repo_script_fingerprint,
    AgentDefaults, AgentModelDefault, AppConfigStore, AutopilotActionId, AutopilotEventId,
    AutopilotRule, AutopilotSettings, ChatSettings, GitMergeMethod, GitProviderConfig,
    GitProviderRepository, GitTargetBranch, GlobalConfig, GlobalGitConfig, HookSet, KanbanSettings,
    OpencodeStartupReadinessConfig, PromptOverride, PromptOverrides, RepoConfig,
    RepoDevServerScript, RepoGitConfig, RuntimeConfig, RuntimeConfigStore, SchedulerConfig,
    SoftGuardrails,
};
pub use git::GitCliPort;
pub use process::{
    bundled_command, command_exists, command_path, resolve_command_path, run_command,
    run_command_allow_failure, run_command_allow_failure_with_env, run_command_with_env,
    subprocess_path_env, version_command,
};
pub use user_paths::{normalize_user_path, parse_user_path, parse_user_path_os};
pub use worktree::{
    build_branch_name, copy_configured_worktree_files, pick_free_port, remove_worktree,
    slugify_title,
};
