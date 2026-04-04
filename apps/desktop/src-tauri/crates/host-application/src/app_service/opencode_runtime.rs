mod mcp_config;
mod process_lifecycle;
mod startup_readiness;

use anyhow::Result;
use std::path::Path;
use std::process::Child;

pub(crate) use process_lifecycle::{
    opencode_server_parent_pid, process_exists, read_opencode_version,
    resolve_opencode_binary_path, terminate_child_process, terminate_process_by_pid,
    wait_for_process_exit_by_pid,
};
pub use startup_readiness::OpencodeStartupWaitFailure;
pub(crate) use startup_readiness::{
    wait_for_local_server_with_process, OpencodeStartupReadinessPolicy, OpencodeStartupWaitReport,
    StartupCancelEpoch,
};

pub(crate) fn spawn_opencode_server(
    working_directory: &Path,
    repo_path_for_mcp: &Path,
    metadata_namespace: &str,
    port: u16,
) -> Result<Child> {
    let config_content =
        mcp_config::build_opencode_config_content(repo_path_for_mcp, metadata_namespace)?;
    process_lifecycle::spawn_opencode_server_with_config(
        working_directory,
        config_content.as_str(),
        port,
    )
}

#[cfg(test)]
pub(crate) use mcp_config::{
    build_opencode_config_content, default_mcp_workspace_root, find_openducktor_workspace_root,
    parse_mcp_command_json, resolve_mcp_command,
};
#[cfg(test)]
pub(crate) use process_lifecycle::is_orphaned_opencode_server_process;
#[cfg(test)]
pub(crate) use startup_readiness::wait_for_local_server;
