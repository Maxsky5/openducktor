mod health_http;
mod open_code;
use super::{
    AppService, RuntimeProcessGuard, RuntimeRoute, RuntimeSessionStatusProbeOutcome,
    RuntimeSessionStatusProbeTarget, RuntimeSessionStatusProbeTargetResolution,
    RuntimeStartupReadinessPolicy, RuntimeStartupWaitReport,
};
use anyhow::{anyhow, Result};
use host_domain::{
    AgentRuntimeKind, RuntimeDefinition, RuntimeHealth, RuntimeInstanceSummary, RuntimeRegistry,
};
use std::collections::{BTreeMap, HashMap};
use std::process::Child;
use std::sync::Arc;

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

    // Host-managed runtimes own startup details, including how they obtain the
    // final runtime route and how they couple process tracking to readiness.
    fn start_host_managed(
        &self,
        _service: &AppService,
        _input: &super::runtime_orchestrator::RuntimeStartInput<'_>,
        _runtime_id: &str,
        _startup_policy: RuntimeStartupReadinessPolicy,
    ) -> Result<HostManagedRuntimeStart> {
        Err(anyhow!("Runtime does not support host-managed provisioning"))
    }

    fn runtime_health(&self) -> RuntimeHealth;

    fn reconcile_on_startup(&self, _service: &AppService) -> Result<()> {
        Ok(())
    }

    fn terminate_tracked_processes(&self, _service: &AppService) -> Result<()> {
        Ok(())
    }

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

    fn stop_session(
        &self,
        runtime_route: &RuntimeRoute,
        external_session_id: &str,
        working_directory: &str,
    ) -> Result<()>;

    fn session_status_probe_target(
        &self,
        runtime_route: &RuntimeRoute,
        working_directory: &str,
    ) -> Result<RuntimeSessionStatusProbeTargetResolution> {
        let _ = (runtime_route, working_directory);
        Ok(RuntimeSessionStatusProbeTargetResolution::Unsupported)
    }

    fn probe_session_status(
        &self,
        _target: &RuntimeSessionStatusProbeTarget,
    ) -> RuntimeSessionStatusProbeOutcome {
        RuntimeSessionStatusProbeOutcome::Unsupported
    }
}

pub(crate) struct ExternalRuntimeStart {
    pub(crate) runtime_route: RuntimeRoute,
    pub(crate) startup_report: RuntimeStartupWaitReport,
}

pub(crate) struct HostManagedRuntimeStart {
    pub(crate) child: Child,
    pub(crate) runtime_process_guard: RuntimeProcessGuard,
    pub(crate) runtime_route: RuntimeRoute,
    pub(crate) startup_report: RuntimeStartupWaitReport,
}

#[derive(Clone)]
pub(crate) struct AppRuntimeRegistry {
    definitions: RuntimeRegistry,
    runtimes_by_kind: Arc<BTreeMap<String, Arc<dyn AppRuntime>>>,
    #[cfg(test)]
    opencode_runtime: Option<Arc<OpenCodeRuntime>>,
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
            #[cfg(test)]
            opencode_runtime: None,
        })
    }

    pub(crate) fn builtin_for_service() -> Self {
        #[cfg(test)]
        {
            let opencode_runtime = Arc::new(OpenCodeRuntime::default());
            let mut registry = AppRuntimeRegistry::new(
                vec![opencode_runtime.clone()],
                AgentRuntimeKind::opencode(),
            )
            .expect("builtin app runtime registry should be valid");
            registry.opencode_runtime = Some(opencode_runtime);
            registry
        }

        #[cfg(not(test))]
        {
            AppRuntimeRegistry::new(
                vec![Arc::new(OpenCodeRuntime::default())],
                AgentRuntimeKind::opencode(),
            )
            .expect("builtin app runtime registry should be valid")
        }
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

    pub(crate) fn runtimes(&self) -> Vec<Arc<dyn AppRuntime>> {
        self.runtimes_by_kind.values().cloned().collect()
    }

    pub(crate) fn runtime_definitions(&self) -> &RuntimeRegistry {
        &self.definitions
    }

    #[cfg(test)]
    #[expect(
        dead_code,
        reason = "used only by shutdown integration tests to seed pending OpenCode process tracking"
    )]
    pub(crate) fn track_pending_opencode_process_for_test(
        &self,
        service: &AppService,
        child_id: u32,
    ) -> Result<RuntimeProcessGuard> {
        self.opencode_runtime
            .as_ref()
            .ok_or_else(|| anyhow!("Builtin OpenCode runtime is not available in this registry"))?
            .track_pending_process(service, child_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_for_service_creates_distinct_runtime_instances() {
        let first = AppRuntimeRegistry::builtin_for_service();
        let second = AppRuntimeRegistry::builtin_for_service();

        let first_runtime = first
            .runtime(&AgentRuntimeKind::opencode())
            .expect("first runtime");
        let second_runtime = second
            .runtime(&AgentRuntimeKind::opencode())
            .expect("second runtime");

        assert!(
            !Arc::ptr_eq(&first_runtime, &second_runtime),
            "builtin runtime registries should create per-service runtime instances"
        );
    }
}
