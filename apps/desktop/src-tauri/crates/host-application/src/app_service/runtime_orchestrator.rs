mod registry;
mod startup;

use super::AppService;
use anyhow::{anyhow, Result};
use host_domain::{
    AgentRuntimeKind, RunState, RunSummary, RuntimeDescriptor, RuntimeInstanceSummary, RuntimeRole,
};
use std::collections::{HashMap, HashSet};
use std::process::Child;
use std::sync::Arc;

#[derive(Clone, Copy)]
pub(super) struct RuntimeExistingLookup<'a> {
    repo_key: &'a str,
    role: RuntimeRole,
    task_id: Option<&'a str>,
}

pub(super) struct RuntimePostStartPolicy<'a> {
    existing_lookup: RuntimeExistingLookup<'a>,
    prune_error_context: String,
}

pub(super) struct RuntimeStartInput<'a> {
    runtime_kind: AgentRuntimeKind,
    startup_scope: &'a str,
    repo_path: &'a str,
    repo_key: String,
    task_id: &'a str,
    role: RuntimeRole,
    startup_policy: super::OpencodeStartupReadinessPolicy,
    working_directory: String,
    cleanup_target: Option<super::RuntimeCleanupTarget>,
    tracking_error_context: &'static str,
    startup_error_context: String,
    post_start_policy: Option<RuntimePostStartPolicy<'a>>,
}

pub(super) struct SpawnedRuntimeServer {
    runtime_id: String,
    port: u16,
    child: Child,
    opencode_process_guard: super::TrackedOpencodeProcessGuard,
}

struct RuntimeEnsureFlightGuard<'a> {
    service: &'a AppService,
    runtime_kind: AgentRuntimeKind,
    repo_key: String,
    flight: Arc<super::service_core::RuntimeEnsureFlight>,
    completed: bool,
}

impl<'a> RuntimeEnsureFlightGuard<'a> {
    fn new(
        service: &'a AppService,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        flight: Arc<super::service_core::RuntimeEnsureFlight>,
    ) -> Self {
        Self {
            service,
            runtime_kind,
            repo_key: repo_key.to_string(),
            flight,
            completed: false,
        }
    }

    fn complete(&mut self, result: &Result<RuntimeInstanceSummary>) -> Result<()> {
        self.completed = true;
        self.service.complete_runtime_ensure_flight(
            self.runtime_kind,
            self.repo_key.as_str(),
            &self.flight,
            result,
        )
    }
}

impl Drop for RuntimeEnsureFlightGuard<'_> {
    fn drop(&mut self) {
        if self.completed {
            return;
        }

        let aborted = Err(anyhow!("Runtime ensure aborted unexpectedly"));
        if let Err(error) = self.service.complete_runtime_ensure_flight(
            self.runtime_kind,
            self.repo_key.as_str(),
            &self.flight,
            &aborted,
        ) {
            eprintln!(
                "OpenDucktor warning: failed completing runtime ensure flight after abort: {error:#}"
            );
        }
    }
}

impl AppService {
    fn runtime_ensure_flight_key(runtime_kind: AgentRuntimeKind, repo_key: &str) -> String {
        format!("{}::{repo_key}", runtime_kind.as_str())
    }

    fn acquire_runtime_ensure_flight(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
    ) -> Result<(Arc<super::service_core::RuntimeEnsureFlight>, bool)> {
        let key = Self::runtime_ensure_flight_key(runtime_kind, repo_key);
        let mut flights = self
            .runtime_ensure_flights
            .lock()
            .map_err(|_| anyhow!("Runtime ensure coordination state lock poisoned"))?;
        if let Some(existing) = flights.get(key.as_str()) {
            return Ok((existing.clone(), false));
        }

        let flight = Arc::new(super::service_core::RuntimeEnsureFlight::new());
        flights.insert(key, flight.clone());
        Ok((flight, true))
    }

