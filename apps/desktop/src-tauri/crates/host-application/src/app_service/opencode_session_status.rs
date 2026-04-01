use super::service_core::{
    AppService, CachedOpencodeSessionStatusProbe, CachedOpencodeSessionStatusProbeOutcome,
    OpencodeSessionStatusFlight, OpencodeSessionStatusFlightState,
    OpencodeSessionStatusProbeLimiter,
};
use anyhow::{Context, Result, anyhow};
use host_domain::RuntimeRoute;
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::ErrorKind;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use url::{Url, form_urlencoded};

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum OpencodeSessionStatus {
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

pub(crate) type OpencodeSessionStatusMap = HashMap<String, OpencodeSessionStatus>;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(crate) struct OpencodeSessionStatusProbeTarget {
    endpoint: String,
    working_directory: String,
}

impl OpencodeSessionStatusProbeTarget {
    pub(crate) fn for_runtime_route(runtime_route: &RuntimeRoute, working_directory: &str) -> Self {
        let endpoint = match runtime_route {
            RuntimeRoute::LocalHttp { endpoint } => endpoint.clone(),
        };
        Self {
            endpoint,
            working_directory: working_directory.trim().to_string(),
        }
    }

    fn endpoint(&self) -> &str {
        self.endpoint.as_str()
    }

    fn working_directory(&self) -> &str {
        self.working_directory.as_str()
    }
}

struct OpencodeSessionStatusFlightGuard<'a> {
    service: &'a AppService,
    target: OpencodeSessionStatusProbeTarget,
    flight: Arc<OpencodeSessionStatusFlight>,
    completed: bool,
}

impl<'a> OpencodeSessionStatusFlightGuard<'a> {
    fn new(
        service: &'a AppService,
        target: &OpencodeSessionStatusProbeTarget,
        flight: Arc<OpencodeSessionStatusFlight>,
    ) -> Self {
        Self {
            service,
            target: target.clone(),
            flight,
            completed: false,
        }
    }

    fn complete(&mut self, outcome: &CachedOpencodeSessionStatusProbeOutcome) -> Result<()> {
        self.completed = true;
        self.service
            .complete_opencode_session_status_flight(&self.target, &self.flight, outcome)
    }
}

impl Drop for OpencodeSessionStatusFlightGuard<'_> {
    fn drop(&mut self) {
        if self.completed {
            return;
        }

        let aborted = CachedOpencodeSessionStatusProbeOutcome::ActionableError(
            "OpenCode session status probe aborted unexpectedly".to_string(),
        );
        if let Err(error) = self.service.complete_opencode_session_status_flight(
            &self.target,
            &self.flight,
            &aborted,
        ) {
            eprintln!(
                "OpenDucktor warning: failed completing OpenCode session status flight after abort: {error:#}"
            );
        }
    }
}

struct OpencodeSessionStatusProbePermit {
    limiter: Arc<OpencodeSessionStatusProbeLimiter>,
}

impl Drop for OpencodeSessionStatusProbePermit {
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
                    "OpenDucktor warning: OpenCode session status probe limiter lock poisoned during permit release"
                );
            }
        }
    }
}

impl CachedOpencodeSessionStatusProbeOutcome {
    fn into_result(&self) -> Result<OpencodeSessionStatusMap> {
        match self {
            Self::Statuses(statuses) => Ok(statuses.clone()),
            Self::ActionableError(message) => Err(anyhow!(message.clone())),
        }
    }
}

pub(crate) fn is_unreachable_opencode_session_status_error(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        cause
            .downcast_ref::<std::io::Error>()
            .is_some_and(|io_error| {
                matches!(
                    io_error.kind(),
                    ErrorKind::ConnectionRefused
                        | ErrorKind::ConnectionReset
                        | ErrorKind::ConnectionAborted
                        | ErrorKind::NotConnected
                        | ErrorKind::TimedOut
                        | ErrorKind::UnexpectedEof
                )
            })
    })
}

