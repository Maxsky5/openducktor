use super::service_core::{
    AppService, CachedRuntimeSessionStatusProbe, RuntimeSessionStatusFlight,
    RuntimeSessionStatusFlightState, RuntimeSessionStatusProbeLimiter,
};
use anyhow::{anyhow, Result};
use host_domain::{AgentRuntimeKind, RuntimeRoute};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fmt;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Clone, Debug, Eq, PartialEq, serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum RuntimeExternalSessionStatus {
    Idle,
    Retry {
        #[allow(dead_code)]
        attempt: u64,
        #[allow(dead_code)]
        message: String,
        #[allow(dead_code)]
        next: u64,
    },
    Busy,
}

pub(crate) type RuntimeSessionStatusMap = HashMap<String, RuntimeExternalSessionStatus>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum RuntimeSessionStatusSnapshotKind {
    NoLiveSessions,
    HasLiveSessions,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RuntimeSessionStatusSnapshot {
    statuses: RuntimeSessionStatusMap,
    kind: RuntimeSessionStatusSnapshotKind,
}

impl RuntimeSessionStatusSnapshot {
    pub(crate) fn from_statuses(statuses: RuntimeSessionStatusMap) -> Self {
        let kind = if statuses.values().any(|status| {
            matches!(
                status,
                RuntimeExternalSessionStatus::Busy | RuntimeExternalSessionStatus::Retry { .. }
            )
        }) {
            RuntimeSessionStatusSnapshotKind::HasLiveSessions
        } else {
            RuntimeSessionStatusSnapshotKind::NoLiveSessions
        };

        Self { statuses, kind }
    }

    pub(crate) fn kind(&self) -> RuntimeSessionStatusSnapshotKind {
        self.kind.clone()
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn statuses(&self) -> &RuntimeSessionStatusMap {
        &self.statuses
    }

    pub(crate) fn has_live_session(&self, external_session_id: &str) -> bool {
        has_live_runtime_session_status(&self.statuses, external_session_id)
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(crate) struct RuntimeSessionStatusProbeTarget {
    runtime_kind: AgentRuntimeKind,
    runtime_route: RuntimeRoute,
    working_directory: String,
}

impl RuntimeSessionStatusProbeTarget {
    pub(crate) fn new(
        runtime_kind: AgentRuntimeKind,
        runtime_route: &RuntimeRoute,
        working_directory: &str,
    ) -> Self {
        Self {
            runtime_kind,
            runtime_route: runtime_route.clone(),
            working_directory: working_directory.to_string(),
        }
    }

    pub(crate) fn runtime_kind(&self) -> &AgentRuntimeKind {
        &self.runtime_kind
    }

    pub(crate) fn runtime_route(&self) -> &RuntimeRoute {
        &self.runtime_route
    }

    pub(crate) fn working_directory(&self) -> &str {
        self.working_directory.as_str()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum RuntimeSessionStatusProbeTargetResolution {
    Unsupported,
    Target(RuntimeSessionStatusProbeTarget),
}

struct RuntimeSessionStatusFlightGuard<'a> {
    service: &'a AppService,
    target: RuntimeSessionStatusProbeTarget,
    flight: Arc<RuntimeSessionStatusFlight>,
    completed: bool,
}

impl<'a> RuntimeSessionStatusFlightGuard<'a> {
    fn new(
        service: &'a AppService,
        target: &RuntimeSessionStatusProbeTarget,
        flight: Arc<RuntimeSessionStatusFlight>,
    ) -> Self {
        Self {
            service,
            target: target.clone(),
            flight,
            completed: false,
        }
    }

    fn complete(&mut self, outcome: &RuntimeSessionStatusProbeOutcome) -> Result<()> {
        self.completed = true;
        self.service
            .complete_runtime_session_status_flight(&self.target, &self.flight, outcome)
    }
}

impl Drop for RuntimeSessionStatusFlightGuard<'_> {
    fn drop(&mut self) {
        if self.completed {
            return;
        }

        let aborted = RuntimeSessionStatusProbeOutcome::ActionableError(
            RuntimeSessionStatusProbeError::ProbeAborted,
        );
        if let Err(error) = self.service.complete_runtime_session_status_flight(
            &self.target,
            &self.flight,
            &aborted,
        ) {
            eprintln!(
                "OpenDucktor warning: failed completing runtime session status flight after abort: {error:#}"
            );
        }
    }
}

struct RuntimeSessionStatusProbePermit {
    limiter: Arc<RuntimeSessionStatusProbeLimiter>,
}

impl Drop for RuntimeSessionStatusProbePermit {
    fn drop(&mut self) {
        match self.limiter.active.lock() {
            Ok(mut active) => {
                if *active > 0 {
                    *active -= 1;
                }
                self.limiter.condvar.notify_one();
            }
            Err(poisoned) => {
                let mut active = poisoned.into_inner();
                if *active > 0 {
                    *active -= 1;
                }
                self.limiter.condvar.notify_one();
                eprintln!(
                    "OpenDucktor warning: runtime session status probe limiter lock poisoned during permit release"
                );
            }
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum RuntimeSessionStatusProbeError {
    ProbeFailed(String),
    ProbeAborted,
}

impl fmt::Display for RuntimeSessionStatusProbeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ProbeFailed(message) => formatter.write_str(message),
            Self::ProbeAborted => {
                formatter.write_str("Runtime session status probe aborted unexpectedly")
            }
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum RuntimeSessionStatusProbeOutcome {
    Snapshot(RuntimeSessionStatusSnapshot),
    Unsupported,
    ActionableError(RuntimeSessionStatusProbeError),
}

pub(crate) fn has_live_runtime_session_status(
    statuses: &RuntimeSessionStatusMap,
    external_session_id: &str,
) -> bool {
    matches!(
        statuses.get(external_session_id),
        Some(RuntimeExternalSessionStatus::Busy | RuntimeExternalSessionStatus::Retry { .. })
    )
}

pub(crate) fn dedupe_probe_targets<I>(targets: I) -> Vec<RuntimeSessionStatusProbeTarget>
where
    I: IntoIterator<Item = RuntimeSessionStatusProbeTarget>,
{
    let mut unique_targets = Vec::new();
    let mut seen = HashSet::new();
    for target in targets {
        if seen.insert(target.clone()) {
            unique_targets.push(target);
        }
    }
    unique_targets
}

impl AppService {
    pub(super) const RUNTIME_SESSION_STATUS_CACHE_TTL: Duration = Duration::from_secs(1);
    const RUNTIME_SESSION_STATUS_BATCH_WORKER_LIMIT: usize = 16;

    pub(super) fn load_cached_runtime_session_statuses_for_targets(
        &self,
        targets: &[RuntimeSessionStatusProbeTarget],
    ) -> Result<HashMap<RuntimeSessionStatusProbeTarget, RuntimeSessionStatusProbeOutcome>> {
        let unique_targets = dedupe_probe_targets(targets.iter().cloned());

        if unique_targets.is_empty() {
            return Ok(HashMap::new());
        }

        self.resolve_status_batch(unique_targets)
    }

    fn resolve_status_batch(
        &self,
        unique_targets: Vec<RuntimeSessionStatusProbeTarget>,
    ) -> Result<HashMap<RuntimeSessionStatusProbeTarget, RuntimeSessionStatusProbeOutcome>> {
        let worker_count = unique_targets.len().min(
            Self::RUNTIME_SESSION_STATUS_BATCH_WORKER_LIMIT.max(
                self.runtime_session_status_probe_limiter
                    .max_concurrent
                    .max(1),
            ),
        );
        let queue = Mutex::new(VecDeque::from(unique_targets));
        let results = Mutex::new(HashMap::new());

        thread::scope(|scope| -> Result<()> {
            let mut handles = Vec::new();
            for _ in 0..worker_count {
                let service = self;
                let queue = &queue;
                let results = &results;
                handles.push(scope.spawn(move || -> Result<()> {
                    loop {
                        let target = {
                            let mut queue = queue.lock().map_err(|_| {
                                anyhow!("OpenCode session status batch queue lock poisoned")
                            })?;
                            queue.pop_front()
                        };
                        let Some(target) = target else {
                            return Ok(());
                        };

                        let outcome = service.resolve_cached_probe_outcome(&target)?;
                        let mut results = results.lock().map_err(|_| {
                            anyhow!("Runtime session status batch results lock poisoned")
                        })?;
                        results.insert(target, outcome);
                    }
                }));
            }

            for handle in handles {
                handle
                    .join()
                    .map_err(|_| anyhow!("Runtime session status batch worker panicked"))??;
            }
            Ok(())
        })?;

        let results = results
            .lock()
            .map_err(|_| anyhow!("OpenCode session status batch results lock poisoned"))?;
        let mut results = results;
        Ok(std::mem::take(&mut *results))
    }

    #[cfg(test)]
    fn load_cached_runtime_session_status_outcome_for_target(
        &self,
        target: &RuntimeSessionStatusProbeTarget,
    ) -> Result<RuntimeSessionStatusProbeOutcome> {
        self.resolve_cached_probe_outcome(target)
    }

    fn resolve_cached_probe_outcome(
        &self,
        target: &RuntimeSessionStatusProbeTarget,
    ) -> Result<RuntimeSessionStatusProbeOutcome> {
        if let Some(cached) = self.cached_runtime_session_status_outcome(target)? {
            return Ok(cached);
        }

        let (flight, is_leader) = self.acquire_runtime_session_status_flight(target)?;
        if !is_leader {
            return Self::wait_for_runtime_session_status_flight(&flight);
        }

        self.resolve_leader_probe_outcome(target, flight)
    }

    fn resolve_leader_probe_outcome(
        &self,
        target: &RuntimeSessionStatusProbeTarget,
        flight: Arc<RuntimeSessionStatusFlight>,
    ) -> Result<RuntimeSessionStatusProbeOutcome> {
        let mut flight_guard = RuntimeSessionStatusFlightGuard::new(self, target, flight);
        let _permit = self.acquire_runtime_session_status_probe_permit()?;
        let outcome = self.probe_uncached_runtime_session_status_target(target)?;
        self.update_runtime_session_status_cache(target, &outcome)?;
        flight_guard.complete(&outcome)?;
        Ok(outcome)
    }

    fn probe_uncached_runtime_session_status_target(
        &self,
        target: &RuntimeSessionStatusProbeTarget,
    ) -> Result<RuntimeSessionStatusProbeOutcome> {
        Ok(self
            .runtime_registry
            .runtime(target.runtime_kind())?
            .probe_session_status(target))
    }

    fn cached_runtime_session_status_outcome(
        &self,
        target: &RuntimeSessionStatusProbeTarget,
    ) -> Result<Option<RuntimeSessionStatusProbeOutcome>> {
        let now = Instant::now();
        let mut cache = self
            .runtime_session_status_cache
            .lock()
            .map_err(|_| anyhow!("Runtime session status cache lock poisoned"))?;
        Self::prune_expired_runtime_session_status_cache(&mut cache, now);
        if let Some(entry) = cache.get(target) {
            return Ok(Some(entry.outcome.clone()));
        }
        Ok(None)
    }

    fn update_runtime_session_status_cache(
        &self,
        target: &RuntimeSessionStatusProbeTarget,
        outcome: &RuntimeSessionStatusProbeOutcome,
    ) -> Result<()> {
        let now = Instant::now();
        let mut cache = self
            .runtime_session_status_cache
            .lock()
            .map_err(|_| anyhow!("Runtime session status cache lock poisoned"))?;
        Self::prune_expired_runtime_session_status_cache(&mut cache, now);
        cache.insert(
            target.clone(),
            CachedRuntimeSessionStatusProbe {
                checked_at: now,
                outcome: outcome.clone(),
            },
        );
        Ok(())
    }

    fn prune_expired_runtime_session_status_cache(
        cache: &mut HashMap<RuntimeSessionStatusProbeTarget, CachedRuntimeSessionStatusProbe>,
        now: Instant,
    ) {
        cache.retain(|_, entry| {
            now.duration_since(entry.checked_at) <= Self::RUNTIME_SESSION_STATUS_CACHE_TTL
        });
    }

    fn acquire_runtime_session_status_flight(
        &self,
        target: &RuntimeSessionStatusProbeTarget,
    ) -> Result<(Arc<RuntimeSessionStatusFlight>, bool)> {
        let mut flights = self
            .runtime_session_status_flights
            .lock()
            .map_err(|_| anyhow!("Runtime session status coordination state lock poisoned"))?;
        if let Some(existing) = flights.get(target) {
            return Ok((existing.clone(), false));
        }

        let flight = Arc::new(RuntimeSessionStatusFlight::new());
        flights.insert(target.clone(), flight.clone());
        Ok((flight, true))
    }

    fn complete_runtime_session_status_flight(
        &self,
        target: &RuntimeSessionStatusProbeTarget,
        flight: &Arc<RuntimeSessionStatusFlight>,
        outcome: &RuntimeSessionStatusProbeOutcome,
    ) -> Result<()> {
        let mut poisoned = false;

        {
            let mut state = match flight.state.lock() {
                Ok(state) => state,
                Err(poisoned_state) => {
                    poisoned = true;
                    poisoned_state.into_inner()
                }
            };
            *state = RuntimeSessionStatusFlightState::Finished(outcome.clone());
            flight.condvar.notify_all();
        }

        {
            let mut flights = match self.runtime_session_status_flights.lock() {
                Ok(flights) => flights,
                Err(poisoned_flights) => {
                    poisoned = true;
                    poisoned_flights.into_inner()
                }
            };
            flights.remove(target);
        }

        if poisoned {
            return Err(anyhow!(
                "Runtime session status coordination state lock poisoned"
            ));
        }

        Ok(())
    }

    fn wait_for_runtime_session_status_flight(
        flight: &Arc<RuntimeSessionStatusFlight>,
    ) -> Result<RuntimeSessionStatusProbeOutcome> {
        let mut state = flight
            .state
            .lock()
            .map_err(|_| anyhow!("Runtime session status coordination state lock poisoned"))?;
        loop {
            match &*state {
                RuntimeSessionStatusFlightState::Finished(outcome) => {
                    return Ok(outcome.clone());
                }
                RuntimeSessionStatusFlightState::Loading => {
                    state = flight.condvar.wait(state).map_err(|_| {
                        anyhow!("Runtime session status coordination state lock poisoned")
                    })?;
                }
            }
        }
    }

    fn acquire_runtime_session_status_probe_permit(
        &self,
    ) -> Result<RuntimeSessionStatusProbePermit> {
        let limiter = Arc::clone(&self.runtime_session_status_probe_limiter);
        let mut active = limiter
            .active
            .lock()
            .map_err(|_| anyhow!("Runtime session status probe limiter lock poisoned"))?;
        while *active >= limiter.max_concurrent {
            active = limiter
                .condvar
                .wait(active)
                .map_err(|_| anyhow!("Runtime session status probe limiter lock poisoned"))?;
        }
        *active += 1;
        drop(active);
        Ok(RuntimeSessionStatusProbePermit { limiter })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AppService, CachedRuntimeSessionStatusProbe, RuntimeExternalSessionStatus,
        RuntimeSessionStatusFlightGuard, RuntimeSessionStatusMap, RuntimeSessionStatusProbeOutcome,
        RuntimeSessionStatusProbeTarget, RuntimeSessionStatusSnapshot,
        RuntimeSessionStatusSnapshotKind,
    };
    use crate::app_service::runtime_registry::{AppRuntime, OpenCodeRuntime};
    use crate::app_service::test_support::{
        build_service_with_state, builtin_opencode_runtime_route,
    };
    use anyhow::{anyhow, Result};
    use host_domain::{AgentRuntimeKind, RuntimeRoute};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};

    fn runtime_target(port: u16, working_directory: &str) -> RuntimeSessionStatusProbeTarget {
        RuntimeSessionStatusProbeTarget::new(
            AgentRuntimeKind::opencode(),
            &builtin_opencode_runtime_route(port),
            working_directory,
        )
    }

    fn expect_statuses(outcome: RuntimeSessionStatusProbeOutcome) -> RuntimeSessionStatusSnapshot {
        match outcome {
            RuntimeSessionStatusProbeOutcome::Snapshot(snapshot) => snapshot,
            other => panic!("expected status snapshot, received {other:?}"),
        }
    }

    fn expect_actionable_error(outcome: RuntimeSessionStatusProbeOutcome) -> anyhow::Error {
        match outcome {
            RuntimeSessionStatusProbeOutcome::ActionableError(error) => anyhow!(error.to_string()),
            other => panic!("expected actionable error, received {other:?}"),
        }
    }

    #[test]
    fn probe_session_status_sends_directory_query_and_parses_response() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let port = listener
            .local_addr()
            .expect("listener should expose addr")
            .port();
        let request_line = Arc::new(Mutex::new(None::<String>));
        let request_line_for_thread = Arc::clone(&request_line);

        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("server should accept request");
            let mut request_buffer = [0_u8; 4096];
            let bytes_read = stream
                .read(&mut request_buffer)
                .expect("server should read request");
            let request_text = String::from_utf8_lossy(&request_buffer[..bytes_read]);
            let first_line = request_text.lines().next().unwrap_or_default().to_string();
            *request_line_for_thread
                .lock()
                .expect("request line lock poisoned") = Some(first_line);

            let body = r#"{"external-session":{"type":"busy"}}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("server should write response");
            stream.flush().expect("server should flush response");
        });

        let target = RuntimeSessionStatusProbeTarget::new(
            AgentRuntimeKind::opencode(),
            &builtin_opencode_runtime_route(port),
            "/tmp/repo path",
        );

        let outcome = OpenCodeRuntime::default().probe_session_status(&target);
        let RuntimeSessionStatusProbeOutcome::Snapshot(snapshot) = outcome else {
            panic!("status request should succeed");
        };
        assert!(matches!(
            snapshot.statuses().get("external-session"),
            Some(RuntimeExternalSessionStatus::Busy)
        ));
        assert_eq!(
            snapshot.kind(),
            RuntimeSessionStatusSnapshotKind::HasLiveSessions
        );
        assert!(snapshot.has_live_session("external-session"));

        server.join().expect("server thread should finish");
        let captured_request = request_line
            .lock()
            .expect("request line lock poisoned")
            .clone()
            .expect("request line should be captured");
        assert!(
            captured_request
                .starts_with("GET /session/status?directory=%2Ftmp%2Frepo+path HTTP/1.1"),
            "unexpected request line: {captured_request}"
        );
    }

    #[test]
    fn cached_probe_preserves_trailing_space_in_directory_query() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        let request_line = Arc::new(Mutex::new(None::<String>));
        let request_line_for_thread = Arc::clone(&request_line);

        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("server should accept request");
            let mut request_buffer = [0_u8; 4096];
            let bytes_read = stream
                .read(&mut request_buffer)
                .expect("server should read request");
            let request_text = String::from_utf8_lossy(&request_buffer[..bytes_read]);
            let first_line = request_text.lines().next().unwrap_or_default().to_string();
            *request_line_for_thread
                .lock()
                .expect("request line lock poisoned") = Some(first_line);

            let body = r#"{"external-session":{"type":"busy"}}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("server should write response");
            stream.flush().expect("server should flush response");
        });

        let target = runtime_target(port, "/tmp/repo ");
        assert_eq!(target.working_directory(), "/tmp/repo ");

        let statuses = expect_statuses(
            service.load_cached_runtime_session_status_outcome_for_target(&target)?,
        );
        assert!(matches!(
            statuses.statuses().get("external-session"),
            Some(RuntimeExternalSessionStatus::Busy)
        ));
        assert_eq!(
            statuses.kind(),
            RuntimeSessionStatusSnapshotKind::HasLiveSessions
        );

        server.join().expect("server thread should finish");
        let captured_request = request_line
            .lock()
            .expect("request line lock poisoned")
            .clone()
            .expect("request line should be captured");
        assert!(
            captured_request.starts_with("GET /session/status?directory=%2Ftmp%2Frepo+ HTTP/1.1"),
            "unexpected request line: {captured_request}"
        );

        Ok(())
    }

    #[test]
    fn cached_probe_reuses_fresh_statuses_without_reconnecting() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let (port, connections, server_handle) = spawn_counting_status_server(
            1,
            Duration::ZERO,
            Ok(r#"{"external-build-session":{"type":"busy"}}"#.to_string()),
        )?;
        let target = runtime_target(port, "/tmp/repo");

        let first = expect_statuses(
            service.load_cached_runtime_session_status_outcome_for_target(&target)?,
        );
        let second = expect_statuses(
            service.load_cached_runtime_session_status_outcome_for_target(&target)?,
        );
        server_handle
            .join()
            .expect("status server thread should finish");

        assert!(first.statuses().contains_key("external-build-session"));
        assert!(second.statuses().contains_key("external-build-session"));
        assert_eq!(connections.load(Ordering::SeqCst), 1);
        Ok(())
    }

    #[test]
    fn opencode_runtime_marks_stdio_session_probe_as_unsupported() -> Result<()> {
        let resolution = OpenCodeRuntime::default()
            .session_status_probe_target(&RuntimeRoute::Stdio, "/tmp/repo")?;

        assert!(matches!(
            resolution,
            super::RuntimeSessionStatusProbeTargetResolution::Unsupported
        ));
        Ok(())
    }

    #[test]
    fn cached_probe_refreshes_when_entry_expires() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let (port, connections, server_handle) = spawn_counting_status_server(
            2,
            Duration::ZERO,
            Ok(r#"{"external-build-session":{"type":"busy"}}"#.to_string()),
        )?;
        let target = runtime_target(port, "/tmp/repo");

        service.load_cached_runtime_session_status_outcome_for_target(&target)?;
        {
            let mut cache = service
                .runtime_session_status_cache
                .lock()
                .expect("status cache lock should be available");
            let entry = cache
                .get_mut(&target)
                .expect("fresh cache entry should be present");
            entry.checked_at = Instant::now()
                - AppService::RUNTIME_SESSION_STATUS_CACHE_TTL
                - Duration::from_millis(10);
        }

        service.load_cached_runtime_session_status_outcome_for_target(&target)?;
        server_handle
            .join()
            .expect("status server thread should finish");

        assert_eq!(connections.load(Ordering::SeqCst), 2);
        Ok(())
    }

    #[test]
    fn cached_probe_prunes_expired_entries_for_other_targets() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let (port, _connections, server_handle) = spawn_counting_status_server(
            1,
            Duration::ZERO,
            Ok(r#"{"external-build-session":{"type":"busy"}}"#.to_string()),
        )?;
        let live_target = runtime_target(port, "/tmp/repo-live");
        let stale_target = runtime_target(9999, "/tmp/repo-stale");

        {
            let mut cache = service
                .runtime_session_status_cache
                .lock()
                .expect("status cache lock should be available");
            cache.insert(
                stale_target.clone(),
                CachedRuntimeSessionStatusProbe {
                    checked_at: Instant::now()
                        - AppService::RUNTIME_SESSION_STATUS_CACHE_TTL
                        - Duration::from_millis(10),
                    outcome: RuntimeSessionStatusProbeOutcome::Snapshot(
                        RuntimeSessionStatusSnapshot::from_statuses(RuntimeSessionStatusMap::new()),
                    ),
                },
            );
        }

        let statuses = expect_statuses(
            service.load_cached_runtime_session_status_outcome_for_target(&live_target)?,
        );
        server_handle
            .join()
            .expect("status server thread should finish");

        assert!(statuses.statuses().contains_key("external-build-session"));
        assert_eq!(
            statuses.kind(),
            RuntimeSessionStatusSnapshotKind::HasLiveSessions
        );
        let cache = service
            .runtime_session_status_cache
            .lock()
            .expect("status cache lock should be available");
        assert!(!cache.contains_key(&stale_target));
        assert!(cache.contains_key(&live_target));
        Ok(())
    }

    #[test]
    fn concurrent_same_target_requests_share_one_underlying_probe() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let (port, connections, server_handle) = spawn_counting_status_server(
            1,
            Duration::from_millis(200),
            Ok(r#"{"external-build-session":{"type":"busy"}}"#.to_string()),
        )?;
        let target = runtime_target(port, "/tmp/repo");
        let barrier = Arc::new(Barrier::new(3));

        thread::scope(|scope| {
            let mut handles = Vec::new();
            for _ in 0..2 {
                let service = &service;
                let target = target.clone();
                let barrier = Arc::clone(&barrier);
                handles.push(scope.spawn(move || {
                    barrier.wait();
                    service
                        .load_cached_runtime_session_status_outcome_for_target(&target)
                        .expect("concurrent status probe should succeed")
                }));
            }

            barrier.wait();
            for handle in handles {
                let statuses =
                    expect_statuses(handle.join().expect("probe thread should not panic"));
                assert!(statuses.statuses().contains_key("external-build-session"));
                assert_eq!(
                    statuses.kind(),
                    RuntimeSessionStatusSnapshotKind::HasLiveSessions
                );
            }
        });

        server_handle
            .join()
            .expect("status server thread should finish");
        assert_eq!(connections.load(Ordering::SeqCst), 1);
        Ok(())
    }

    #[test]
    fn batch_probe_bounds_wall_clock_for_unique_slow_targets() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let mut targets = Vec::new();
        let mut handles = Vec::new();
        let mut counters = Vec::new();
        for index in 0..6 {
            let (port, connections, server_handle) = spawn_counting_status_server(
                1,
                Duration::from_millis(300),
                Ok(format!(
                    r#"{{"external-build-session-{index}":{{"type":"busy"}}}}"#
                )),
            )?;
            targets.push(runtime_target(port, format!("/tmp/repo-{index}").as_str()));
            counters.push(connections);
            handles.push(server_handle);
        }

        let started_at = Instant::now();
        let statuses = service.load_cached_runtime_session_statuses_for_targets(&targets)?;
        let elapsed = started_at.elapsed();

        for handle in handles {
            handle.join().expect("status server thread should finish");
        }

        assert_eq!(statuses.len(), targets.len());
        assert!(
            elapsed < Duration::from_millis(1200),
            "expected bounded parallel latency, observed {elapsed:?}"
        );
        for counter in counters {
            assert_eq!(counter.load(Ordering::SeqCst), 1);
        }
        Ok(())
    }

    #[test]
    fn actionable_probe_failures_are_cached_inside_ttl() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let (port, connections, server_handle) = spawn_counting_status_server(
            1,
            Duration::ZERO,
            Err((500, "session status failed".to_string())),
        )?;
        let target = runtime_target(port, "/tmp/repo");

        let first_error = expect_actionable_error(
            service.load_cached_runtime_session_status_outcome_for_target(&target)?,
        );
        let second_error = expect_actionable_error(
            service.load_cached_runtime_session_status_outcome_for_target(&target)?,
        );
        server_handle
            .join()
            .expect("status server thread should finish");

        assert!(first_error.to_string().contains("HTTP 500"));
        assert!(second_error.to_string().contains("HTTP 500"));
        assert_eq!(connections.load(Ordering::SeqCst), 1);
        Ok(())
    }

    #[test]
    fn malformed_json_probe_failures_are_cached_inside_ttl() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let (port, connections, server_handle) =
            spawn_counting_status_server(1, Duration::ZERO, Ok("{not-json}".to_string()))?;
        let target = runtime_target(port, "/tmp/repo");

        let first_error = expect_actionable_error(
            service.load_cached_runtime_session_status_outcome_for_target(&target)?,
        );
        let second_error = expect_actionable_error(
            service.load_cached_runtime_session_status_outcome_for_target(&target)?,
        );
        server_handle
            .join()
            .expect("status server thread should finish");

        assert!(first_error
            .to_string()
            .contains("Failed parsing OpenCode session status response"));
        assert!(second_error
            .to_string()
            .contains("Failed parsing OpenCode session status response"));
        assert_eq!(connections.load(Ordering::SeqCst), 1);
        Ok(())
    }

    #[test]
    fn session_status_flight_guard_finishes_waiters_when_dropped_uncompleted() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let target = runtime_target(1234, "/tmp/runtime-flight-guard");
        let (flight, is_leader) = service.acquire_runtime_session_status_flight(&target)?;
        assert!(is_leader);

        {
            let _guard = RuntimeSessionStatusFlightGuard::new(&service, &target, flight.clone());
        }

        let outcome = AppService::wait_for_runtime_session_status_flight(&flight)?;
        let error = expect_actionable_error(outcome);
        assert!(error
            .to_string()
            .contains("Runtime session status probe aborted unexpectedly"));

        Ok(())
    }

    #[test]
    fn complete_runtime_session_status_flight_recovers_poisoned_state_and_removes_entry(
    ) -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let target = runtime_target(1235, "/tmp/runtime-flight-poison");
        let (flight, is_leader) = service.acquire_runtime_session_status_flight(&target)?;
        assert!(is_leader);

        let poison_handle = thread::spawn({
            let flight = flight.clone();
            move || {
                let _lock = flight
                    .state
                    .lock()
                    .expect("flight state should be available for poisoning");
                panic!("poison session status flight state");
            }
        });
        assert!(poison_handle.join().is_err());

        let error = service
            .complete_runtime_session_status_flight(
                &target,
                &flight,
                &RuntimeSessionStatusProbeOutcome::Snapshot(
                    RuntimeSessionStatusSnapshot::from_statuses(RuntimeSessionStatusMap::new()),
                ),
            )
            .expect_err("poisoned completion should surface an error");
        assert!(error
            .to_string()
            .contains("Runtime session status coordination state lock poisoned"));

        let flights = service
            .runtime_session_status_flights
            .lock()
            .expect("status flights lock should remain available");
        assert!(flights.is_empty());

        Ok(())
    }

    fn spawn_counting_status_server(
        expected_connections: usize,
        delay: Duration,
        response: Result<String, (u16, String)>,
    ) -> Result<(u16, Arc<AtomicUsize>, thread::JoinHandle<()>)> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        let connections = Arc::new(AtomicUsize::new(0));
        let connections_for_thread = Arc::clone(&connections);

        let handle = thread::spawn(move || {
            for _ in 0..expected_connections {
                let (mut stream, _) = listener.accept().expect("server should accept request");
                connections_for_thread.fetch_add(1, Ordering::SeqCst);

                let mut request_buffer = [0_u8; 4096];
                let _ = stream.read(&mut request_buffer);
                if !delay.is_zero() {
                    thread::sleep(delay);
                }

                let response = match &response {
                    Ok(body) => format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    ),
                    Err((status, body)) => format!(
                        "HTTP/1.1 {status} Error\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    ),
                };
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });

        Ok((port, connections, handle))
    }
}