    fn complete_runtime_ensure_flight(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        flight: &Arc<super::service_core::RuntimeEnsureFlight>,
        result: &Result<RuntimeInstanceSummary>,
    ) -> Result<()> {
        let stored_result = match result {
            Ok(summary) => Ok(summary.clone()),
            Err(error) => Err(format!("{error:#}")),
        };
        let mut poisoned = false;

        {
            let mut state = match flight.state.lock() {
                Ok(state) => state,
                Err(poisoned_state) => {
                    poisoned = true;
                    poisoned_state.into_inner()
                }
            };
            *state =
                super::service_core::RuntimeEnsureFlightState::Finished(Box::new(stored_result));
            flight.condvar.notify_all();
        }

        {
            let mut flights = match self.runtime_ensure_flights.lock() {
                Ok(flights) => flights,
                Err(poisoned_flights) => {
                    poisoned = true;
                    poisoned_flights.into_inner()
                }
            };
            let key = Self::runtime_ensure_flight_key(runtime_kind, repo_key);
            flights.remove(key.as_str());
        }

        if poisoned {
            return Err(anyhow!("Runtime ensure coordination state lock poisoned"));
        }

        Ok(())
    }

    fn wait_for_runtime_ensure_flight(
        flight: &Arc<super::service_core::RuntimeEnsureFlight>,
    ) -> Result<RuntimeInstanceSummary> {
        let mut state = flight
            .state
            .lock()
            .map_err(|_| anyhow!("Runtime ensure coordination state lock poisoned"))?;
        loop {
            match &*state {
                super::service_core::RuntimeEnsureFlightState::Starting => {
                    state = flight
                        .condvar
                        .wait(state)
                        .map_err(|_| anyhow!("Runtime ensure coordination state lock poisoned"))?;
                }
                super::service_core::RuntimeEnsureFlightState::Finished(result) => {
                    return result.as_ref().clone().map_err(|message| anyhow!(message));
                }
            }
        }
    }

    fn find_existing_workspace_runtime(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
    ) -> Result<Option<RuntimeInstanceSummary>> {
        let mut runtimes = self
            .agent_runtimes
            .lock()
            .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
        Self::prune_stale_runtimes(&mut runtimes)?;
        Ok(Self::find_existing_runtime(
            &runtimes,
            RuntimeExistingLookup {
                repo_key,
                role: Self::WORKSPACE_RUNTIME_ROLE,
                task_id: None,
            },
        )
        .filter(|runtime| runtime.kind == runtime_kind))
    }

    pub(super) fn ensure_runtime_supports_all_workflow_scopes(
        runtime_kind: AgentRuntimeKind,
    ) -> Result<()> {
        let descriptor = runtime_kind.descriptor();
        let validation_errors = descriptor.validate_for_openducktor();
        if validation_errors.is_empty() {
            return Ok(());
        }

        Err(anyhow!(
            "Runtime '{}' is incompatible with OpenDucktor: {}.",
            runtime_kind.as_str(),
            validation_errors.join("; "),
        ))
    }

    pub fn runtime_definitions_list(&self) -> Result<Vec<RuntimeDescriptor>> {
        let definitions = vec![AgentRuntimeKind::Opencode.descriptor()];
        for definition in &definitions {
            let validation_errors = definition.validate_for_openducktor();
            if !validation_errors.is_empty() {
                return Err(anyhow!(
                    "Runtime '{}' is incompatible with OpenDucktor: {}.",
                    definition.kind.as_str(),
                    validation_errors.join("; "),
                ));
            }
        }

        Ok(definitions)
    }

    pub fn runtime_list(
        &self,
        runtime_kind: &str,
        repo_path: Option<&str>,
    ) -> Result<Vec<RuntimeInstanceSummary>> {
        let supported_kind = Self::resolve_supported_runtime_kind(runtime_kind)?;
        Ok(self
            .list_registered_runtimes(repo_path)?
            .into_iter()
            .filter(|runtime| runtime.kind == supported_kind)
            .collect())
    }