pub(crate) fn has_live_opencode_session_status(
    statuses: &OpencodeSessionStatusMap,
    external_session_id: &str,
) -> bool {
    matches!(
        statuses.get(external_session_id),
        Some(OpencodeSessionStatus::Busy | OpencodeSessionStatus::Retry { .. })
    )
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn load_opencode_session_statuses(
    runtime_route: &RuntimeRoute,
    working_directory: &str,
) -> Result<OpencodeSessionStatusMap> {
    let target =
        OpencodeSessionStatusProbeTarget::for_runtime_route(runtime_route, working_directory);
    load_opencode_session_statuses_for_target(&target)
}

fn load_opencode_session_statuses_for_target(
    target: &OpencodeSessionStatusProbeTarget,
) -> Result<OpencodeSessionStatusMap> {
    let endpoint = target.endpoint();
    let working_directory = target.working_directory();
    let parsed_endpoint = Url::parse(endpoint)
        .with_context(|| format!("Invalid OpenCode runtime endpoint: {endpoint}"))?;
    let host = parsed_endpoint
        .host_str()
        .ok_or_else(|| anyhow!("OpenCode runtime endpoint is missing a host: {endpoint}"))?;
    let port = parsed_endpoint
        .port()
        .ok_or_else(|| anyhow!("OpenCode runtime route must expose a port: {endpoint}"))?;
    let request_path = format!(
        "/session/status?{}",
        form_urlencoded::Serializer::new(String::new())
            .append_pair("directory", working_directory)
            .finish()
    );
    let mut stream = TcpStream::connect((host, port)).with_context(|| {
        format!(
            "Failed to connect to OpenCode runtime at {endpoint} to inspect session status for {working_directory}"
        )
    })?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .context("Failed configuring OpenCode session status read timeout")?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .context("Failed configuring OpenCode session status write timeout")?;

    let request =
        format!("GET {request_path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).with_context(|| {
        format!("Failed sending OpenCode session status request for {working_directory}")
    })?;
    stream.flush().with_context(|| {
        format!("Failed flushing OpenCode session status request for {working_directory}")
    })?;

    let mut reader = BufReader::new(stream);
    let mut status_line = String::new();
    reader.read_line(&mut status_line).with_context(|| {
        format!("Failed reading OpenCode session status response for {working_directory}")
    })?;
    let status_code = parse_http_status_code(status_line.as_str())?;

    let mut response = String::new();
    reader.read_to_string(&mut response).with_context(|| {
        format!("Failed reading OpenCode session status body for {working_directory}")
    })?;

    if !(200..300).contains(&status_code) {
        let response_body = extract_http_response_body(response.as_str());
        let detail_suffix = if response_body.is_empty() {
            String::new()
        } else {
            format!(": {response_body}")
        };
        return Err(anyhow!(
            "OpenCode runtime failed to load session status for {working_directory}: HTTP {status_code}{detail_suffix}"
        ));
    }

    let body = extract_http_response_body(response.as_str());
    serde_json::from_str::<OpencodeSessionStatusMap>(body.as_str()).with_context(|| {
        format!("Failed parsing OpenCode session status response for {working_directory}")
    })
}

fn parse_http_status_code(status_line: &str) -> Result<u16> {
    let trimmed = status_line.trim();
    let status_code = trimmed
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| anyhow!("OpenCode response missing HTTP status code"))?;
    status_code
        .parse::<u16>()
        .with_context(|| format!("Invalid OpenCode HTTP status code: {status_code}"))
}

fn extract_http_response_body(response: &str) -> String {
    response
        .split_once("\r\n\r\n")
        .or_else(|| response.split_once("\n\n"))
        .map(|(_, body)| body.trim().to_string())
        .unwrap_or_default()
}

impl AppService {
    pub(super) const OPENCODE_SESSION_STATUS_CACHE_TTL: Duration = Duration::from_secs(1);

