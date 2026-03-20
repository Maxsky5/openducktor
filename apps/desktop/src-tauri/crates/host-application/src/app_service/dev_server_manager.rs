use super::{validate_hook_trust, AppService, DevServerEmitter, DevServerGroupRuntime};
use anyhow::{anyhow, Context, Result};
use host_domain::{
    now_rfc3339, DevServerEvent, DevServerGroupState, DevServerLogLine, DevServerLogStream,
    DevServerScriptState, DevServerScriptStatus,
};
use host_infra_system::{RepoConfig, RepoDevServerScript};
use std::collections::HashMap;
#[cfg(unix)]
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
#[cfg(unix)]
use std::os::fd::FromRawFd;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

const DEV_SERVER_LOG_BUFFER_LIMIT: usize = 2_000;
const DEV_SERVER_STOP_TIMEOUT: Duration = Duration::from_secs(3);
const DEV_SERVER_START_GRACE_PERIOD: Duration = Duration::from_millis(150);

impl AppService {
    pub fn dev_server_get_state(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<DevServerGroupState> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        let repo_config = self.config_store.repo_config(repo_path.as_str())?;
        let worktree_path = self.resolve_dev_server_worktree_path(repo_path.as_str(), task_id);
        let key = dev_server_group_key(repo_path.as_str(), task_id);
        let mut groups = self
            .dev_server_groups
            .lock()
            .map_err(|_| anyhow!("Dev server state lock poisoned"))?;
        let runtime = groups.entry(key).or_insert_with(|| DevServerGroupRuntime {
            state: build_group_state(
                repo_path.as_str(),
                task_id,
                worktree_path.clone(),
                &repo_config,
            ),
            emitter: None,
        });
        sync_group_state(
            &mut runtime.state,
            repo_path.as_str(),
            task_id,
            worktree_path,
            &repo_config,
        );
        Ok(runtime.state.clone())
    }

    pub fn dev_server_start(
        &self,
        repo_path: &str,
        task_id: &str,
        emitter: DevServerEmitter,
    ) -> Result<DevServerGroupState> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        let repo_config = self.config_store.repo_config(repo_path.as_str())?;
        if repo_config.dev_servers.is_empty() {
            return Err(anyhow!(
                "No builder dev server scripts are configured for {repo_path}. Add them in repository settings first."
            ));
        }
        validate_hook_trust(repo_path.as_str(), &repo_config)?;
        let worktree_path = self
            .build_continuation_target_get(repo_path.as_str(), task_id)?
            .working_directory;
        let key = dev_server_group_key(repo_path.as_str(), task_id);

        {
            let mut groups = self
                .dev_server_groups
                .lock()
                .map_err(|_| anyhow!("Dev server state lock poisoned"))?;
            let runtime = groups
                .entry(key.clone())
                .or_insert_with(|| DevServerGroupRuntime {
                    state: build_group_state(
                        repo_path.as_str(),
                        task_id,
                        Some(worktree_path.clone()),
                        &repo_config,
                    ),
                    emitter: Some(emitter.clone()),
                });
            runtime.emitter = Some(emitter.clone());
            sync_group_state(
                &mut runtime.state,
                repo_path.as_str(),
                task_id,
                Some(worktree_path.clone()),
                &repo_config,
            );
            if runtime.state.scripts.iter().any(script_has_live_process) {
                return Err(anyhow!(
                    "Dev servers are already running for task {task_id}. Stop or restart them instead."
                ));
            }
        }

        emit_group_snapshot(self.dev_server_groups.clone(), &key);

        let mut errors = Vec::new();
        let mut started_scripts = Vec::new();
        for script in repo_config.dev_servers.iter().cloned() {
            let script_id = script.id.clone();
            match self.start_dev_server_script(
                key.as_str(),
                repo_path.as_str(),
                task_id,
                worktree_path.as_str(),
                script,
            ) {
                Ok(pid) => started_scripts.push((script_id, pid)),
                Err(error) => errors.push(error.to_string()),
            }
        }

        if !errors.is_empty() {
            let rollback_errors =
                self.rollback_started_dev_server_scripts(key.as_str(), started_scripts);
            if !rollback_errors.is_empty() {
                errors.extend(rollback_errors);
            }
        }

