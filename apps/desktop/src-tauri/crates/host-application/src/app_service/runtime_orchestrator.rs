mod registry;
mod repo_health;
mod repo_health_snapshot;
mod startup;

use super::AppService;
use anyhow::{anyhow, Result};
use host_domain::{
    now_rfc3339, AgentRuntimeKind, RepoRuntimeStartupFailureKind, RepoRuntimeStartupStage,
    RepoRuntimeStartupStatus, RunState, RunSummary, RuntimeDescriptor, RuntimeInstanceSummary,
    RuntimeRole,
};
use std::collections::{HashMap, HashSet};
use std::process::Child;
use std::sync::Arc;
use std::time::Instant;

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
    startup_started_at_instant: Instant,
    startup_started_at: String,
    task_id: &'a str,
    role: RuntimeRole,
    startup_policy: super::OpencodeStartupReadinessPolicy,
    working_directory: String,
    cleanup_target: Option<super::RuntimeCleanupTarget>,
    tracking_error_context: &'static str,
    startup_error_context: String,
    post_start_policy: Option<RuntimePostStartPolicy<'a>>,
}

#[derive(Clone)]
struct RuntimeStartupProgress {
    started_at_instant: Instant,
    started_at: String,
    attempts: Option<u32>,
    elapsed_ms: Option<u64>,
}

struct RuntimeStartupFailure {
    failure_kind: RepoRuntimeStartupFailureKind,
    failure_reason: String,
    detail: String,
}

pub(super) struct SpawnedRuntimeServer {
    runtime_id: String,
    port: u16,
    child: Child,
    opencode_process_guard: super::TrackedOpencodeProcessGuard,
    startup_started_at_instant: Instant,
    startup_started_at: String,
    startup_report: super::OpencodeStartupWaitReport,
}

#[derive(Clone)]
struct RunExposureCandidate {
    summary: RunSummary,
    repo_path: String,
    task_id: String,
    worktree_path: String,
}

impl RunExposureCandidate {
    fn from_run(run: &super::RunProcess) -> Self {
        Self {
            summary: run.summary.clone(),
            repo_path: run.repo_path.clone(),
            task_id: run.task_id.clone(),
            worktree_path: run.worktree_path.clone(),
        }
    }

    fn requires_live_session_check(&self) -> bool {
        matches!(
            self.summary.state,
            RunState::Starting
                | RunState::Running
                | RunState::Blocked
                | RunState::AwaitingDoneConfirmation
        )
    }
}

struct RunExposurePlan {
    summary: RunSummary,
    external_session_ids: Vec<String>,
    probe_target: Option<super::OpencodeSessionStatusProbeTarget>,
}

impl RunExposurePlan {
    fn without_probe(summary: RunSummary) -> Self {
        Self {
            summary,
            external_session_ids: Vec::new(),
            probe_target: None,
        }
    }

    fn with_probe(
        summary: RunSummary,
        external_session_ids: Vec<String>,
        probe_target: super::OpencodeSessionStatusProbeTarget,
    ) -> Self {
        Self {
            summary,
            external_session_ids,
            probe_target: Some(probe_target),
        }
    }

    fn is_visible(
        &self,
        statuses_by_target: &HashMap<
            super::OpencodeSessionStatusProbeTarget,
            super::OpencodeSessionStatusMap,
        >,
    ) -> Result<bool> {
        let Some(probe_target) = self.probe_target.as_ref() else {
            return Ok(true);
        };

        let statuses = statuses_by_target.get(probe_target).ok_or_else(|| {
            anyhow!(
                "Missing cached OpenCode session statuses for run {}",
                self.summary.run_id
            )
        })?;
        Ok(self.external_session_ids.iter().any(|external_session_id| {
            super::has_live_opencode_session_status(statuses, external_session_id)
        }))
    }
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

    fn update_runtime_startup_status(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        update: impl FnOnce(&mut super::service_core::RuntimeStartupStatusEntry),
    ) -> Result<()> {
        let key = Self::runtime_ensure_flight_key(runtime_kind, repo_key);
        let mut statuses = self
            .runtime_startup_status
            .lock()
            .map_err(|_| anyhow!("Runtime startup status lock poisoned"))?;
        let entry = statuses.entry(key).or_insert_with(|| {
            super::service_core::RuntimeStartupStatusEntry::new(
                runtime_kind,
                repo_key.to_string(),
                RepoRuntimeStartupStage::Idle,
            )
        });
        update(entry);
        entry.updated_at = now_rfc3339();
        Ok(())
    }

    fn mark_runtime_startup_requested(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        progress: &RuntimeStartupProgress,
    ) -> Result<()> {
        self.update_runtime_startup_status(runtime_kind, repo_key, |entry| {
            entry.stage = RepoRuntimeStartupStage::StartupRequested;
            entry.runtime = None;
            entry.started_at = Some(progress.started_at.clone());
            entry.started_at_instant = Some(progress.started_at_instant);
            entry.elapsed_ms = None;
            entry.attempts = Some(0);
            entry.failure_kind = None;
            entry.failure_reason = None;
            entry.detail = None;
        })
    }

