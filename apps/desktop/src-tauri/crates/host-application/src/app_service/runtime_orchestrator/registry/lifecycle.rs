use super::super::super::{AgentRuntimeProcess, AppService, RuntimeCleanupTarget};
use super::super::start_pipeline::{
    RuntimePostStartPolicy, RuntimeStartInput, SpawnedRuntimeServer,
};
use anyhow::{anyhow, Result};
use host_domain::{now_rfc3339, RuntimeInstanceSummary};
use host_infra_system::stop_shared_dolt_server_for_current_owner;
use std::collections::HashMap;
use std::sync::MutexGuard;

impl AppService {
    pub(in crate::app_service::runtime_orchestrator) fn attach_runtime_session(
        &self,
        input: RuntimeStartInput<'_>,
        mut spawned_server: SpawnedRuntimeServer,
    ) -> Result<RuntimeInstanceSummary> {
        let RuntimeStartInput {
            runtime_kind,
            startup_scope,
            repo_key,
            task_id,
            role,
            working_directory,
            cleanup_target,
            post_start_policy,
            ..
        } = input;

        let definition = self.runtime_registry.definition(&runtime_kind)?;
        let summary = RuntimeInstanceSummary {
            kind: runtime_kind.clone(),
            runtime_id: spawned_server.runtime_id.clone(),
            repo_path: repo_key,
            task_id: (role != host_domain::RuntimeRole::Workspace).then(|| task_id.to_string()),
            role,
            working_directory,
            runtime_route: spawned_server.runtime_route.clone(),
            started_at: now_rfc3339(),
            descriptor: definition.descriptor().clone(),
        };

        let mut runtimes = self.lock_runtime_registry_for_attach(
            spawned_server.child.as_mut(),
            cleanup_target.as_ref(),
        )?;
        if let Some(existing) = self.apply_post_start_policy(
            &mut runtimes,
            post_start_policy,
            startup_scope,
            spawned_server.child.as_mut(),
            cleanup_target.as_ref(),
        )? {
            return Ok(existing);
        }

        runtimes.insert(
            spawned_server.runtime_id,
            AgentRuntimeProcess {
                summary: summary.clone(),
                child: spawned_server.child,
                _runtime_process_guard: spawned_server._runtime_process_guard,
                cleanup_target,
            },
        );

        Ok(summary)
    }

