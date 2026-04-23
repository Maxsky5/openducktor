use super::health_http::{
    RuntimeHealthCheckFailure, RuntimeHealthHttpClient, RuntimeMcpServerStatus,
};
use super::{AppRuntime, HostManagedRuntimeStart};
use crate::app_service::opencode_runtime::{
    opencode_process_registry_path, reconcile_opencode_process_registry_on_startup,
    OpenCodeProcessTracker,
};
use crate::app_service::{
    read_opencode_version, require_local_http_endpoint, require_local_http_port,
    resolve_opencode_binary_path, wait_for_runtime_with_process, AppService, RuntimeProcessGuard,
    RuntimeRoute, RuntimeSessionStatusMap, RuntimeSessionStatusProbeError,
    RuntimeSessionStatusProbeOutcome, RuntimeSessionStatusProbeTarget,
    RuntimeSessionStatusProbeTargetResolution, RuntimeSessionStatusSnapshot,
    RuntimeStartupReadinessPolicy, StartupEventContext, StartupEventCorrelation,
    StartupEventPayload,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{
    AgentRuntimeKind, RuntimeDefinition, RuntimeHealth, RuntimeInstanceSummary,
    RuntimeStartupReadinessConfig,
};
use host_infra_system::pick_free_port;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::Duration;
use url::form_urlencoded;

#[derive(Default)]
pub(crate) struct OpenCodeRuntime {
    process_tracker: OpenCodeProcessTracker,
}

struct OpenCodeAbortResponseHeaders {
    lines: Vec<String>,
}

impl OpenCodeAbortResponseHeaders {
    fn read_from<R: BufRead>(reader: &mut R, external_session_id: &str) -> Result<Self> {
        let mut lines = Vec::new();
        let mut line = String::new();
        loop {
            line.clear();
            let bytes_read = reader.read_line(&mut line).with_context(|| {
                format!(
                    "Failed reading OpenCode abort response headers for session {external_session_id}"
                )
            })?;
            if bytes_read == 0 || line == "\r\n" || line == "\n" {
                break;
            }
            lines.push(line.trim_end().to_string());
        }

        Ok(Self { lines })
    }

    fn value(&self, name: &str) -> Option<&str> {
        self.lines.iter().find_map(|line| {
            let (header_name, value) = line.split_once(':')?;
            if header_name.trim().eq_ignore_ascii_case(name) {
                Some(value.trim())
            } else {
                None
            }
        })
    }

    fn transfer_encoding_is_chunked(&self) -> bool {
        self.value("Transfer-Encoding").is_some_and(|value| {
            value
                .split(',')
                .any(|encoding| encoding.trim().eq_ignore_ascii_case("chunked"))
        })
    }

    fn content_length(&self, external_session_id: &str) -> Result<Option<usize>> {
        let Some(value) = self.value("Content-Length") else {
            return Ok(None);
        };
        value.parse::<usize>().map(Some).with_context(|| {
            format!(
                "Invalid OpenCode abort response Content-Length for session {external_session_id}: {value}"
            )
        })
    }
}

impl OpenCodeRuntime {
    fn local_http_route_for_port(port: u16) -> RuntimeRoute {
        RuntimeRoute::LocalHttp {
            endpoint: format!("http://127.0.0.1:{port}"),
        }
    }

    fn load_session_statuses(
        runtime_route: &RuntimeRoute,
        working_directory: &str,
    ) -> Result<RuntimeSessionStatusMap> {
        let endpoint = require_local_http_endpoint(runtime_route, "session status probes")?;
        let parsed_endpoint = url::Url::parse(endpoint)
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
        let socket_address = (host, port)
            .to_socket_addrs()
            .with_context(|| format!("Failed resolving OpenCode runtime endpoint: {endpoint}"))?
            .next()
            .ok_or_else(|| anyhow!("OpenCode runtime endpoint did not resolve: {endpoint}"))?;
        let socket_address = Self::require_loopback_socket_address(socket_address, endpoint)?;
        let mut stream = TcpStream::connect_timeout(&socket_address, Duration::from_secs(2)).with_context(|| {
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

        let request = format!(
            "GET {request_path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n"
        );
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
        let status_code = Self::parse_http_status_code(status_line.as_str())?;

        let mut response = String::new();
        reader.read_to_string(&mut response).with_context(|| {
            format!("Failed reading OpenCode session status body for {working_directory}")
        })?;

        if !(200..300).contains(&status_code) {
            let response_body =
                Self::extract_http_response_body(response.as_str()).with_context(|| {
                    format!(
                    "Failed decoding OpenCode session status response body for {working_directory}"
                )
                })?;
            let detail_suffix = if response_body.is_empty() {
                String::new()
            } else {
                format!(": {response_body}")
            };
            return Err(anyhow!(
                "OpenCode runtime failed to load session status for {working_directory}: HTTP {status_code}{detail_suffix}"
            ));
        }

        let body = Self::extract_http_response_body(response.as_str()).with_context(|| {
            format!("Failed decoding OpenCode session status response body for {working_directory}")
        })?;
        serde_json::from_str::<RuntimeSessionStatusMap>(body.as_str()).with_context(|| {
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

    fn require_loopback_socket_address(
        socket_address: SocketAddr,
        endpoint: &str,
    ) -> Result<SocketAddr> {
        if socket_address.ip().is_loopback() {
            return Ok(socket_address);
        }

        Err(anyhow!(
            "OpenCode runtime endpoint for session status probes must resolve to a loopback address: {endpoint}"
        ))
    }

    fn extract_http_response_body(response: &str) -> Result<String> {
        let (headers, body) = response
            .split_once("\r\n\r\n")
            .or_else(|| response.split_once("\n\n"))
            .unwrap_or(("", response));

        if headers
            .lines()
            .any(|line| line.eq_ignore_ascii_case("Transfer-Encoding: chunked"))
        {
            return Self::decode_chunked_http_body(body);
        }

        Ok(body.trim().to_string())
    }

    fn decode_chunked_http_body(body: &str) -> Result<String> {
        let mut remaining = body;
        let mut decoded = String::new();

        loop {
            let Some((size_line, rest)) = remaining.split_once("\r\n") else {
                return Err(anyhow!(
                    "Chunked OpenCode response is missing a chunk size delimiter"
                ));
            };
            let size_text = size_line
                .split_once(';')
                .map_or(size_line, |(size, _)| size)
                .trim();
            let size = usize::from_str_radix(size_text, 16)
                .with_context(|| format!("Invalid chunk size in OpenCode response: {size_text}"))?;
            if size == 0 {
                return Ok(decoded.trim().to_string());
            }
            if rest.len() < size + 2 {
                return Err(anyhow!(
                    "Chunked OpenCode response ended before the declared chunk size"
                ));
            }

            decoded.push_str(&rest[..size]);
            let chunk_suffix = &rest[size..size + 2];
            if chunk_suffix != "\r\n" {
                return Err(anyhow!(
                    "Chunked OpenCode response is missing a chunk terminator"
                ));
            }

            remaining = &rest[size + 2..];
        }
    }

    fn read_chunked_http_response_body<R: BufRead>(
        reader: &mut R,
        external_session_id: &str,
    ) -> Result<String> {
        let mut decoded = Vec::new();

        loop {
            let mut size_line = String::new();
            let bytes_read = reader.read_line(&mut size_line).with_context(|| {
                format!(
                    "Failed reading OpenCode abort chunk size for session {external_session_id}"
                )
            })?;
            if bytes_read == 0 {
                return Err(anyhow!(
                    "Chunked OpenCode abort response ended before a terminal chunk for session {external_session_id}"
                ));
            }

            let size_text = size_line
                .split_once(';')
                .map_or(size_line.as_str(), |(size, _)| size)
                .trim();
            let size = usize::from_str_radix(size_text, 16).with_context(|| {
                format!(
                    "Invalid OpenCode abort response chunk size for session {external_session_id}: {size_text}"
                )
            })?;
            if size == 0 {
                return String::from_utf8(decoded)
                    .map(|body| body.trim().to_string())
                    .with_context(|| {
                        format!(
                            "OpenCode abort response body for session {external_session_id} is not UTF-8"
                        )
                    });
            }

            let start = decoded.len();
            decoded.resize(start + size, 0);
            reader
                .read_exact(&mut decoded[start..])
                .with_context(|| {
                    format!(
                        "Failed reading OpenCode abort response chunk body for session {external_session_id}"
                    )
                })?;
            let mut terminator = [0_u8; 2];
            reader.read_exact(&mut terminator).with_context(|| {
                format!(
                    "Failed reading OpenCode abort response chunk terminator for session {external_session_id}"
                )
            })?;
            if terminator != *b"\r\n" {
                return Err(anyhow!(
                    "OpenCode abort response chunk terminator is malformed for session {external_session_id}"
                ));
            }
        }
    }

    fn read_http_response_body<R: BufRead + Read>(
        reader: &mut R,
        headers: &OpenCodeAbortResponseHeaders,
        external_session_id: &str,
    ) -> Result<String> {
        if headers.transfer_encoding_is_chunked() {
            return Self::read_chunked_http_response_body(reader, external_session_id);
        }

        if let Some(content_length) = headers.content_length(external_session_id)? {
            let mut body = vec![0_u8; content_length];
            reader.read_exact(&mut body).with_context(|| {
                format!(
                    "Failed reading OpenCode abort response body for session {external_session_id}"
                )
            })?;
            return String::from_utf8(body)
                .map(|body| body.trim().to_string())
                .with_context(|| {
                    format!(
                        "OpenCode abort response body for session {external_session_id} is not UTF-8"
                    )
                });
        }

        Err(anyhow!(
            "Malformed OpenCode abort error response for session {external_session_id}: missing Content-Length or Transfer-Encoding header"
        ))
    }

    fn startup_config(service: &AppService) -> Result<RuntimeStartupReadinessConfig> {
        let config = service.runtime_config_store.load().with_context(|| {
            format!(
                "Failed loading OpenCode startup readiness config from {}. Fix invalid JSON in this file or delete it so OpenDucktor can recreate defaults.",
                service.runtime_config_store.path().display()
            )
        })?;
        config.runtimes.get("opencode").cloned().ok_or_else(|| {
            anyhow!("Runtime config is missing startup readiness settings for opencode")
        })
    }

    fn abort_session(
        runtime_route: &RuntimeRoute,
        external_session_id: &str,
        working_directory: &str,
    ) -> Result<()> {
        let port = require_local_http_port(runtime_route, "build session abort")?;
        let request_path = format!(
            "/session/{external_session_id}/abort?{}",
            form_urlencoded::Serializer::new(String::new())
                .append_pair("directory", working_directory)
                .finish()
        );

        let mut stream = TcpStream::connect(("127.0.0.1", port)).with_context(|| {
            format!(
                "Failed to connect to OpenCode runtime on port {port} to abort session {external_session_id}"
            )
        })?;
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .context("Failed configuring OpenCode abort read timeout")?;
        stream
            .set_write_timeout(Some(Duration::from_secs(2)))
            .context("Failed configuring OpenCode abort write timeout")?;

        let request = format!(
            "POST {request_path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
        );
        stream.write_all(request.as_bytes()).with_context(|| {
            format!("Failed sending OpenCode abort request for session {external_session_id}")
        })?;
        stream.flush().with_context(|| {
            format!("Failed flushing OpenCode abort request for session {external_session_id}")
        })?;

        let mut status_line = String::new();
        let mut reader = BufReader::new(stream);
        reader.read_line(&mut status_line).with_context(|| {
            format!("Failed reading OpenCode abort response for session {external_session_id}")
        })?;
        let status_code = status_line
            .split_whitespace()
            .nth(1)
            .ok_or_else(|| {
                anyhow!("Malformed OpenCode abort response for session {external_session_id}")
            })?
            .parse::<u16>()
            .with_context(|| {
                format!("Malformed OpenCode abort status code for session {external_session_id}")
            })?;

        let response_headers =
            OpenCodeAbortResponseHeaders::read_from(&mut reader, external_session_id)?;
        if !(200..300).contains(&status_code) {
            let response_body =
                Self::read_http_response_body(&mut reader, &response_headers, external_session_id)?;
            let detail = response_body.trim();
            if detail.is_empty() {
                return Err(anyhow!(
                    "OpenCode runtime rejected abort for session {external_session_id} with status {status_code}"
                ));
            }
            return Err(anyhow!(
                "OpenCode runtime rejected abort for session {external_session_id} with status {status_code}: {detail}"
            ));
        }

        Ok(())
    }

    fn health_client(
        runtime: &RuntimeInstanceSummary,
    ) -> std::result::Result<RuntimeHealthHttpClient<'_>, RuntimeHealthCheckFailure> {
        let endpoint =
            require_local_http_endpoint(&runtime.runtime_route, "runtime MCP health checks")
                .map_err(|error| RuntimeHealthCheckFailure::error(error.to_string()))?;
        Ok(RuntimeHealthHttpClient::new(endpoint))
    }

    pub(crate) fn track_pending_process(
        &self,
        service: &AppService,
        child_id: u32,
    ) -> Result<RuntimeProcessGuard> {
        self.process_tracker.track_process(
            opencode_process_registry_path(&service.config_store).as_path(),
            service.instance_pid,
            child_id,
        )
    }
}

impl AppRuntime for OpenCodeRuntime {
    fn definition(&self) -> RuntimeDefinition {
        host_domain::builtin_runtime_registry()
            .definition_by_str("opencode")
            .expect("builtin runtime registry should include opencode")
            .clone()
    }

    fn startup_policy(&self, service: &AppService) -> Result<RuntimeStartupReadinessPolicy> {
        Ok(RuntimeStartupReadinessPolicy::from_config(
            Self::startup_config(service)?,
        ))
    }

    fn start_host_managed(
        &self,
        service: &AppService,
        input: &crate::app_service::runtime_orchestrator::RuntimeStartInput<'_>,
        runtime_id: &str,
        startup_policy: RuntimeStartupReadinessPolicy,
    ) -> Result<HostManagedRuntimeStart> {
        let port = pick_free_port()?;
        let runtime_route = Self::local_http_route_for_port(port);
        let mut child = service.spawn_opencode_server(
            std::path::Path::new(input.working_directory.as_str()),
            input.workspace_id_for_mcp,
            port,
        )?;
        let runtime_process_guard = match self.track_pending_process(service, child.id()) {
            Ok(guard) => guard,
            Err(error) => {
                let tracking_error =
                    error.context("Failed tracking spawned OpenCode runtime process");
                if let Err(cleanup_error) = AppService::cleanup_failed_host_managed_start(
                    Some(&mut child),
                    input.cleanup_target.as_ref(),
                ) {
                    return Err(AppService::append_runtime_cleanup_error(
                        tracking_error,
                        cleanup_error,
                    ));
                }
                return Err(tracking_error);
            }
        };

        let startup_cancel_epoch = service.startup_cancel_epoch();
        let startup_cancel_snapshot = service.startup_cancel_snapshot();
        service.emit_opencode_startup_event(StartupEventPayload::wait_begin(
            StartupEventContext::new(
                input.startup_scope,
                input.repo_path,
                Some(input.task_id),
                input.role.as_str(),
                Some(port),
                Some(StartupEventCorrelation::new("runtime_id", runtime_id)),
                Some(startup_policy),
            ),
        ));

        match wait_for_runtime_with_process(
            &mut child,
            port,
            startup_policy,
            &startup_cancel_epoch,
            startup_cancel_snapshot,
            |progress| {
                let _ = service.mark_runtime_startup_waiting(
                    &input.runtime_kind,
                    input.repo_key.as_str(),
                    &crate::app_service::runtime_orchestrator::RuntimeStartupProgress {
                        started_at_instant: input.startup_started_at_instant,
                        started_at: input.startup_started_at.clone(),
                        attempts: Some(progress.report.attempts()),
                        elapsed_ms: None,
                    },
                );
            },
        ) {
            Ok(report) => {
                service.emit_opencode_startup_event(StartupEventPayload::ready(
                    StartupEventContext::new(
                        input.startup_scope,
                        input.repo_path,
                        Some(input.task_id),
                        input.role.as_str(),
                        Some(port),
                        Some(StartupEventCorrelation::new("runtime_id", runtime_id)),
                        Some(startup_policy),
                    ),
                    report,
                ));
                Ok(HostManagedRuntimeStart {
                    child,
                    runtime_process_guard,
                    runtime_route,
                    startup_report: report,
                })
            }
            Err(error) => {
                service.emit_opencode_startup_event(StartupEventPayload::failed(
                    StartupEventContext::new(
                        input.startup_scope,
                        input.repo_path,
                        Some(input.task_id),
                        input.role.as_str(),
                        Some(port),
                        Some(StartupEventCorrelation::new("runtime_id", runtime_id)),
                        Some(startup_policy),
                    ),
                    error.report(),
                    error.reason(),
                ));
                let startup_error = anyhow::Error::new(error);
                if let Err(cleanup_error) = AppService::cleanup_failed_host_managed_start(
                    Some(&mut child),
                    input.cleanup_target.as_ref(),
                ) {
                    return Err(AppService::append_runtime_cleanup_error(
                        startup_error,
                        cleanup_error,
                    ));
                }
                Err(startup_error)
            }
        }
    }

    fn runtime_health(&self) -> RuntimeHealth {
        let opencode_binary = resolve_opencode_binary_path();
        let opencode_ok = opencode_binary.is_some();
        RuntimeHealth {
            kind: "opencode".to_string(),
            ok: opencode_ok,
            version: opencode_binary.as_ref().map(|binary| {
                if let Some(version) = read_opencode_version(binary.as_str()) {
                    format!("{version} ({binary})")
                } else {
                    format!("installed ({binary})")
                }
            }),
            error: (!opencode_ok).then(|| {
                "opencode not found in bundled locations, standard install locations, PATH, or ~/.opencode/bin"
                    .to_string()
            }),
        }
    }

    fn reconcile_on_startup(&self, service: &AppService) -> Result<()> {
        reconcile_opencode_process_registry_on_startup(
            opencode_process_registry_path(&service.config_store).as_path(),
            service.instance_pid,
        )
    }

    fn terminate_tracked_processes(&self, service: &AppService) -> Result<()> {
        self.process_tracker.terminate_tracked_processes(
            opencode_process_registry_path(&service.config_store).as_path(),
            service.instance_pid,
        )
    }

    fn should_restart_for_mcp_status_error(&self, message: &str) -> bool {
        let normalized = message.to_ascii_lowercase();
        [
            "configinvaliderror",
            "opencode_config_content",
            "loglevel",
            "invalid option",
        ]
        .iter()
        .any(|needle| normalized.contains(needle))
    }

    fn load_mcp_status(
        &self,
        runtime: &RuntimeInstanceSummary,
    ) -> std::result::Result<HashMap<String, RuntimeMcpServerStatus>, RuntimeHealthCheckFailure>
    {
        Self::health_client(runtime)?.load_mcp_status(runtime.working_directory.as_str())
    }

    fn connect_mcp_server(
        &self,
        runtime: &RuntimeInstanceSummary,
        name: &str,
    ) -> std::result::Result<(), RuntimeHealthCheckFailure> {
        Self::health_client(runtime)?.connect_mcp_server(name, runtime.working_directory.as_str())
    }

    fn load_tool_ids(
        &self,
        runtime: &RuntimeInstanceSummary,
    ) -> std::result::Result<Vec<String>, RuntimeHealthCheckFailure> {
        Self::health_client(runtime)?.load_tool_ids(runtime.working_directory.as_str())
    }

    fn stop_session(
        &self,
        runtime_route: &RuntimeRoute,
        external_session_id: &str,
        working_directory: &str,
    ) -> Result<()> {
        Self::abort_session(runtime_route, external_session_id, working_directory)
    }

    fn session_status_probe_target(
        &self,
        runtime_route: &RuntimeRoute,
        working_directory: &str,
    ) -> Result<RuntimeSessionStatusProbeTargetResolution> {
        match runtime_route {
            RuntimeRoute::LocalHttp { .. } => {
                Ok(RuntimeSessionStatusProbeTargetResolution::Target(
                    RuntimeSessionStatusProbeTarget::new(
                        AgentRuntimeKind::opencode(),
                        runtime_route,
                        working_directory,
                    ),
                ))
            }
            RuntimeRoute::Stdio => Ok(RuntimeSessionStatusProbeTargetResolution::Unsupported),
        }
    }

    fn probe_session_status(
        &self,
        target: &RuntimeSessionStatusProbeTarget,
    ) -> RuntimeSessionStatusProbeOutcome {
        match Self::load_session_statuses(target.runtime_route(), target.working_directory()) {
            Ok(statuses) => RuntimeSessionStatusProbeOutcome::Snapshot(
                RuntimeSessionStatusSnapshot::from_statuses(statuses),
            ),
            Err(error) => RuntimeSessionStatusProbeOutcome::ActionableError(
                RuntimeSessionStatusProbeError::ProbeFailed(error.to_string()),
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{OpenCodeAbortResponseHeaders, OpenCodeRuntime};
    use crate::app_service::RuntimeRoute;
    use anyhow::Result;
    use std::io::{BufReader, Cursor, Read, Write};
    use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener};
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn require_loopback_socket_address_accepts_loopback_addresses() {
        let loopback = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 8080);

        let result =
            OpenCodeRuntime::require_loopback_socket_address(loopback, "http://127.0.0.1:8080")
                .expect("loopback endpoint should be accepted");

        assert_eq!(result, loopback);
    }

    #[test]
    fn require_loopback_socket_address_rejects_non_loopback_addresses() {
        let error = OpenCodeRuntime::require_loopback_socket_address(
            SocketAddr::new(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 10)), 8080),
            "http://192.168.1.10:8080",
        )
        .expect_err("non-loopback endpoint should be rejected");

        assert!(error
            .to_string()
            .contains("must resolve to a loopback address"));
    }

    #[test]
    fn extract_http_response_body_decodes_chunked_transfer_encoding() {
        let response = concat!(
            "HTTP/1.1 200 OK\r\n",
            "Transfer-Encoding: chunked\r\n",
            "\r\n",
            "7\r\n",
            "{\"a\":1}\r\n",
            "0\r\n",
            "\r\n"
        );

        let body = OpenCodeRuntime::extract_http_response_body(response)
            .expect("chunked body should decode");

        assert_eq!(body, "{\"a\":1}");
    }

    #[test]
    fn abort_session_returns_after_success_headers_without_waiting_for_close() -> Result<()> {
        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        let port = listener.local_addr()?.port();
        let (response_sent, response_received) = mpsc::channel();
        let (release_sent, release_received) = mpsc::channel();
        let server = thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            let mut request = [0_u8; 1024];
            let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
            let _ = stream.read(&mut request);
            let _ = stream.write_all(
                b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n",
            );
            let _ = response_sent.send(());
            let _ = release_received.recv_timeout(Duration::from_secs(3));
        });
        let route = RuntimeRoute::LocalHttp {
            endpoint: format!("http://127.0.0.1:{port}"),
        };

        let abort_result = OpenCodeRuntime::abort_session(&route, "session-1", "/repo");
        let response_result = response_received.recv_timeout(Duration::from_secs(1));
        let _ = release_sent.send(());
        let join_result = server
            .join()
            .map_err(|_| anyhow::anyhow!("abort test server thread panicked"));

        abort_result?;
        response_result?;
        join_result?;
        Ok(())
    }

    #[test]
    fn read_http_response_body_uses_content_length_without_waiting_for_eof() -> Result<()> {
        let headers = OpenCodeAbortResponseHeaders {
            lines: vec!["Content-Length: 11".to_string()],
        };
        let mut reader = BufReader::new(Cursor::new("stop failedtail"));

        let body = OpenCodeRuntime::read_http_response_body(&mut reader, &headers, "session-1")?;

        assert_eq!(body, "stop failed");
        Ok(())
    }

    #[test]
    fn read_http_response_body_decodes_chunked_transfer_encoding() -> Result<()> {
        let headers = OpenCodeAbortResponseHeaders {
            lines: vec!["Transfer-Encoding: gzip, chunked".to_string()],
        };
        let mut reader = BufReader::new(Cursor::new("4\r\nstop\r\n7\r\n failed\r\n0\r\n\r\n"));

        let body = OpenCodeRuntime::read_http_response_body(&mut reader, &headers, "session-1")?;

        assert_eq!(body, "stop failed");
        Ok(())
    }

    #[test]
    fn read_http_response_body_rejects_unframed_abort_error_bodies() {
        let headers = OpenCodeAbortResponseHeaders { lines: vec![] };
        let mut reader = BufReader::new(Cursor::new("stop failed"));

        let error = OpenCodeRuntime::read_http_response_body(&mut reader, &headers, "session-1")
            .expect_err("unframed response bodies should fail fast");

        assert!(error
            .to_string()
            .contains("missing Content-Length or Transfer-Encoding"));
    }
}
