mod processes;
mod state;
mod terminal;

use super::{AppService, DevServerEmitter, DevServerGroupRuntime};
use anyhow::{anyhow, Result};
use host_domain::DevServerGroupState;

use self::processes::{stop_process_group, DEV_SERVER_STOP_TIMEOUT};
use self::state::{
    build_group_state, dev_server_group_key, mark_started_dev_servers_stopping_after_start_failure,
    script_has_live_process, sync_group_state,
};
use self::terminal::emit_group_snapshot;

#[cfg(test)]
mod tests;

impl AppService {
    pub fn dev_server_get_state(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<DevServerGroupState> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        let repo_config = self.workspace_get_repo_config_by_repo_path(repo_path.as_str())?;
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
        let repo_config = self.workspace_get_repo_config_by_repo_path(repo_path.as_str())?;
        if repo_config.dev_servers.is_empty() {
            return Err(anyhow!(
                "No builder dev server scripts are configured for {repo_path}. Add them in repository settings first."
            ));
        }
        let worktree_path = self
            .task_worktree_get(repo_path.as_str(), task_id)?
            .ok_or_else(|| {
                anyhow!(
                    "Builder continuation cannot start until a builder worktree exists for task {task_id}. Start Builder first."
                )
            })?
            .working_directory;
        let key = dev_server_group_key(repo_path.as_str(), task_id);
        tracing::info!(
            target: "openducktor.lifecycle",
            "Starting {} dev server script(s) for task {task_id} in {repo_path}",
            repo_config.dev_servers.len()
        );

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

        let mut start_error = None;
        for script in repo_config.dev_servers.iter().cloned() {
            let script_id = script.id.clone();
            tracing::info!(
                target: "openducktor.lifecycle",
                "Starting dev server script {} for task {task_id} in {repo_path}",
                script_id
            );
            match self.start_dev_server_script(
                key.as_str(),
                repo_path.as_str(),
                task_id,
                worktree_path.as_str(),
                script,
            ) {
                Ok(_pid) => {}
                Err(error) => {
                    start_error =
                        Some(format!("Failed starting dev server {script_id}: {error:#}"));
                    break;
                }
            }
        }

        if let Some(start_error) = start_error {
            let cleanup_errors =
                self.stop_started_dev_servers_after_start_failure(key.as_str(), task_id)?;
            let _state = self.dev_server_get_state(repo_path.as_str(), task_id)?;
            emit_group_snapshot(self.dev_server_groups.clone(), &key);
            let mut messages = vec![
                "Failed to start all configured dev server scripts.".to_string(),
                start_error,
            ];
            messages.extend(cleanup_errors);
            return Err(anyhow!(messages.join("\n")));
        }

        let state = self.dev_server_get_state(repo_path.as_str(), task_id)?;
        emit_group_snapshot(self.dev_server_groups.clone(), &key);
        if state.scripts.iter().any(script_has_live_process) {
            return Ok(state);
        }

        Err(anyhow!(
            "Dev server start completed without any live script processes."
        ))
    }

    pub fn dev_server_stop(&self, repo_path: &str, task_id: &str) -> Result<DevServerGroupState> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        let repo_config = self.workspace_get_repo_config_by_repo_path(repo_path.as_str())?;
        let key = dev_server_group_key(repo_path.as_str(), task_id);
        tracing::info!(
            target: "openducktor.lifecycle",
            "Stopping dev servers for task {task_id} in {repo_path}"
        );
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
            tracing::info!(
                target: "openducktor.lifecycle",
                "Stopping dev server script {script_id} for task {task_id} (pid {pid})"
            );
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

    fn stop_started_dev_servers_after_start_failure(
        &self,
        group_key: &str,
        task_id: &str,
    ) -> Result<Vec<String>> {
        let targets = mark_started_dev_servers_stopping_after_start_failure(
            self.dev_server_groups.clone(),
            group_key,
        )?;
        let mut errors = Vec::new();

        for (script_id, pid) in targets {
            tracing::info!(
                target: "openducktor.lifecycle",
                "Stopping dev server script {script_id} for task {task_id} after start failure (pid {pid})"
            );
            if let Err(error) = stop_process_group(pid, DEV_SERVER_STOP_TIMEOUT) {
                self.mark_dev_server_stop_failed(
                    group_key,
                    script_id.as_str(),
                    pid,
                    &error.to_string(),
                );
                errors.push(format!(
                    "Failed cleaning up dev server {script_id}: {error:#}"
                ));
                continue;
            }
            self.mark_dev_server_stopped(group_key, script_id.as_str(), pid, None);
        }

        Ok(errors)
    }

    pub(crate) fn stop_all_dev_servers(&self) -> Result<()> {
        let targets = self
            .dev_server_groups
            .lock()
            .map_err(|_| anyhow!("Dev server state lock poisoned"))?
            .values()
            .map(|group| (group.state.repo_path.clone(), group.state.task_id.clone()))
            .collect::<Vec<_>>();
        tracing::info!(
            target: "openducktor.lifecycle",
            "Stopping {} tracked dev server group(s)",
            targets.len()
        );
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
}