    pub fn runtime_ensure(
        &self,
        runtime_kind: &str,
        repo_path: &str,
    ) -> Result<RuntimeInstanceSummary> {
        let runtime_kind = Self::resolve_supported_runtime_kind(runtime_kind)?;
        Self::ensure_runtime_supports_all_workflow_scopes(runtime_kind)?;
        self.ensure_workspace_runtime(runtime_kind, repo_path)
    }

    pub fn runtime_stop(&self, runtime_id: &str) -> Result<bool> {
        self.stop_registered_runtime(runtime_id)
    }

    pub fn runs_list(&self, repo_path: Option<&str>) -> Result<Vec<RunSummary>> {
        let repo_key_filter = repo_path
            .map(|path| self.resolve_authorized_repo_path(path))
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
        let mut runtime_statuses_by_worktree = HashMap::new();
        let mut sessions_by_repo_task = HashMap::new();

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
            .filter_map(|run| {
                match self.should_expose_run(
                    run,
                    &mut runtime_statuses_by_worktree,
                    &mut sessions_by_repo_task,
                ) {
                    Ok(true) => Some(Ok(run.summary.clone())),
                    Ok(false) => None,
                    Err(error) => Some(Err(error)),
                }
            })
            .collect::<Result<Vec<_>>>()?;

        list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        Ok(list)
    }

