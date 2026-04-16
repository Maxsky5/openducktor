use super::super::{AppService, RuntimeStartupWaitFailure};
use super::ensure_flight::RuntimeEnsureFlightGuard;
use super::start_pipeline::{RuntimeExistingLookup, RuntimePostStartPolicy, RuntimeStartInput};
use super::startup_status::{RuntimeStartupFailure, RuntimeStartupProgress};
use anyhow::{anyhow, Result};
use host_domain::{
    now_rfc3339, AgentRuntimeKind, RepoRuntimeStartupFailureKind, RuntimeInstanceSummary,
};
use std::time::Instant;

impl AppService {
    pub(in crate::app_service::runtime_orchestrator) fn find_existing_workspace_runtime(
        &self,
        runtime_kind: &AgentRuntimeKind,
        repo_key: &str,
    ) -> Result<Option<RuntimeInstanceSummary>> {
        let mut runtimes = self
            .agent_runtimes
            .lock()
            .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
        self.prune_stale_runtimes(&mut runtimes)?;
        Ok(Self::find_existing_runtime(
            &runtimes,
            RuntimeExistingLookup {
                repo_key,
                role: Self::WORKSPACE_RUNTIME_ROLE,
                task_id: None,
            },
        )
        .filter(|runtime| runtime.kind == *runtime_kind))
    }

    pub(in crate::app_service::runtime_orchestrator) fn ensure_workspace_runtime(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_path: &str,
    ) -> Result<RuntimeInstanceSummary> {
        let repo_key = self.resolve_authorized_repo_path(repo_path)?;
        let repo_path = repo_key.as_str();
        let workspace_id_for_mcp = self.workspace_id_for_repo_path(repo_path)?;

        if let Some(existing) =
            self.find_existing_workspace_runtime(&runtime_kind, repo_key.as_str())?
        {
            return Ok(existing);
        }

        let (flight, is_leader) =
            self.acquire_runtime_ensure_flight(runtime_kind.clone(), repo_key.as_str())?;
        if !is_leader {
            return Self::wait_for_runtime_ensure_flight(&flight);
        }
        let mut flight_guard =
            RuntimeEnsureFlightGuard::new(self, runtime_kind.clone(), repo_key.as_str(), flight);
        let startup_started_at_instant = Instant::now();
        let startup_started_at = now_rfc3339();

        let startup_result = (|| -> Result<RuntimeInstanceSummary> {
            if let Some(existing) =
                self.find_existing_workspace_runtime(&runtime_kind, repo_key.as_str())?
            {
                return Ok(existing);
            }

            let startup_error_context = format!(
                "{} workspace runtime failed to start for {repo_path}",
                runtime_kind.as_str()
            );
            let startup_policy = self.resolve_runtime_startup_policy(
                &runtime_kind,
                "workspace_runtime",
                repo_path,
                Self::WORKSPACE_RUNTIME_TASK_ID,
                Self::WORKSPACE_RUNTIME_ROLE,
                startup_error_context.as_str(),
            )?;

            self.spawn_and_register_runtime(RuntimeStartInput {
                runtime_kind: runtime_kind.clone(),
                startup_scope: "workspace_runtime",
                repo_path,
                workspace_id_for_mcp: workspace_id_for_mcp.as_str(),
                repo_key: repo_key.clone(),
                startup_started_at_instant,
                startup_started_at: startup_started_at.clone(),
                task_id: Self::WORKSPACE_RUNTIME_TASK_ID,
                role: Self::WORKSPACE_RUNTIME_ROLE,
                startup_policy,
                working_directory: repo_key.clone(),
                cleanup_target: None,
                tracking_error_context: "Failed tracking spawned workspace runtime process",
                startup_error_context,
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
        })();
        let startup_result = match startup_result {
            Ok(summary) => Ok(summary),
            Err(error) => {
                let startup_failure = error
                    .chain()
                    .find_map(|cause| cause.downcast_ref::<RuntimeStartupWaitFailure>());
                let (failure_kind, failure_reason, attempts, elapsed_ms) = match startup_failure {
                    Some(failure) => (
                        if failure.reason().is_timeout() {
                            RepoRuntimeStartupFailureKind::Timeout
                        } else {
                            RepoRuntimeStartupFailureKind::Error
                        },
                        failure.reason().as_str(),
                        Some(failure.report().attempts()),
                        Some(failure.report().startup_ms()),
                    ),
                    None => (RepoRuntimeStartupFailureKind::Error, "error", None, None),
                };
                match self.mark_runtime_startup_failed(
                    &runtime_kind,
                    repo_key.as_str(),
                    &RuntimeStartupProgress {
                        started_at_instant: startup_started_at_instant,
                        started_at: startup_started_at.clone(),
                        attempts,
                        elapsed_ms,
                    },
                    RuntimeStartupFailure {
                        failure_kind,
                        failure_reason: failure_reason.to_string(),
                        detail: format!("{error:#}"),
                    },
                ) {
                    Ok(()) => Err(error),
                    Err(mark_error) => Err(error.context(format!(
                        "Also failed recording workspace runtime startup failure for {repo_path}: {mark_error:#}"
                    ))),
                }
            }
        };
        flight_guard.complete(&startup_result)?;
        startup_result
    }
}

#[cfg(test)]
mod tests {
    use crate::app_service::test_support::{
        build_service_with_store, create_failing_opencode, create_fake_opencode, init_git_repo,
        install_fake_dolt, lock_env, set_env_var, set_fake_opencode_and_bridge_binaries,
        unique_temp_path, wait_for_path_exists, write_executable_script, EnvVarGuard,
    };
    use anyhow::Result;
    use host_domain::{
        AgentRuntimeKind, GitCurrentBranch, RepoRuntimeStartupFailureKind, RepoRuntimeStartupStage,
        RuntimeInstanceSummary,
    };
    use host_infra_system::AppConfigStore;
    use std::fs;
    use std::panic::{self, AssertUnwindSafe};
    use std::path::Path;
    use std::thread;
    use std::time::Duration;

    fn set_test_mcp_command() -> EnvVarGuard {
        set_env_var("OPENDUCKTOR_MCP_COMMAND_JSON", r#"["mcp-bin","--stdio"]"#)
    }

    fn create_delayed_failing_opencode(path: &Path) -> Result<()> {
        write_executable_script(
            path,
            r#"#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "opencode-fake 0.0.1"
  exit 0
fi

if [ "$1" = "serve" ]; then
  STARTS_FILE="${OPENDUCKTOR_TEST_STARTS_FILE:-}"
  if [ -n "$STARTS_FILE" ]; then
    echo "$$" >> "$STARTS_FILE"
  fi
  sleep 0.2
  echo "simulated delayed startup failure" >&2
  exit 42
fi

echo "unsupported opencode invocation" >&2
exit 1
"#,
        )
    }

    #[test]
    fn ensure_workspace_runtime_deduplicates_parallel_startup_at_module_seam() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("workspace-runtime-dedup");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let fake_opencode = root.join("opencode");
        create_fake_opencode(&fake_opencode)?;
        let _dolt_guard = install_fake_dolt(&root)?;
        let starts_file = root.join("started-pids.log");
        let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());
        let _mcp_command_guard = set_test_mcp_command();
        let _delay_guard = set_env_var("OPENDUCKTOR_TEST_STARTUP_DELAY_MS", "400");
        let _starts_guard = set_env_var(
            "OPENDUCKTOR_TEST_STARTS_FILE",
            starts_file.to_string_lossy().as_ref(),
        );

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
                revision: None,
            },
            config_store,
        );

