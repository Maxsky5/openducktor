use super::{
    read_opencode_version, require_local_http_endpoint, require_local_http_port,
    resolve_opencode_binary_path, wait_for_runtime_with_process, AppService, RuntimeProcessGuard,
    RuntimeRoute, RuntimeSessionStatusProbeTarget, RuntimeStartupReadinessPolicy,
    RuntimeStartupWaitReport, StartupEventContext, StartupEventCorrelation, StartupEventPayload,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{
    AgentRuntimeKind, RepoRuntimeStartupFailureKind, RuntimeDefinition, RuntimeHealth,
    RuntimeInstanceSummary, RuntimeRegistry, RuntimeStartupReadinessConfig,
};
use reqwest::blocking::Client;
use serde::{de::DeserializeOwned, Deserialize};
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::process::Child;
use std::sync::{Arc, LazyLock};
use std::time::Duration;
use url::{form_urlencoded, Url};

const ODT_MCP_SERVER_NAME: &str = "openducktor";
const RUNTIME_HEALTH_HTTP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
pub(crate) struct RuntimeHealthCheckFailure {
    pub(crate) failure_kind: RepoRuntimeStartupFailureKind,
    pub(crate) message: String,
    pub(crate) is_connect_failure: bool,
}

impl std::fmt::Display for RuntimeHealthCheckFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message.as_str())
    }
}

impl std::error::Error for RuntimeHealthCheckFailure {}

impl RuntimeHealthCheckFailure {
    fn error(message: String) -> Self {
        Self {
            failure_kind: RepoRuntimeStartupFailureKind::Error,
            message,
            is_connect_failure: false,
        }
    }

    fn from_request_error(action: &str, error: &reqwest::Error) -> Self {
        Self {
            failure_kind: classify_runtime_health_request_failure(error),
            message: format!("Failed to query runtime to {action}: {error}"),
            is_connect_failure: error.is_connect(),
        }
    }

