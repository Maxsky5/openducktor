use super::{
    run_parsed_hook_command_allow_failure, spawn_opencode_server, terminate_child_process,
    validate_hook_trust, wait_for_local_server_with_process, AgentRuntimeProcess, AppService,
    StartupEventCorrelation, StartupEventPayload,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{now_rfc3339, AgentRuntimeSummary, RunSummary};
use host_infra_system::{build_branch_name, pick_free_port, remove_worktree, run_command};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use uuid::Uuid;

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

            if let Some(existing) = runtimes.values().find(|runtime| {
                Self::repo_key(runtime.summary.repo_path.as_str()) == repo_key
                    && runtime.summary.role == Self::WORKSPACE_RUNTIME_ROLE
            }) {
                return Ok(existing.summary.clone());
            }
        }

        let port = pick_free_port()?;
        let runtime_id = format!("runtime-{}", Uuid::new_v4().simple());
        let metadata_namespace = self.config_store.task_metadata_namespace()?;
        let mut child = spawn_opencode_server(
            Path::new(repo_path),
            Path::new(repo_path),
            metadata_namespace.as_str(),
            port,
        )?;
        let opencode_process_guard = match self.track_pending_opencode_process(child.id()) {
            Ok(guard) => guard,
            Err(error) => {
                terminate_child_process(&mut child);
                return Err(error).context("Failed tracking spawned OpenCode workspace runtime");
            }
        };
        let startup_policy = self.opencode_startup_readiness_policy();
        let startup_cancel_epoch = self.startup_cancel_epoch();
        let startup_cancel_snapshot = self.startup_cancel_snapshot();
        self.emit_opencode_startup_event(StartupEventPayload::wait_begin(
            "workspace_runtime",
            repo_path,
            Some(Self::WORKSPACE_RUNTIME_TASK_ID),
            Self::WORKSPACE_RUNTIME_ROLE,
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
                    "workspace_runtime",
                    repo_path,
                    Some(Self::WORKSPACE_RUNTIME_TASK_ID),
                    Self::WORKSPACE_RUNTIME_ROLE,
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
                return Err(anyhow!(error)).with_context(|| {
                    format!("OpenCode workspace runtime failed to start for {repo_path}")
                });
            }
        };
        self.emit_opencode_startup_event(StartupEventPayload::ready(
            "workspace_runtime",
            repo_path,
            Some(Self::WORKSPACE_RUNTIME_TASK_ID),
            Self::WORKSPACE_RUNTIME_ROLE,
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
            if let Err(error) = Self::prune_stale_runtimes(&mut runtimes) {
                terminate_child_process(&mut child);
                return Err(error).with_context(|| {
                    format!(
                        "Failed pruning stale runtimes while finalizing workspace runtime for {repo_path}"
                    )
                });
            }

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
                    _opencode_process_guard: Some(opencode_process_guard),
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

            validate_hook_trust(repo_path, &repo_config)?;

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
                    run_parsed_hook_command_allow_failure(hook, qa_worktree.as_path());
                if !ok {
                    if let Err(cleanup_error) =
                        Self::remove_runtime_worktree(repo_path_ref, qa_worktree.as_path())
                    {
                        return Err(anyhow!(
                            "QA pre-start hook failed: {hook}\n{stderr}\nAlso failed to remove QA worktree: {cleanup_error}"
                        ));
                    }
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
        let runtime_id = format!("runtime-{}", Uuid::new_v4().simple());
        let metadata_namespace = self.config_store.task_metadata_namespace()?;
        let mut child = spawn_opencode_server(
            Path::new(&runtime_working_directory),
            Path::new(repo_path),
            metadata_namespace.as_str(),
            port,
        )?;
        let opencode_process_guard = match self.track_pending_opencode_process(child.id()) {
            Ok(guard) => guard,
            Err(error) => {
                terminate_child_process(&mut child);
                return Err(error).context("Failed tracking spawned OpenCode agent runtime");
            }
        };
        let startup_policy = self.opencode_startup_readiness_policy();
        let startup_cancel_epoch = self.startup_cancel_epoch();
        let startup_cancel_snapshot = self.startup_cancel_snapshot();
        self.emit_opencode_startup_event(StartupEventPayload::wait_begin(
            "agent_runtime",
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
                    "agent_runtime",
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
                let startup_context =
                    format!("OpenCode runtime failed to start for task {task_id}");
                if let (Some(repo), Some(worktree)) = (
                    cleanup_repo_path.as_deref(),
                    cleanup_worktree_path.as_deref(),
                ) {
                    if let Err(cleanup_error) =
                        Self::remove_runtime_worktree(Path::new(repo), Path::new(worktree))
                    {
                        return Err(anyhow!(
                            "{startup_context}\nAlso failed to remove QA worktree: {cleanup_error}"
                        ));
                    }
                }
                return Err(anyhow!(error)).with_context(|| startup_context);
            }
        };
        self.emit_opencode_startup_event(StartupEventPayload::ready(
            "agent_runtime",
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
                    _opencode_process_guard: Some(opencode_process_guard),
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
            Self::remove_runtime_worktree(Path::new(repo_path), Path::new(worktree_path))?;
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
                        if let Err(error) = Self::remove_runtime_worktree(
                            Path::new(repo_path),
                            Path::new(worktree_path),
                        ) {
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

    fn remove_runtime_worktree(repo_path: &Path, worktree_path: &Path) -> Result<()> {
        remove_worktree(repo_path, worktree_path).with_context(|| {
            format!(
                "Failed removing QA worktree runtime {}",
                worktree_path.display()
            )
        })
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
                    if let Err(error) = Self::remove_runtime_worktree(
                        Path::new(repo_path),
                        Path::new(worktree_path),
                    ) {
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
