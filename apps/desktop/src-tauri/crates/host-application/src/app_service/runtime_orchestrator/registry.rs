use super::super::{
    qa_worktree::remove_runtime_worktree, terminate_child_process, AgentRuntimeProcess, AppService,
};
use super::{RuntimeExistingLookup, RuntimeStartInput, SpawnedRuntimeServer};
use anyhow::{anyhow, Context, Result};
use host_domain::{now_rfc3339, AgentRuntimeSummary};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::Child;

impl AppService {
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

    pub(super) fn attach_runtime_session(
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
            cleanup_repo_path,
            cleanup_worktree_path,
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

        let mut runtimes = match self.agent_runtimes.lock() {
            Ok(runtimes) => runtimes,
            Err(_) => {
                let lock_error = anyhow!("Agent runtime state lock poisoned");
                if let Err(cleanup_error) = Self::cleanup_started_runtime(
                    &mut spawned_server.child,
                    cleanup_repo_path.as_deref(),
                    cleanup_worktree_path.as_deref(),
                ) {
                    return Err(Self::append_cleanup_error(lock_error, cleanup_error));
                }
                return Err(lock_error);
            }
        };
        if let Some(post_start_policy) = post_start_policy {
            if let Err(error) = Self::prune_stale_runtimes(&mut runtimes) {
                let prune_error = error.context(post_start_policy.prune_error_context);
                if let Err(cleanup_error) = Self::cleanup_started_runtime(
                    &mut spawned_server.child,
                    cleanup_repo_path.as_deref(),
                    cleanup_worktree_path.as_deref(),
                ) {
                    return Err(Self::append_cleanup_error(prune_error, cleanup_error));
                }
                return Err(prune_error);
            }
            if let Some(existing) =
                Self::find_existing_runtime(&runtimes, post_start_policy.existing_lookup)
            {
                if let Err(cleanup_error) = Self::cleanup_started_runtime(
                    &mut spawned_server.child,
                    cleanup_repo_path.as_deref(),
                    cleanup_worktree_path.as_deref(),
                ) {
                    return Err(anyhow!(
                        "Found existing runtime {} while finalizing {startup_scope} startup\nAlso failed to remove QA worktree: {cleanup_error}",
                        existing.runtime_id
                    ));
                }
                return Ok(existing);
            }
        }

        runtimes.insert(
            spawned_server.runtime_id,
            AgentRuntimeProcess {
                summary: summary.clone(),
                child: spawned_server.child,
                _opencode_process_guard: Some(spawned_server.opencode_process_guard),
                cleanup_repo_path,
                cleanup_worktree_path,
            },
        );

        Ok(summary)
    }

    pub(super) fn find_existing_runtime(
        runtimes: &HashMap<String, AgentRuntimeProcess>,
        lookup: RuntimeExistingLookup<'_>,
    ) -> Option<AgentRuntimeSummary> {
        runtimes
            .values()
            .find(|runtime| {
                runtime.summary.repo_path == lookup.repo_key
                    && runtime.summary.role == lookup.role
                    && lookup
                        .task_id
                        .map_or(true, |task_id| runtime.summary.task_id == task_id)
            })
            .map(|runtime| runtime.summary.clone())
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

    pub(super) fn prune_stale_runtimes(
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

    fn cleanup_runtime_worktree_if_needed(
        cleanup_repo_path: Option<&str>,
        cleanup_worktree_path: Option<&str>,
    ) -> Result<()> {
        if let (Some(repo_path), Some(worktree_path)) = (cleanup_repo_path, cleanup_worktree_path) {
            remove_runtime_worktree(Path::new(repo_path), Path::new(worktree_path))?;
        }
        Ok(())
    }

    pub(super) fn cleanup_started_runtime(
        child: &mut Child,
        cleanup_repo_path: Option<&str>,
        cleanup_worktree_path: Option<&str>,
    ) -> Result<()> {
        terminate_child_process(child);
        Self::cleanup_runtime_worktree_if_needed(cleanup_repo_path, cleanup_worktree_path)
    }

    pub(super) fn append_cleanup_error(
        base_error: anyhow::Error,
        cleanup_error: anyhow::Error,
    ) -> anyhow::Error {
        anyhow!("{base_error}\nAlso failed to remove QA worktree: {cleanup_error}")
    }
}
