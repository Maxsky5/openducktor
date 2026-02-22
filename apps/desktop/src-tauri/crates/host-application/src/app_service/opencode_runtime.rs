use anyhow::{anyhow, Context, Result};
use host_infra_system::{command_exists, command_path, resolve_central_beads_dir};
use serde_json::json;
use std::io::Read;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

pub(crate) fn parse_mcp_command_json(raw: &str) -> Result<Vec<String>> {
    let parsed: serde_json::Value =
        serde_json::from_str(raw).context("Invalid OPENDUCKTOR_MCP_COMMAND_JSON format")?;
    let values = parsed
        .as_array()
        .ok_or_else(|| anyhow!("OPENDUCKTOR_MCP_COMMAND_JSON must be a JSON string array"))?;

    let command = values
        .iter()
        .map(|entry| {
            entry
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .ok_or_else(|| {
                    anyhow!("OPENDUCKTOR_MCP_COMMAND_JSON must contain only non-empty strings")
                })
        })
        .collect::<Result<Vec<_>>>()?;

    if command.is_empty() {
        return Err(anyhow!("OPENDUCKTOR_MCP_COMMAND_JSON cannot be empty"));
    }
    Ok(command)
}

pub(crate) fn default_mcp_workspace_root() -> Result<String> {
    let from_env = std::env::var("OPENDUCKTOR_WORKSPACE_ROOT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(root) = from_env {
        return Ok(root);
    }

    let compiled_path = Path::new(env!("CARGO_MANIFEST_DIR"));
    let root = compiled_path.ancestors().nth(5).ok_or_else(|| {
        anyhow!("Unable to resolve OpenDucktor workspace root from manifest path")
    })?;
    Ok(root.to_string_lossy().to_string())
}

pub(crate) fn resolve_mcp_command() -> Result<Vec<String>> {
    if let Ok(raw) = std::env::var("OPENDUCKTOR_MCP_COMMAND_JSON") {
        return parse_mcp_command_json(raw.as_str());
    }

    if command_exists("openducktor-mcp") {
        return Ok(vec!["openducktor-mcp".to_string()]);
    }

    if !command_exists("bun") {
        return Err(anyhow!(
            "Missing MCP runner. Install `openducktor-mcp` on PATH or install bun for workspace fallback."
        ));
    }

    let workspace_root = default_mcp_workspace_root()?;
    let direct_entrypoint = Path::new(&workspace_root)
        .join("packages")
        .join("openducktor-mcp")
        .join("src")
        .join("index.ts");

    if direct_entrypoint.exists() {
        return Ok(vec![
            "bun".to_string(),
            direct_entrypoint.to_string_lossy().to_string(),
        ]);
    }

    Ok(vec![
        "bun".to_string(),
        "run".to_string(),
        "--silent".to_string(),
        "--cwd".to_string(),
        workspace_root,
        "--filter".to_string(),
        "@openducktor/openducktor-mcp".to_string(),
        "start".to_string(),
    ])
}

pub(crate) fn build_opencode_config_content(
    repo_path_for_mcp: &Path,
    metadata_namespace: &str,
) -> Result<String> {
    let mcp_command = resolve_mcp_command()?;
    let beads_dir = resolve_central_beads_dir(repo_path_for_mcp)?;
    let config = json!({
        "logLevel": "INFO",
        "mcp": {
            "openducktor": {
                "type": "local",
                "enabled": true,
                "command": mcp_command,
                "environment": {
                    "ODT_REPO_PATH": repo_path_for_mcp.to_string_lossy().to_string(),
                    "ODT_BEADS_DIR": beads_dir.to_string_lossy().to_string(),
                    "ODT_METADATA_NAMESPACE": metadata_namespace,
                }
            }
        }
    });
    serde_json::to_string(&config).context("Failed to serialize OpenCode MCP config")
}

pub(crate) fn read_opencode_version(binary: &str) -> Option<String> {
    let mut command = Command::new(binary);
    command
        .arg("--version")
        .env("OPENCODE_CONFIG_CONTENT", r#"{"logLevel":"INFO"}"#)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
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

pub(crate) fn resolve_opencode_binary_path() -> Option<String> {
    if let Ok(override_binary) = std::env::var("OPENDUCKTOR_OPENCODE_BINARY") {
        let trimmed = override_binary.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    if let Some(resolved) = command_path("opencode") {
        return Some(resolved);
    }

    let home = std::env::var_os("HOME")?;
    let candidate = PathBuf::from(home)
        .join(".opencode")
        .join("bin")
        .join("opencode");
    if candidate.is_file() {
        return candidate.to_str().map(|value| value.to_string());
    }

    None
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_process_group(_command: &mut Command) {}

#[cfg(unix)]
fn terminate_process_group_if_owned(child: &Child) {
    let pid = child.id() as i32;
    if pid <= 0 {
        return;
    }
    let pgid = unsafe { libc::getpgid(pid) };
    if pgid == pid {
        unsafe {
            libc::killpg(pid, libc::SIGTERM);
        }
    }
}

#[cfg(not(unix))]
fn terminate_process_group_if_owned(_child: &Child) {}

pub(crate) fn terminate_child_process(child: &mut Child) {
    terminate_process_group_if_owned(child);
    let _ = child.kill();
    let _ = child.wait();
}

pub(crate) fn spawn_opencode_server(
    working_directory: &Path,
    repo_path_for_mcp: &Path,
    metadata_namespace: &str,
    port: u16,
) -> Result<Child> {
    let config_content = build_opencode_config_content(repo_path_for_mcp, metadata_namespace)?;
    let opencode_binary = resolve_opencode_binary_path()
        .ok_or_else(|| anyhow!("opencode binary not found in PATH or ~/.opencode/bin"))?;
    let mut command = Command::new(&opencode_binary);
    command
        .arg("serve")
        .arg("--hostname")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .env("OPENCODE_CONFIG_CONTENT", config_content)
        .current_dir(working_directory)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);
    command.spawn().with_context(|| {
        format!(
            "Failed to spawn opencode serve with binary {}",
            opencode_binary
        )
    })
}

#[cfg(test)]
pub(crate) fn wait_for_local_server(port: u16, timeout: Duration) -> Result<()> {
    let deadline = Instant::now() + timeout;
    let address: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .context("Invalid localhost address")?;

    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(150));
    }

    Err(anyhow!(
        "Timed out waiting for OpenCode runtime on 127.0.0.1:{}",
        port
    ))
}

fn read_child_pipe(pipe: &mut Option<impl Read>) -> String {
    let Some(mut reader) = pipe.take() else {
        return String::new();
    };
    let mut output = String::new();
    let _ = reader.read_to_string(&mut output);
    output.trim().to_string()
}

pub(crate) fn wait_for_local_server_with_process(
    child: &mut Child,
    port: u16,
    timeout: Duration,
) -> Result<()> {
    let deadline = Instant::now() + timeout;
    let address: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .context("Invalid localhost address")?;

    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok() {
            return Ok(());
        }

        if let Some(status) = child
            .try_wait()
            .context("Failed checking OpenCode process state")?
        {
            let stderr = read_child_pipe(&mut child.stderr);
            let stdout = read_child_pipe(&mut child.stdout);
            let details = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                format!("process exited with status {status}")
            };
            return Err(anyhow!(
                "OpenCode process exited before runtime became reachable: {details}"
            ));
        }

        std::thread::sleep(Duration::from_millis(150));
    }

    Err(anyhow!(
        "Timed out waiting for OpenCode runtime on 127.0.0.1:{}",
        port
    ))
}
