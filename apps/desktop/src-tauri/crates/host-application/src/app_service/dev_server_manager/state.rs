use super::AppService;
use anyhow::{anyhow, Result};
use host_domain::{
    now_rfc3339, DevServerEvent, DevServerGroupState, DevServerScriptState, DevServerScriptStatus,
};
use host_infra_system::{RepoConfig, RepoDevServerScript};
use std::collections::HashMap;

pub(super) fn build_group_state(
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

pub(super) fn sync_group_state(
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
        buffered_terminal_chunks: Vec::new(),
        next_terminal_sequence: 0,
    }
}

pub(super) fn script_has_live_process(script: &DevServerScriptState) -> bool {
    script.pid.is_some()
}

pub(super) fn dev_server_group_key(repo_path: &str, task_id: &str) -> String {
    format!("{repo_path}::{task_id}")
}

impl AppService {
    pub(super) fn mark_dev_servers_stopping(&self, group_key: &str) -> Result<Vec<(String, u32)>> {
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
            script.buffered_terminal_chunks.clear();
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

    pub(super) fn mark_dev_server_stopped(
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

    pub(super) fn mark_dev_server_stop_failed(
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

    pub(super) fn mark_dev_server_start_failed(
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
        self.append_terminal_system_message(group_key, repo_path, task_id, script_id, message);
    }

    pub(super) fn mark_dev_server_start_exit_failed(
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
        self.append_terminal_system_message(group_key, repo_path, task_id, script_id, message);
    }

    pub(super) fn update_script_state<F>(
        &self,
        group_key: &str,
        script_id: &str,
        update: F,
    ) -> Result<()>
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

    pub(super) fn resolve_dev_server_worktree_path(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Option<String> {
        self.task_worktree_get(repo_path, task_id)
            .ok()
            .flatten()
            .map(|entry| entry.working_directory)
    }
}