    fn ensure_workspace_runtime(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_path: &str,
    ) -> Result<RuntimeInstanceSummary> {
        let repo_key = self.resolve_authorized_repo_path(repo_path)?;
        let repo_path = repo_key.as_str();

        if let Some(existing) =
            self.find_existing_workspace_runtime(runtime_kind, repo_key.as_str())?
        {
            return Ok(existing);
        }

        let (flight, is_leader) =
            self.acquire_runtime_ensure_flight(runtime_kind, repo_key.as_str())?;
        if !is_leader {
            return Self::wait_for_runtime_ensure_flight(&flight);
        }
        let mut flight_guard =
            RuntimeEnsureFlightGuard::new(self, runtime_kind, repo_key.as_str(), flight);

        let startup_result = (|| -> Result<RuntimeInstanceSummary> {
            if let Some(existing) =
                self.find_existing_workspace_runtime(runtime_kind, repo_key.as_str())?
            {
                return Ok(existing);
            }

            let startup_error_context = format!(
                "{} workspace runtime failed to start for {repo_path}",
                runtime_kind.as_str()
            );
            let startup_policy = self.resolve_runtime_startup_policy(
                "workspace_runtime",
                repo_path,
                Self::WORKSPACE_RUNTIME_TASK_ID,
                Self::WORKSPACE_RUNTIME_ROLE,
                startup_error_context.as_str(),
            )?;

            self.spawn_and_register_runtime(RuntimeStartInput {
                runtime_kind,
                startup_scope: "workspace_runtime",
                repo_path,
                repo_key: repo_key.clone(),
                task_id: Self::WORKSPACE_RUNTIME_TASK_ID,
                role: Self::WORKSPACE_RUNTIME_ROLE,
                startup_policy,
                working_directory: repo_key.clone(),
                cleanup_target: None,
                tracking_error_context: "Failed tracking spawned OpenCode workspace runtime",
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
        flight_guard.complete(&startup_result)?;
        startup_result
    }

    fn spawn_and_register_runtime(
        &self,
        input: RuntimeStartInput<'_>,
    ) -> Result<RuntimeInstanceSummary> {
        let spawned_server = self.spawn_runtime_server(&input)?;
        self.attach_runtime_session(input, spawned_server)
    }

    pub(super) fn resolve_supported_runtime_kind(runtime_kind: &str) -> Result<AgentRuntimeKind> {
        match runtime_kind.trim() {
            "opencode" => Ok(AgentRuntimeKind::Opencode),
            other => Err(anyhow!("Unsupported agent runtime kind: {other}")),
        }
    }

    fn should_expose_run(
        &self,
        run: &super::RunProcess,
        runtime_statuses_by_worktree: &mut HashMap<String, super::OpencodeSessionStatusMap>,
        sessions_by_repo_task: &mut HashMap<String, Vec<host_domain::AgentSessionDocument>>,
    ) -> Result<bool> {
        if !matches!(
            run.summary.state,
            RunState::Starting
                | RunState::Running
                | RunState::Blocked
                | RunState::AwaitingDoneConfirmation
        ) {
            return Ok(true);
        }

        let session_cache_key = format!("{}::{}", run.repo_path, run.task_id);
        if !sessions_by_repo_task.contains_key(session_cache_key.as_str()) {
            let sessions = self.agent_sessions_list(run.repo_path.as_str(), run.task_id.as_str())?;
            sessions_by_repo_task.insert(session_cache_key.clone(), sessions);
        }
        let sessions = sessions_by_repo_task
            .get(session_cache_key.as_str())
            .ok_or_else(|| anyhow!("Missing cached agent sessions for {}", session_cache_key))?;
        let external_session_ids = sessions
            .iter()
            .filter(|session| session.role.trim() == "build")
            .filter(|session| session.runtime_kind.trim() == run.summary.runtime_kind.as_str())
            .filter(|session| {
                super::task_workflow::normalize_path_for_comparison(session.working_directory.as_str())
                    == super::task_workflow::normalize_path_for_comparison(
                        run.worktree_path.as_str(),
                    )
            })
            .filter_map(|session| {
                session
                    .external_session_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            })
            .collect::<Vec<_>>();

        if external_session_ids.is_empty() {
            return Ok(true);
        }

        let worktree_key = super::task_workflow::normalize_path_key(run.worktree_path.as_str());
        if !runtime_statuses_by_worktree.contains_key(worktree_key.as_str()) {
            let statuses = match run.summary.runtime_kind {
                AgentRuntimeKind::Opencode => {
                    super::load_opencode_session_statuses(
                        &run.summary.runtime_route,
                        run.worktree_path.as_str(),
                    )?
                }
            };
            runtime_statuses_by_worktree.insert(worktree_key.clone(), statuses);
        }
        let statuses = runtime_statuses_by_worktree
            .get(worktree_key.as_str())
            .ok_or_else(|| anyhow!("Missing cached OpenCode session statuses for {}", worktree_key))?;
        Ok(external_session_ids
            .iter()
            .any(|external_session_id| super::has_live_opencode_session_status(statuses, external_session_id)))
    }
}

#[cfg(test)]
mod tests {
    use super::{AppService, RuntimeEnsureFlightGuard};
    use crate::app_service::test_support::{build_service_with_state, make_task};
    use crate::app_service::RunProcess;
    use anyhow::{anyhow, Result};
    use host_domain::{AgentRuntimeKind, AgentSessionDocument, RunSummary, TaskStatus};
    use host_infra_system::RepoConfig;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn spawn_opencode_session_status_server(
        response_body: &'static str,
    ) -> Result<(u16, std::thread::JoinHandle<()>)> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            response_body.len(),
            response_body
        );
        let handle = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut request_buffer = [0_u8; 4096];
                let _ = stream.read(&mut request_buffer);
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });
        Ok((port, handle))
    }

    #[test]
    fn runtime_ensure_flight_guard_finishes_waiters_when_dropped_uncompleted() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let repo_key = "/tmp/runtime-flight-guard";
        let (flight, is_leader) =
            service.acquire_runtime_ensure_flight(AgentRuntimeKind::Opencode, repo_key)?;
        assert!(is_leader);

        {
            let _guard = RuntimeEnsureFlightGuard::new(
                &service,
                AgentRuntimeKind::Opencode,
                repo_key,
                flight.clone(),
            );
        }

