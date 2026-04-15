use host_domain::RepoRuntimeStartupFailureKind;
use reqwest::blocking::Client;
use serde::{de::DeserializeOwned, Deserialize};
use std::collections::HashMap;
use std::time::Duration;
use url::{form_urlencoded, Url};

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
    pub(crate) fn error(message: String) -> Self {
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

pub(crate) struct RuntimeHealthHttpResponse {
    pub(crate) status_code: u16,
    pub(crate) body: String,
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

    pub(crate) fn connect_mcp_server(
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

    pub(crate) fn load_tool_ids(
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
