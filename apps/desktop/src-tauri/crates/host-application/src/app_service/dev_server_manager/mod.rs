mod processes;
mod state;
mod terminal;

use super::{validate_hook_trust, AppService, DevServerEmitter, DevServerGroupRuntime};
use anyhow::{anyhow, Result};
use host_domain::DevServerGroupState;

use self::processes::{stop_process_group, DEV_SERVER_STOP_TIMEOUT};
use self::state::{
    build_group_state, dev_server_group_key, script_has_live_process, sync_group_state,
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
        let worktree_path = self
            .build_continuation_target_get(repo_path.as_str(), task_id)?
            .ok_or_else(|| {
                anyhow!(
                    "Builder continuation cannot start until a builder worktree exists for task {task_id}. Start Builder first."
                )
            })?
            .working_directory;
        validate_hook_trust(repo_path.as_str(), &repo_config)?;
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
        for script in repo_config.dev_servers.iter().cloned() {
            match self.start_dev_server_script(
                key.as_str(),
                repo_path.as_str(),
                task_id,
                worktree_path.as_str(),
                script,
            ) {
                Ok(_pid) => {}
                Err(error) => errors.push(error.to_string()),
            }
        }

        let state = self.dev_server_get_state(repo_path.as_str(), task_id)?;
        emit_group_snapshot(self.dev_server_groups.clone(), &key);
        if errors.is_empty() || state.scripts.iter().any(script_has_live_process) {
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
}
