use super::health_http::{
    RuntimeHealthCheckFailure, RuntimeHealthHttpClient, RuntimeMcpServerStatus,
};
use super::AppRuntime;
use crate::app_service::{
    read_opencode_version, require_local_http_endpoint, require_local_http_port,
    resolve_opencode_binary_path, wait_for_runtime_with_process, AppService, RuntimeProcessGuard,
    RuntimeRoute, RuntimeStartupReadinessPolicy, RuntimeStartupWaitReport, StartupEventContext,
    StartupEventCorrelation, StartupEventPayload,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{
    RuntimeDefinition, RuntimeHealth, RuntimeInstanceSummary, RuntimeStartupReadinessConfig,
};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::process::Child;
use std::time::Duration;
use url::form_urlencoded;

pub(crate) struct OpenCodeRuntime;

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
        input: &crate::app_service::runtime_orchestrator::RuntimeStartInput<'_>,
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

    fn abort_build_session(
        &self,
        runtime_route: &RuntimeRoute,
        external_session_id: &str,
        working_directory: &str,
    ) -> Result<()> {
        Self::abort_session(runtime_route, external_session_id, working_directory)
    }
}
