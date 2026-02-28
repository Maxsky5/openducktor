use super::mcp_config::build_opencode_config_content;
use anyhow::{anyhow, Context, Result};
use host_infra_system::command_path;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

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
    terminate_process_group_if_owned_pid(child.id());
}

#[cfg(unix)]
fn terminate_process_group_if_owned_pid(pid: u32) {
    let pid = pid as i32;
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

#[cfg(not(unix))]
fn terminate_process_group_if_owned_pid(_pid: u32) {}

pub(crate) fn terminate_child_process(child: &mut Child) {
    terminate_process_group_if_owned(child);
    let _ = child.kill();
    let _ = child.wait();
}

pub(crate) fn terminate_process_by_pid(pid: u32) {
    terminate_process_group_if_owned_pid(pid);
    #[cfg(unix)]
    {
        let pid = pid as i32;
        if pid > 0 {
            unsafe {
                libc::kill(pid, libc::SIGKILL);
            }
        }
    }
}

fn read_process_snapshot(pid: u32) -> Option<(u32, String)> {
    let output = Command::new("ps")
        .arg("-o")
        .arg("ppid=")
        .arg("-o")
        .arg("command=")
        .arg("-p")
        .arg(pid.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .find(|entry| !entry.trim().is_empty())?
        .trim()
        .to_string();
    let split_index = line.find(char::is_whitespace)?;
    let ppid = line[..split_index].trim().parse::<u32>().ok()?;
    let command = line[split_index..].trim_start().to_string();
    Some((ppid, command))
}

pub(crate) fn process_exists(pid: u32) -> bool {
    read_process_snapshot(pid).is_some()
}

fn is_opencode_server_command(command: &str) -> bool {
    let normalized = command.to_ascii_lowercase();
    normalized.contains("opencode")
        && normalized.contains(" serve")
        && normalized.contains("--hostname")
        && normalized.contains("127.0.0.1")
}

pub(crate) fn opencode_server_parent_pid(pid: u32) -> Option<u32> {
    let (ppid, command) = read_process_snapshot(pid)?;
    if is_opencode_server_command(command.as_str()) {
        Some(ppid)
    } else {
        None
    }
}

#[cfg(test)]
pub(crate) fn is_orphaned_opencode_server_process(pid: u32) -> bool {
    matches!(opencode_server_parent_pid(pid), Some(1))
}

#[cfg(unix)]
fn spawn_parent_death_watcher(parent_pid: u32, child_pid: u32) -> Result<()> {
    let watcher_script = format!(
        r#"P={parent_pid}; C={child_pid}; while kill -0 "$P" 2>/dev/null && kill -0 "$C" 2>/dev/null; do sleep 1; done; if ! kill -0 "$P" 2>/dev/null && kill -0 "$C" 2>/dev/null; then kill -TERM -"$C" 2>/dev/null || true; sleep 1; kill -KILL -"$C" 2>/dev/null || true; kill -KILL "$C" 2>/dev/null || true; fi"#
    );
    Command::new("/bin/sh")
        .arg("-lc")
        .arg(watcher_script)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .context("Failed to spawn OpenCode parent-death watcher")?;
    Ok(())
}

#[cfg(not(unix))]
fn spawn_parent_death_watcher(_parent_pid: u32, _child_pid: u32) -> Result<()> {
    Ok(())
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
    let child = command.spawn().with_context(|| {
        format!(
            "Failed to spawn opencode serve with binary {}",
            opencode_binary
        )
    })?;
    if let Err(error) = spawn_parent_death_watcher(std::process::id(), child.id()) {
        eprintln!(
            "OpenDucktor warning: failed to attach OpenCode parent-death watcher for pid {}: {error:#}",
            child.id()
        );
    }
    Ok(child)
}
