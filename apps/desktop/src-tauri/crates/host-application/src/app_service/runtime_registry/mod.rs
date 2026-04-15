mod health_http;
mod open_code;

use super::{
    AppService, RuntimeProcessGuard, RuntimeRoute, RuntimeSessionStatusProbeTarget,
    RuntimeStartupReadinessPolicy, RuntimeStartupWaitReport,
};
use anyhow::{anyhow, Result};
use host_domain::{
    AgentRuntimeKind, RuntimeDefinition, RuntimeHealth, RuntimeInstanceSummary, RuntimeRegistry,
};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::process::Child;
use std::sync::{Arc, LazyLock};

#[cfg(test)]
pub(crate) use health_http::RuntimeHealthHttpClient;
pub(crate) use health_http::{
    ResolvedRuntimeMcpStatus, RuntimeHealthCheckFailure, RuntimeMcpServerStatus,
};
pub(crate) use open_code::OpenCodeRuntime;

pub(crate) trait AppRuntime: Send + Sync {
    fn definition(&self) -> RuntimeDefinition;

    fn startup_policy(&self, service: &AppService) -> Result<RuntimeStartupReadinessPolicy>;

    fn start_external(
        &self,
        _service: &AppService,
        _input: &super::runtime_orchestrator::RuntimeStartInput<'_>,
        _runtime_id: &str,
    ) -> Result<ExternalRuntimeStart> {
        Err(anyhow!("Runtime does not support external provisioning"))
    }

    // Host-managed runtimes must return a tracked process guard so cleanup and
    // stale-runtime pruning stay coupled to the spawned child lifecycle.
    fn track_process(&self, _service: &AppService, _child_id: u32) -> Result<RuntimeProcessGuard>;

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
        const ODT_MCP_SERVER_NAME: &str = "openducktor";

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

pub(crate) struct ExternalRuntimeStart {
    pub(crate) runtime_route: RuntimeRoute,
    pub(crate) startup_report: RuntimeStartupWaitReport,
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

    pub(crate) fn runtime_definitions(&self) -> &RuntimeRegistry {
        &self.definitions
    }
}
