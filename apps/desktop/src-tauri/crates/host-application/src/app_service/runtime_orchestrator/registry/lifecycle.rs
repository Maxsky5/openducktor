use super::super::super::{AgentRuntimeProcess, AppService, RuntimeCleanupTarget};
use super::super::{RuntimePostStartPolicy, RuntimeStartInput, SpawnedRuntimeServer};
use anyhow::{anyhow, Result};
use host_domain::{now_rfc3339, AgentRuntimeSummary};
use std::collections::HashMap;
use std::process::Child;
use std::sync::MutexGuard;

impl AppService {
    pub(in crate::app_service::runtime_orchestrator) fn attach_runtime_session(
        &self,
        input: RuntimeStartInput<'_>,
        mut spawned_server: SpawnedRuntimeServer,
    ) -> Result<AgentRuntimeSummary> {
        let RuntimeStartInput {
            startup_scope,
            repo_key,
            task_id,
            role,
            working_directory,
            cleanup_target,
            post_start_policy,
            ..
        } = input;

        let summary = AgentRuntimeSummary {
            runtime_id: spawned_server.runtime_id.clone(),
            repo_path: repo_key,
            task_id: task_id.to_string(),
            role,
            working_directory,
            port: spawned_server.port,
            started_at: now_rfc3339(),
        };

        let mut runtimes =
            self.lock_runtime_registry_for_attach(&mut spawned_server.child, cleanup_target.as_ref())?;
        if let Some(existing) = Self::apply_post_start_policy(
            &mut runtimes,
            post_start_policy,
            startup_scope,
            &mut spawned_server.child,
            cleanup_target.as_ref(),
        )? {
            return Ok(existing);
        }

        runtimes.insert(
            spawned_server.runtime_id,
            AgentRuntimeProcess {
                summary: summary.clone(),
                child: spawned_server.child,
                _opencode_process_guard: Some(spawned_server.opencode_process_guard),
                cleanup_target,
            },
        );

        Ok(summary)
    }

    fn lock_runtime_registry_for_attach<'a>(
        &'a self,
        child: &mut Child,
        cleanup_target: Option<&RuntimeCleanupTarget>,
    ) -> Result<MutexGuard<'a, HashMap<String, AgentRuntimeProcess>>> {
        match self.agent_runtimes.lock() {
            Ok(runtimes) => Ok(runtimes),
            Err(_) => {
                let lock_error = anyhow!("Agent runtime state lock poisoned");
                if let Err(cleanup_error) = Self::cleanup_started_runtime(child, cleanup_target) {
                    return Err(Self::append_cleanup_error(lock_error, cleanup_error));
                }
                Err(lock_error)
            }
        }
    }

    fn apply_post_start_policy(
        runtimes: &mut HashMap<String, AgentRuntimeProcess>,
        post_start_policy: Option<RuntimePostStartPolicy<'_>>,
        startup_scope: &str,
        child: &mut Child,
        cleanup_target: Option<&RuntimeCleanupTarget>,
    ) -> Result<Option<AgentRuntimeSummary>> {
        let Some(post_start_policy) = post_start_policy else {
            return Ok(None);
        };

        if let Err(error) = Self::prune_stale_runtimes(runtimes) {
            let prune_error = error.context(post_start_policy.prune_error_context);
            if let Err(cleanup_error) = Self::cleanup_started_runtime(child, cleanup_target) {
                return Err(Self::append_cleanup_error(prune_error, cleanup_error));
            }
            return Err(prune_error);
        }

        if let Some(existing) = Self::find_existing_runtime(runtimes, post_start_policy.existing_lookup) {
            if let Err(cleanup_error) = Self::cleanup_started_runtime(child, cleanup_target) {
                return Err(anyhow!(
                    "Found existing runtime {} while finalizing {startup_scope} startup\nAlso failed to remove QA worktree: {cleanup_error}",
                    existing.runtime_id
                ));
            }
            return Ok(Some(existing));
        }

        Ok(None)
    }

    pub fn opencode_runtime_stop(&self, runtime_id: &str) -> Result<bool> {
        let mut runtimes = self
            .agent_runtimes
            .lock()
            .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
        let mut runtime = runtimes
            .remove(runtime_id)
            .ok_or_else(|| anyhow!("Runtime not found: {runtime_id}"))?;
        Self::cleanup_runtime_process(&mut runtime)?;
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
                    super::super::super::terminate_child_process(&mut run.child);
                }
            }
            Err(_) => cleanup_errors.push("Run state lock poisoned".to_string()),
        }

        match self.agent_runtimes.lock() {
            Ok(mut runtimes) => {
                for (_, mut runtime) in runtimes.drain() {
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

        if cleanup_errors.is_empty() {
            Ok(())
        } else {
            Err(anyhow!(cleanup_errors.join("\n")))
        }
    }

    pub(in crate::app_service::runtime_orchestrator) fn prune_stale_runtimes(
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
