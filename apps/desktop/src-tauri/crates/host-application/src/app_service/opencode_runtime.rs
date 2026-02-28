mod mcp_config;
mod process_lifecycle;
mod startup_readiness;

pub(crate) use process_lifecycle::{
    opencode_server_parent_pid, process_exists, read_opencode_version, resolve_opencode_binary_path,
    spawn_opencode_server, terminate_child_process, terminate_process_by_pid,
};
pub(crate) use startup_readiness::{
    wait_for_local_server_with_process, OpencodeStartupReadinessPolicy, OpencodeStartupWaitReport,
    StartupCancelEpoch,
};

#[cfg(test)]
pub(crate) use mcp_config::{
    build_opencode_config_content, default_mcp_workspace_root, parse_mcp_command_json,
    resolve_mcp_command,
};
#[cfg(test)]
pub(crate) use process_lifecycle::is_orphaned_opencode_server_process;
#[cfg(test)]
pub(crate) use startup_readiness::wait_for_local_server;
