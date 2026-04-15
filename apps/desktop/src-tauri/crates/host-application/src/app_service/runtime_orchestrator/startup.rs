use super::super::{
    AppService, RuntimeStartupReadinessPolicy, RuntimeStartupWaitReport, StartupEventContext,
    StartupEventPayload, STARTUP_CONFIG_INVALID_REASON,
};
use super::start_pipeline::{RuntimeStartInput, SpawnedRuntimeServer};
use super::startup_status::RuntimeStartupProgress;
use anyhow::{anyhow, Context, Result};
use host_domain::{RuntimeProvisioningMode, RuntimeRole};
use host_infra_system::pick_free_port;
use std::path::Path;
use uuid::Uuid;

impl AppService {
    pub(crate) fn resolve_runtime_startup_policy(
        &self,
        runtime_kind: &host_domain::AgentRuntimeKind,
        startup_scope: &str,
        repo_path: &str,
        task_id: &str,
        role: RuntimeRole,
        startup_error_context: &str,
    ) -> Result<RuntimeStartupReadinessPolicy> {
        self.runtime_registry
            .runtime(runtime_kind)?
            .startup_policy(self)
            .inspect_err(|_| {
                self.emit_opencode_startup_event(StartupEventPayload::failed(
                    StartupEventContext::new(
                        startup_scope,
                        repo_path,
                        Some(task_id),
                        role.as_str(),
                        0,
                        None,
                        None,
                    ),
                    RuntimeStartupWaitReport::zero(),
                    STARTUP_CONFIG_INVALID_REASON,
                ));
            })
            .with_context(|| startup_error_context.to_string())
    }

    pub(super) fn spawn_runtime_server(
        &self,
        input: &RuntimeStartInput<'_>,
    ) -> Result<SpawnedRuntimeServer> {
        self.mark_runtime_startup_requested(
            &input.runtime_kind,
            input.repo_key.as_str(),
            &RuntimeStartupProgress {
                started_at_instant: input.startup_started_at_instant,
                started_at: input.startup_started_at.clone(),
                attempts: Some(0),
                elapsed_ms: None,
            },
        )?;
        let port = pick_free_port()?;
        let runtime_id = format!("runtime-{}", Uuid::new_v4().simple());
        let startup_policy = input.startup_policy;
        let definition = self.runtime_registry.definition(&input.runtime_kind)?;
        let runtime = self.runtime_registry.runtime(&input.runtime_kind)?;
        match definition.descriptor().capabilities.provisioning_mode {
            RuntimeProvisioningMode::HostManaged => {
                let mut child = runtime.spawn_server(
                    self,
                    Path::new(input.working_directory.as_str()),
                    input.workspace_id_for_mcp,
                    port,
                )?;
                let runtime_process_guard = match runtime.track_process(self, child.id()) {
                    Ok(guard) => guard,
                    Err(error) => {
                        let tracking_error = anyhow!(error).context(input.tracking_error_context);
                        if let Err(cleanup_error) = Self::cleanup_started_runtime(
                            Some(&mut child),
                            input.cleanup_target.as_ref(),
                        ) {
                            return Err(Self::append_cleanup_error(tracking_error, cleanup_error));
                        }
                        return Err(tracking_error);
                    }
                };
                let startup_report = match runtime.wait_until_ready(
                    self,
                    input,
                    &mut child,
                    port,
                    runtime_id.as_str(),
                    startup_policy,
                ) {
                    Ok(report) => report,
                    Err(startup_error) => {
                        if let Err(cleanup_error) = Self::cleanup_started_runtime(
                            Some(&mut child),
                            input.cleanup_target.as_ref(),
                        ) {
                            return Err(Self::append_cleanup_error(startup_error, cleanup_error));
                        }
                        return Err(startup_error);
                    }
                };

                Ok(SpawnedRuntimeServer {
                    runtime_id,
                    runtime_route: definition.route_for_port(port),
                    child: Some(child),
                    _runtime_process_guard: Some(runtime_process_guard),
                    startup_started_at_instant: input.startup_started_at_instant,
                    startup_started_at: input.startup_started_at.clone(),
                    startup_report,
                })
            }
            RuntimeProvisioningMode::External => {
                let external_start = runtime
                    .start_external(self, input, runtime_id.as_str())
                    .with_context(|| input.startup_error_context.clone())?;

                Ok(SpawnedRuntimeServer {
                    runtime_id,
                    runtime_route: external_start.runtime_route,
                    child: None,
                    _runtime_process_guard: None,
                    startup_started_at_instant: input.startup_started_at_instant,
                    startup_started_at: input.startup_started_at.clone(),
                    startup_report: external_start.startup_report,
                })
            }
        }
    }
}
