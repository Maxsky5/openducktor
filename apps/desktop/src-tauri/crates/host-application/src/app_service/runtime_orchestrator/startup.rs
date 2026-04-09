use super::super::{
    wait_for_local_server_with_process, AppService, OpencodeStartupReadinessPolicy,
    OpencodeStartupWaitReport, StartupEventContext, StartupEventCorrelation, StartupEventPayload,
    STARTUP_CONFIG_INVALID_REASON,
};
use super::{RuntimeStartInput, SpawnedRuntimeServer};
use anyhow::{anyhow, Context, Result};
use host_domain::{RuntimeRole, TASK_METADATA_NAMESPACE};
use host_infra_system::pick_free_port;
use std::path::Path;
use uuid::Uuid;

impl AppService {
    pub(crate) fn resolve_runtime_startup_policy(
        &self,
        startup_scope: &str,
        repo_path: &str,
        task_id: &str,
        role: RuntimeRole,
        startup_error_context: &str,
    ) -> Result<OpencodeStartupReadinessPolicy> {
        self.opencode_startup_readiness_policy()
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
                    OpencodeStartupWaitReport::zero(),
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
            input.runtime_kind,
            input.repo_key.as_str(),
            &super::RuntimeStartupProgress {
                started_at_instant: input.startup_started_at_instant,
                started_at: input.startup_started_at.clone(),
                attempts: Some(0),
                elapsed_ms: None,
            },
        )?;
        let port = pick_free_port()?;
        let runtime_id = format!("runtime-{}", Uuid::new_v4().simple());
        let startup_policy = input.startup_policy;
        let mut child = self.spawn_opencode_server(
            Path::new(input.working_directory.as_str()),
            Path::new(input.repo_path),
            TASK_METADATA_NAMESPACE,
            port,
        )?;
        let opencode_process_guard = match self.track_pending_opencode_process(child.id()) {
            Ok(guard) => guard,
            Err(error) => {
                let tracking_error = anyhow!(error).context(input.tracking_error_context);
                if let Err(cleanup_error) =
                    Self::cleanup_started_runtime(&mut child, input.cleanup_target.as_ref())
                {
                    return Err(Self::append_cleanup_error(tracking_error, cleanup_error));
                }
                return Err(tracking_error);
            }
        };
        let startup_cancel_epoch = self.startup_cancel_epoch();
        let startup_cancel_snapshot = self.startup_cancel_snapshot();
        self.emit_opencode_startup_event(StartupEventPayload::wait_begin(
            StartupEventContext::new(
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
            ),
        ));
        let startup_report = match wait_for_local_server_with_process(
            &mut child,
            port,
            startup_policy,
            &startup_cancel_epoch,
            startup_cancel_snapshot,
            |progress| {
                let _ = self.mark_runtime_startup_waiting(
                    input.runtime_kind,
                    input.repo_key.as_str(),
                    &super::RuntimeStartupProgress {
                        started_at_instant: input.startup_started_at_instant,
                        started_at: input.startup_started_at.clone(),
                        attempts: Some(progress.report.attempts()),
                        elapsed_ms: None,
                    },
                );
            },
        ) {
            Ok(report) => report,
            Err(error) => {
                self.emit_opencode_startup_event(StartupEventPayload::failed(
                    StartupEventContext::new(
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
                    ),
                    error.report(),
                    error.reason,
                ));
                let startup_error = anyhow!(error).context(input.startup_error_context.clone());
                if let Err(cleanup_error) =
                    Self::cleanup_started_runtime(&mut child, input.cleanup_target.as_ref())
                {
                    return Err(Self::append_cleanup_error(startup_error, cleanup_error));
                }
                return Err(startup_error);
            }
        };
        self.emit_opencode_startup_event(StartupEventPayload::ready(
            StartupEventContext::new(
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
            ),
            startup_report,
        ));

        Ok(SpawnedRuntimeServer {
            runtime_id,
            port,
            child,
            opencode_process_guard,
            startup_started_at_instant: input.startup_started_at_instant,
            startup_started_at: input.startup_started_at.clone(),
            startup_report,
        })
    }
}
