#[path = "beads/repo_paths.rs"]
mod repo_paths;
#[path = "beads/shared_dolt_server.rs"]
mod shared_dolt_server;

pub use repo_paths::{
    compute_beads_database_name, compute_repo_id, compute_repo_slug, resolve_beads_root,
    resolve_default_worktree_base_dir, resolve_dolt_config_dir, resolve_dolt_config_file,
    resolve_effective_worktree_base_dir, resolve_repo_beads_attachment_dir,
    resolve_repo_beads_attachment_root, resolve_repo_beads_paths, resolve_repo_live_database_dir,
    resolve_server_lock_file, resolve_server_state_file, resolve_shared_dolt_root,
    resolve_shared_server_root, RepoBeadsPaths,
};
pub use shared_dolt_server::{
    ensure_shared_dolt_server_running, read_shared_dolt_server_state,
    restore_shared_dolt_database_from_backup, stop_shared_dolt_server_for_current_owner,
    SharedDoltServerState, SHARED_DOLT_SERVER_HOST, SHARED_DOLT_SERVER_USER,
};

#[cfg(test)]
pub(crate) use shared_dolt_server::{
    deterministic_shared_dolt_port_candidate, is_process_alive,
    process_matches_expected_dolt_server, wrap_port_candidate, write_dolt_config_file,
    SHARED_DOLT_PORT_RANGE_LEN, SHARED_DOLT_PORT_RANGE_START,
};

#[cfg(test)]
#[path = "beads/tests.rs"]
mod tests;
