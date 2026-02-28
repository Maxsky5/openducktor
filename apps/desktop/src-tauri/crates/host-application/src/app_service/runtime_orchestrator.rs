use super::{
    qa_worktree::{prepare_qa_worktree, remove_runtime_worktree},
    spawn_opencode_server, terminate_child_process, wait_for_local_server_with_process,
    AgentRuntimeProcess, AppService, StartupEventCorrelation, StartupEventPayload,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{now_rfc3339, AgentRuntimeSummary, RunSummary};
use host_infra_system::pick_free_port;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use uuid::Uuid;

#[derive(Clone, Copy)]
struct RuntimeExistingLookup<'a> {
    repo_key: &'a str,
    role: &'a str,
    task_id: Option<&'a str>,
}

struct RuntimePostStartPolicy<'a> {
    existing_lookup: RuntimeExistingLookup<'a>,
    prune_error_context: String,
}

struct RuntimeStartInput<'a> {
    startup_scope: &'a str,
    repo_path: &'a str,
    task_id: &'a str,
    role: &'a str,
    working_directory: String,
    cleanup_repo_path: Option<String>,
    cleanup_worktree_path: Option<String>,
    tracking_error_context: &'static str,
    startup_error_context: String,
    post_start_policy: Option<RuntimePostStartPolicy<'a>>,
}

