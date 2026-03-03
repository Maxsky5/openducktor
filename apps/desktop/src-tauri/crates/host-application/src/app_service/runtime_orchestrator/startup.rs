use super::super::{
    spawn_opencode_server, wait_for_local_server_with_process, AppService,
    StartupEventCorrelation, StartupEventPayload,
};
use super::{RuntimeStartInput, SpawnedRuntimeServer};
use anyhow::{anyhow, Result};
use host_domain::TASK_METADATA_NAMESPACE;
use host_infra_system::pick_free_port;
use std::path::Path;
use uuid::Uuid;

impl AppService {
    pub(super) fn spawn_runtime_server(
        &self,
        input: &RuntimeStartInput<'_>,
    ) -> Result<SpawnedRuntimeServer> {
        let port = pick_free_port()?;
        let runtime_id = format!("runtime-{}", Uuid::new_v4().simple());
        let mut child = spawn_opencode_server(
            Path::new(input.working_directory.as_str()),
            Path::new(input.repo_path),
            TASK_METADATA_NAMESPACE,
            port,
        )?;
        let opencode_process_guard = match self.track_pending_opencode_process(child.id()) {
            Ok(guard) => guard,
            Err(error) => {
                let tracking_error = anyhow!(error).context(input.tracking_error_context);
                if let Err(cleanup_error) = Self::cleanup_started_runtime(
                    &mut child,
                    input.cleanup_target.as_ref(),
                ) {
                    return Err(Self::append_cleanup_error(tracking_error, cleanup_error));
                }
                return Err(tracking_error);
            }
        };

        let startup_policy = match self.opencode_startup_readiness_policy() {
            Ok(policy) => policy,
            Err(error) => {
                let startup_policy_error = error.context(input.startup_error_context.clone());
                if let Err(cleanup_error) = Self::cleanup_started_runtime(
                    &mut child,
                    input.cleanup_target.as_ref(),
                ) {
                    return Err(Self::append_cleanup_error(
                        startup_policy_error,
                        cleanup_error,
                    ));
                }
                return Err(startup_policy_error);
            }
        };
        let startup_cancel_epoch = self.startup_cancel_epoch();
        let startup_cancel_snapshot = self.startup_cancel_snapshot();
        self.emit_opencode_startup_event(StartupEventPayload::wait_begin(
            input.startup_scope,
            input.repo_path,
            Some(input.task_id),
            input.role.as_str(),
            port,
            Some(StartupEventCorrelation::new(
                "runtime_id",
                runtime_id.as_str(),
            )),
            Some(startup_policy),
        ));
        let startup_report = match wait_for_local_server_with_process(
            &mut child,
            port,
            startup_policy,
            &startup_cancel_epoch,
            startup_cancel_snapshot,
        ) {
            Ok(report) => report,
            Err(error) => {
                self.emit_opencode_startup_event(StartupEventPayload::failed(
                    input.startup_scope,
                    input.repo_path,
                    Some(input.task_id),
                    input.role.as_str(),
                    port,
                    Some(StartupEventCorrelation::new(
                        "runtime_id",
                        runtime_id.as_str(),
                    )),
                    Some(startup_policy),
                    error.report,
                    error.reason,
                ));
                let startup_error = anyhow!(error).context(input.startup_error_context.clone());
                if let Err(cleanup_error) = Self::cleanup_started_runtime(
                    &mut child,
                    input.cleanup_target.as_ref(),
                ) {
                    return Err(Self::append_cleanup_error(startup_error, cleanup_error));
                }
                return Err(startup_error);
            }
        };
        self.emit_opencode_startup_event(StartupEventPayload::ready(
            input.startup_scope,
            input.repo_path,
            Some(input.task_id),
            input.role.as_str(),
            port,
            Some(StartupEventCorrelation::new(
                "runtime_id",
                runtime_id.as_str(),
            )),
            Some(startup_policy),
            startup_report,
        ));

        Ok(SpawnedRuntimeServer {
            runtime_id,
            port,
            child,
            opencode_process_guard,
        })
    }
}