    fn mark_runtime_startup_waiting(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        progress: &RuntimeStartupProgress,
    ) -> Result<()> {
        self.update_runtime_startup_status(runtime_kind, repo_key, |entry| {
            entry.stage = RepoRuntimeStartupStage::WaitingForRuntime;
            entry.started_at = Some(progress.started_at.clone());
            entry.started_at_instant = Some(progress.started_at_instant);
            entry.elapsed_ms = None;
            entry.attempts = progress.attempts;
        })
    }

    fn mark_runtime_startup_ready(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        runtime: &RuntimeInstanceSummary,
        progress: &RuntimeStartupProgress,
    ) -> Result<()> {
        self.update_runtime_startup_status(runtime_kind, repo_key, |entry| {
            entry.stage = RepoRuntimeStartupStage::RuntimeReady;
            entry.runtime = Some(runtime.clone());
            entry.started_at = Some(progress.started_at.clone());
            entry.started_at_instant = Some(progress.started_at_instant);
            entry.elapsed_ms = progress.elapsed_ms;
            entry.attempts = progress.attempts;
            entry.failure_kind = None;
            entry.failure_reason = None;
            entry.detail = None;
        })
    }

    fn mark_runtime_startup_failed(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        progress: &RuntimeStartupProgress,
        failure: RuntimeStartupFailure,
    ) -> Result<()> {
        self.update_runtime_startup_status(runtime_kind, repo_key, |entry| {
            entry.stage = RepoRuntimeStartupStage::StartupFailed;
            entry.runtime = None;
            entry.started_at = Some(progress.started_at.clone());
            entry.started_at_instant = Some(progress.started_at_instant);
            entry.elapsed_ms = progress.elapsed_ms;
            entry.attempts = progress.attempts;
            entry.failure_kind = Some(failure.failure_kind);
            entry.failure_reason = Some(failure.failure_reason.clone());
            entry.detail = Some(failure.detail.clone());
        })
    }

    fn clear_runtime_startup_status(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
    ) -> Result<()> {
        let key = Self::runtime_ensure_flight_key(runtime_kind, repo_key);
        let mut statuses = self
            .runtime_startup_status
            .lock()
            .map_err(|_| anyhow!("Runtime startup status lock poisoned"))?;
        statuses.remove(key.as_str());
        Ok(())
    }

    fn clear_runtime_startup_status_for_runtime(
        &self,
        runtime: &RuntimeInstanceSummary,
    ) -> Result<()> {
        self.clear_runtime_startup_status(runtime.kind, runtime.repo_path.as_str())
    }

    pub fn runtime_startup_status(
        &self,
        runtime_kind: &str,
        repo_path: &str,
    ) -> Result<RepoRuntimeStartupStatus> {
        let runtime_kind = Self::resolve_supported_runtime_kind(runtime_kind)?;
        let repo_key = self.resolve_authorized_repo_path(repo_path)?;
        let status_key = Self::runtime_ensure_flight_key(runtime_kind, repo_key.as_str());

        if let Some(snapshot) = self
            .runtime_startup_status
            .lock()
            .map_err(|_| anyhow!("Runtime startup status lock poisoned"))?
            .get(status_key.as_str())
            .cloned()
        {
            if snapshot.stage != RepoRuntimeStartupStage::RuntimeReady
                || self
                    .find_existing_workspace_runtime(runtime_kind, repo_key.as_str())?
                    .is_some()
            {
                return Ok(snapshot.to_public_status());
            }
        }

        if let Some(runtime) =
            self.find_existing_workspace_runtime(runtime_kind, repo_key.as_str())?
        {
            return Ok(RepoRuntimeStartupStatus {
                runtime_kind,
                repo_path: repo_key,
                stage: RepoRuntimeStartupStage::RuntimeReady,
                runtime: Some(runtime.clone()),
                started_at: Some(runtime.started_at.clone()),
                updated_at: runtime.started_at,
                elapsed_ms: None,
                attempts: None,
                failure_kind: None,
                failure_reason: None,
                detail: None,
            });
        }

        Ok(RepoRuntimeStartupStatus {
            runtime_kind,
            repo_path: repo_key,
            stage: RepoRuntimeStartupStage::Idle,
            runtime: None,
            started_at: None,
            updated_at: now_rfc3339(),
            elapsed_ms: None,
            attempts: None,
            failure_kind: None,
            failure_reason: None,
            detail: None,
        })
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
        self.prune_stale_runtimes(&mut runtimes)?;
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
        let run_candidates = runs
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
            .map(RunExposureCandidate::from_run)
            .collect::<Vec<_>>();
        drop(runs);

        let (exposure_plans, probe_targets) = self.build_run_exposure_plans(run_candidates)?;
        let statuses_by_target =
            self.load_cached_opencode_session_statuses_for_targets(&probe_targets)?;
        let mut list = self.visible_run_summaries(exposure_plans, &statuses_by_target)?;

        list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        Ok(list)
    }

