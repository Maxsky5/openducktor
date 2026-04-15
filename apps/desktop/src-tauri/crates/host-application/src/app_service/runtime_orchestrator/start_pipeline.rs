use super::super::{
    AppService, RuntimeCleanupTarget, RuntimeProcessGuard, RuntimeStartupReadinessPolicy,
    RuntimeStartupWaitReport,
};
use super::startup_status::RuntimeStartupProgress;
use anyhow::Result;
use host_domain::{AgentRuntimeKind, RuntimeInstanceSummary, RuntimeRole, RuntimeRoute};
use std::process::Child;
use std::time::Instant;

#[derive(Clone, Copy)]
pub(crate) struct RuntimeExistingLookup<'a> {
    pub(crate) repo_key: &'a str,
    pub(crate) role: RuntimeRole,
    pub(crate) task_id: Option<&'a str>,
}

pub(crate) struct RuntimePostStartPolicy<'a> {
    pub(crate) existing_lookup: RuntimeExistingLookup<'a>,
    pub(crate) prune_error_context: String,
}

pub(crate) struct RuntimeStartInput<'a> {
    pub(crate) runtime_kind: AgentRuntimeKind,
    pub(crate) startup_scope: &'a str,
    pub(crate) repo_path: &'a str,
    pub(crate) repo_key: String,
    pub(crate) startup_started_at_instant: Instant,
    pub(crate) startup_started_at: String,
    pub(crate) task_id: &'a str,
    pub(crate) role: RuntimeRole,
    pub(crate) startup_policy: RuntimeStartupReadinessPolicy,
    pub(crate) working_directory: String,
    pub(crate) cleanup_target: Option<RuntimeCleanupTarget>,
    pub(crate) tracking_error_context: &'static str,
    pub(crate) startup_error_context: String,
    pub(crate) post_start_policy: Option<RuntimePostStartPolicy<'a>>,
}

pub(super) struct SpawnedRuntimeServer {
    pub(super) runtime_id: String,
    pub(super) runtime_route: RuntimeRoute,
    pub(super) child: Option<Child>,
    pub(super) _runtime_process_guard: Option<RuntimeProcessGuard>,
    pub(super) startup_started_at_instant: Instant,
    pub(super) startup_started_at: String,
    pub(super) startup_report: RuntimeStartupWaitReport,
}

impl AppService {
    pub(in crate::app_service::runtime_orchestrator) fn spawn_and_register_runtime(
        &self,
        input: RuntimeStartInput<'_>,
    ) -> Result<RuntimeInstanceSummary> {
        let spawned_server = self.spawn_runtime_server(&input)?;
        let startup_started_at_instant = spawned_server.startup_started_at_instant;
        let startup_started_at = spawned_server.startup_started_at.clone();
        let startup_report = spawned_server.startup_report;
        let runtime_kind = input.runtime_kind.clone();
        let repo_key = input.repo_key.clone();
        let summary = self.attach_runtime_session(input, spawned_server)?;
        self.mark_runtime_startup_ready(
            &runtime_kind,
            repo_key.as_str(),
            &summary,
            &RuntimeStartupProgress {
                started_at_instant: startup_started_at_instant,
                started_at: startup_started_at,
                attempts: Some(startup_report.attempts()),
                elapsed_ms: Some(startup_report.startup_ms()),
            },
        )?;
        Ok(summary)
    }
}

#[cfg(test)]
mod tests {
    use super::{AppService, RuntimeExistingLookup, RuntimePostStartPolicy, RuntimeStartInput};
    use crate::app_service::test_support::{
        build_service_with_store, create_fake_opencode, init_git_repo, install_fake_dolt, lock_env,
        set_env_var, set_fake_opencode_and_bridge_binaries, unique_temp_path, wait_for_path_exists,
        wait_for_process_exit,
    };
    use anyhow::Result;
    use host_domain::{now_rfc3339, AgentRuntimeKind, GitCurrentBranch};
    use host_infra_system::AppConfigStore;
    use std::fs;
    use std::thread;
    use std::time::{Duration, Instant};

    #[test]
    fn spawn_and_register_runtime_cleans_up_spawned_child_when_runtime_lock_is_poisoned(
    ) -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("start-pipeline-lock-poison");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let fake_opencode = root.join("opencode");
        create_fake_opencode(&fake_opencode)?;
        let _dolt_guard = install_fake_dolt(&root)?;
        let starts_file = root.join("spawned-runtime.starts");
        let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());
        let _delay_guard = set_env_var("OPENDUCKTOR_TEST_STARTUP_DELAY_MS", "800");
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
        let pipeline_error = thread::scope(|scope| -> Result<anyhow::Error> {
            let pipeline_handle = scope.spawn(|| {
                let startup_error_context = format!(
                    "{} workspace runtime failed to start for {repo_path}",
                    AgentRuntimeKind::opencode().as_str()
                );
                let startup_policy = service.resolve_runtime_startup_policy(
                    &AgentRuntimeKind::opencode(),
                    "workspace_runtime",
                    repo_path.as_str(),
                    AppService::WORKSPACE_RUNTIME_TASK_ID,
                    AppService::WORKSPACE_RUNTIME_ROLE,
                    startup_error_context.as_str(),
                )?;

                service.spawn_and_register_runtime(RuntimeStartInput {
                    runtime_kind: AgentRuntimeKind::opencode(),
                    startup_scope: "workspace_runtime",
                    repo_path: repo_path.as_str(),
                    repo_key: repo_path.clone(),
                    startup_started_at_instant: Instant::now(),
                    startup_started_at: now_rfc3339(),
                    task_id: AppService::WORKSPACE_RUNTIME_TASK_ID,
                    role: AppService::WORKSPACE_RUNTIME_ROLE,
                    startup_policy,
                    working_directory: repo_path.clone(),
                    cleanup_target: None,
                    tracking_error_context: "Failed tracking spawned OpenCode workspace runtime",
                    startup_error_context,
                    post_start_policy: Some(RuntimePostStartPolicy {
                        existing_lookup: RuntimeExistingLookup {
                            repo_key: repo_path.as_str(),
                            role: AppService::WORKSPACE_RUNTIME_ROLE,
                            task_id: None,
                        },
                        prune_error_context: format!(
                            "Failed pruning stale runtimes while finalizing workspace runtime for {repo_path}"
                        ),
                    }),
                })
            });

            assert!(wait_for_path_exists(
                starts_file.as_path(),
                Duration::from_secs(2)
            ));
            let spawned_pid = fs::read_to_string(starts_file.as_path())?
                .trim()
                .parse::<i32>()
                .expect("spawned runtime pid should parse as i32");

            let poison_handle = scope.spawn(|| {
                let _lock = service
                    .agent_runtimes
                    .lock()
                    .expect("runtime lock should be available for poisoning");
                panic!("poison runtime lock");
            });
            assert!(poison_handle.join().is_err());

            let pipeline_error = pipeline_handle
                .join()
                .expect("start pipeline thread should join")
                .expect_err("start pipeline should fail when runtime lock is poisoned");
            assert!(wait_for_process_exit(spawned_pid, Duration::from_secs(2)));
            Ok(pipeline_error)
        })?;

        assert!(pipeline_error
            .to_string()
            .contains("Agent runtime state lock poisoned"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }
}
