use super::{terminate_child_process, AppService, McpBridgeProcess};
use anyhow::{anyhow, Context, Result};
use host_infra_system::pick_free_port;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const MCP_BRIDGE_READY_TIMEOUT: Duration = Duration::from_secs(5);
const MCP_BRIDGE_HEALTH_PATH: &str = "/health";

fn bridge_base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

fn read_child_pipe(pipe: &mut Option<impl Read>) -> String {
    let Some(mut reader) = pipe.take() else {
        return String::new();
    };
    let mut output = String::new();
    let _ = reader.read_to_string(&mut output);
    output.trim().to_string()
}

fn health_check(port: u16) -> Result<bool> {
    let address: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .context("Invalid localhost MCP bridge address")?;
    let mut stream = match TcpStream::connect_timeout(&address, Duration::from_millis(200)) {
        Ok(stream) => stream,
        Err(_) => return Ok(false),
    };
    stream
        .set_read_timeout(Some(Duration::from_millis(200)))
        .context("Failed setting MCP bridge read timeout")?;
    stream
        .set_write_timeout(Some(Duration::from_millis(200)))
        .context("Failed setting MCP bridge write timeout")?;
    stream
        .write_all(
            format!(
                "GET {MCP_BRIDGE_HEALTH_PATH} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
            )
            .as_bytes(),
        )
        .context("Failed writing MCP bridge health request")?;

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .context("Failed reading MCP bridge health response")?;

    Ok(response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200"))
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
        .arg("-lc")
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
    let current_exe =
        std::env::current_exe().context("Failed to resolve current executable for MCP bridge")?;
    let mut command = Command::new(current_exe);
    command
        .arg("--browser-backend")
        .arg("--port")
        .arg(port.to_string())
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

impl AppService {
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
        *bridge = Some(McpBridgeProcess {
            base_url: base_url.clone(),
            child,
        });
        Ok(base_url)
    }

    pub(crate) fn stop_mcp_bridge_process(&self) -> Result<()> {
        let mut bridge = self
            .mcp_bridge_process
            .lock()
            .map_err(|_| anyhow!("MCP bridge process state lock poisoned"))?;
        if let Some(process) = bridge.as_mut() {
            terminate_child_process(&mut process.child);
        }
        *bridge = None;
        Ok(())
    }
}
