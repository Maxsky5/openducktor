use super::terminal::{
    format_terminal_system_message, push_terminal_chunk, spawn_terminal_forwarder,
};
use super::{AppService, DevServerGroupRuntime};
use anyhow::{anyhow, Context, Result};
use host_domain::{now_rfc3339, DevServerEvent, DevServerScriptStatus};
use host_infra_system::{subprocess_path_env, RepoDevServerScript};
use std::collections::HashMap;
#[cfg(unix)]
use std::fs::File;
use std::io::Read;
#[cfg(unix)]
use std::os::fd::FromRawFd;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

pub(super) const DEV_SERVER_STOP_TIMEOUT: Duration = Duration::from_secs(3);
const DEV_SERVER_START_GRACE_PERIOD: Duration = Duration::from_millis(150);

impl AppService {
    pub(super) fn start_dev_server_script(
        &self,
        group_key: &str,
        repo_path: &str,
        task_id: &str,
        worktree_path: &str,
        script: RepoDevServerScript,
    ) -> Result<u32> {
        let script_display_name = sanitize_dev_server_display_name(script.name.as_str());
        self.update_script_state(group_key, script.id.as_str(), |state| {
            state.status = DevServerScriptStatus::Starting;
            state.pid = None;
            state.started_at = None;
            state.exit_code = None;
            state.last_error = None;
            state.buffered_terminal_chunks.clear();
        })?;
        self.append_terminal_system_message(
            group_key,
            repo_path,
            task_id,
            script.id.as_str(),
            format!("Starting `{}`", script.command),
        );

        let mut spawned_pid = None;
        let mut start_failure_already_recorded = false;
        let start_result = (|| -> Result<u32> {
            let mut command =
                build_dev_server_command(script.command.as_str(), script.name.as_str())?;
            command.current_dir(worktree_path);
            let path_value = subprocess_path_env().ok_or_else(|| {
                anyhow!(
                    "Failed to assemble subprocess PATH for dev server `{}`",
                    script.name
                )
            })?;
            command.env("PATH", path_value);
            configure_process_group(&mut command);

            #[cfg(unix)]
            let terminal_reader: Box<dyn Read + Send> = {
                let (terminal_reader, terminal_writer) = open_pty_pair()?;
                let stdout_writer = terminal_writer
                    .try_clone()
                    .context("Failed duplicating pseudo terminal handle for dev server stdout")?;
                command.stdout(Stdio::from(stdout_writer));
                command.stderr(Stdio::from(terminal_writer));
                Box::new(terminal_reader)
            };

            #[cfg(not(unix))]
            return Err(anyhow!(
                "Builder dev servers require PTY-backed terminal capture and are only supported on Unix hosts in this build."
            ));

            #[cfg(unix)]
            let mut child = command.spawn().with_context(|| {
                format!(
                    "Failed to start dev server {} in {} using command `{}`",
                    script_display_name, worktree_path, script.command
                )
            })?;

            #[cfg(not(unix))]
            let mut child = command.spawn().with_context(|| {
                format!(
                    "Failed to start dev server {} in {} using command `{}`",
                    script_display_name, worktree_path, script.command
                )
            })?;
            let pid = child.id();
            spawned_pid = Some(pid);

            #[cfg(unix)]
            if let Err(error) = spawn_dev_server_parent_death_watcher(std::process::id(), pid) {
                eprintln!(
                    "OpenDucktor warning: failed to attach dev server parent-death watcher for pid {}: {error:#}",
                    pid
                );
            }

            let started_at = now_rfc3339();

            spawn_terminal_forwarder(
                self.dev_server_groups.clone(),
                group_key.to_string(),
                repo_path.to_string(),
                task_id.to_string(),
                script.id.clone(),
                terminal_reader,
            );

            self.update_script_state(group_key, script.id.as_str(), |state| {
                state.status = DevServerScriptStatus::Starting;
                state.pid = Some(pid);
                state.started_at = Some(started_at.clone());
                state.exit_code = None;
                state.last_error = None;
            })?;

            if let Some(status) =
                wait_for_immediate_dev_server_exit(&mut child, DEV_SERVER_START_GRACE_PERIOD)?
            {
                let message = dev_server_exit_message(status.code());
                self.mark_dev_server_start_exit_failed(
                    group_key,
                    repo_path,
                    task_id,
                    script.id.as_str(),
                    status.code(),
                    message.as_str(),
                );
                spawned_pid = None;
                start_failure_already_recorded = true;
                return Err(anyhow!(message));
            }

            self.update_script_state(group_key, script.id.as_str(), |state| {
                state.status = DevServerScriptStatus::Running;
                state.pid = Some(pid);
                state.started_at = Some(started_at.clone());
                state.exit_code = None;
                state.last_error = None;
            })?;

            spawn_waiter(
                self.dev_server_groups.clone(),
                group_key.to_string(),
                repo_path.to_string(),
                task_id.to_string(),
                script.id.clone(),
                pid,
                child,
            );
            Ok(pid)
        })();

        if let Err(error) = start_result {
            let mut message = format!("{error:#}");
            if let Some(pid) = spawned_pid {
                if let Err(stop_error) = stop_process_group(pid, DEV_SERVER_STOP_TIMEOUT) {
                    message = format!(
                        "{message}\nFailed stopping partially started dev server {} (pid {pid}): {stop_error:#}",
                        script_display_name
                    );
                }
            }
            if !start_failure_already_recorded {
                self.mark_dev_server_start_failed(
                    group_key,
                    repo_path,
                    task_id,
                    script.id.as_str(),
                    message.as_str(),
                );
            }
            return Err(anyhow!(message));
        }

        start_result
    }
}

