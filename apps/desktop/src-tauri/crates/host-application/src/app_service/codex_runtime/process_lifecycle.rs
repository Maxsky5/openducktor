use crate::app_service::terminate_child_process;
use anyhow::{Context, Result};
use host_infra_system::{
    bundled_command, parse_user_path, resolve_command_path, subprocess_path_env,
};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

pub(super) const CODEX_ODT_TOOL_IDS: [&str; 10] = [
    "odt_read_task",
    "odt_read_task_documents",
    "odt_set_spec",
    "odt_set_plan",
    "odt_build_blocked",
    "odt_build_resumed",
    "odt_build_completed",
    "odt_set_pull_request",
    "odt_qa_approved",
    "odt_qa_rejected",
];

const CODEX_MCP_ENV_VARS: [&str; 5] = [
    "ODT_WORKSPACE_ID",
    "ODT_HOST_URL",
    "ODT_HOST_TOKEN",
    "ODT_FORBID_WORKSPACE_ID_INPUT",
    "ODT_ALLOWED_TOOLS",
];

pub(crate) fn read_codex_version(binary: &str) -> Option<String> {
    let mut command = Command::new(binary);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(path_value) = subprocess_path_env() {
        command.env("PATH", path_value);
    }
    configure_process_group(&mut command);

    let mut child = command.spawn().ok()?;
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match child.try_wait().ok()? {
            Some(status) => {
                if !status.success() {
                    return None;
                }
                let output = child.wait_with_output().ok()?;
                let stdout = String::from_utf8_lossy(&output.stdout);
                return stdout
                    .lines()
                    .find(|line| !line.trim().is_empty())
                    .map(|line| line.trim().to_string());
            }
            None => {
                if Instant::now() >= deadline {
                    terminate_child_process(&mut child);
                    return None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

pub(crate) fn resolve_codex_binary_path() -> Option<String> {
    if let Ok(override_binary) = std::env::var("OPENDUCKTOR_CODEX_BINARY") {
        if override_binary.trim().is_empty() {
            return None;
        }
        if let Ok(path) = parse_user_path(override_binary.as_str()) {
            return Some(path.to_string_lossy().to_string());
        }
        return Some(override_binary);
    }

    if let Some(resolved) = bundled_command("codex") {
        return Some(resolved);
    }

    resolve_command_path("codex").ok().flatten()
}

pub(super) fn spawn_codex_app_server_with_binary(
    codex_binary: &str,
    working_directory: &Path,
    workspace_id_for_mcp: &str,
    host_url: &str,
    host_token: &str,
    runtime_id: &str,
) -> Result<Child> {
    let mut command = Command::new(codex_binary);
    tracing::info!(
        target: "openducktor.lifecycle",
        "Starting Codex app-server runtime {runtime_id} for {}",
        working_directory.display()
    );
    configure_codex_mcp_args(&mut command)?;
    configure_codex_mcp_env(&mut command, workspace_id_for_mcp, host_url, host_token);
    command
        .arg("app-server")
        .current_dir(working_directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(path_value) = subprocess_path_env() {
        command.env("PATH", path_value);
    }
    configure_process_group(&mut command);
    command
        .spawn()
        .with_context(|| format!("Failed to spawn codex app-server with binary {codex_binary}"))
}

fn toml_string(value: &str) -> Result<String> {
    serde_json::to_string(value).context("Failed to serialize Codex MCP config string")
}

fn toml_string_array(values: &[String]) -> Result<String> {
    let entries = values
        .iter()
        .map(|value| toml_string(value))
        .collect::<Result<Vec<_>>>()?;
    Ok(format!("[{}]", entries.join(", ")))
}

fn configure_codex_mcp_env(
    command: &mut Command,
    workspace_id_for_mcp: &str,
    host_url: &str,
    host_token: &str,
) {
    let allowed_tools = CODEX_ODT_TOOL_IDS.join(",");
    command
        .env("ODT_WORKSPACE_ID", workspace_id_for_mcp)
        .env("ODT_HOST_URL", host_url)
        .env("ODT_HOST_TOKEN", host_token)
        .env("ODT_FORBID_WORKSPACE_ID_INPUT", "true")
        .env("ODT_ALLOWED_TOOLS", allowed_tools);
}

fn configure_codex_mcp_args(command: &mut Command) -> Result<()> {
    let mcp_command = crate::app_service::opencode_runtime::mcp_config::resolve_mcp_command()?;
    let (mcp_binary, mcp_args) = mcp_command
        .split_first()
        .context("OpenDucktor MCP command cannot be empty")?;

    for config in [
        format!(
            "mcp_servers.openducktor.command={}",
            toml_string(mcp_binary)?
        ),
        format!(
            "mcp_servers.openducktor.args={}",
            toml_string_array(mcp_args)?
        ),
        format!(
            "mcp_servers.openducktor.env_vars={}",
            toml_string_array(
                &CODEX_MCP_ENV_VARS
                    .iter()
                    .map(|value| (*value).to_string())
                    .collect::<Vec<_>>()
            )?
        ),
        "mcp_servers.openducktor.enabled=true".to_string(),
    ] {
        command.arg("--config").arg(config);
    }
    Ok(())
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_process_group(_command: &mut Command) {}
