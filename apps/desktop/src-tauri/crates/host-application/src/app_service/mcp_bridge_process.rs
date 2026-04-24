use super::mcp_bridge_registry::{bridge_base_url, health_check};
use super::{terminate_child_process, AppService, McpBridgeProcess};
use anyhow::{anyhow, Context, Result};
use host_infra_system::pick_free_port;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const MCP_BRIDGE_READY_TIMEOUT: Duration = Duration::from_secs(5);
const MCP_BRIDGE_BINARY_ENV: &str = "OPENDUCKTOR_MCP_BRIDGE_BINARY";
const MCP_BRIDGE_FALLBACK_BINARY_NAME: &str = "openducktor-desktop";

fn read_child_pipe(pipe: &mut Option<impl Read>) -> String {
    let Some(mut reader) = pipe.take() else {
        return String::new();
    };
    let mut output = String::new();
    let _ = reader.read_to_string(&mut output);
    output.trim().to_string()
}

fn wait_for_bridge_ready(child: &mut Child, port: u16) -> Result<()> {
    let deadline = Instant::now() + MCP_BRIDGE_READY_TIMEOUT;
    loop {
        if let Some(status) = child
            .try_wait()
            .context("Failed checking MCP bridge process state")?
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
                "MCP host bridge exited before becoming healthy on 127.0.0.1:{port}: {details}"
            ));
        }

        if health_check(port)? {
            return Ok(());
        }

        if Instant::now() >= deadline {
            return Err(anyhow!(
                "Timed out waiting for the MCP host bridge on 127.0.0.1:{port}"
            ));
        }

        std::thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(unix)]
fn spawn_parent_death_watcher(parent_pid: u32, child_pid: u32) -> Result<()> {
    let watcher_script = format!(
        r#"P={parent_pid}; C={child_pid}; while kill -0 "$P" 2>/dev/null && kill -0 "$C" 2>/dev/null; do sleep 1; done; if ! kill -0 "$P" 2>/dev/null && kill -0 "$C" 2>/dev/null; then kill -TERM "$C" 2>/dev/null || true; sleep 1; kill -KILL "$C" 2>/dev/null || true; fi"#
    );
    Command::new("/bin/sh")
        .arg("-c")
        .arg(watcher_script)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .context("Failed to spawn MCP bridge parent-death watcher")?;
    Ok(())
}

#[cfg(not(unix))]
fn spawn_parent_death_watcher(_parent_pid: u32, _child_pid: u32) -> Result<()> {
    Ok(())
}

fn spawn_mcp_bridge_process(port: u16) -> Result<Child> {
    let bridge_binary = resolve_mcp_bridge_binary_path()?;
    let frontend_origin = format!("http://127.0.0.1:{port}");
    let control_token = uuid::Uuid::new_v4().to_string();
    let app_token = uuid::Uuid::new_v4().to_string();
    let mut command = Command::new(bridge_binary);
    command
        .arg("--web-host")
        .arg("--port")
        .arg(port.to_string())
        .arg("--frontend-origin")
        .arg(frontend_origin)
        .arg("--control-token")
        .arg(control_token)
        .arg("--app-token")
        .arg(app_token)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child = command.spawn().with_context(|| {
        format!("Failed to spawn the MCP host bridge process on 127.0.0.1:{port}")
    })?;
    if let Err(error) = spawn_parent_death_watcher(std::process::id(), child.id()) {
        eprintln!(
            "OpenDucktor warning: failed to attach MCP bridge parent-death watcher for pid {}: {error:#}",
            child.id()
        );
    }
    Ok(child)
}

fn mcp_bridge_fallback_binary_path(parent: &Path) -> PathBuf {
    parent.join(format!(
        "{MCP_BRIDGE_FALLBACK_BINARY_NAME}{}",
        std::env::consts::EXE_SUFFIX
    ))
}

fn resolve_mcp_bridge_binary_path() -> Result<PathBuf> {
    if let Ok(raw) = std::env::var(MCP_BRIDGE_BINARY_ENV) {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(anyhow!(
                "{MCP_BRIDGE_BINARY_ENV} is set but empty. Provide a web-host-capable executable path."
            ));
        }
        return Ok(PathBuf::from(trimmed));
    }

    let current_exe =
        std::env::current_exe().context("Failed to resolve current executable for MCP bridge")?;

    if current_exe
        .file_stem()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value == "browser_backend")
    {
        if let Some(parent) = current_exe.parent() {
            let fallback = mcp_bridge_fallback_binary_path(parent);
            if fallback.is_file() {
                return Ok(fallback);
            }
        }
    }

    Ok(current_exe)
}

impl AppService {
    pub fn ensure_external_mcp_discovery_ready(&self) -> Result<()> {
        self.ensure_mcp_bridge_url().map(|_| ())
    }

    pub fn mcp_bridge_base_url(&self) -> Result<String> {
        self.ensure_mcp_bridge_url()
    }

    pub(crate) fn ensure_mcp_bridge_url(&self) -> Result<String> {
        let mut bridge = self
            .mcp_bridge_process
            .lock()
            .map_err(|_| anyhow!("MCP bridge process state lock poisoned"))?;

        if let Some(process) = bridge.as_mut() {
            if process
                .child
                .try_wait()
                .context("Failed checking MCP bridge process state")?
                .is_none()
            {
                self.register_mcp_bridge_port(process.port)?;
                return Ok(process.base_url.clone());
            }
            *bridge = None;
        }

        let port = pick_free_port()?;
        let mut child = spawn_mcp_bridge_process(port)?;
        if let Err(error) = wait_for_bridge_ready(&mut child, port) {
            terminate_child_process(&mut child);
            return Err(error);
        }

        let base_url = bridge_base_url(port);
        if let Err(error) = self.register_mcp_bridge_port(port) {
            terminate_child_process(&mut child);
            return Err(error);
        }
        *bridge = Some(McpBridgeProcess {
            base_url: base_url.clone(),
            port,
            child,
        });
        Ok(base_url)
    }

    pub(crate) fn stop_mcp_bridge_process(&self) -> Result<()> {
        let mut bridge = self
            .mcp_bridge_process
            .lock()
            .map_err(|_| anyhow!("MCP bridge process state lock poisoned"))?;
        if let Some(mut process) = bridge.take() {
            let port = process.port;
            tracing::debug!(
                target: "openducktor.mcp-bridge",
                port,
                "Stopping MCP host bridge process"
            );
            terminate_child_process(&mut process.child);
            self.unregister_mcp_bridge_port(port)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::mcp_bridge_fallback_binary_path;
    use std::path::Path;

    #[test]
    fn fallback_bridge_binary_appends_platform_executable_suffix() {
        let expected = format!("openducktor-desktop{}", std::env::consts::EXE_SUFFIX);
        let resolved = mcp_bridge_fallback_binary_path(Path::new("/tmp"));

        assert_eq!(
            resolved.file_name().and_then(|value| value.to_str()),
            Some(expected.as_str())
        );
    }
}