        let state = self.dev_server_get_state(repo_path.as_str(), task_id)?;
        emit_group_snapshot(self.dev_server_groups.clone(), &key);
        if errors.is_empty() {
            Ok(state)
        } else {
            Err(anyhow!(errors.join("\n")))
        }
    }

    pub fn dev_server_stop(&self, repo_path: &str, task_id: &str) -> Result<DevServerGroupState> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        let repo_config = self.config_store.repo_config(repo_path.as_str())?;
        let key = dev_server_group_key(repo_path.as_str(), task_id);
        {
            let mut groups = self
                .dev_server_groups
                .lock()
                .map_err(|_| anyhow!("Dev server state lock poisoned"))?;
            let runtime = groups
                .entry(key.clone())
                .or_insert_with(|| DevServerGroupRuntime {
                    state: build_group_state(repo_path.as_str(), task_id, None, &repo_config),
                    emitter: None,
                });
            sync_group_state(
                &mut runtime.state,
                repo_path.as_str(),
                task_id,
                None,
                &repo_config,
            );
        }

        let targets = self.mark_dev_servers_stopping(key.as_str())?;
        if targets.is_empty() {
            let state = self.dev_server_get_state(repo_path.as_str(), task_id)?;
            emit_group_snapshot(self.dev_server_groups.clone(), &key);
            return Ok(state);
        }

        let mut errors = Vec::new();
        for (script_id, pid) in targets {
            if let Err(error) = stop_process_group(pid, DEV_SERVER_STOP_TIMEOUT) {
                self.mark_dev_server_stop_failed(key.as_str(), &script_id, pid, &error.to_string());
                errors.push(format!("Failed stopping dev server {script_id}: {error}"));
                continue;
            }
            self.mark_dev_server_stopped(key.as_str(), &script_id, pid, None);
        }

        let state = self.dev_server_get_state(repo_path.as_str(), task_id)?;
        emit_group_snapshot(self.dev_server_groups.clone(), &key);
        if errors.is_empty() {
            Ok(state)
        } else {
            Err(anyhow!(errors.join("\n")))
        }
    }

    pub fn dev_server_restart(
        &self,
        repo_path: &str,
        task_id: &str,
        emitter: DevServerEmitter,
    ) -> Result<DevServerGroupState> {
        self.dev_server_stop(repo_path, task_id)?;
        self.dev_server_start(repo_path, task_id, emitter)
    }

    pub(crate) fn stop_dev_servers_for_task(&self, repo_path: &str, task_id: &str) -> Result<()> {
        let _ = self.dev_server_stop(repo_path, task_id)?;
        Ok(())
    }

    pub(crate) fn stop_all_dev_servers(&self) -> Result<()> {
        let targets = self
            .dev_server_groups
            .lock()
            .map_err(|_| anyhow!("Dev server state lock poisoned"))?
            .values()
            .map(|group| (group.state.repo_path.clone(), group.state.task_id.clone()))
            .collect::<Vec<_>>();
        let mut errors = Vec::new();
        for (repo_path, task_id) in targets {
            if let Err(error) = self.stop_dev_servers_for_task(repo_path.as_str(), task_id.as_str())
            {
                errors.push(format!(
                    "Failed stopping dev servers for {}:{}: {error:#}",
                    repo_path, task_id
                ));
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(anyhow!(errors.join("\n")))
        }
    }

    fn start_dev_server_script(
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
            state.buffered_log_lines.clear();
        })?;
        self.append_log(
            group_key,
            repo_path,
            task_id,
            script.id.as_str(),
            DevServerLogStream::System,
            format!("Starting `{}`", script.command),
        );

        let mut spawned_pid = None;
        let mut start_failure_already_recorded = false;
        let start_result = (|| -> Result<u32> {
            let mut command =
                build_dev_server_command(script.command.as_str(), script.name.as_str())?;
            command.current_dir(worktree_path);
            configure_process_group(&mut command);

            #[cfg(unix)]
            let (stdout, stderr): (Box<dyn Read + Send>, Box<dyn Read + Send>) = {
                let (stdout_reader, stdout_writer) = open_pty_pair()?;
                let (stderr_reader, stderr_writer) = open_pty_pair()?;
                command.stdout(Stdio::from(stdout_writer));
                command.stderr(Stdio::from(stderr_writer));
                (Box::new(stdout_reader), Box::new(stderr_reader))
            };

            #[cfg(not(unix))]
            command.stdout(Stdio::piped());
            #[cfg(not(unix))]
            command.stderr(Stdio::piped());

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

            #[cfg(not(unix))]
            let stdout = child.stdout.take().ok_or_else(|| {
                anyhow!("Failed capturing stdout for dev server {}.", script.name)
            })?;

            #[cfg(not(unix))]
            let stderr = child.stderr.take().ok_or_else(|| {
                anyhow!("Failed capturing stderr for dev server {}.", script.name)
            })?;
            let started_at = now_rfc3339();

            spawn_log_forwarder(
                self.dev_server_groups.clone(),
                group_key.to_string(),
                repo_path.to_string(),
                task_id.to_string(),
                script.id.clone(),
                DevServerLogStream::Stdout,
                stdout,
            );
            spawn_log_forwarder(
                self.dev_server_groups.clone(),
                group_key.to_string(),
                repo_path.to_string(),
                task_id.to_string(),
                script.id.clone(),
                DevServerLogStream::Stderr,
                stderr,
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

    fn rollback_started_dev_server_scripts(
        &self,
        group_key: &str,
        started_scripts: Vec<(String, u32)>,
    ) -> Vec<String> {
        let mut errors = Vec::new();

        for (script_id, pid) in started_scripts {
            if let Err(error) = stop_process_group(pid, DEV_SERVER_STOP_TIMEOUT) {
                self.mark_dev_server_stop_failed(
                    group_key,
                    script_id.as_str(),
                    pid,
                    &error.to_string(),
                );
                errors.push(format!(
                    "Failed rolling back partially started dev server {script_id}: {error}"
                ));
                continue;
            }

            self.mark_dev_server_stopped(group_key, script_id.as_str(), pid, None);
        }

        errors
    }

    fn mark_dev_servers_stopping(&self, group_key: &str) -> Result<Vec<(String, u32)>> {
        let mut groups = self
            .dev_server_groups
            .lock()
            .map_err(|_| anyhow!("Dev server state lock poisoned"))?;
        let runtime = groups
            .get_mut(group_key)
            .ok_or_else(|| anyhow!("Dev server state missing for active task"))?;
        let updated_at = now_rfc3339();
        runtime.state.updated_at = updated_at.clone();
        let mut targets = Vec::new();
        let mut changed_scripts = Vec::new();
        for script in &mut runtime.state.scripts {
            script.buffered_log_lines.clear();
            if let Some(pid) = script.pid {
                script.status = DevServerScriptStatus::Stopping;
                script.last_error = None;
                targets.push((script.script_id.clone(), pid));
                changed_scripts.push(script.clone());
            } else if script.status != DevServerScriptStatus::Stopped
                || script.last_error.is_some()
                || script.exit_code.is_some()
            {
                script.status = DevServerScriptStatus::Stopped;
                script.started_at = None;
                script.exit_code = None;
                script.last_error = None;
                changed_scripts.push(script.clone());
            }
        }
        let emitter = runtime.emitter.clone();
        let repo_path = runtime.state.repo_path.clone();
        let task_id = runtime.state.task_id.clone();
        drop(groups);
        if let Some(emitter) = emitter {
            for script in changed_scripts {
                emitter(DevServerEvent::ScriptStatusChanged {
                    repo_path: repo_path.clone(),
                    task_id: task_id.clone(),
                    script,
                    updated_at: updated_at.clone(),
                });
            }
        }
        Ok(targets)
    }

    fn mark_dev_server_stopped(
        &self,
        group_key: &str,
        script_id: &str,
        pid: u32,
        exit_code: Option<i32>,
    ) {
        let _ = self.update_script_state(group_key, script_id, |state| {
            if state.pid != Some(pid) {
                return;
            }
            state.status = DevServerScriptStatus::Stopped;
            state.pid = None;
            state.started_at = None;
            state.exit_code = exit_code;
            state.last_error = None;
        });
    }

    fn mark_dev_server_stop_failed(
        &self,
        group_key: &str,
        script_id: &str,
        pid: u32,
        message: &str,
    ) {
        let _ = self.update_script_state(group_key, script_id, |state| {
            if state.pid != Some(pid) {
                return;
            }
            state.status = DevServerScriptStatus::Failed;
            state.last_error = Some(message.to_string());
        });
    }

    fn mark_dev_server_start_failed(
        &self,
        group_key: &str,
        repo_path: &str,
        task_id: &str,
        script_id: &str,
        message: &str,
    ) {
        let _ = self.update_script_state(group_key, script_id, |state| {
            state.status = DevServerScriptStatus::Failed;
            state.pid = None;
            state.started_at = None;
            state.exit_code = None;
            state.last_error = Some(message.to_string());
        });
        self.append_log(
            group_key,
            repo_path,
            task_id,
            script_id,
            DevServerLogStream::System,
            message.to_string(),
        );
    }

    fn mark_dev_server_start_exit_failed(
        &self,
        group_key: &str,
        repo_path: &str,
        task_id: &str,
        script_id: &str,
        exit_code: Option<i32>,
        message: &str,
    ) {
        let _ = self.update_script_state(group_key, script_id, |state| {
            state.status = DevServerScriptStatus::Failed;
            state.pid = None;
            state.started_at = None;
            state.exit_code = exit_code;
            state.last_error = Some(message.to_string());
        });
        self.append_log(
            group_key,
            repo_path,
            task_id,
            script_id,
            DevServerLogStream::System,
            message.to_string(),
        );
    }

    fn update_script_state<F>(&self, group_key: &str, script_id: &str, update: F) -> Result<()>
    where
        F: FnOnce(&mut DevServerScriptState),
    {
        let mut groups = self
            .dev_server_groups
            .lock()
            .map_err(|_| anyhow!("Dev server state lock poisoned"))?;
        let runtime = groups
            .get_mut(group_key)
            .ok_or_else(|| anyhow!("Dev server state missing for active task"))?;
        let script_snapshot = {
            let script = runtime
                .state
                .scripts
                .iter_mut()
                .find(|script| script.script_id == script_id)
                .ok_or_else(|| anyhow!("Unknown dev server script: {script_id}"))?;
            update(script);
            script.clone()
        };
        runtime.state.updated_at = now_rfc3339();
        let updated_at = runtime.state.updated_at.clone();
        let emitter = runtime.emitter.clone();
        let repo_path = runtime.state.repo_path.clone();
        let task_id = runtime.state.task_id.clone();
        drop(groups);
        if let Some(emitter) = emitter {
            emitter(DevServerEvent::ScriptStatusChanged {
                repo_path,
                task_id,
                script: script_snapshot,
                updated_at,
            });
        }
        Ok(())
    }

    fn resolve_dev_server_worktree_path(&self, repo_path: &str, task_id: &str) -> Option<String> {
        self.build_continuation_target_get(repo_path, task_id)
            .ok()
            .map(|target| target.working_directory)
    }

    fn append_log(
        &self,
        group_key: &str,
        repo_path: &str,
        task_id: &str,
        script_id: &str,
        stream: DevServerLogStream,
        text: String,
    ) {
        emit_log_line(
            &self.dev_server_groups,
            group_key,
            repo_path,
            task_id,
            DevServerLogLine {
                script_id: script_id.to_string(),
                stream,
                text,
                timestamp: now_rfc3339(),
            },
        );
    }
}

fn build_group_state(
    repo_path: &str,
    task_id: &str,
    worktree_path: Option<String>,
    repo_config: &RepoConfig,
) -> DevServerGroupState {
    DevServerGroupState {
        repo_path: repo_path.to_string(),
        task_id: task_id.to_string(),
        worktree_path,
        scripts: repo_config
            .dev_servers
            .iter()
            .map(new_script_state)
            .collect(),
        updated_at: now_rfc3339(),
    }
}

fn sync_group_state(
    state: &mut DevServerGroupState,
    repo_path: &str,
    task_id: &str,
    worktree_path: Option<String>,
    repo_config: &RepoConfig,
) {
    state.repo_path = repo_path.to_string();
    state.task_id = task_id.to_string();
    state.worktree_path = worktree_path;

    let mut existing = state
        .scripts
        .drain(..)
        .map(|script| (script.script_id.clone(), script))
        .collect::<HashMap<_, _>>();
    let mut next_scripts = Vec::with_capacity(repo_config.dev_servers.len());
    for repo_script in &repo_config.dev_servers {
        if let Some(mut script) = existing.remove(repo_script.id.as_str()) {
            script.name = repo_script.name.clone();
            script.command = repo_script.command.clone();
            next_scripts.push(script);
        } else {
            next_scripts.push(new_script_state(repo_script));
        }
    }
    next_scripts.extend(existing.into_values().filter(script_has_live_process));
    state.scripts = next_scripts;
    state.updated_at = now_rfc3339();
}

fn new_script_state(script: &RepoDevServerScript) -> DevServerScriptState {
    DevServerScriptState {
        script_id: script.id.clone(),
        name: script.name.clone(),
        command: script.command.clone(),
        status: DevServerScriptStatus::Stopped,
        pid: None,
        started_at: None,
        exit_code: None,
        last_error: None,
        buffered_log_lines: Vec::new(),
    }
}

fn script_has_live_process(script: &DevServerScriptState) -> bool {
    script.pid.is_some()
}

fn dev_server_group_key(repo_path: &str, task_id: &str) -> String {
    format!("{repo_path}::{task_id}")
}

fn emit_group_snapshot(
    groups: Arc<Mutex<HashMap<String, DevServerGroupRuntime>>>,
    group_key: &str,
) {
    let (emitter, state) = {
        let Ok(groups) = groups.lock() else {
            return;
        };
        let Some(runtime) = groups.get(group_key) else {
            return;
        };
        (runtime.emitter.clone(), runtime.state.clone())
    };
    if let Some(emitter) = emitter {
        emitter(DevServerEvent::Snapshot { state });
    }
}

fn emit_log_line(
    groups: &Arc<Mutex<HashMap<String, DevServerGroupRuntime>>>,
    group_key: &str,
    repo_path: &str,
    task_id: &str,
    log_line: DevServerLogLine,
) {
    let emitter = {
        let Ok(mut groups) = groups.lock() else {
            return;
        };
        let Some(runtime) = groups.get_mut(group_key) else {
            return;
        };
        let Some(script) = runtime
            .state
            .scripts
            .iter_mut()
            .find(|script| script.script_id == log_line.script_id)
        else {
            return;
        };
        script.buffered_log_lines.push(log_line.clone());
        if script.buffered_log_lines.len() > DEV_SERVER_LOG_BUFFER_LIMIT {
            let overflow = script.buffered_log_lines.len() - DEV_SERVER_LOG_BUFFER_LIMIT;
            script.buffered_log_lines.drain(0..overflow);
        }
        runtime.state.updated_at = now_rfc3339();
        runtime.emitter.clone()
    };

    if let Some(emitter) = emitter {
        emitter(DevServerEvent::LogLine {
            repo_path: repo_path.to_string(),
            task_id: task_id.to_string(),
            log_line,
        });
    }
}

fn spawn_log_forwarder<R>(
    groups: Arc<Mutex<HashMap<String, DevServerGroupRuntime>>>,
    group_key: String,
    repo_path: String,
    task_id: String,
    script_id: String,
    stream: DevServerLogStream,
    reader: R,
) where
    R: Read + Send + 'static,
{
    std::thread::spawn(move || {
        let reader = BufReader::new(reader);
        for line in reader.lines() {
            let Ok(line) = line else {
                break;
            };
            let text = line.trim_end_matches('\r').to_string();
            emit_log_line(
                &groups,
                group_key.as_str(),
                repo_path.as_str(),
                task_id.as_str(),
                DevServerLogLine {
                    script_id: script_id.clone(),
                    stream: stream.clone(),
                    text,
                    timestamp: now_rfc3339(),
                },
            );
        }
    });
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

        let mut emitted_log = None;
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
                let log_line = DevServerLogLine {
                    script_id: script_id.clone(),
                    stream: DevServerLogStream::System,
                    text: message.clone(),
                    timestamp: now_rfc3339(),
                };
                script.buffered_log_lines.push(log_line.clone());
                if script.buffered_log_lines.len() > DEV_SERVER_LOG_BUFFER_LIMIT {
                    let overflow = script.buffered_log_lines.len() - DEV_SERVER_LOG_BUFFER_LIMIT;
                    script.buffered_log_lines.drain(0..overflow);
                }
                emitted_log = Some(log_line);
            }
            runtime.state.updated_at = now_rfc3339();
            (
                runtime.emitter.clone(),
                script.clone(),
                runtime.state.updated_at.clone(),
            )
        };

        if let Some(emitter) = emitter {
            if let Some(log_line) = emitted_log {
                emitter(DevServerEvent::LogLine {
                    repo_path: repo_path.clone(),
                    task_id: task_id.clone(),
                    log_line,
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
fn spawn_dev_server_parent_death_watcher(parent_pid: u32, child_pid: u32) -> Result<()> {
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
fn spawn_dev_server_parent_death_watcher(_parent_pid: u32, _child_pid: u32) -> Result<()> {
    Ok(())
}

#[cfg(unix)]
fn stop_process_group(pid: u32, timeout: Duration) -> Result<()> {
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
    if super::wait_for_process_exit_by_pid(wait_pid, timeout) {
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
    if super::wait_for_process_exit_by_pid(wait_pid, timeout) {
        return Ok(());
    }
    Err(anyhow!(
        "Timed out waiting for process group {pid} to stop after SIGTERM and SIGKILL"
    ))
}

#[cfg(not(unix))]
fn stop_process_group(pid: u32, timeout: Duration) -> Result<()> {
    let _ = (pid, timeout);
    Err(anyhow!(
        "Builder dev servers are only supported on Unix hosts in this build."
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_service::test_support::{
        build_service_with_state, spawn_sleep_process_group, unique_temp_path,
        wait_for_process_exit,
    };
    use std::fs;
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::Duration;

    fn repo_config(dev_servers: Vec<RepoDevServerScript>) -> RepoConfig {
        RepoConfig {
            dev_servers,
            ..Default::default()
        }
    }

    #[test]
    fn sync_group_state_updates_order_and_retains_live_removed_scripts() {
        let mut state = DevServerGroupState {
            repo_path: "/repo".to_string(),
            task_id: "task-1".to_string(),
            worktree_path: Some("/repo/worktree".to_string()),
            scripts: vec![
                DevServerScriptState {
                    script_id: "frontend".to_string(),
                    name: "Frontend old".to_string(),
                    command: "bun run dev:old".to_string(),
                    status: DevServerScriptStatus::Stopped,
                    pid: None,
                    started_at: None,
                    exit_code: None,
                    last_error: None,
                    buffered_log_lines: vec![DevServerLogLine {
                        script_id: "frontend".to_string(),
                        stream: DevServerLogStream::Stdout,
                        text: "kept".to_string(),
                        timestamp: "2026-03-19T10:00:00Z".to_string(),
                    }],
                },
                DevServerScriptState {
                    script_id: "orphan".to_string(),
                    name: "Old orphan".to_string(),
                    command: "sleep 30".to_string(),
                    status: DevServerScriptStatus::Running,
                    pid: Some(4242),
                    started_at: Some("2026-03-19T10:01:00Z".to_string()),
                    exit_code: None,
                    last_error: None,
                    buffered_log_lines: Vec::new(),
                },
            ],
            updated_at: "2026-03-19T10:00:00Z".to_string(),
        };

        sync_group_state(
            &mut state,
            "/repo",
            "task-1",
            Some("/repo/worktree-next".to_string()),
            &repo_config(vec![
                RepoDevServerScript {
                    id: "backend".to_string(),
                    name: "Backend".to_string(),
                    command: "bun run api".to_string(),
                },
                RepoDevServerScript {
                    id: "frontend".to_string(),
                    name: "Frontend".to_string(),
                    command: "bun run web".to_string(),
                },
            ]),
        );

        assert_eq!(state.worktree_path.as_deref(), Some("/repo/worktree-next"));
        assert_eq!(state.scripts.len(), 3);
        assert_eq!(state.scripts[0].script_id, "backend");
        assert_eq!(state.scripts[0].name, "Backend");
        assert_eq!(state.scripts[1].script_id, "frontend");
        assert_eq!(state.scripts[1].name, "Frontend");
        assert_eq!(state.scripts[1].command, "bun run web");
        assert_eq!(state.scripts[1].buffered_log_lines.len(), 1);
        assert_eq!(state.scripts[2].script_id, "orphan");
        assert_eq!(state.scripts[2].pid, Some(4242));
    }

    #[test]
    fn emit_log_line_trims_buffer_and_emits_events() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let emitter_events = events.clone();
        let emitter: DevServerEmitter = Arc::new(move |event| {
            emitter_events
                .lock()
                .expect("event lock poisoned")
                .push(event);
        });
        let groups = Arc::new(Mutex::new(HashMap::from([(
            "repo::task-1".to_string(),
            DevServerGroupRuntime {
                state: DevServerGroupState {
                    repo_path: "repo".to_string(),
                    task_id: "task-1".to_string(),
                    worktree_path: Some("/tmp/worktree".to_string()),
                    scripts: vec![DevServerScriptState {
                        script_id: "server-1".to_string(),
                        name: "Server".to_string(),
                        command: "bun run dev".to_string(),
                        status: DevServerScriptStatus::Running,
                        pid: Some(99),
                        started_at: Some("2026-03-19T10:00:00Z".to_string()),
                        exit_code: None,
                        last_error: None,
                        buffered_log_lines: Vec::new(),
                    }],
                    updated_at: "2026-03-19T10:00:00Z".to_string(),
                },
                emitter: Some(emitter),
            },
        )])));

        for index in 0..(DEV_SERVER_LOG_BUFFER_LIMIT + 5) {
            emit_log_line(
                &groups,
                "repo::task-1",
                "repo",
                "task-1",
                DevServerLogLine {
                    script_id: "server-1".to_string(),
                    stream: DevServerLogStream::Stdout,
                    text: format!("line-{index}"),
                    timestamp: format!("2026-03-19T10:00:{:02}Z", index % 60),
                },
            );
        }

        let groups = groups.lock().expect("group lock poisoned");
        let runtime = groups.get("repo::task-1").expect("runtime present");
        let logs = &runtime.state.scripts[0].buffered_log_lines;
        assert_eq!(logs.len(), DEV_SERVER_LOG_BUFFER_LIMIT);
        assert_eq!(logs.first().map(|line| line.text.as_str()), Some("line-5"));
        assert_eq!(
            logs.last().map(|line| line.text.as_str()),
            Some("line-2004")
        );
        drop(groups);

        let emitted = events.lock().expect("event lock poisoned");
        assert_eq!(emitted.len(), DEV_SERVER_LOG_BUFFER_LIMIT + 5);
        assert!(matches!(
            emitted.last(),
            Some(DevServerEvent::LogLine { log_line, .. }) if log_line.text == "line-2004"
        ));
    }

    #[test]
    fn start_dev_server_script_rejects_blank_commands() {
        let (service, _task_state, _git_state) = build_service_with_state(Vec::new());
        let repo_path = "/repo";
        let task_id = "task-parse";
        let group_key = dev_server_group_key(repo_path, task_id);
        let script = RepoDevServerScript {
            id: "frontend".to_string(),
            name: "Frontend".to_string(),
            command: "   ".to_string(),
        };

        service
            .dev_server_groups
            .lock()
            .expect("group lock poisoned")
            .insert(
                group_key.clone(),
                DevServerGroupRuntime {
                    state: build_group_state(
                        repo_path,
                        task_id,
                        Some("/tmp/worktree".to_string()),
                        &repo_config(vec![script.clone()]),
                    ),
                    emitter: None,
                },
            );

        let error = service
            .start_dev_server_script(
                group_key.as_str(),
                repo_path,
                task_id,
                "/tmp/worktree",
                script,
            )
            .expect_err("blank command should fail");

        assert!(error
            .to_string()
            .contains("Dev server command is empty for Frontend"));

        let groups = service
            .dev_server_groups
            .lock()
            .expect("group lock poisoned");
        let runtime = groups.get(&group_key).expect("runtime present");
        let script = &runtime.state.scripts[0];
        assert_eq!(script.status, DevServerScriptStatus::Failed);
        assert_eq!(script.pid, None);
        assert_eq!(script.started_at, None);
        assert_eq!(script.exit_code, None);
        assert!(matches!(
            script.last_error.as_deref(),
            Some(message) if message.contains("Dev server command is empty for Frontend")
        ));
        assert!(script.buffered_log_lines.iter().any(|line| line
            .text
            .contains("Dev server command is empty for Frontend")));
    }

    #[test]
    fn start_dev_server_script_reports_immediate_shell_failures() {
        let (service, _task_state, _git_state) = build_service_with_state(Vec::new());
        let repo_path = "/repo";
        let task_id = "task-spawn";
        let worktree_path = unique_temp_path("dev-server-worktree");
        fs::create_dir_all(&worktree_path).expect("create worktree path");
        let worktree_path = worktree_path.to_string_lossy().to_string();
        let group_key = dev_server_group_key(repo_path, task_id);
        let script = RepoDevServerScript {
            id: "backend".to_string(),
            name: "Backend".to_string(),
            command: "__odt_missing_executable__ --port 3000".to_string(),
        };

        service
            .dev_server_groups
            .lock()
            .expect("group lock poisoned")
            .insert(
                group_key.clone(),
                DevServerGroupRuntime {
                    state: build_group_state(
                        repo_path,
                        task_id,
                        Some(worktree_path.clone()),
                        &repo_config(vec![script.clone()]),
                    ),
                    emitter: None,
                },
            );

        let error = service
            .start_dev_server_script(
                group_key.as_str(),
                repo_path,
                task_id,
                worktree_path.as_str(),
                script,
            )
            .expect_err("missing command should fail during startup");

        assert!(error
            .to_string()
            .contains("Dev server exited with code 127"));

        let groups = service
            .dev_server_groups
            .lock()
            .expect("group lock poisoned");
        let runtime = groups.get(&group_key).expect("runtime present");
        let script = &runtime.state.scripts[0];
        assert_eq!(script.status, DevServerScriptStatus::Failed);
        assert_eq!(script.pid, None);
        assert_eq!(script.started_at, None);
        assert_eq!(script.exit_code, Some(127));
        assert!(matches!(
            script.last_error.as_deref(),
            Some(message) if message.contains("Dev server exited with code")
        ));
        assert!(script
            .buffered_log_lines
            .iter()
            .any(|line| line.text.contains("Dev server exited with code")));
    }

    #[cfg(unix)]
    #[test]
    fn start_dev_server_script_streams_logs_before_process_exit_and_clears_old_logs() {
        let (service, _task_state, _git_state) = build_service_with_state(Vec::new());
        let repo_path = "/repo";
        let task_id = "task-stream";
        let worktree_path = unique_temp_path("dev-server-stream-worktree");
        fs::create_dir_all(&worktree_path).expect("create worktree path");
        let worktree_path = worktree_path.to_string_lossy().to_string();
        let group_key = dev_server_group_key(repo_path, task_id);
        let script = RepoDevServerScript {
            id: "frontend".to_string(),
            name: "Frontend".to_string(),
            command: "printf 'db generated\\n' && python3 -c \"import time; print('ready'); time.sleep(5)\""
                .to_string(),
        };

        let mut state = build_group_state(
            repo_path,
            task_id,
            Some(worktree_path.clone()),
            &repo_config(vec![script.clone()]),
        );
        state.scripts[0].buffered_log_lines.push(DevServerLogLine {
            script_id: "frontend".to_string(),
            stream: DevServerLogStream::Stdout,
            text: "stale log".to_string(),
            timestamp: "2026-03-19T10:00:00Z".to_string(),
        });

        service
            .dev_server_groups
            .lock()
            .expect("group lock poisoned")
            .insert(
                group_key.clone(),
                DevServerGroupRuntime {
                    state,
                    emitter: None,
                },
            );

        service
            .start_dev_server_script(
                group_key.as_str(),
                repo_path,
                task_id,
                worktree_path.as_str(),
                script,
            )
            .expect("dev server should start");

        let mut saw_ready_log = false;
        let mut saw_setup_log = false;
        let mut pid = None;
        for _ in 0..30 {
            thread::sleep(Duration::from_millis(100));
            let groups = service
                .dev_server_groups
                .lock()
                .expect("group lock poisoned");
            let runtime = groups.get(&group_key).expect("runtime present");
            let script = &runtime.state.scripts[0];
            pid = script.pid;
            assert!(script
                .buffered_log_lines
                .iter()
                .all(|line| line.text != "stale log"));
            saw_setup_log = script
                .buffered_log_lines
                .iter()
                .any(|line| line.text.contains("db generated"));
            saw_ready_log = script
                .buffered_log_lines
                .iter()
                .any(|line| line.text.contains("ready"));
            if saw_setup_log && saw_ready_log {
                break;
            }
        }

        assert!(
            saw_setup_log,
            "expected chained shell setup log before process exit"
        );
        assert!(saw_ready_log, "expected log line before process exit");

        let pid = pid.expect("dev server pid missing");
        stop_process_group(pid, DEV_SERVER_STOP_TIMEOUT).expect("stop streamed dev server");
        for _ in 0..30 {
            thread::sleep(Duration::from_millis(50));
            let groups = service
                .dev_server_groups
                .lock()
                .expect("group lock poisoned");
            let runtime = groups.get(&group_key).expect("runtime present");
            if runtime.state.scripts[0].pid.is_none() {
                break;
            }
        }
    }

    #[test]
    fn mark_dev_servers_stopping_clears_logs_and_resets_failed_scripts() {
        let (service, _task_state, _git_state) = build_service_with_state(Vec::new());
        let group_key = "repo::task-stop".to_string();
        service
            .dev_server_groups
            .lock()
            .expect("group lock poisoned")
            .insert(
                group_key.clone(),
                DevServerGroupRuntime {
                    state: DevServerGroupState {
                        repo_path: "repo".to_string(),
                        task_id: "task-stop".to_string(),
                        worktree_path: Some("/tmp/worktree".to_string()),
                        scripts: vec![
                            DevServerScriptState {
                                script_id: "frontend".to_string(),
                                name: "Frontend".to_string(),
                                command: "bun run dev".to_string(),
                                status: DevServerScriptStatus::Running,
                                pid: Some(4242),
                                started_at: Some("2026-03-19T10:00:00Z".to_string()),
                                exit_code: None,
                                last_error: None,
                                buffered_log_lines: vec![DevServerLogLine {
                                    script_id: "frontend".to_string(),
                                    stream: DevServerLogStream::Stdout,
                                    text: "ready".to_string(),
                                    timestamp: "2026-03-19T10:00:00Z".to_string(),
                                }],
                            },
                            DevServerScriptState {
                                script_id: "backend".to_string(),
                                name: "Backend".to_string(),
                                command: "bun run api".to_string(),
                                status: DevServerScriptStatus::Failed,
                                pid: None,
                                started_at: None,
                                exit_code: Some(1),
                                last_error: Some("boom".to_string()),
                                buffered_log_lines: vec![DevServerLogLine {
                                    script_id: "backend".to_string(),
                                    stream: DevServerLogStream::System,
                                    text: "boom".to_string(),
                                    timestamp: "2026-03-19T10:00:01Z".to_string(),
                                }],
                            },
                        ],
                        updated_at: "2026-03-19T10:00:00Z".to_string(),
                    },
                    emitter: None,
                },
            );

        let targets = service
            .mark_dev_servers_stopping(group_key.as_str())
            .expect("stop mark should succeed");

        assert_eq!(targets, vec![("frontend".to_string(), 4242)]);

        let groups = service
            .dev_server_groups
            .lock()
            .expect("group lock poisoned");
        let runtime = groups.get(&group_key).expect("runtime present");
        assert_eq!(
            runtime.state.scripts[0].status,
            DevServerScriptStatus::Stopping
        );
        assert!(runtime.state.scripts[0].buffered_log_lines.is_empty());
        assert_eq!(
            runtime.state.scripts[1].status,
            DevServerScriptStatus::Stopped
        );
        assert_eq!(runtime.state.scripts[1].last_error, None);
        assert_eq!(runtime.state.scripts[1].exit_code, None);
        assert!(runtime.state.scripts[1].buffered_log_lines.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn rollback_started_dev_server_scripts_stops_live_processes() {
        let (service, _task_state, _git_state) = build_service_with_state(Vec::new());
        let mut child = spawn_sleep_process_group(20);
        let pid = child.id();
        let group_key = "repo::task-rollback";

        service
            .dev_server_groups
            .lock()
            .expect("group lock poisoned")
            .insert(
                group_key.to_string(),
                DevServerGroupRuntime {
                    state: DevServerGroupState {
                        repo_path: "repo".to_string(),
                        task_id: "task-rollback".to_string(),
                        worktree_path: Some("/tmp/worktree".to_string()),
                        scripts: vec![DevServerScriptState {
                            script_id: "frontend".to_string(),
                            name: "Frontend".to_string(),
                            command: "sleep 20".to_string(),
                            status: DevServerScriptStatus::Running,
                            pid: Some(pid),
                            started_at: Some("2026-03-19T10:00:00Z".to_string()),
                            exit_code: None,
                            last_error: None,
                            buffered_log_lines: Vec::new(),
                        }],
                        updated_at: "2026-03-19T10:00:00Z".to_string(),
                    },
                    emitter: None,
                },
            );

        let errors = service
            .rollback_started_dev_server_scripts(group_key, vec![("frontend".to_string(), pid)]);

        assert!(errors.is_empty());
        assert!(wait_for_process_exit(pid as i32, Duration::from_secs(2)));
        let groups = service
            .dev_server_groups
            .lock()
            .expect("group lock poisoned");
        let runtime = groups.get(group_key).expect("runtime present");
        assert_eq!(
            runtime.state.scripts[0].status,
            DevServerScriptStatus::Stopped
        );
        assert_eq!(runtime.state.scripts[0].pid, None);
        drop(groups);
        let _ = child.wait().expect("failed waiting rollback child");
    }

    #[cfg(unix)]
    #[test]
    fn dev_server_parent_death_watcher_terminates_orphaned_process_group() {
        let mut child = spawn_sleep_process_group(20);
        let pid = child.id();

        spawn_dev_server_parent_death_watcher(999_999, pid)
            .expect("watcher should start for dev server process");

        assert!(
            wait_for_process_exit(pid as i32, Duration::from_secs(3)),
            "dev server process group should exit when parent is already gone"
        );
        let _ = child.wait().expect("failed waiting dev server child");
    }
}