        let repo_path = fs::canonicalize(&repo)?.to_string_lossy().to_string();
        service.workspace_add(repo_path.as_str())?;
        let (first, second) = thread::scope(
            |scope| -> Result<(RuntimeInstanceSummary, RuntimeInstanceSummary)> {
                let first_handle = scope.spawn(|| {
                    service
                        .ensure_workspace_runtime(AgentRuntimeKind::opencode(), repo_path.as_str())
                });
                let second_handle = scope.spawn(|| {
                    service
                        .ensure_workspace_runtime(AgentRuntimeKind::opencode(), repo_path.as_str())
                });

                let first = first_handle
                    .join()
                    .expect("first ensure thread should join")?;
                let second = second_handle
                    .join()
                    .expect("second ensure thread should join")?;
                Ok((first, second))
            },
        )?;

        assert_eq!(first.runtime_id, second.runtime_id);
        assert!(service
            .find_existing_workspace_runtime(&AgentRuntimeKind::opencode(), repo_path.as_str())?
            .is_some());

        let started_pids_file = fs::read_to_string(starts_file.as_path())?;
        let started_pids = started_pids_file
            .lines()
            .filter(|line| !line.trim().is_empty())
            .collect::<Vec<_>>();
        assert_eq!(started_pids.len(), 1);