        let error = AppService::wait_for_runtime_ensure_flight(&flight)
            .expect_err("dropped leader should finish waiters with an error");
        assert!(error
            .to_string()
            .contains("Runtime ensure aborted unexpectedly"));

        Ok(())
    }

    #[test]
    fn complete_runtime_ensure_flight_recovers_poisoned_state_and_removes_entry() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let repo_key = "/tmp/runtime-flight-poison";
        let (flight, is_leader) =
            service.acquire_runtime_ensure_flight(AgentRuntimeKind::Opencode, repo_key)?;
        assert!(is_leader);

        let poison_handle = thread::spawn({
            let flight = flight.clone();
            move || {
                let _lock = flight
                    .state
                    .lock()
                    .expect("flight state should be available for poisoning");
                panic!("poison runtime ensure flight state");
            }
        });
        assert!(poison_handle.join().is_err());

        let error = service
            .complete_runtime_ensure_flight(
                AgentRuntimeKind::Opencode,
                repo_key,
                &flight,
                &Err(anyhow!("simulated startup failure")),
            )
            .expect_err("poisoned completion should surface an error");
        assert!(error
            .to_string()
            .contains("Runtime ensure coordination state lock poisoned"));

        let flights = service
            .runtime_ensure_flights
            .lock()
            .expect("runtime ensure flights lock should remain available");
        assert!(flights.is_empty());

        Ok(())
    }

    #[test]
    fn module_runs_list_is_empty_on_fresh_service() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);

        let runs = service
            .runs_list(None)
            .expect("runs list should be available");

        assert!(runs.is_empty());
    }

    #[test]
    fn module_runs_list_filters_stale_build_runs_without_live_runtime_session() -> Result<()> {
        let (service, task_state, _git_state) =
            build_service_with_state(vec![make_task("task-1", "task", TaskStatus::InProgress)]);
        let (port, server_handle) =
            spawn_opencode_session_status_server(r#"{"external-build-session":{"type":"idle"}}"#)?;

        task_state
            .lock()
            .expect("task store lock poisoned")
            .agent_sessions = vec![AgentSessionDocument {
            session_id: "build-session".to_string(),
            external_session_id: Some("external-build-session".to_string()),
            task_id: Some("task-1".to_string()),
            role: "build".to_string(),
            scenario: Some("build_implementation_start".to_string()),
            status: Some("running".to_string()),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            updated_at: None,
            ended_at: None,
            runtime_kind: "opencode".to_string(),
            working_directory: "/tmp/repo/worktree".to_string(),
            pending_permissions: Vec::new(),
            pending_questions: Vec::new(),
            selected_model: None,
        }];

        service.runs.lock().expect("run state lock poisoned").insert(
            "run-1".to_string(),
            RunProcess {
                summary: RunSummary {
                    run_id: "run-1".to_string(),
                    runtime_kind: AgentRuntimeKind::Opencode,
                    runtime_route: host_domain::RuntimeRoute::LocalHttp {
                        endpoint: format!("http://127.0.0.1:{port}"),
                    },
                    repo_path: "/tmp/repo".to_string(),
                    task_id: "task-1".to_string(),
                    branch: "odt/task-1".to_string(),
                    worktree_path: "/tmp/repo/worktree".to_string(),
                    port,
                    state: host_domain::RunState::Running,
                    last_message: None,
                    started_at: "2026-03-17T11:00:00Z".to_string(),
                },
                child: None,
                _opencode_process_guard: None,
                repo_path: "/tmp/repo".to_string(),
                task_id: "task-1".to_string(),
                worktree_path: "/tmp/repo/worktree".to_string(),
                repo_config: RepoConfig::default(),
            },
        );

        let runs = service.runs_list(Some("/tmp/repo"))?;
        server_handle.join().expect("status server thread should finish");

        assert!(runs.is_empty());
        Ok(())
    }

    #[test]
    fn module_runtime_stop_reports_missing_runtime() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);

        let error = service
            .runtime_stop("missing-runtime")
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
