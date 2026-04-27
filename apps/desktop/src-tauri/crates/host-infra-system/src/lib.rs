mod beads;
mod config;
mod filesystem;
mod git;
mod open_in;
mod process;
mod user_paths;
mod worktree;

pub use beads::{
    compute_beads_database_name, compute_beads_database_name_for_workspace, compute_repo_id,
    compute_repo_slug, compute_workspace_repo_id, ensure_shared_dolt_server_running,
    is_process_alive, read_shared_dolt_server_state, resolve_beads_root,
    resolve_default_worktree_base_dir, resolve_default_worktree_base_dir_for_workspace,
    resolve_dolt_config_dir, resolve_dolt_config_file, resolve_effective_worktree_base_dir,
    resolve_effective_worktree_base_dir_for_workspace, resolve_repo_beads_attachment_dir,
    resolve_repo_beads_attachment_root, resolve_repo_live_database_dir, resolve_server_lock_file,
    resolve_server_state_file, resolve_shared_dolt_root, resolve_shared_server_root,
    resolve_workspace_beads_attachment_dir, resolve_workspace_beads_attachment_root,
    resolve_workspace_live_database_dir, restore_shared_dolt_database_from_backup,
    stop_shared_dolt_server_for_current_owner, SharedDoltServerAcquisition, SharedDoltServerState,
    SHARED_DOLT_SERVER_HOST, SHARED_DOLT_SERVER_USER,
};
pub use config::{
    derive_workspace_name_from_repo_path, normalize_hook_set, normalize_repo_dev_servers,
    propose_workspace_id, uniquify_workspace_id, AgentDefaults, AgentModelDefault, AppConfigStore,
    AutopilotActionId, AutopilotEventId, AutopilotRule, AutopilotSettings, ChatSettings,
    GitMergeMethod, GitProviderConfig, GitProviderRepository, GitTargetBranch, GlobalConfig,
    GlobalGitConfig, HookSet, KanbanSettings, OpencodeStartupReadinessConfig, PromptOverride,
    PromptOverrides, RepoConfig, RepoDevServerScript, RepoGitConfig, RuntimeConfig,
    RuntimeConfigStore, SchedulerConfig, SoftGuardrails,
};
pub use filesystem::{list_directory, FilesystemListDirectoryError};
pub use git::GitCliPort;
pub use open_in::{discover_open_in_tools, open_directory_in_tool};
pub use process::{
    bundled_command, command_exists, command_path, resolve_command_path, run_command,
    run_command_allow_failure, run_command_allow_failure_with_env, run_command_with_env,
    subprocess_path_env, version_command,
};
pub use user_paths::{normalize_user_path, parse_user_path, parse_user_path_os};
pub use worktree::{
    build_branch_name, copy_configured_worktree_files, pick_free_port, remove_worktree,
    remove_worktree_path_if_present, slugify_title,
};