    fn from_response_body_error(action: &str, error: reqwest::Error) -> Self {
        Self {
            failure_kind: classify_runtime_health_request_failure(&error),
            message: format!("Failed to read runtime response body for {action}: {error}"),
            is_connect_failure: error.is_connect(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub(crate) struct RuntimeMcpServerStatus {
    pub(crate) status: String,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedRuntimeMcpStatus {
    pub(crate) status: Option<String>,
    pub(crate) error: Option<String>,
    pub(crate) failure_kind: Option<RepoRuntimeStartupFailureKind>,
}

impl ResolvedRuntimeMcpStatus {
    pub(crate) fn connected() -> Self {
        Self {
            status: Some("connected".to_string()),
            error: None,
            failure_kind: None,
        }
    }

    pub(crate) fn unavailable(status: Option<String>, error: String) -> Self {
        Self {
            status,
            error: Some(error),
            failure_kind: Some(RepoRuntimeStartupFailureKind::Error),
        }
    }

    pub(crate) fn is_connected(&self) -> bool {
        self.status.as_deref() == Some("connected")
    }
}

#[derive(Clone, Copy)]
enum RuntimeHealthHttpMethod {
    Get,
    Post,
}

struct RuntimeHealthHttpResponse {
    status_code: u16,
    body: String,
}

pub(crate) struct RuntimeHealthHttpClient<'a> {
    endpoint: &'a str,
}

impl<'a> RuntimeHealthHttpClient<'a> {
    pub(crate) fn new(endpoint: &'a str) -> Self {
        Self { endpoint }
    }

    pub(crate) fn load_mcp_status(
        &self,
        working_directory: &str,
    ) -> std::result::Result<HashMap<String, RuntimeMcpServerStatus>, RuntimeHealthCheckFailure>
    {
        self.request_json(
            RuntimeHealthHttpMethod::Get,
            Self::mcp_status_path(working_directory).as_str(),
            "load MCP status",
        )
    }

    fn connect_mcp_server(
        &self,
        name: &str,
        working_directory: &str,
    ) -> std::result::Result<(), RuntimeHealthCheckFailure> {
        let _: serde_json::Value = self.request_json(
            RuntimeHealthHttpMethod::Post,
            Self::connect_mcp_path(name, working_directory).as_str(),
            "connect MCP server",
        )?;
        Ok(())
    }

    fn load_tool_ids(
        &self,
        working_directory: &str,
    ) -> std::result::Result<Vec<String>, RuntimeHealthCheckFailure> {
        self.request_json(
            RuntimeHealthHttpMethod::Get,
            Self::tool_ids_path(working_directory).as_str(),
            "list tool ids",
        )
    }

    fn request_json<T: DeserializeOwned>(
        &self,
        method: RuntimeHealthHttpMethod,
        request_path: &str,
        action: &str,
    ) -> std::result::Result<T, RuntimeHealthCheckFailure> {
        let RuntimeHealthHttpResponse { status_code, body } =
            self.send_request(method, request_path, action)?;
        if !(200..300).contains(&status_code) {
            return Err(runtime_health_http_status_failure(
                status_code,
                body.as_str(),
                action,
            ));
        }

        parse_runtime_health_json(body.as_str(), action)
    }

    fn send_request(
        &self,
        method: RuntimeHealthHttpMethod,
        request_path: &str,
        action: &str,
    ) -> std::result::Result<RuntimeHealthHttpResponse, RuntimeHealthCheckFailure> {
        let url = self.request_url(request_path, action)?;
        let client = self.http_client(action)?;
        let response = self
            .build_request(&client, method, url)
            .send()
            .map_err(|error| RuntimeHealthCheckFailure::from_request_error(action, &error))?;
        let status_code = response.status().as_u16();
        let body = response
            .text()
            .map_err(|error| RuntimeHealthCheckFailure::from_response_body_error(action, error))?;

        Ok(RuntimeHealthHttpResponse { status_code, body })
    }

    fn request_url(
        &self,
        request_path: &str,
        action: &str,
    ) -> std::result::Result<Url, RuntimeHealthCheckFailure> {
        let endpoint = Url::parse(self.endpoint).map_err(|error| {
            RuntimeHealthCheckFailure::error(format!(
                "Invalid runtime endpoint {}: {error}",
                self.endpoint
            ))
        })?;
        endpoint.join(request_path).map_err(|error| {
            RuntimeHealthCheckFailure::error(format!(
                "Failed to build runtime request URL for {action}: {error}"
            ))
        })
    }

    fn http_client(&self, action: &str) -> std::result::Result<Client, RuntimeHealthCheckFailure> {
        Client::builder()
            .timeout(RUNTIME_HEALTH_HTTP_TIMEOUT)
            .build()
            .map_err(|error| {
                RuntimeHealthCheckFailure::error(format!(
                    "Failed to build runtime HTTP client for {action}: {error}"
                ))
            })
    }

    fn build_request(
        &self,
        client: &Client,
        method: RuntimeHealthHttpMethod,
        url: Url,
    ) -> reqwest::blocking::RequestBuilder {
        match method {
            RuntimeHealthHttpMethod::Get => client.get(url),
            RuntimeHealthHttpMethod::Post => client.post(url),
        }
    }

    fn mcp_status_path(working_directory: &str) -> String {
        format!(
            "/mcp?{}",
            form_urlencoded::Serializer::new(String::new())
                .append_pair("directory", working_directory)
                .finish()
        )
    }

    fn tool_ids_path(working_directory: &str) -> String {
        format!(
            "/experimental/tool/ids?{}",
            form_urlencoded::Serializer::new(String::new())
                .append_pair("directory", working_directory)
                .finish()
        )
    }

    fn connect_mcp_path(name: &str, working_directory: &str) -> String {
        let encoded_name: String = url::form_urlencoded::byte_serialize(name.as_bytes()).collect();
        format!(
            "/mcp/{encoded_name}/connect?{}",
            form_urlencoded::Serializer::new(String::new())
                .append_pair("directory", working_directory)
                .finish()
        )
    }
}

pub(crate) trait AppRuntime: Send + Sync {
    fn definition(&self) -> RuntimeDefinition;

    fn startup_policy(&self, service: &AppService) -> Result<RuntimeStartupReadinessPolicy>;

    fn track_process(
        &self,
        _service: &AppService,
        _child_id: u32,
    ) -> Result<Option<RuntimeProcessGuard>> {
        Ok(None)
    }

    fn wait_until_ready(
        &self,
        service: &AppService,
        input: &super::runtime_orchestrator::RuntimeStartInput<'_>,
        child: &mut Child,
        port: u16,
        runtime_id: &str,
        startup_policy: RuntimeStartupReadinessPolicy,
    ) -> Result<RuntimeStartupWaitReport>;

    fn spawn_server(
        &self,
        service: &AppService,
        working_directory: &Path,
        repo_path_for_mcp: &Path,
        port: u16,
    ) -> Result<Child>;

    fn runtime_health(&self) -> RuntimeHealth;

    fn should_restart_for_mcp_status_error(&self, _message: &str) -> bool {
        false
    }

    fn load_mcp_status(
        &self,
        _runtime: &RuntimeInstanceSummary,
    ) -> std::result::Result<HashMap<String, RuntimeMcpServerStatus>, RuntimeHealthCheckFailure>
    {
        Err(RuntimeHealthCheckFailure::error(
            "Runtime does not support MCP status probing".to_string(),
        ))
    }

    fn connect_mcp_server(
        &self,
        _runtime: &RuntimeInstanceSummary,
        _name: &str,
    ) -> std::result::Result<(), RuntimeHealthCheckFailure> {
        Err(RuntimeHealthCheckFailure::error(
            "Runtime does not support MCP reconnection".to_string(),
        ))
    }

    fn load_tool_ids(
        &self,
        _runtime: &RuntimeInstanceSummary,
    ) -> std::result::Result<Vec<String>, RuntimeHealthCheckFailure> {
        Err(RuntimeHealthCheckFailure::error(
            "Runtime does not expose MCP tool ids".to_string(),
        ))
    }

    fn resolve_mcp_status(
        &self,
        status_by_server: &HashMap<String, RuntimeMcpServerStatus>,
    ) -> ResolvedRuntimeMcpStatus {
        let Some(server_status) = status_by_server.get(ODT_MCP_SERVER_NAME) else {
            return ResolvedRuntimeMcpStatus::unavailable(
                None,
                format!("MCP server '{ODT_MCP_SERVER_NAME}' is not configured for this runtime."),
            );
        };
        if server_status.status == "connected" {
            return ResolvedRuntimeMcpStatus::connected();
        }

        ResolvedRuntimeMcpStatus::unavailable(
            Some(server_status.status.clone()),
            server_status.error.clone().unwrap_or_else(|| {
                format!(
                    "MCP server '{ODT_MCP_SERVER_NAME}' is {}.",
                    server_status.status
                )
            }),
        )
    }

    fn abort_build_session(
        &self,
        runtime_route: &RuntimeRoute,
        external_session_id: &str,
        working_directory: &str,
    ) -> Result<()>;

    fn session_status_probe_target(
        &self,
        runtime_route: &RuntimeRoute,
        working_directory: &str,
    ) -> Result<Option<RuntimeSessionStatusProbeTarget>> {
        match runtime_route {
            RuntimeRoute::LocalHttp { .. } => {
                Ok(Some(RuntimeSessionStatusProbeTarget::for_runtime_route(
                    runtime_route,
                    working_directory,
                )?))
            }
            RuntimeRoute::Stdio => Ok(None),
        }
    }
}

#[derive(Clone)]
pub(crate) struct AppRuntimeRegistry {
    definitions: RuntimeRegistry,
    runtimes_by_kind: Arc<BTreeMap<String, Arc<dyn AppRuntime>>>,
}

impl AppRuntimeRegistry {
    pub(crate) fn new(
        runtimes: Vec<Arc<dyn AppRuntime>>,
        default_kind: AgentRuntimeKind,
    ) -> Result<Self> {
        let definitions = RuntimeRegistry::new_with_default_kind(
            runtimes
                .iter()
                .map(|runtime| runtime.definition())
                .collect(),
            Some(default_kind),
        )?;
        let runtimes_by_kind = runtimes
            .into_iter()
            .map(|runtime| (runtime.definition().kind().to_string(), runtime))
            .collect();
        Ok(Self {
            definitions,
            runtimes_by_kind: Arc::new(runtimes_by_kind),
        })
    }

    pub(crate) fn builtin() -> Self {
        static BUILTIN: LazyLock<AppRuntimeRegistry> = LazyLock::new(|| {
            AppRuntimeRegistry::new(
                vec![Arc::new(OpenCodeRuntime)],
                AgentRuntimeKind::opencode(),
            )
            .expect("builtin app runtime registry should be valid")
        });
        BUILTIN.clone()
    }

    pub(crate) fn definitions(&self) -> Vec<RuntimeDefinition> {
        self.definitions.definitions()
    }

    pub(crate) fn definition(&self, kind: &AgentRuntimeKind) -> Result<&RuntimeDefinition> {
        self.definitions.definition(kind)
    }

    pub(crate) fn resolve_kind(&self, kind: &str) -> Result<AgentRuntimeKind> {
        self.definitions.resolve_kind(kind)
    }

    pub(crate) fn runtime(&self, kind: &AgentRuntimeKind) -> Result<Arc<dyn AppRuntime>> {
        self.runtimes_by_kind
            .get(kind.as_str())
            .cloned()
            .ok_or_else(|| anyhow!("Unsupported agent runtime kind: {}", kind.as_str()))
    }
}

struct OpenCodeRuntime;

impl OpenCodeRuntime {
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

        let mut response_body = String::new();
        reader.read_to_string(&mut response_body).with_context(|| {
            format!("Failed reading OpenCode abort response body for session {external_session_id}")
        })?;

        if !(200..300).contains(&status_code) {
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

    fn spawn_server(
        &self,
        service: &AppService,
        working_directory: &Path,
        repo_path_for_mcp: &Path,
        port: u16,
    ) -> Result<Child> {
        service.spawn_opencode_server(working_directory, repo_path_for_mcp, port)
    }

    fn track_process(
        &self,
        service: &AppService,
        child_id: u32,
    ) -> Result<Option<RuntimeProcessGuard>> {
        Ok(Some(service.track_pending_opencode_process(child_id)?))
    }

    fn wait_until_ready(
        &self,
        service: &AppService,
        input: &super::runtime_orchestrator::RuntimeStartInput<'_>,
        child: &mut Child,
        port: u16,
        runtime_id: &str,
        startup_policy: RuntimeStartupReadinessPolicy,
    ) -> Result<RuntimeStartupWaitReport> {
        let startup_cancel_epoch = service.startup_cancel_epoch();
        let startup_cancel_snapshot = service.startup_cancel_snapshot();
        service.emit_opencode_startup_event(StartupEventPayload::wait_begin(
            StartupEventContext::new(
                input.startup_scope,
                input.repo_path,
                Some(input.task_id),
                input.role.as_str(),
                port,
                Some(StartupEventCorrelation::new("runtime_id", runtime_id)),
                Some(startup_policy),
            ),
        ));

        match wait_for_runtime_with_process(
            child,
            port,
            startup_policy,
            &startup_cancel_epoch,
            startup_cancel_snapshot,
            |progress| {
                let _ = service.mark_runtime_startup_waiting(
                    &input.runtime_kind,
                    input.repo_key.as_str(),
                    &super::runtime_orchestrator::RuntimeStartupProgress {
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
                        port,
                        Some(StartupEventCorrelation::new("runtime_id", runtime_id)),
                        Some(startup_policy),
                    ),
                    report,
                ));
                Ok(report)
            }
            Err(error) => {
                service.emit_opencode_startup_event(StartupEventPayload::failed(
                    StartupEventContext::new(
                        input.startup_scope,
                        input.repo_path,
                        Some(input.task_id),
                        input.role.as_str(),
                        port,
                        Some(StartupEventCorrelation::new("runtime_id", runtime_id)),
                        Some(startup_policy),
                    ),
                    error.report(),
                    error.reason,
                ));
                Err(anyhow!(error).context(input.startup_error_context.clone()))
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

    fn should_restart_for_mcp_status_error(&self, message: &str) -> bool {
        lower_contains_any(
            message,
            &[
                "configinvaliderror",
                "opencode_config_content",
                "loglevel",
                "invalid option",
            ],
        )
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

    fn abort_build_session(
        &self,
        runtime_route: &RuntimeRoute,
        external_session_id: &str,
        working_directory: &str,
    ) -> Result<()> {
        Self::abort_session(runtime_route, external_session_id, working_directory)
    }
}

fn parse_runtime_health_json<T: DeserializeOwned>(
    body: &str,
    action: &str,
) -> std::result::Result<T, RuntimeHealthCheckFailure> {
    serde_json::from_str::<T>(body).map_err(|error| {
        RuntimeHealthCheckFailure::error(format!(
            "Failed to parse runtime response for {action}: {error}"
        ))
    })
}

fn runtime_health_http_status_failure(
    status_code: u16,
    body: &str,
    action: &str,
) -> RuntimeHealthCheckFailure {
    let detail = runtime_health_http_error_detail(body);
    let failure_kind = if matches!(status_code, 408 | 504) {
        RepoRuntimeStartupFailureKind::Timeout
    } else {
        RepoRuntimeStartupFailureKind::Error
    };

    RuntimeHealthCheckFailure {
        failure_kind,
        message: match detail {
            Some(detail) => format!("Runtime failed to {action}: HTTP {status_code}: {detail}"),
            None => format!("Runtime failed to {action}: HTTP {status_code}"),
        },
        is_connect_failure: false,
    }
}

fn runtime_health_http_error_detail(body: &str) -> Option<String> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return None;
    }

    serde_json::from_str::<serde_json::Value>(trimmed)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(|error| error.as_str())
                .map(str::to_string)
                .or_else(|| {
                    value
                        .get("message")
                        .and_then(|message| message.as_str())
                        .map(str::to_string)
                })
        })
        .or_else(|| Some(trimmed.to_string()))
}

fn classify_runtime_health_request_failure(
    error: &reqwest::Error,
) -> RepoRuntimeStartupFailureKind {
    if error.is_timeout() {
        RepoRuntimeStartupFailureKind::Timeout
    } else {
        RepoRuntimeStartupFailureKind::Error
    }
}

fn lower_contains_any(haystack: &str, needles: &[&str]) -> bool {
    let normalized = haystack.to_ascii_lowercase();
    needles.iter().any(|needle| normalized.contains(needle))
}
