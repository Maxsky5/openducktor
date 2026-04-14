use super::{
    read_opencode_version, require_opencode_local_http_port, resolve_opencode_binary_path,
    AppService, OpencodeStartupReadinessPolicy, RuntimeRoute,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{
    AgentRuntimeKind, RuntimeDefinition, RuntimeHealth, RuntimeRegistry,
    RuntimeStartupReadinessConfig,
};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::process::Child;
use std::sync::{Arc, LazyLock};
use std::time::Duration;
use url::form_urlencoded;

pub(crate) trait AppRuntime: Send + Sync {
    fn definition(&self) -> RuntimeDefinition;

    fn startup_policy(&self, service: &AppService) -> Result<OpencodeStartupReadinessPolicy>;

    fn spawn_server(
        &self,
        service: &AppService,
        working_directory: &Path,
        repo_path_for_mcp: &Path,
        port: u16,
    ) -> Result<Child>;

    fn runtime_health(&self) -> RuntimeHealth;

    fn abort_build_session(
        &self,
        runtime_route: &RuntimeRoute,
        external_session_id: &str,
        working_directory: &str,
    ) -> Result<()>;
}

#[derive(Clone)]
pub(crate) struct AppRuntimeRegistry {
    definitions: RuntimeRegistry,
    runtimes_by_kind: Arc<BTreeMap<String, Arc<dyn AppRuntime>>>,
}

impl AppRuntimeRegistry {
    pub(crate) fn new(runtimes: Vec<Arc<dyn AppRuntime>>) -> Result<Self> {
        let definitions = RuntimeRegistry::new(
            runtimes
                .iter()
                .map(|runtime| runtime.definition())
                .collect(),
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
            AppRuntimeRegistry::new(vec![Arc::new(OpenCodeRuntime)])
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
        let port = require_opencode_local_http_port(runtime_route, "build session abort")?;
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
}

impl AppRuntime for OpenCodeRuntime {
    fn definition(&self) -> RuntimeDefinition {
        host_domain::builtin_runtime_registry()
            .definition_by_str("opencode")
            .expect("builtin runtime registry should include opencode")
            .clone()
    }

    fn startup_policy(&self, service: &AppService) -> Result<OpencodeStartupReadinessPolicy> {
        Ok(OpencodeStartupReadinessPolicy::from_config(
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

    fn abort_build_session(
        &self,
        runtime_route: &RuntimeRoute,
        external_session_id: &str,
        working_directory: &str,
    ) -> Result<()> {
        Self::abort_session(runtime_route, external_session_id, working_directory)
    }
}