    fn build_run_exposure_plans(
        &self,
        run_candidates: Vec<RunExposureCandidate>,
    ) -> Result<(
        Vec<RunExposurePlan>,
        Vec<super::OpencodeSessionStatusProbeTarget>,
    )> {
        let mut sessions_by_repo_task = HashMap::new();
        let mut exposure_plans = Vec::with_capacity(run_candidates.len());
        let mut probe_targets = Vec::new();

        for run in run_candidates {
            if !run.requires_live_session_check() {
                exposure_plans.push(RunExposurePlan::without_probe(run.summary));
                continue;
            }

            let sessions = self.sessions_for_run_candidate(&run, &mut sessions_by_repo_task)?;
            let external_session_ids = collect_build_external_session_ids_for_run(&run, sessions);

            if external_session_ids.is_empty() {
                exposure_plans.push(RunExposurePlan::without_probe(run.summary));
                continue;
            }

            let probe_target = super::OpencodeSessionStatusProbeTarget::for_runtime_route(
                &run.summary.runtime_route,
                run.worktree_path.as_str(),
            );
            probe_targets.push(probe_target.clone());
            exposure_plans.push(RunExposurePlan::with_probe(
                run.summary,
                external_session_ids,
                probe_target,
            ));
        }

        Ok((exposure_plans, probe_targets))
    }