impl AppService {
    pub fn runs_list(&self, repo_path: Option<&str>) -> Result<Vec<RunSummary>> {
        let repo_key_filter = repo_path
            .map(|path| self.ensure_repo_authorized(path))
            .transpose()?;
        let allowlisted_repo_keys = if repo_key_filter.is_none() && self.enforce_repo_allowlist {
            Some(
                self.config_store
                    .list_workspaces()?
                    .into_iter()
                    .map(|workspace| workspace.path)
                    .collect::<HashSet<_>>(),
            )
        } else {
            None
        };
        let runs = self
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?;

        let mut list = runs
            .values()
            .filter(|run| {
                if let Some(path_key) = repo_key_filter.as_deref() {
                    Self::repo_key(run.repo_path.as_str()) == path_key
                } else if let Some(allowlist) = allowlisted_repo_keys.as_ref() {
                    let run_repo_key = Self::repo_key(run.repo_path.as_str());
                    allowlist.contains(&run_repo_key)
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
        let repo_key_filter = repo_path
            .map(|path| self.ensure_repo_authorized(path))
            .transpose()?;
        let allowlisted_repo_keys = if repo_key_filter.is_none() && self.enforce_repo_allowlist {
            Some(
                self.config_store
                    .list_workspaces()?
                    .into_iter()
                    .map(|workspace| workspace.path)
                    .collect::<HashSet<_>>(),
            )
        } else {
            None
        };
        let mut runtimes = self
            .agent_runtimes
            .lock()
            .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
        Self::prune_stale_runtimes(&mut runtimes)?;

        let mut list = runtimes
            .values()
            .filter(|runtime| {
                if let Some(path_key) = repo_key_filter.as_deref() {
                    Self::repo_key(runtime.summary.repo_path.as_str()) == path_key
                } else if let Some(allowlist) = allowlisted_repo_keys.as_ref() {
                    let runtime_repo_key = Self::repo_key(runtime.summary.repo_path.as_str());
                    allowlist.contains(&runtime_repo_key)
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
        let repo_key = self.resolve_initialized_repo_path(repo_path)?;
        let repo_path = repo_key.as_str();

        {
            let mut runtimes = self
                .agent_runtimes
                .lock()
                .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
            Self::prune_stale_runtimes(&mut runtimes)?;

            if let Some(existing) = Self::find_existing_runtime(
                &runtimes,
                RuntimeExistingLookup {
                    repo_key: repo_key.as_str(),
                    role: Self::WORKSPACE_RUNTIME_ROLE,
                    task_id: None,
                },
            ) {
                return Ok(existing);
            }
        }

        self.spawn_and_register_runtime(RuntimeStartInput {
            startup_scope: "workspace_runtime",
            repo_path,
            task_id: Self::WORKSPACE_RUNTIME_TASK_ID,
            role: Self::WORKSPACE_RUNTIME_ROLE,
            working_directory: repo_key.clone(),
            cleanup_repo_path: None,
            cleanup_worktree_path: None,
            tracking_error_context: "Failed tracking spawned OpenCode workspace runtime",
            startup_error_context: format!("OpenCode workspace runtime failed to start for {repo_path}"),
            post_start_policy: Some(RuntimePostStartPolicy {
                existing_lookup: RuntimeExistingLookup {
                    repo_key: repo_key.as_str(),
                    role: Self::WORKSPACE_RUNTIME_ROLE,
                    task_id: None,
                },
                prune_error_context: format!(
                    "Failed pruning stale runtimes while finalizing workspace runtime for {repo_path}"
                ),
            }),
        })
    }

    pub fn opencode_runtime_start(
        &self,
        repo_path: &str,
        task_id: &str,
        role: &str,
    ) -> Result<AgentRuntimeSummary> {
        let repo_key = self.resolve_initialized_repo_path(repo_path)?;
        let repo_path = repo_key.as_str();
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
            Self::prune_stale_runtimes(&mut runtimes)?;

            if let Some(existing) = Self::find_existing_runtime(
                &runtimes,
                RuntimeExistingLookup {
                    repo_key: repo_key.as_str(),
                    role,
                    task_id: Some(task_id),
                },
            ) {
                return Ok(existing);
            }
        }

        let (runtime_working_directory, cleanup_repo_path, cleanup_worktree_path) = if role == "qa"
        {
            let setup =
                prepare_qa_worktree(repo_path, task_id, task.title.as_str(), &self.config_store)?;
            (
                setup.worktree_path.clone(),
                Some(setup.repo_path),
                Some(setup.worktree_path),
            )
        } else {
            (repo_path.to_string(), None, None)
        };

        self.spawn_and_register_runtime(RuntimeStartInput {
            startup_scope: "agent_runtime",
            repo_path,
            task_id,
            role,
            working_directory: runtime_working_directory,
            cleanup_repo_path,
            cleanup_worktree_path,
            tracking_error_context: "Failed tracking spawned OpenCode agent runtime",
            startup_error_context: format!("OpenCode runtime failed to start for task {task_id}"),
            post_start_policy: None,
        })
    }

    fn spawn_and_register_runtime(
        &self,
        input: RuntimeStartInput<'_>,
    ) -> Result<AgentRuntimeSummary> {
        let RuntimeStartInput {
            startup_scope,
            repo_path,
            task_id,
            role,
            working_directory,
            cleanup_repo_path,
            cleanup_worktree_path,
            tracking_error_context,
            startup_error_context,
            post_start_policy,
        } = input;

        let port = pick_free_port()?;
        let runtime_id = format!("runtime-{}", Uuid::new_v4().simple());
        let metadata_namespace = self.config_store.task_metadata_namespace()?;
        let mut child = spawn_opencode_server(
            Path::new(working_directory.as_str()),
            Path::new(repo_path),
            metadata_namespace.as_str(),
            port,
        )?;
        let opencode_process_guard = match self.track_pending_opencode_process(child.id()) {
            Ok(guard) => guard,
            Err(error) => {
                terminate_child_process(&mut child);
                return Err(error).context(tracking_error_context);
            }
        };
        let startup_policy = self.opencode_startup_readiness_policy();
        let startup_cancel_epoch = self.startup_cancel_epoch();
        let startup_cancel_snapshot = self.startup_cancel_snapshot();
        self.emit_opencode_startup_event(StartupEventPayload::wait_begin(
            startup_scope,
            repo_path,
            Some(task_id),
            role,
            port,
            Some(StartupEventCorrelation::new(
                "runtime_id",
                runtime_id.as_str(),
            )),
            Some(startup_policy),
        ));
        let startup_report = match wait_for_local_server_with_process(
            &mut child,
            port,
            startup_policy,
            &startup_cancel_epoch,
            startup_cancel_snapshot,
        ) {
            Ok(report) => report,
            Err(error) => {
                self.emit_opencode_startup_event(StartupEventPayload::failed(
                    startup_scope,
                    repo_path,
                    Some(task_id),
                    role,
                    port,
                    Some(StartupEventCorrelation::new(
                        "runtime_id",
                        runtime_id.as_str(),
                    )),
                    Some(startup_policy),
                    error.report,
                    error.reason,
                ));
                terminate_child_process(&mut child);
                if let Err(cleanup_error) = Self::cleanup_runtime_worktree_if_needed(
                    cleanup_repo_path.as_deref(),
                    cleanup_worktree_path.as_deref(),
                ) {
                    return Err(anyhow!(
                        "{startup_error_context}\nAlso failed to remove QA worktree: {cleanup_error}"
                    ));
                }
                return Err(anyhow!(error)).with_context(|| startup_error_context);
            }
        };
        self.emit_opencode_startup_event(StartupEventPayload::ready(
            startup_scope,
            repo_path,
            Some(task_id),
            role,
            port,
            Some(StartupEventCorrelation::new(
                "runtime_id",
                runtime_id.as_str(),
            )),
            Some(startup_policy),
            startup_report,
        ));

        let summary = AgentRuntimeSummary {
            runtime_id: runtime_id.clone(),
            repo_path: repo_path.to_string(),
            task_id: task_id.to_string(),
            role: role.to_string(),
            working_directory,
            port,
            started_at: now_rfc3339(),
        };

        let mut runtimes = self
            .agent_runtimes
            .lock()
            .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
        if let Some(post_start_policy) = post_start_policy {
            if let Err(error) = Self::prune_stale_runtimes(&mut runtimes) {
                terminate_child_process(&mut child);
                return Err(error).with_context(|| post_start_policy.prune_error_context);
            }
            if let Some(existing) =
                Self::find_existing_runtime(&runtimes, post_start_policy.existing_lookup)
            {
                terminate_child_process(&mut child);
                return Ok(existing);
            }
        }

        runtimes.insert(
            runtime_id,
            AgentRuntimeProcess {
                summary: summary.clone(),
                child,
                _opencode_process_guard: Some(opencode_process_guard),
                cleanup_repo_path,
                cleanup_worktree_path,
            },
        );

        Ok(summary)
    }

    fn find_existing_runtime(
        runtimes: &HashMap<String, AgentRuntimeProcess>,
        lookup: RuntimeExistingLookup<'_>,
    ) -> Option<AgentRuntimeSummary> {
        runtimes
            .values()
            .find(|runtime| {
                Self::repo_key(runtime.summary.repo_path.as_str()) == lookup.repo_key
                    && runtime.summary.role == lookup.role
                    && lookup
                        .task_id
                        .map_or(true, |task_id| runtime.summary.task_id == task_id)
            })
            .map(|runtime| runtime.summary.clone())
    }

    fn cleanup_runtime_worktree_if_needed(
        cleanup_repo_path: Option<&str>,
        cleanup_worktree_path: Option<&str>,
    ) -> Result<()> {
        if let (Some(repo_path), Some(worktree_path)) = (cleanup_repo_path, cleanup_worktree_path) {
            remove_runtime_worktree(Path::new(repo_path), Path::new(worktree_path))?;
        }
        Ok(())
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
            remove_runtime_worktree(Path::new(repo_path), Path::new(worktree_path))?;
        }
        Ok(true)
    }

    pub fn shutdown(&self) -> Result<()> {
        self.startup_cancel_epoch
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let mut cleanup_errors = Vec::new();
        if let Err(error) = self.terminate_pending_opencode_processes() {
            cleanup_errors.push(format!(
                "Failed terminating pending OpenCode processes: {error:#}"
            ));
        }

        match self.runs.lock() {
            Ok(mut runs) => {
                for (_, mut run) in runs.drain() {
                    terminate_child_process(&mut run.child);
                }
            }
            Err(_) => cleanup_errors.push("Run state lock poisoned".to_string()),
        }

        match self.agent_runtimes.lock() {
            Ok(mut runtimes) => {
                for (_, mut runtime) in runtimes.drain() {
                    terminate_child_process(&mut runtime.child);
                    if let (Some(repo_path), Some(worktree_path)) = (
                        runtime.cleanup_repo_path.as_deref(),
                        runtime.cleanup_worktree_path.as_deref(),
                    ) {
                        if let Err(error) =
                            remove_runtime_worktree(Path::new(repo_path), Path::new(worktree_path))
                        {
                            cleanup_errors.push(format!(
                                "Failed shutting down runtime {}: {}",
                                runtime.summary.runtime_id, error
                            ));
                        }
                    }
                }
            }
            Err(_) => cleanup_errors.push("Agent runtime state lock poisoned".to_string()),
        }

        if cleanup_errors.is_empty() {
            Ok(())
        } else {
            Err(anyhow!(cleanup_errors.join("\n")))
        }
    }

    pub(crate) fn prune_stale_runtimes(
        runtimes: &mut HashMap<String, AgentRuntimeProcess>,
    ) -> Result<()> {
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
        let mut cleanup_errors = Vec::new();
        for runtime_id in stale_runtime_ids {
            if let Some(mut runtime) = runtimes.remove(&runtime_id) {
                terminate_child_process(&mut runtime.child);
                if let (Some(repo_path), Some(worktree_path)) = (
                    runtime.cleanup_repo_path.as_deref(),
                    runtime.cleanup_worktree_path.as_deref(),
                ) {
                    if let Err(error) =
                        remove_runtime_worktree(Path::new(repo_path), Path::new(worktree_path))
                    {
                        cleanup_errors.push(format!(
                            "Failed pruning stale runtime {runtime_id}: {error}"
                        ));
                    }
                }
            }
        }

        if cleanup_errors.is_empty() {
            Ok(())
        } else {
            Err(anyhow!(
                "Failed pruning stale agent runtimes:\n{}",
                cleanup_errors.join("\n")
            ))
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
            .contains("Runtime not found: missing-runtime"));
    }

    #[test]
    fn module_shutdown_succeeds_when_no_processes_are_running() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        service
            .shutdown()
            .expect("shutdown should be idempotent for empty state");
    }
}