    pub(super) fn load_cached_opencode_session_statuses_for_targets(
        &self,
        targets: &[OpencodeSessionStatusProbeTarget],
    ) -> Result<HashMap<OpencodeSessionStatusProbeTarget, OpencodeSessionStatusMap>> {
        let mut unique_targets = Vec::new();
        let mut seen = HashSet::new();
        for target in targets {
            if seen.insert(target.clone()) {
                unique_targets.push(target.clone());
            }
        }

        if unique_targets.is_empty() {
            return Ok(HashMap::new());
        }

        let worker_count = unique_targets.len().min(
            self.opencode_session_status_probe_limiter
                .max_concurrent
                .max(1),
        );
        let queue = Arc::new(Mutex::new(VecDeque::from(unique_targets)));
        let results = Arc::new(Mutex::new(HashMap::new()));

        thread::scope(|scope| -> Result<()> {
            let mut handles = Vec::new();
            for _ in 0..worker_count {
                let service = self;
                let queue = Arc::clone(&queue);
                let results = Arc::clone(&results);
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

                        let statuses =
                            service.load_cached_opencode_session_statuses_for_target(&target)?;
                        let mut results = results.lock().map_err(|_| {
                            anyhow!("OpenCode session status batch results lock poisoned")
                        })?;
                        results.insert(target, statuses);
                    }
                }));
            }

            for handle in handles {
                handle
                    .join()
                    .map_err(|_| anyhow!("OpenCode session status batch worker panicked"))??;
            }
            Ok(())
        })?;

        let results = results
            .lock()
            .map_err(|_| anyhow!("OpenCode session status batch results lock poisoned"))?;
        Ok(results.clone())
    }

    fn load_cached_opencode_session_statuses_for_target(
        &self,
        target: &OpencodeSessionStatusProbeTarget,
    ) -> Result<OpencodeSessionStatusMap> {
        if let Some(cached) = self.cached_opencode_session_status_outcome(target)? {
            return cached.into_result();
        }

        let (flight, is_leader) = self.acquire_opencode_session_status_flight(target)?;
        if !is_leader {
            let awaited = Self::wait_for_opencode_session_status_flight(&flight)?;
            return awaited.into_result();
        }

        let mut flight_guard = OpencodeSessionStatusFlightGuard::new(self, target, flight);
        let _permit = self.acquire_opencode_session_status_probe_permit()?;
        let outcome = Self::probe_uncached_opencode_session_status_target(target);
        self.update_opencode_session_status_cache(target, &outcome)?;
        flight_guard.complete(&outcome)?;
        outcome.into_result()
    }

    fn probe_uncached_opencode_session_status_target(
        target: &OpencodeSessionStatusProbeTarget,
    ) -> CachedOpencodeSessionStatusProbeOutcome {
        match load_opencode_session_statuses_for_target(target) {
            Ok(statuses) => CachedOpencodeSessionStatusProbeOutcome::Statuses(statuses),
            Err(error) if is_unreachable_opencode_session_status_error(&error) => {
                CachedOpencodeSessionStatusProbeOutcome::Statuses(OpencodeSessionStatusMap::new())
            }
            Err(error) => {
                CachedOpencodeSessionStatusProbeOutcome::ActionableError(error.to_string())
            }
        }
    }

    fn cached_opencode_session_status_outcome(
        &self,
        target: &OpencodeSessionStatusProbeTarget,
    ) -> Result<Option<CachedOpencodeSessionStatusProbeOutcome>> {
        let mut cache = self
            .opencode_session_status_cache
            .lock()
            .map_err(|_| anyhow!("OpenCode session status cache lock poisoned"))?;
        if let Some(entry) = cache.get(target) {
            if entry.checked_at.elapsed() <= Self::OPENCODE_SESSION_STATUS_CACHE_TTL {
                return Ok(Some(entry.outcome.clone()));
            }
        }

        cache.remove(target);
        Ok(None)
    }

    fn update_opencode_session_status_cache(
        &self,
        target: &OpencodeSessionStatusProbeTarget,
        outcome: &CachedOpencodeSessionStatusProbeOutcome,
    ) -> Result<()> {
        let mut cache = self
            .opencode_session_status_cache
            .lock()
            .map_err(|_| anyhow!("OpenCode session status cache lock poisoned"))?;
        cache.insert(
            target.clone(),
            CachedOpencodeSessionStatusProbe {
                checked_at: Instant::now(),
                outcome: outcome.clone(),
            },
        );
        Ok(())
    }

    fn acquire_opencode_session_status_flight(
        &self,
        target: &OpencodeSessionStatusProbeTarget,
    ) -> Result<(Arc<OpencodeSessionStatusFlight>, bool)> {
        let mut flights = self
            .opencode_session_status_flights
            .lock()
            .map_err(|_| anyhow!("OpenCode session status coordination state lock poisoned"))?;
        if let Some(existing) = flights.get(target) {
            return Ok((existing.clone(), false));
        }

        let flight = Arc::new(OpencodeSessionStatusFlight::new());
        flights.insert(target.clone(), flight.clone());
        Ok((flight, true))
    }

    fn complete_opencode_session_status_flight(
        &self,
        target: &OpencodeSessionStatusProbeTarget,
        flight: &Arc<OpencodeSessionStatusFlight>,
        outcome: &CachedOpencodeSessionStatusProbeOutcome,
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
            *state = OpencodeSessionStatusFlightState::Finished(outcome.clone());
            flight.condvar.notify_all();
        }

        {
            let mut flights = match self.opencode_session_status_flights.lock() {
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
                "OpenCode session status coordination state lock poisoned"
            ));
        }

        Ok(())
    }

    fn wait_for_opencode_session_status_flight(
        flight: &Arc<OpencodeSessionStatusFlight>,
    ) -> Result<CachedOpencodeSessionStatusProbeOutcome> {
        let mut state = flight
            .state
            .lock()
            .map_err(|_| anyhow!("OpenCode session status coordination state lock poisoned"))?;
        loop {
            match &*state {
                OpencodeSessionStatusFlightState::Finished(outcome) => {
                    return Ok(outcome.clone());
                }
                OpencodeSessionStatusFlightState::Loading => {
                    state = flight.condvar.wait(state).map_err(|_| {
                        anyhow!("OpenCode session status coordination state lock poisoned")
                    })?;
                }
            }
        }
    }

    fn acquire_opencode_session_status_probe_permit(
        &self,
    ) -> Result<OpencodeSessionStatusProbePermit> {
        let limiter = Arc::clone(&self.opencode_session_status_probe_limiter);
        let mut active = limiter
            .active
            .lock()
            .map_err(|_| anyhow!("OpenCode session status probe limiter lock poisoned"))?;
        while *active >= limiter.max_concurrent {
            active = limiter
                .condvar
                .wait(active)
                .map_err(|_| anyhow!("OpenCode session status probe limiter lock poisoned"))?;
        }
        *active += 1;
        drop(active);
        Ok(OpencodeSessionStatusProbePermit { limiter })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AppService, CachedOpencodeSessionStatusProbeOutcome, OpencodeSessionStatus,
        OpencodeSessionStatusFlightGuard, OpencodeSessionStatusMap,
        OpencodeSessionStatusProbeTarget, has_live_opencode_session_status,
        load_opencode_session_statuses,
    };
    use crate::app_service::test_support::build_service_with_state;
    use anyhow::Result;
    use host_domain::AgentRuntimeKind;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};

    #[test]
    fn load_opencode_session_statuses_sends_directory_query_and_parses_response() {
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

        let runtime_route = AgentRuntimeKind::Opencode.route_for_port(port);

        let statuses = load_opencode_session_statuses(&runtime_route, "/tmp/repo path")
            .expect("status request should succeed");
        assert!(matches!(
            statuses.get("external-session"),
            Some(OpencodeSessionStatus::Busy)
        ));
        assert!(has_live_opencode_session_status(
            &statuses,
            "external-session"
        ));

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
    fn cached_probe_reuses_fresh_statuses_without_reconnecting() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let (port, connections, server_handle) = spawn_counting_status_server(
            1,
            Duration::ZERO,
            Ok(r#"{"external-build-session":{"type":"busy"}}"#.to_string()),
        )?;
        let target = OpencodeSessionStatusProbeTarget::for_runtime_route(
            &AgentRuntimeKind::Opencode.route_for_port(port),
            "/tmp/repo",
        );

        let first = service.load_cached_opencode_session_statuses_for_target(&target)?;
        let second = service.load_cached_opencode_session_statuses_for_target(&target)?;
        server_handle
            .join()
            .expect("status server thread should finish");

        assert!(first.contains_key("external-build-session"));
        assert!(second.contains_key("external-build-session"));
        assert_eq!(connections.load(Ordering::SeqCst), 1);
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
        let target = OpencodeSessionStatusProbeTarget::for_runtime_route(
            &AgentRuntimeKind::Opencode.route_for_port(port),
            "/tmp/repo",
        );

        service.load_cached_opencode_session_statuses_for_target(&target)?;
        {
            let mut cache = service
                .opencode_session_status_cache
                .lock()
                .expect("status cache lock should be available");
            let entry = cache
                .get_mut(&target)
                .expect("fresh cache entry should be present");
            entry.checked_at = Instant::now()
                - AppService::OPENCODE_SESSION_STATUS_CACHE_TTL
                - Duration::from_millis(10);
        }

        service.load_cached_opencode_session_statuses_for_target(&target)?;
        server_handle
            .join()
            .expect("status server thread should finish");

        assert_eq!(connections.load(Ordering::SeqCst), 2);
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
        let target = OpencodeSessionStatusProbeTarget::for_runtime_route(
            &AgentRuntimeKind::Opencode.route_for_port(port),
            "/tmp/repo",
        );
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
                        .load_cached_opencode_session_statuses_for_target(&target)
                        .expect("concurrent status probe should succeed")
                }));
            }

            barrier.wait();
            for handle in handles {
                let statuses = handle.join().expect("probe thread should not panic");
                assert!(statuses.contains_key("external-build-session"));
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
            targets.push(OpencodeSessionStatusProbeTarget::for_runtime_route(
                &AgentRuntimeKind::Opencode.route_for_port(port),
                format!("/tmp/repo-{index}").as_str(),
            ));
            counters.push(connections);
            handles.push(server_handle);
        }

        let started_at = Instant::now();
        let statuses = service.load_cached_opencode_session_statuses_for_targets(&targets)?;
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
        let target = OpencodeSessionStatusProbeTarget::for_runtime_route(
            &AgentRuntimeKind::Opencode.route_for_port(port),
            "/tmp/repo",
        );

        let first_error = service
            .load_cached_opencode_session_statuses_for_target(&target)
            .expect_err("HTTP failures should remain actionable");
        let second_error = service
            .load_cached_opencode_session_statuses_for_target(&target)
            .expect_err("cached HTTP failures should remain actionable");
        server_handle
            .join()
            .expect("status server thread should finish");

        assert!(first_error.to_string().contains("HTTP 500"));
        assert!(second_error.to_string().contains("HTTP 500"));
        assert_eq!(connections.load(Ordering::SeqCst), 1);
        Ok(())
    }

    #[test]
    fn session_status_flight_guard_finishes_waiters_when_dropped_uncompleted() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let target = OpencodeSessionStatusProbeTarget::for_runtime_route(
            &AgentRuntimeKind::Opencode.route_for_port(1234),
            "/tmp/runtime-flight-guard",
        );
        let (flight, is_leader) = service.acquire_opencode_session_status_flight(&target)?;
        assert!(is_leader);

        {
            let _guard = OpencodeSessionStatusFlightGuard::new(&service, &target, flight.clone());
        }

        let outcome = AppService::wait_for_opencode_session_status_flight(&flight)?;
        let error = outcome
            .into_result()
            .expect_err("dropped leader should finish waiters with an error");
        assert!(
            error
                .to_string()
                .contains("OpenCode session status probe aborted unexpectedly")
        );

        Ok(())
    }

    #[test]
    fn complete_opencode_session_status_flight_recovers_poisoned_state_and_removes_entry()
    -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let target = OpencodeSessionStatusProbeTarget::for_runtime_route(
            &AgentRuntimeKind::Opencode.route_for_port(1235),
            "/tmp/runtime-flight-poison",
        );
        let (flight, is_leader) = service.acquire_opencode_session_status_flight(&target)?;
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
            .complete_opencode_session_status_flight(
                &target,
                &flight,
                &CachedOpencodeSessionStatusProbeOutcome::Statuses(OpencodeSessionStatusMap::new()),
            )
            .expect_err("poisoned completion should surface an error");
        assert!(
            error
                .to_string()
                .contains("OpenCode session status coordination state lock poisoned")
        );

        let flights = service
            .opencode_session_status_flights
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