fn wait_for_immediate_dev_server_exit(
    child: &mut std::process::Child,
    timeout: Duration,
) -> Result<Option<std::process::ExitStatus>> {
    let poll_interval = Duration::from_millis(25);
    let mut waited = Duration::ZERO;
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(Some(status));
        }
        if waited >= timeout {
            return Ok(None);
        }
        thread::sleep(poll_interval);
        waited = waited.saturating_add(poll_interval);
    }
}

fn dev_server_exit_message(exit_code: Option<i32>) -> String {
    if let Some(code) = exit_code {
        format!("Dev server exited with code {code}.")
    } else {
        "Dev server exited after receiving a signal.".to_string()
    }
}

fn sanitize_dev_server_display_name(script_name: &str) -> String {
    const DISPLAY_NAME_LIMIT: usize = 80;

    let mut sanitized = String::new();
    for ch in script_name.chars() {
        match ch {
            '\n' => sanitized.push_str("\\n"),
            '\r' => sanitized.push_str("\\r"),
            '\t' => sanitized.push_str("\\t"),
            _ if ch.is_control() => sanitized.push(' '),
            _ => sanitized.push(ch),
        }

        if sanitized.chars().count() > DISPLAY_NAME_LIMIT {
            sanitized = sanitized.chars().take(DISPLAY_NAME_LIMIT).collect();
            sanitized.push_str("...");
            return sanitized;
        }
    }

    sanitized.trim().to_string()
}

#[cfg(unix)]
fn build_dev_server_command(command: &str, script_name: &str) -> Result<Command> {
    if command.trim().is_empty() {
        let script_name = sanitize_dev_server_display_name(script_name);
        return Err(anyhow!(
            "Dev server command is empty for {}. Provide a command to run.",
            script_name
        ));
    }

    let mut process = Command::new("/bin/sh");
    process.arg("-c");
    process.arg(command);
    Ok(process)
}

#[cfg(not(unix))]
fn build_dev_server_command(command: &str, script_name: &str) -> Result<Command> {
    let script_name = sanitize_dev_server_display_name(script_name);
    let parsed = shell_words::split(command).map_err(|error| {
        anyhow!(
            "Invalid dev server command syntax for {}. Use argv tokens, or explicitly invoke a shell (for example: sh -lc '...'): {error}",
            script_name
        )
    })?;
    let (program, args) = parsed.split_first().ok_or_else(|| {
        anyhow!(
            "Dev server command is empty for {}. Provide an executable name.",
            script_name
        )
    })?;

    let mut process = Command::new(program);
    process.args(args);
    Ok(process)
}