    fn sessions_for_run_candidate<'a>(
        &self,
        run: &RunExposureCandidate,
        sessions_by_repo_task: &'a mut HashMap<String, Vec<host_domain::AgentSessionDocument>>,
    ) -> Result<&'a [host_domain::AgentSessionDocument]> {
        let session_cache_key = format!("{}::{}", run.repo_path, run.task_id);
        if !sessions_by_repo_task.contains_key(session_cache_key.as_str()) {
            let sessions =
                self.agent_sessions_list(run.repo_path.as_str(), run.task_id.as_str())?;
            sessions_by_repo_task.insert(session_cache_key.clone(), sessions);
        }

        sessions_by_repo_task
            .get(session_cache_key.as_str())
            .map(Vec::as_slice)
            .ok_or_else(|| anyhow!("Missing cached agent sessions for {}", session_cache_key))
    }

    fn visible_run_summaries(
        &self,
        exposure_plans: Vec<RunExposurePlan>,
        statuses_by_target: &HashMap<
            super::OpencodeSessionStatusProbeTarget,
            super::OpencodeSessionStatusMap,
        >,
    ) -> Result<Vec<RunSummary>> {
        let mut list = Vec::new();
        for plan in exposure_plans {
            if plan.is_visible(statuses_by_target)? {
                list.push(plan.summary);
            }
        }
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
        let startup_started_at_instant = Instant::now();
        let startup_started_at = now_rfc3339();

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
                startup_started_at_instant,
                startup_started_at: startup_started_at.clone(),
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
        if let Err(error) = startup_result.as_ref() {
            let startup_failure = error
                .chain()
                .find_map(|cause| cause.downcast_ref::<super::OpencodeStartupWaitFailure>());
            let (failure_kind, failure_reason, attempts, elapsed_ms) = match startup_failure {
                Some(failure) => (
                    if failure.reason == "timeout" {
                        RepoRuntimeStartupFailureKind::Timeout
                    } else {
                        RepoRuntimeStartupFailureKind::Error
                    },
                    failure.reason,
                    Some(failure.report().attempts()),
                    Some(failure.report().startup_ms()),
                ),
                None => (RepoRuntimeStartupFailureKind::Error, "error", None, None),
            };
            self.mark_runtime_startup_failed(
                runtime_kind,
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
            )?;
        }
        flight_guard.complete(&startup_result)?;
        startup_result
    }

    fn spawn_and_register_runtime(
        &self,
        input: RuntimeStartInput<'_>,
    ) -> Result<RuntimeInstanceSummary> {
        let spawned_server = self.spawn_runtime_server(&input)?;
        let startup_started_at_instant = spawned_server.startup_started_at_instant;
        let startup_started_at = spawned_server.startup_started_at.clone();
        let startup_report = spawned_server.startup_report;
        let runtime_kind = input.runtime_kind;
        let repo_key = input.repo_key.clone();
        let summary = self.attach_runtime_session(input, spawned_server)?;
        self.mark_runtime_startup_ready(
            runtime_kind,
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

    pub(super) fn resolve_supported_runtime_kind(runtime_kind: &str) -> Result<AgentRuntimeKind> {
        match runtime_kind.trim() {
            "opencode" => Ok(AgentRuntimeKind::Opencode),
            other => Err(anyhow!("Unsupported agent runtime kind: {other}")),
        }
    }
}

fn collect_build_external_session_ids_for_run(
    run: &RunExposureCandidate,
    sessions: &[host_domain::AgentSessionDocument],
) -> Vec<String> {
    sessions
        .iter()
        .filter(|session| session.role.trim() == "build")
        .filter(|session| session.runtime_kind.trim() == run.summary.runtime_kind.as_str())
        .filter(|session| {
            super::task_workflow::normalize_path_for_comparison(session.working_directory.as_str())
                == super::task_workflow::normalize_path_for_comparison(run.worktree_path.as_str())
        })
        .filter_map(|session| {
            session
                .external_session_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        AppService, RuntimeEnsureFlightGuard, RuntimeStartupFailure, RuntimeStartupProgress,
    };
    use crate::app_service::test_support::{build_service_with_state, make_task};
    use crate::app_service::{AgentRuntimeProcess, RunProcess};
    use anyhow::{anyhow, Result};
    use host_domain::{
        AgentRuntimeKind, AgentSessionDocument, RepoRuntimeHealthMcp, RepoRuntimeHealthObservation,
        RepoRuntimeHealthRuntime, RepoRuntimeHealthState, RepoRuntimeMcpStatus,
        RepoRuntimeStartupFailureKind, RepoRuntimeStartupStage, RunSummary, TaskStatus,
    };
    use host_infra_system::RepoConfig;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::process::Command;
    use std::thread;
    use std::time::{Duration, Instant};

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

    fn spawn_delayed_opencode_session_status_server(
        response_body: String,
        delay: Duration,
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
                if !delay.is_zero() {
                    std::thread::sleep(delay);
                }
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });
        Ok((port, handle))
    }

    fn spawn_runtime_http_server(
        responses: Vec<String>,
    ) -> Result<(u16, std::thread::JoinHandle<Vec<String>>)> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        let handle = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for response in responses {
                if let Ok((mut stream, _)) = listener.accept() {
                    let mut request_buffer = [0_u8; 4096];
                    let size = stream.read(&mut request_buffer).unwrap_or(0);
                    requests.push(String::from_utf8_lossy(&request_buffer[..size]).to_string());
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();
                }
            }
            requests
        });
        Ok((port, handle))
    }

    fn runtime_http_response(status_line: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    fn insert_workspace_runtime(
        service: &AppService,
        runtime: host_domain::RuntimeInstanceSummary,
    ) -> Result<()> {
        let child = Command::new("/bin/sh")
            .arg("-lc")
            .arg("sleep 30")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()?;
        service
            .agent_runtimes
            .lock()
            .expect("agent runtimes lock poisoned")
            .insert(
                runtime.runtime_id.clone(),
                AgentRuntimeProcess {
                    summary: runtime,
                    child,
                    _opencode_process_guard: None,
                    cleanup_target: None,
                },
            );
        Ok(())
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
    fn runtime_startup_status_tracks_waiting_and_failure_stages() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let repo_path = "/tmp/runtime-startup-status";
        let started_at_instant = Instant::now();
        let started_at = "2026-04-04T16:00:00Z";

        service.mark_runtime_startup_requested(
            AgentRuntimeKind::Opencode,
            repo_path,
            &RuntimeStartupProgress {
                started_at_instant,
                started_at: started_at.to_string(),
                attempts: Some(0),
                elapsed_ms: None,
            },
        )?;
        service.mark_runtime_startup_waiting(
            AgentRuntimeKind::Opencode,
            repo_path,
            &RuntimeStartupProgress {
                started_at_instant,
                started_at: started_at.to_string(),
                attempts: Some(3),
                elapsed_ms: None,
            },
        )?;

        let waiting_status = service.runtime_startup_status("opencode", repo_path)?;
        assert_eq!(
            waiting_status.stage,
            RepoRuntimeStartupStage::WaitingForRuntime
        );
        assert_eq!(waiting_status.attempts, Some(3));
        assert_eq!(waiting_status.started_at.as_deref(), Some(started_at));

        service.mark_runtime_startup_failed(
            AgentRuntimeKind::Opencode,
            repo_path,
            &RuntimeStartupProgress {
                started_at_instant,
                started_at: started_at.to_string(),
                attempts: Some(4),
                elapsed_ms: Some(4200),
            },
            RuntimeStartupFailure {
                failure_kind: RepoRuntimeStartupFailureKind::Timeout,
                failure_reason: "timeout".to_string(),
                detail: "OpenCode startup probe failed reason=timeout".to_string(),
            },
        )?;

        let failed_status = service.runtime_startup_status("opencode", repo_path)?;
        assert_eq!(failed_status.stage, RepoRuntimeStartupStage::StartupFailed);
        assert_eq!(
            failed_status.failure_kind,
            Some(RepoRuntimeStartupFailureKind::Timeout)
        );
        assert_eq!(failed_status.failure_reason.as_deref(), Some("timeout"));
        assert_eq!(failed_status.attempts, Some(4));
        assert_eq!(failed_status.elapsed_ms, Some(4200));

        Ok(())
    }

    #[test]
    fn runtime_startup_status_ignores_stale_ready_snapshot_without_live_runtime() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let repo_path = "/tmp/runtime-stale-ready";
        let started_at_instant = Instant::now();
        let started_at = "2026-04-04T16:00:00Z";

        service.mark_runtime_startup_waiting(
            AgentRuntimeKind::Opencode,
            repo_path,
            &RuntimeStartupProgress {
                started_at_instant,
                started_at: started_at.to_string(),
                attempts: Some(1),
                elapsed_ms: None,
            },
        )?;
        service.mark_runtime_startup_ready(
            AgentRuntimeKind::Opencode,
            repo_path,
            &host_domain::RuntimeInstanceSummary {
                kind: AgentRuntimeKind::Opencode,
                runtime_id: "runtime-stale".to_string(),
                repo_path: repo_path.to_string(),
                task_id: None,
                role: host_domain::RuntimeRole::Workspace,
                working_directory: repo_path.to_string(),
                runtime_route: host_domain::RuntimeRoute::LocalHttp {
                    endpoint: "http://127.0.0.1:9999".to_string(),
                },
                started_at: started_at.to_string(),
                descriptor: AgentRuntimeKind::Opencode.descriptor(),
            },
            &RuntimeStartupProgress {
                started_at_instant,
                started_at: started_at.to_string(),
                attempts: Some(2),
                elapsed_ms: Some(1000),
            },
        )?;

        let status = service.runtime_startup_status("opencode", repo_path)?;

        assert_eq!(status.stage, RepoRuntimeStartupStage::Idle);
        assert!(status.runtime.is_none());
        Ok(())
    }

    #[test]
    fn repo_runtime_health_reports_ready_connected_runtime() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let (port, server_handle) = spawn_runtime_http_server(vec![
            runtime_http_response("200 OK", r#"{"openducktor":{"status":"connected"}}"#),
            runtime_http_response("200 OK", r#"["odt_read_task"]"#),
        ])?;
        let runtime = host_domain::RuntimeInstanceSummary {
            kind: AgentRuntimeKind::Opencode,
            runtime_id: "runtime-ready".to_string(),
            repo_path: "/tmp/repo-health-ready".to_string(),
            task_id: None,
            role: host_domain::RuntimeRole::Workspace,
            working_directory: "/tmp/repo-health-ready".to_string(),
            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                endpoint: format!("http://127.0.0.1:{port}"),
            },
            started_at: "2026-04-04T16:00:00Z".to_string(),
            descriptor: AgentRuntimeKind::Opencode.descriptor(),
        };
        insert_workspace_runtime(&service, runtime.clone())?;

        let health = service.repo_runtime_health("opencode", "/tmp/repo-health-ready")?;
        let requests = server_handle.join().expect("server thread should finish");

        assert!(requests[0].starts_with("GET /mcp?directory=%2Ftmp%2Frepo-health-ready "));
        assert!(requests[1]
            .starts_with("GET /experimental/tool/ids?directory=%2Ftmp%2Frepo-health-ready "));
        assert_eq!(health.status, RepoRuntimeHealthState::Ready);
        assert_eq!(health.runtime.status, RepoRuntimeHealthState::Ready);
        assert_eq!(
            health.runtime.observation,
            Some(RepoRuntimeHealthObservation::ObservedExistingRuntime)
        );
        assert_eq!(
            health.mcp.as_ref().map(|value| value.status),
            Some(RepoRuntimeMcpStatus::Connected)
        );
        assert_eq!(
            health.mcp.as_ref().map(|value| value.tool_ids.clone()),
            Some(vec!["odt_read_task".to_string()])
        );
        service.runtime_stop(runtime.runtime_id.as_str())?;
        Ok(())
    }

    #[test]
    fn repo_runtime_health_reconnects_disconnected_mcp() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let (port, server_handle) = spawn_runtime_http_server(vec![
            runtime_http_response(
                "200 OK",
                r#"{"openducktor":{"status":"disconnected","error":"not connected"}}"#,
            ),
            runtime_http_response("200 OK", r#"true"#),
            runtime_http_response("200 OK", r#"{"openducktor":{"status":"connected"}}"#),
            runtime_http_response("200 OK", r#"["odt_read_task"]"#),
        ])?;
        let runtime = host_domain::RuntimeInstanceSummary {
            kind: AgentRuntimeKind::Opencode,
            runtime_id: "runtime-reconnect".to_string(),
            repo_path: "/tmp/repo-health-reconnect".to_string(),
            task_id: None,
            role: host_domain::RuntimeRole::Workspace,
            working_directory: "/tmp/repo-health-reconnect".to_string(),
            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                endpoint: format!("http://127.0.0.1:{port}"),
            },
            started_at: "2026-04-04T16:00:00Z".to_string(),
            descriptor: AgentRuntimeKind::Opencode.descriptor(),
        };
        insert_workspace_runtime(&service, runtime.clone())?;

        let health = service.repo_runtime_health("opencode", "/tmp/repo-health-reconnect")?;
        let requests = server_handle.join().expect("server thread should finish");

        assert!(requests[1].starts_with(
            "POST /mcp/openducktor/connect?directory=%2Ftmp%2Frepo-health-reconnect "
        ));
        assert_eq!(health.status, RepoRuntimeHealthState::Ready);
        assert_eq!(
            health.mcp.as_ref().map(|value| value.status),
            Some(RepoRuntimeMcpStatus::Connected)
        );
        assert_eq!(
            health.mcp.as_ref().map(|value| value.tool_ids.clone()),
            Some(vec!["odt_read_task".to_string()])
        );
        service.runtime_stop(runtime.runtime_id.as_str())?;
        Ok(())
    }

    #[test]
    fn repo_runtime_health_returns_structured_failure_when_refresh_after_reconnect_fails(
    ) -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let (port, server_handle) = spawn_runtime_http_server(vec![
            runtime_http_response(
                "200 OK",
                r#"{"openducktor":{"status":"disconnected","error":"not connected"}}"#,
            ),
            runtime_http_response("200 OK", r#"true"#),
            runtime_http_response(
                "504 Gateway Timeout",
                r#"{"error":{"message":"status probe timed out"}}"#,
            ),
        ])?;
        let runtime = host_domain::RuntimeInstanceSummary {
            kind: AgentRuntimeKind::Opencode,
            runtime_id: "runtime-refresh-failure".to_string(),
            repo_path: "/tmp/repo-health-refresh-failure".to_string(),
            task_id: None,
            role: host_domain::RuntimeRole::Workspace,
            working_directory: "/tmp/repo-health-refresh-failure".to_string(),
            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                endpoint: format!("http://127.0.0.1:{port}"),
            },
            started_at: "2026-04-04T16:00:00Z".to_string(),
            descriptor: AgentRuntimeKind::Opencode.descriptor(),
        };
        insert_workspace_runtime(&service, runtime.clone())?;

        let health = service.repo_runtime_health("opencode", "/tmp/repo-health-refresh-failure")?;
        let requests = server_handle.join().expect("server thread should finish");

        assert!(requests[1].starts_with(
            "POST /mcp/openducktor/connect?directory=%2Ftmp%2Frepo-health-refresh-failure "
        ));
        assert_eq!(health.runtime.status, RepoRuntimeHealthState::Ready);
        assert_eq!(health.status, RepoRuntimeHealthState::Error);
        assert_eq!(
            health.mcp.as_ref().map(|value| value.status),
            Some(RepoRuntimeMcpStatus::Error)
        );
        assert!(health
            .mcp
            .as_ref()
            .and_then(|value| value.detail.as_deref())
            .is_some_and(
                |value| value.contains("Failed to refresh runtime MCP status after reconnect")
            ));
        service.runtime_stop(runtime.runtime_id.as_str())?;
        Ok(())
    }

    #[test]
    fn repo_runtime_health_reports_mcp_error_when_tool_ids_fail() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let (port, server_handle) = spawn_runtime_http_server(vec![
            runtime_http_response("200 OK", r#"{"openducktor":{"status":"connected"}}"#),
            runtime_http_response(
                "504 Gateway Timeout",
                r#"{"error":{"message":"tool ids timed out"}}"#,
            ),
        ])?;
        let runtime = host_domain::RuntimeInstanceSummary {
            kind: AgentRuntimeKind::Opencode,
            runtime_id: "runtime-tool-ids-failure".to_string(),
            repo_path: "/tmp/repo-health-tool-ids-failure".to_string(),
            task_id: None,
            role: host_domain::RuntimeRole::Workspace,
            working_directory: "/tmp/repo-health-tool-ids-failure".to_string(),
            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                endpoint: format!("http://127.0.0.1:{port}"),
            },
            started_at: "2026-04-04T16:00:00Z".to_string(),
            descriptor: AgentRuntimeKind::Opencode.descriptor(),
        };
        insert_workspace_runtime(&service, runtime.clone())?;

        let health =
            service.repo_runtime_health("opencode", "/tmp/repo-health-tool-ids-failure")?;
        let requests = server_handle.join().expect("server thread should finish");

        assert!(
            requests[0].starts_with("GET /mcp?directory=%2Ftmp%2Frepo-health-tool-ids-failure ")
        );
        assert!(requests[1].starts_with(
            "GET /experimental/tool/ids?directory=%2Ftmp%2Frepo-health-tool-ids-failure "
        ));
        assert_eq!(health.runtime.status, RepoRuntimeHealthState::Ready);
        assert_eq!(health.status, RepoRuntimeHealthState::Error);
        assert_eq!(
            health.mcp.as_ref().map(|value| value.status),
            Some(RepoRuntimeMcpStatus::Error)
        );
        assert!(health
            .mcp
            .as_ref()
            .and_then(|value| value.detail.as_deref())
            .is_some_and(|value| value.contains("Failed to load runtime MCP tool ids")));
        assert_eq!(
            health.mcp.as_ref().map(|value| value.tool_ids.clone()),
            Some(Vec::new())
        );
        service.runtime_stop(runtime.runtime_id.as_str())?;
        Ok(())
    }

    #[test]
    fn stop_registered_runtime_preserving_repo_health_keeps_restart_snapshot() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let runtime = host_domain::RuntimeInstanceSummary {
            kind: AgentRuntimeKind::Opencode,
            runtime_id: "runtime-preserve-health".to_string(),
            repo_path: "/tmp/repo-health-preserve".to_string(),
            task_id: None,
            role: host_domain::RuntimeRole::Workspace,
            working_directory: "/tmp/repo-health-preserve".to_string(),
            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                endpoint: "http://127.0.0.1:9998".to_string(),
            },
            started_at: "2026-04-04T16:00:00Z".to_string(),
            descriptor: AgentRuntimeKind::Opencode.descriptor(),
        };
        insert_workspace_runtime(&service, runtime.clone())?;
        service
            .repo_runtime_health_snapshots
            .lock()
            .expect("repo runtime health snapshots lock poisoned")
            .insert(
                AppService::runtime_ensure_flight_key(
                    AgentRuntimeKind::Opencode,
                    "/tmp/repo-health-preserve",
                ),
                host_domain::RepoRuntimeHealthCheck {
                    status: host_domain::RepoRuntimeHealthState::Checking,
                    checked_at: "2026-04-04T16:00:01Z".to_string(),
                    runtime: RepoRuntimeHealthRuntime {
                        status: host_domain::RepoRuntimeHealthState::Checking,
                        stage: RepoRuntimeStartupStage::StartupRequested,
                        observation: Some(RepoRuntimeHealthObservation::RestartedForMcp),
                        instance: Some(runtime.clone()),
                        started_at: Some("2026-04-04T16:00:00Z".to_string()),
                        updated_at: "2026-04-04T16:00:01Z".to_string(),
                        elapsed_ms: None,
                        attempts: None,
                        detail: Some("Restarting runtime".to_string()),
                        failure_kind: Some(RepoRuntimeStartupFailureKind::Error),
                        failure_reason: None,
                    },
                    mcp: Some(RepoRuntimeHealthMcp {
                        supported: true,
                        status: RepoRuntimeMcpStatus::WaitingForRuntime,
                        server_name: "openducktor".to_string(),
                        server_status: None,
                        tool_ids: Vec::new(),
                        detail: Some("Restarting runtime".to_string()),
                        failure_kind: Some(RepoRuntimeStartupFailureKind::Error),
                    }),
                },
            );

        service.stop_registered_runtime_preserving_repo_health(runtime.runtime_id.as_str())?;

        let health = service.repo_runtime_health_status("opencode", "/tmp/repo-health-preserve")?;
        assert_eq!(health.status, RepoRuntimeHealthState::Checking);
        assert!(health.runtime.instance.is_some());
        Ok(())
    }

    #[test]
    fn repo_runtime_health_skips_restart_when_active_run_uses_runtime() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let (port, server_handle) = spawn_runtime_http_server(vec![runtime_http_response(
            "500 Internal Server Error",
            r#"{"error":{"message":"ConfigInvalidError: invalid option loglevel"}}"#,
        )])?;
        let runtime = host_domain::RuntimeInstanceSummary {
            kind: AgentRuntimeKind::Opencode,
            runtime_id: "runtime-active-run".to_string(),
            repo_path: "/tmp/repo-health-active-run".to_string(),
            task_id: None,
            role: host_domain::RuntimeRole::Workspace,
            working_directory: "/tmp/repo-health-active-run".to_string(),
            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                endpoint: format!("http://127.0.0.1:{port}"),
            },
            started_at: "2026-04-04T16:00:00Z".to_string(),
            descriptor: AgentRuntimeKind::Opencode.descriptor(),
        };
        insert_workspace_runtime(&service, runtime.clone())?;
        service.runs.lock().expect("runs lock poisoned").insert(
            "run-1".to_string(),
            RunProcess {
                summary: RunSummary {
                    run_id: "run-1".to_string(),
                    runtime_kind: AgentRuntimeKind::Opencode,
                    runtime_route: runtime.runtime_route.clone(),
                    repo_path: runtime.repo_path.clone(),
                    task_id: "task-1".to_string(),
                    branch: "odt/task-1".to_string(),
                    worktree_path: runtime.working_directory.clone(),
                    port,
                    state: host_domain::RunState::Running,
                    last_message: None,
                    started_at: "2026-04-04T16:00:10Z".to_string(),
                },
                child: None,
                _opencode_process_guard: None,
                repo_path: runtime.repo_path.clone(),
                task_id: "task-1".to_string(),
                worktree_path: runtime.working_directory.clone(),
                repo_config: RepoConfig::default(),
            },
        );

        let health = service.repo_runtime_health("opencode", "/tmp/repo-health-active-run")?;
        let _requests = server_handle.join().expect("server thread should finish");

        assert_eq!(health.runtime.status, RepoRuntimeHealthState::Ready);
        assert_eq!(
            health.mcp.as_ref().map(|value| value.status),
            Some(RepoRuntimeMcpStatus::Error)
        );
        assert!(health
            .mcp
            .as_ref()
            .and_then(|value| value.detail.as_deref())
            .is_some_and(|value| value.contains("restart was skipped")));
        service.runtime_stop(runtime.runtime_id.as_str())?;
        Ok(())
    }

    #[test]
    fn repo_runtime_health_status_describes_idle_runtime() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);

        let health = service.repo_runtime_health_status("opencode", "/tmp/repo-health-idle")?;

        assert_eq!(health.status, RepoRuntimeHealthState::Idle);
        assert_eq!(health.runtime.status, RepoRuntimeHealthState::Idle);
        assert_eq!(
            health.runtime.detail.as_deref(),
            Some("Runtime has not been started yet.")
        );

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
            role: "build".to_string(),
            scenario: "build_implementation_start".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: "/tmp/repo/worktree".to_string(),
            selected_model: None,
        }];

        service
            .runs
            .lock()
            .expect("run state lock poisoned")
            .insert(
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
        server_handle
            .join()
            .expect("status server thread should finish");

        assert!(runs.is_empty());
        Ok(())
    }

    #[test]
    fn module_runs_list_treats_unreachable_status_endpoint_as_stale_run() -> Result<()> {
        let (service, task_state, _git_state) =
            build_service_with_state(vec![make_task("task-1", "task", TaskStatus::InProgress)]);
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        drop(listener);

        task_state
            .lock()
            .expect("task store lock poisoned")
            .agent_sessions = vec![AgentSessionDocument {
            session_id: "build-session".to_string(),
            external_session_id: Some("external-build-session".to_string()),
            role: "build".to_string(),
            scenario: "build_implementation_start".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: "/tmp/repo/worktree".to_string(),
            selected_model: None,
        }];

        service
            .runs
            .lock()
            .expect("run state lock poisoned")
            .insert(
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

        assert!(runs.is_empty());
        Ok(())
    }

    #[test]
    fn module_runs_list_batches_unique_slow_status_probes() -> Result<()> {
        let tasks = (0..6)
            .map(|index| {
                make_task(
                    format!("task-{index}").as_str(),
                    "task",
                    TaskStatus::InProgress,
                )
            })
            .collect::<Vec<_>>();
        let (service, task_state, _git_state) = build_service_with_state(tasks);
        let mut server_handles = Vec::new();
        let mut sessions = Vec::new();

        for index in 0..6 {
            let (port, server_handle) = spawn_delayed_opencode_session_status_server(
                format!(r#"{{"external-build-session-{index}":{{"type":"busy"}}}}"#),
                Duration::from_millis(300),
            )?;
            server_handles.push(server_handle);
            sessions.push(AgentSessionDocument {
                session_id: format!("build-session-{index}"),
                external_session_id: Some(format!("external-build-session-{index}")),
                role: "build".to_string(),
                scenario: "build_implementation_start".to_string(),
                started_at: "2026-03-17T11:00:00Z".to_string(),
                runtime_kind: "opencode".to_string(),
                working_directory: format!("/tmp/repo/worktree-{index}"),
                selected_model: None,
            });

            service
                .runs
                .lock()
                .expect("run state lock poisoned")
                .insert(
                    format!("run-{index}"),
                    RunProcess {
                        summary: RunSummary {
                            run_id: format!("run-{index}"),
                            runtime_kind: AgentRuntimeKind::Opencode,
                            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                                endpoint: format!("http://127.0.0.1:{port}"),
                            },
                            repo_path: "/tmp/repo".to_string(),
                            task_id: format!("task-{index}"),
                            branch: format!("odt/task-{index}"),
                            worktree_path: format!("/tmp/repo/worktree-{index}"),
                            port,
                            state: host_domain::RunState::Running,
                            last_message: None,
                            started_at: format!("2026-03-17T11:00:0{index}Z"),
                        },
                        child: None,
                        _opencode_process_guard: None,
                        repo_path: "/tmp/repo".to_string(),
                        task_id: format!("task-{index}"),
                        worktree_path: format!("/tmp/repo/worktree-{index}"),
                        repo_config: RepoConfig::default(),
                    },
                );
        }

        task_state
            .lock()
            .expect("task store lock poisoned")
            .agent_sessions = sessions;

        let started_at = Instant::now();
        let runs = service.runs_list(Some("/tmp/repo"))?;
        let elapsed = started_at.elapsed();

        for server_handle in server_handles {
            server_handle
                .join()
                .expect("status server thread should finish");
        }

        assert_eq!(runs.len(), 6);
        assert!(
            elapsed < Duration::from_millis(1200),
            "expected bounded parallel latency, observed {elapsed:?}"
        );
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
