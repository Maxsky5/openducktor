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

pub(super) fn spawn_opencode_server_with_config(
    working_directory: &Path,
    config_content: &str,
    port: u16,
) -> Result<Child> {
    let opencode_binary = resolve_opencode_binary_path()
        .ok_or_else(|| anyhow!("opencode binary not found in PATH or ~/.opencode/bin"))?;
    spawn_opencode_server_with_binary(opencode_binary.as_str(), working_directory, config_content, port)
}

fn spawn_opencode_server_with_binary(
    opencode_binary: &str,
    working_directory: &Path,
    config_content: &str,
    port: u16,
) -> Result<Child> {
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

#[cfg(test)]
#[cfg(unix)]
mod tests {
    use super::terminate_child_process;
    use anyhow::{Context, Result};
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    fn temp_test_dir(prefix: &str) -> Result<PathBuf> {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .context("system clock error")?
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("odt-{prefix}-{nanos}"));
        fs::create_dir_all(&dir).with_context(|| format!("failed creating {}", dir.display()))?;
        Ok(dir)
    }

    fn wait_for_capture(path: &Path) -> Result<String> {
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while std::time::Instant::now() < deadline {
            if let Ok(contents) = fs::read_to_string(path) {
                if contents.contains("config=") && contents.contains("args=") {
                    return Ok(contents);
                }
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        Err(anyhow::anyhow!(
            "timed out waiting for complete capture in {}",
            path.display()
        ))
    }

    #[test]
    fn spawn_with_config_injects_config_content_and_args() -> Result<()> {
        let sandbox = temp_test_dir("spawn-with-config")?;
        let output_path = sandbox.join("captured.txt");
        let script_path = sandbox.join("fake-opencode.sh");
        let script = format!(
            r#"#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "opencode-fake 0.0.1"
  exit 0
fi
echo "config=$OPENCODE_CONFIG_CONTENT" > "{}"
echo "args=$*" >> "{}"
sleep 5
"#,
            output_path.display(),
            output_path.display()
        );
        fs::write(&script_path, script)
            .with_context(|| format!("failed writing {}", script_path.display()))?;
        fs::set_permissions(&script_path, fs::Permissions::from_mode(0o755))
            .with_context(|| format!("failed chmod {}", script_path.display()))?;

        let config = r#"{"logLevel":"INFO","mcp":{"openducktor":{"enabled":true}}}"#;
        let mut child = super::spawn_opencode_server_with_binary(
            script_path.to_string_lossy().as_ref(),
            sandbox.as_path(),
            config,
            43123,
        )?;

        let captured = wait_for_capture(output_path.as_path())?;
        assert!(captured.contains("config="), "captured output: {captured}");
        assert!(
            captured.contains(r#""logLevel":"INFO""#),
            "captured output: {captured}"
        );
        assert!(
            captured.contains(r#""openducktor":{"enabled":true}"#),
            "captured output: {captured}"
        );
        assert!(captured.contains("args=serve --hostname 127.0.0.1 --port 43123"));

        terminate_child_process(&mut child);
        fs::remove_dir_all(&sandbox).ok();
        Ok(())
    }
}
