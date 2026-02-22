use super::{
    spawn_opencode_server, terminate_child_process, wait_for_local_server_with_process,
    AgentRuntimeProcess, AppService,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{now_rfc3339, AgentRuntimeSummary, RunSummary};
use host_infra_system::{
    build_branch_name, pick_free_port, remove_worktree, run_command, run_command_allow_failure,
};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::Duration;
use uuid::Uuid;

impl AppService {
    pub fn runs_list(&self, repo_path: Option<&str>) -> Result<Vec<RunSummary>> {
        let runs = self
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?;

        let mut list = runs
            .values()
            .filter(|run| {
                if let Some(path) = repo_path {
                    run.repo_path == path
                } else {
                    true
                }
            })
            .map(|run| run.summary.clone())
            .collect::<Vec<_>>();

        list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        Ok(list)
    }

    pub fn opencode_runtime_list(
        &self,
        repo_path: Option<&str>,
    ) -> Result<Vec<AgentRuntimeSummary>> {
        let repo_key_filter = repo_path.map(Self::repo_key);
        let mut runtimes = self
            .agent_runtimes
            .lock()
            .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
        Self::prune_stale_runtimes(&mut runtimes);

        let mut list = runtimes
            .values()
            .filter(|runtime| {
                if let Some(path_key) = repo_key_filter.as_deref() {
                    Self::repo_key(runtime.summary.repo_path.as_str()) == path_key
                } else {
                    true
                }
            })
            .map(|runtime| runtime.summary.clone())
            .collect::<Vec<_>>();

        list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        Ok(list)
    }

    pub fn opencode_repo_runtime_ensure(&self, repo_path: &str) -> Result<AgentRuntimeSummary> {
        self.ensure_repo_initialized(repo_path)?;
        let repo_key = Self::repo_key(repo_path);

        {
            let mut runtimes = self
                .agent_runtimes
                .lock()
                .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
            Self::prune_stale_runtimes(&mut runtimes);

            if let Some(existing) = runtimes.values().find(|runtime| {
                Self::repo_key(runtime.summary.repo_path.as_str()) == repo_key
                    && runtime.summary.role == Self::WORKSPACE_RUNTIME_ROLE
            }) {
                return Ok(existing.summary.clone());
            }
        }

        let port = pick_free_port()?;
        let metadata_namespace = self.config_store.task_metadata_namespace()?;
        let mut child = spawn_opencode_server(
            Path::new(repo_path),
            Path::new(repo_path),
            metadata_namespace.as_str(),
            port,
        )?;
        if let Err(error) =
            wait_for_local_server_with_process(&mut child, port, Duration::from_secs(8))
        {
            terminate_child_process(&mut child);
            return Err(error).with_context(|| {
                format!("OpenCode workspace runtime failed to start for {repo_path}")
            });
        }

        let runtime_id = format!("runtime-{}", Uuid::new_v4().simple());
        let summary = AgentRuntimeSummary {
            runtime_id: runtime_id.clone(),
            repo_path: repo_key.clone(),
            task_id: Self::WORKSPACE_RUNTIME_TASK_ID.to_string(),
            role: Self::WORKSPACE_RUNTIME_ROLE.to_string(),
            working_directory: repo_key.clone(),
            port,
            started_at: now_rfc3339(),
        };

        {
            let mut runtimes = self
                .agent_runtimes
                .lock()
                .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
            Self::prune_stale_runtimes(&mut runtimes);

            if let Some(existing) = runtimes.values().find(|runtime| {
                Self::repo_key(runtime.summary.repo_path.as_str()) == repo_key
                    && runtime.summary.role == Self::WORKSPACE_RUNTIME_ROLE
            }) {
                terminate_child_process(&mut child);
                return Ok(existing.summary.clone());
            }

            runtimes.insert(
                runtime_id,
                AgentRuntimeProcess {
                    summary: summary.clone(),
                    child,
                    cleanup_repo_path: None,
                    cleanup_worktree_path: None,
                },
            );
        }

        Ok(summary)
    }

    pub fn opencode_runtime_start(
        &self,
        repo_path: &str,
        task_id: &str,
        role: &str,
    ) -> Result<AgentRuntimeSummary> {
        self.ensure_repo_initialized(repo_path)?;
        let repo_key = Self::repo_key(repo_path);
        if !matches!(role, "spec" | "planner" | "qa") {
            return Err(anyhow!(
                "Unsupported agent runtime role: {role}. Supported: spec, planner, qa"
            ));
        }

        let tasks = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = tasks
            .iter()
            .find(|entry| entry.id == task_id)
            .cloned()
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;

        {
            let mut runtimes = self
                .agent_runtimes
                .lock()
                .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
            Self::prune_stale_runtimes(&mut runtimes);

            if let Some(existing) = runtimes.values().find(|runtime| {
                Self::repo_key(runtime.summary.repo_path.as_str()) == repo_key
                    && runtime.summary.task_id == task_id
                    && runtime.summary.role == role
            }) {
                return Ok(existing.summary.clone());
            }
        }

        let mut cleanup_repo_path: Option<String> = None;
        let mut cleanup_worktree_path: Option<String> = None;
        let runtime_working_directory = if role == "qa" {
            let repo_config = self.config_store.repo_config(repo_path)?;
            let worktree_base = repo_config.worktree_base_path.clone().ok_or_else(|| {
                anyhow!(
                    "QA blocked: configure repos.{repo_path}.worktreeBasePath in {}",
                    self.config_store.path().display()
                )
            })?;

            if (!repo_config.hooks.pre_start.is_empty()
                || !repo_config.hooks.post_complete.is_empty())
                && !repo_config.trusted_hooks
            {
                return Err(anyhow!(
                    "Hooks are configured but not trusted for {repo_path}. Confirm trust first."
                ));
            }

            let worktree_base_path = Path::new(&worktree_base);
            fs::create_dir_all(worktree_base_path).with_context(|| {
                format!(
                    "Failed creating QA worktree base directory {}",
                    worktree_base_path.display()
                )
            })?;

            let qa_worktree = worktree_base_path.join(format!("qa-{task_id}"));
            if qa_worktree.exists() {
                return Err(anyhow!(
                    "QA worktree path already exists for task {}: {}",
                    task_id,
                    qa_worktree.display()
                ));
            }

            let repo_path_ref = Path::new(repo_path);
            let branch = build_branch_name(&repo_config.branch_prefix, task_id, &task.title);
            let qa_worktree_str = qa_worktree
                .to_str()
                .ok_or_else(|| anyhow!("Invalid QA worktree path"))?;
            let checkout_existing = run_command(
                "git",
                &["worktree", "add", qa_worktree_str, &branch],
                Some(repo_path_ref),
            );
            if let Err(existing_error) = checkout_existing {
                run_command(
                    "git",
                    &["worktree", "add", qa_worktree_str, "-b", &branch],
                    Some(repo_path_ref),
                )
                .with_context(|| {
                    format!("Failed to create or checkout QA branch {branch}: {existing_error}")
                })?;
            }

            for hook in &repo_config.hooks.pre_start {
                let (ok, _stdout, stderr) =
                    run_command_allow_failure("sh", &["-lc", hook], Some(qa_worktree.as_path()))?;
                if !ok {
                    let _ = remove_worktree(repo_path_ref, qa_worktree.as_path());
                    return Err(anyhow!("QA pre-start hook failed: {hook}\n{stderr}"));
                }
            }

            cleanup_repo_path = Some(repo_path.to_string());
            cleanup_worktree_path = Some(qa_worktree_str.to_string());
            qa_worktree_str.to_string()
        } else {
            repo_path.to_string()
        };

        let port = pick_free_port()?;
        let metadata_namespace = self.config_store.task_metadata_namespace()?;
        let mut child = spawn_opencode_server(
            Path::new(&runtime_working_directory),
            Path::new(repo_path),
            metadata_namespace.as_str(),
            port,
        )?;
        if let Err(error) =
            wait_for_local_server_with_process(&mut child, port, Duration::from_secs(8))
        {
            terminate_child_process(&mut child);
            if let (Some(repo), Some(worktree)) = (
                cleanup_repo_path.as_deref(),
                cleanup_worktree_path.as_deref(),
            ) {
                let _ = remove_worktree(Path::new(repo), Path::new(worktree));
            }
            return Err(error)
                .with_context(|| format!("OpenCode runtime failed to start for task {task_id}"));
        }

        let runtime_id = format!("runtime-{}", Uuid::new_v4().simple());
        let summary = AgentRuntimeSummary {
            runtime_id: runtime_id.clone(),
            repo_path: repo_key,
            task_id: task_id.to_string(),
            role: role.to_string(),
            working_directory: runtime_working_directory,
            port,
            started_at: now_rfc3339(),
        };

        self.agent_runtimes
            .lock()
            .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?
            .insert(
                runtime_id,
                AgentRuntimeProcess {
                    summary: summary.clone(),
                    child,
                    cleanup_repo_path,
                    cleanup_worktree_path,
                },
            );

        Ok(summary)
    }

    pub fn opencode_runtime_stop(&self, runtime_id: &str) -> Result<bool> {
        let mut runtimes = self
            .agent_runtimes
            .lock()
            .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
        let mut runtime = runtimes
            .remove(runtime_id)
            .ok_or_else(|| anyhow!("Runtime not found: {runtime_id}"))?;
        terminate_child_process(&mut runtime.child);
        if let (Some(repo_path), Some(worktree_path)) = (
            runtime.cleanup_repo_path.as_deref(),
            runtime.cleanup_worktree_path.as_deref(),
        ) {
            remove_worktree(Path::new(repo_path), Path::new(worktree_path))
                .with_context(|| format!("Failed removing QA worktree runtime {worktree_path}"))?;
        }
        Ok(true)
    }

    pub fn shutdown(&self) -> Result<()> {
        {
            let mut runs = self
                .runs
                .lock()
                .map_err(|_| anyhow!("Run state lock poisoned"))?;
            for (_, mut run) in runs.drain() {
                terminate_child_process(&mut run.child);
            }
        }

        let mut cleanup_errors = Vec::new();
        {
            let mut runtimes = self
                .agent_runtimes
                .lock()
                .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
            for (_, mut runtime) in runtimes.drain() {
                terminate_child_process(&mut runtime.child);
                if let (Some(repo_path), Some(worktree_path)) = (
                    runtime.cleanup_repo_path.as_deref(),
                    runtime.cleanup_worktree_path.as_deref(),
                ) {
                    if let Err(error) =
                        remove_worktree(Path::new(repo_path), Path::new(worktree_path))
                    {
                        cleanup_errors.push(format!(
                            "Failed removing QA worktree runtime {}: {}",
                            worktree_path, error
                        ));
                    }
                }
            }
        }

        if cleanup_errors.is_empty() {
            Ok(())
        } else {
            Err(anyhow!(cleanup_errors.join("\n")))
        }
    }

    pub(crate) fn prune_stale_runtimes(runtimes: &mut HashMap<String, AgentRuntimeProcess>) {
        let stale_runtime_ids = runtimes
            .iter_mut()
            .filter_map(|(runtime_id, runtime)| {
                runtime
                    .child
                    .try_wait()
                    .ok()
                    .flatten()
                    .map(|_| runtime_id.clone())
            })
            .collect::<Vec<_>>();
        for runtime_id in stale_runtime_ids {
            if let Some(mut runtime) = runtimes.remove(&runtime_id) {
                terminate_child_process(&mut runtime.child);
                if let (Some(repo_path), Some(worktree_path)) = (
                    runtime.cleanup_repo_path.as_deref(),
                    runtime.cleanup_worktree_path.as_deref(),
                ) {
                    let _ = remove_worktree(Path::new(repo_path), Path::new(worktree_path));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::app_service::test_support::build_service_with_state;

    #[test]
    fn module_runs_list_is_empty_on_fresh_service() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);

        let runs = service
            .runs_list(None)
            .expect("runs list should be available");

        assert!(runs.is_empty());
    }

    #[test]
    fn module_opencode_runtime_stop_reports_missing_runtime() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);

        let error = service
            .opencode_runtime_stop("missing-runtime")
            .expect_err("stopping unknown runtime should fail");

        assert!(error
            .to_string()
            .contains("Runtime missing-runtime not found"));
    }

    #[test]
    fn module_shutdown_succeeds_when_no_processes_are_running() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        service
            .shutdown()
            .expect("shutdown should be idempotent for empty state");
    }
}