    fn lock_runtime_registry_for_attach<'a>(
        &'a self,
        child: Option<&mut std::process::Child>,
        cleanup_target: Option<&RuntimeCleanupTarget>,
    ) -> Result<MutexGuard<'a, HashMap<String, AgentRuntimeProcess>>> {
        match self.agent_runtimes.lock() {
            Ok(runtimes) => Ok(runtimes),
            Err(_) => {
                let lock_error = anyhow!("Agent runtime state lock poisoned");
                if let Err(cleanup_error) = Self::cleanup_started_runtime(child, cleanup_target) {
                    return Err(Self::append_runtime_cleanup_error(
                        lock_error,
                        cleanup_error,
                    ));
                }
                Err(lock_error)
            }
        }
    }

    fn apply_post_start_policy(
        &self,
        runtimes: &mut HashMap<String, AgentRuntimeProcess>,
        post_start_policy: Option<RuntimePostStartPolicy<'_>>,
        startup_scope: &str,
        child: Option<&mut std::process::Child>,
        cleanup_target: Option<&RuntimeCleanupTarget>,
    ) -> Result<Option<RuntimeInstanceSummary>> {
        let Some(post_start_policy) = post_start_policy else {
            return Ok(None);
        };

        if let Err(error) = self.prune_stale_runtimes(runtimes) {
            let prune_error = error.context(post_start_policy.prune_error_context);
            if let Err(cleanup_error) = Self::cleanup_started_runtime(child, cleanup_target) {
                return Err(Self::append_runtime_cleanup_error(
                    prune_error,
                    cleanup_error,
                ));
            }
            return Err(prune_error);
        }

        if let Some(existing) =
            Self::find_existing_runtime(runtimes, post_start_policy.existing_lookup)
        {
            if let Err(cleanup_error) = Self::cleanup_started_runtime(child, cleanup_target) {
                return Err(Self::append_runtime_cleanup_error(
                    anyhow!(
                        "Found existing runtime {} while finalizing {startup_scope} startup",
                        existing.runtime_id
                    ),
                    cleanup_error,
                ));
            }
            return Ok(Some(existing));
        }

        Ok(None)
    }

    fn stop_registered_runtime_internal(
        &self,
        runtime_id: &str,
        clear_repo_runtime_health: bool,
    ) -> Result<bool> {
        let mut runtimes = self
            .agent_runtimes
            .lock()
            .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
        let mut runtime = runtimes
            .remove(runtime_id)
            .ok_or_else(|| anyhow!("Runtime not found: {runtime_id}"))?;
        let cleanup_result = Self::cleanup_runtime_process(&mut runtime);
        let clear_startup_result = self.clear_runtime_startup_status_for_runtime(&runtime.summary);
        let clear_repo_health_result = if clear_repo_runtime_health {
            self.clear_repo_runtime_health_status_for_runtime(&runtime.summary)
        } else {
            Ok(())
        };

        let mut errors = Vec::new();
        if let Err(error) = cleanup_result {
            errors.push(format!(
                "Failed shutting down runtime {runtime_id}: {error:#}"
            ));
        }
        if let Err(error) = clear_startup_result {
            errors.push(format!(
                "Failed clearing startup status for runtime {runtime_id}: {error:#}"
            ));
        }
        if let Err(error) = clear_repo_health_result {
            errors.push(format!(
                "Failed clearing repo runtime health status for runtime {runtime_id}: {error:#}"
            ));
        }

        if errors.is_empty() {
            Ok(true)
        } else {
            Err(anyhow!(errors.join("\n")))
        }
    }

    pub(in crate::app_service::runtime_orchestrator) fn stop_registered_runtime(
        &self,
        runtime_id: &str,
    ) -> Result<bool> {
        self.stop_registered_runtime_internal(runtime_id, true)
    }

    pub(in crate::app_service::runtime_orchestrator) fn stop_registered_runtime_preserving_repo_health(
        &self,
        runtime_id: &str,
    ) -> Result<bool> {
        self.stop_registered_runtime_internal(runtime_id, false)
    }

    pub fn shutdown(&self) -> Result<()> {
        tracing::info!(
            target: "openducktor.lifecycle",
            "Shutting down OpenDucktor host services"
        );
        self.startup_cancel_epoch
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let mut cleanup_errors = Vec::new();
        for runtime in self.runtime_registry.runtimes() {
            let runtime_kind = runtime.definition().kind().as_str().to_string();
            tracing::info!(
                target: "openducktor.lifecycle",
                "Stopping pending {runtime_kind} runtime startup processes"
            );
            if let Err(error) = runtime.terminate_tracked_processes(self) {
                cleanup_errors.push(format!(
                    "Failed terminating pending {} runtime processes: {error:#}",
                    runtime_kind
                ));
            }
        }
        tracing::info!(target: "openducktor.lifecycle", "Stopping dev servers");
        if let Err(error) = self.stop_all_dev_servers() {
            cleanup_errors.push(format!("Failed stopping dev servers: {error:#}"));
        }

        match self.agent_runtimes.lock() {
            Ok(mut runtimes) => {
                tracing::info!(
                    target: "openducktor.lifecycle",
                    "Stopping {} active agent runtime(s)",
                    runtimes.len()
                );
                for (_, mut runtime) in runtimes.drain() {
                    let task_label = runtime.summary.task_id.as_deref().unwrap_or("workspace");
                    tracing::info!(
                        target: "openducktor.lifecycle",
                        "Stopping {} runtime {} for task {task_label} ({:?})",
                        runtime.summary.kind.as_str(),
                        runtime.summary.runtime_id,
                        runtime.summary.role
                    );
                    if let Err(error) =
                        self.clear_runtime_startup_status_for_runtime(&runtime.summary)
                    {
                        cleanup_errors.push(format!(
                            "Failed clearing startup status for runtime {}: {}",
                            runtime.summary.runtime_id, error
                        ));
                    }
                    if let Err(error) =
                        self.clear_repo_runtime_health_status_for_runtime(&runtime.summary)
                    {
                        cleanup_errors.push(format!(
                            "Failed clearing repo runtime health status for runtime {}: {}",
                            runtime.summary.runtime_id, error
                        ));
                    }
                    if let Err(error) = Self::cleanup_runtime_process(&mut runtime) {
                        cleanup_errors.push(format!(
                            "Failed shutting down runtime {}: {}",
                            runtime.summary.runtime_id, error
                        ));
                    }
                }
            }
            Err(_) => cleanup_errors.push("Agent runtime state lock poisoned".to_string()),
        }

        tracing::info!(target: "openducktor.lifecycle", "Stopping MCP host bridge");
        if let Err(error) = self.stop_mcp_bridge_process() {
            cleanup_errors.push(format!("Failed shutting down MCP host bridge: {error:#}"));
        }

        tracing::info!(target: "openducktor.lifecycle", "Stopping shared Dolt server");
        match stop_shared_dolt_server_for_current_owner(self.instance_pid) {
            Ok(true) => tracing::info!(
                target: "openducktor.lifecycle",
                "Shared Dolt server stopped"
            ),
            Ok(false) => tracing::info!(
                target: "openducktor.lifecycle",
                "No shared Dolt server owned by this OpenDucktor process"
            ),
            Err(error) => cleanup_errors.push(format!(
                "Failed shutting down shared Dolt server: {error:#}"
            )),
        }

        if cleanup_errors.is_empty() {
            tracing::info!(
                target: "openducktor.lifecycle",
                "OpenDucktor host services stopped"
            );
            Ok(())
        } else {
            tracing::error!(
                target: "openducktor.lifecycle",
                "OpenDucktor host services stopped with {} cleanup error(s)",
                cleanup_errors.len()
            );
            Err(anyhow!(cleanup_errors.join("\n")))
        }
    }

    pub(in crate::app_service::runtime_orchestrator) fn prune_stale_runtimes(
        &self,
        runtimes: &mut HashMap<String, AgentRuntimeProcess>,
    ) -> Result<()> {
        let stale_runtime_ids = runtimes
            .iter_mut()
            .filter_map(|(runtime_id, runtime)| {
                runtime
                    .child
                    .as_mut()
                    .and_then(|child| child.try_wait().ok().flatten())
                    .map(|_| runtime_id.clone())
            })
            .collect::<Vec<_>>();
        let mut cleanup_errors = Vec::new();

        for runtime_id in stale_runtime_ids {
            if let Some(mut runtime) = runtimes.remove(&runtime_id) {
                if let Err(error) = self.clear_runtime_startup_status_for_runtime(&runtime.summary)
                {
                    cleanup_errors.push(format!(
                        "Failed clearing startup status for stale runtime {runtime_id}: {error}"
                    ));
                }
                if let Err(error) =
                    self.clear_repo_runtime_health_status_for_runtime(&runtime.summary)
                {
                    cleanup_errors.push(format!(
                        "Failed clearing repo runtime health status for stale runtime {runtime_id}: {error}"
                    ));
                }
                if let Err(error) = Self::cleanup_runtime_process(&mut runtime) {
                    cleanup_errors.push(format!(
                        "Failed pruning stale runtime {runtime_id}: {error}"
                    ));
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
