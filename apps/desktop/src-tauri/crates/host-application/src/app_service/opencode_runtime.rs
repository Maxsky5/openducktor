mod mcp_config;
mod process_lifecycle;
mod process_registry;
mod startup_readiness;
#[cfg(test)]
pub(crate) mod test_support;

use crate::app_service::AppService;
use anyhow::Result;
use std::path::Path;
use std::process::Child;

pub(crate) use process_lifecycle::{
    opencode_server_parent_pid, process_exists, read_opencode_version,
    resolve_opencode_binary_path, terminate_child_process, terminate_process_by_pid,
    wait_for_process_exit_by_pid,
};
pub(crate) use process_registry::{
    opencode_process_registry_path, reconcile_opencode_process_registry_on_startup,
    OpenCodeProcessTracker,
};
pub(crate) use startup_readiness::{wait_for_local_server_with_process, StartupCancelEpoch};

impl AppService {
    pub(crate) fn spawn_opencode_server(
        &self,
        working_directory: &Path,
        workspace_id_for_mcp: &str,
        port: u16,
    ) -> Result<Child> {
        let (host_url, host_token) = self.ensure_mcp_bridge_connection()?;
        let config_content = mcp_config::build_opencode_config_content(
            workspace_id_for_mcp,
            host_url.as_str(),
            host_token.as_str(),
        )?;
        process_lifecycle::spawn_opencode_server_with_config(
            working_directory,
            config_content.as_str(),
            port,
        )
    }
}

#[cfg(test)]
pub(crate) use mcp_config::{
    build_opencode_config_content, default_mcp_workspace_root, parse_mcp_command_json,
    resolve_mcp_command,
};
#[cfg(test)]
pub(crate) use process_lifecycle::is_orphaned_opencode_server_process;
#[cfg(test)]
pub(crate) use startup_readiness::wait_for_local_server;