        assert!(service.runtime_stop(first.runtime_id.as_str())?);

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn ensure_workspace_runtime_records_child_exit_failure_status_at_module_seam() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("workspace-runtime-startup-failure-status");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let failing_opencode = root.join("opencode");
        let fake_bridge = root.join("browser-backend");
        create_failing_opencode(&failing_opencode)?;
        create_fake_opencode(&fake_bridge)?;
        let _dolt_guard = install_fake_dolt(&root)?;
        let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_bridge.as_path());
        let _mcp_command_guard = set_test_mcp_command();
        let _opencode_guard = set_env_var(
            "OPENDUCKTOR_OPENCODE_BINARY",
            failing_opencode.to_string_lossy().as_ref(),
        );

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
                revision: None,
            },
            config_store,
        );

        let repo_path = fs::canonicalize(&repo)?.to_string_lossy().to_string();
        service.workspace_add(repo_path.as_str())?;
        let error = service
            .ensure_workspace_runtime(AgentRuntimeKind::opencode(), repo_path.as_str())
            .expect_err("workspace runtime should fail when the startup process exits early");
        assert!(error
            .to_string()
            .contains("workspace runtime failed to start"));

        let status = service.runtime_startup_status("opencode", repo_path.as_str())?;
        assert_eq!(status.stage, RepoRuntimeStartupStage::StartupFailed);
        assert_eq!(
            status.failure_kind,
            Some(RepoRuntimeStartupFailureKind::Error)
        );
        assert_eq!(status.failure_reason.as_deref(), Some("child_exited"));
        assert!(status.attempts.is_some());
        assert!(status.elapsed_ms.is_some());
        assert!(service
            .find_existing_workspace_runtime(&AgentRuntimeKind::opencode(), repo_path.as_str())?
            .is_none());

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn ensure_workspace_runtime_completes_waiters_with_recording_failure_error_instead_of_abort(
    ) -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("workspace-runtime-status-recording-poison");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let failing_opencode = root.join("opencode");
        let fake_bridge = root.join("browser-backend");
        let starts_file = root.join("spawned-runtime.starts");
        create_delayed_failing_opencode(&failing_opencode)?;
        create_fake_opencode(&fake_bridge)?;
        let _dolt_guard = install_fake_dolt(&root)?;
        let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_bridge.as_path());
        let _mcp_command_guard = set_test_mcp_command();
        let _opencode_guard = set_env_var(
            "OPENDUCKTOR_OPENCODE_BINARY",
            failing_opencode.to_string_lossy().as_ref(),
        );
        let _starts_guard = set_env_var(
            "OPENDUCKTOR_TEST_STARTS_FILE",
            starts_file.to_string_lossy().as_ref(),
        );

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
                revision: None,
            },
            config_store,
        );

        let repo_path = fs::canonicalize(&repo)?.to_string_lossy().to_string();
        service.workspace_add(repo_path.as_str())?;
        let (leader_error, follower_error) =
            thread::scope(|scope| -> Result<(anyhow::Error, anyhow::Error)> {
                let leader_handle = scope.spawn(|| {
                    service
                        .ensure_workspace_runtime(AgentRuntimeKind::opencode(), repo_path.as_str())
                        .expect_err("leader startup should fail")
                });

                assert!(wait_for_path_exists(
                    starts_file.as_path(),
                    Duration::from_secs(2)
                ));

                let follower_handle = scope.spawn(|| {
                    service
                        .ensure_workspace_runtime(AgentRuntimeKind::opencode(), repo_path.as_str())
                        .expect_err("follower should receive the startup failure")
                });

                let poison_handle = scope.spawn(|| {
                    let _ = panic::catch_unwind(AssertUnwindSafe(|| {
                        let _lock = service.runtime_startup_status.lock().expect(
                            "runtime startup status lock should be available for poisoning",
                        );
                        panic!("poison runtime startup status lock");
                    }));
                });
                poison_handle
                    .join()
                    .expect("startup status poison thread should join");

                let leader_error = leader_handle
                    .join()
                    .expect("leader ensure thread should join");
                let follower_error = follower_handle
                    .join()
                    .expect("follower ensure thread should join");
                Ok((leader_error, follower_error))
            })?;

        let leader_message = format!("{leader_error:#}");
        let follower_message = format!("{follower_error:#}");
        assert!(leader_message.contains("workspace runtime failed to start"));
        assert!(leader_message.contains("Runtime startup status lock poisoned"));
        assert!(follower_message.contains("workspace runtime failed to start"));
        assert!(follower_message.contains("Runtime startup status lock poisoned"));
        assert!(!follower_message.contains("Runtime ensure aborted unexpectedly"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }
}