#[cfg(unix)]
fn open_pty_pair() -> Result<(File, File)> {
    let mut master_fd = 0;
    let mut slave_fd = 0;
    let result = unsafe {
        libc::openpty(
            &mut master_fd,
            &mut slave_fd,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if result != 0 {
        return Err(anyhow!(
            "Failed creating pseudo terminal for dev server logs: {}",
            std::io::Error::last_os_error()
        ));
    }

    let master = unsafe { File::from_raw_fd(master_fd) };
    let slave = unsafe { File::from_raw_fd(slave_fd) };
    Ok((master, slave))
}

fn spawn_waiter(
    groups: Arc<Mutex<HashMap<String, DevServerGroupRuntime>>>,
    group_key: String,
    repo_path: String,
    task_id: String,
    script_id: String,
    pid: u32,
    mut child: std::process::Child,
) {
    std::thread::spawn(move || {
        let status = child.wait();
        let (exit_code, message) = match status {
            Ok(status) => (status.code(), dev_server_exit_message(status.code())),
            Err(error) => (None, format!("Failed waiting for dev server exit: {error}")),
        };

        let mut emitted_terminal_chunk = None;
        let (emitter, script, updated_at) = {
            let Ok(mut groups) = groups.lock() else {
                return;
            };
            let Some(runtime) = groups.get_mut(group_key.as_str()) else {
                return;
            };
            let Some(script) = runtime
                .state
                .scripts
                .iter_mut()
                .find(|script| script.script_id == script_id)
            else {
                return;
            };
            if script.pid != Some(pid) {
                return;
            }
            let expected_stop = matches!(script.status, DevServerScriptStatus::Stopping);
            script.pid = None;
            script.started_at = None;
            script.exit_code = exit_code;
            if expected_stop {
                script.status = DevServerScriptStatus::Stopped;
                script.last_error = None;
            } else {
                script.status = DevServerScriptStatus::Failed;
                script.last_error = Some(message.clone());
                emitted_terminal_chunk = Some(push_terminal_chunk(
                    script,
                    format_terminal_system_message(message.as_str()),
                    now_rfc3339(),
                ));
            }
            runtime.state.updated_at = now_rfc3339();
            (
                runtime.emitter.clone(),
                script.clone(),
                runtime.state.updated_at.clone(),
            )
        };

        if let Some(emitter) = emitter {
            if let Some(terminal_chunk) = emitted_terminal_chunk {
                emitter(DevServerEvent::TerminalChunk {
                    repo_path: repo_path.clone(),
                    task_id: task_id.clone(),
                    terminal_chunk,
                });
            }
            emitter(DevServerEvent::ScriptStatusChanged {
                repo_path,
                task_id,
                script,
                updated_at,
            });
        }
    });
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_process_group(_command: &mut Command) {}

#[cfg(unix)]
pub(super) fn spawn_dev_server_parent_death_watcher(parent_pid: u32, child_pid: u32) -> Result<()> {
    let watcher_script = format!(
        r#"P={parent_pid}; C={child_pid}; while kill -0 "$P" 2>/dev/null && kill -0 "$C" 2>/dev/null; do sleep 1; done; if ! kill -0 "$P" 2>/dev/null && kill -0 "$C" 2>/dev/null; then kill -TERM -"$C" 2>/dev/null || true; sleep 1; kill -KILL -"$C" 2>/dev/null || true; kill -KILL "$C" 2>/dev/null || true; fi"#
    );
    Command::new("/bin/sh")
        .arg("-c")
        .arg(watcher_script)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .context("Failed to spawn dev server parent-death watcher")?;
    Ok(())
}

#[cfg(not(unix))]
pub(super) fn spawn_dev_server_parent_death_watcher(
    _parent_pid: u32,
    _child_pid: u32,
) -> Result<()> {
    Ok(())
}

#[cfg(unix)]
pub(super) fn stop_process_group(pid: u32, timeout: Duration) -> Result<()> {
    let pid =
        i32::try_from(pid).map_err(|_| anyhow!("Invalid process id for dev server: {pid}"))?;
    if pid <= 0 {
        return Err(anyhow!("Invalid process id for dev server: {pid}"));
    }
    let wait_pid = pid as u32;
    let term_result = unsafe { libc::killpg(pid, libc::SIGTERM) };
    if term_result != 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            return Ok(());
        }
        return Err(anyhow!(
            "Failed sending SIGTERM to process group {pid}: {error}"
        ));
    }
    if super::super::wait_for_process_exit_by_pid(wait_pid, timeout) {
        return Ok(());
    }
    let kill_result = unsafe { libc::killpg(pid, libc::SIGKILL) };
    if kill_result != 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            return Ok(());
        }
        return Err(anyhow!(
            "Failed sending SIGKILL to process group {pid}: {error}"
        ));
    }
    if super::super::wait_for_process_exit_by_pid(wait_pid, timeout) {
        return Ok(());
    }
    Err(anyhow!(
        "Timed out waiting for process group {pid} to stop after SIGTERM and SIGKILL"
    ))
}

#[cfg(not(unix))]
pub(super) fn stop_process_group(pid: u32, timeout: Duration) -> Result<()> {
    let _ = (pid, timeout);
    Err(anyhow!(
        "Builder dev servers are only supported on Unix hosts in this build."
    ))
}
