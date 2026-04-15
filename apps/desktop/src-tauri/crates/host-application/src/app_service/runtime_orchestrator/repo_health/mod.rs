use super::repo_health_snapshot::{
    build_repo_runtime_health_check, map_startup_stage_to_failed_health,
    map_startup_stage_to_health, repo_runtime_progress, RepoRuntimeHealthCheckInput,
    RepoRuntimeProgressInput, RuntimeHealthWorkflowStage,
};
use super::AppService;
use crate::app_service::runtime_registry::{ResolvedRuntimeMcpStatus, RuntimeHealthCheckFailure};
use crate::app_service::service_core::{RepoRuntimeHealthFlight, RepoRuntimeHealthFlightState};
use crate::app_service::OpencodeStartupWaitFailure;
use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use host_domain::{
    now_rfc3339, AgentRuntimeKind, RepoRuntimeHealthCheck, RepoRuntimeHealthObservation,
    RepoRuntimeStartupFailureKind, RepoRuntimeStartupStage, RepoRuntimeStartupStatus, RunState,
    RuntimeInstanceSummary, RuntimeRoute,
};
use std::sync::Arc;
use std::time::Duration;

mod flights;
mod mcp;
mod orchestration;
mod status;

#[cfg(test)]
mod tests;

const MCP_CONNECT_STARTUP_GRACE_PERIOD: Duration = Duration::from_secs(10);
const MCP_CONNECT_STATUS_RETRY_DELAY: Duration = Duration::from_millis(250);

pub(in crate::app_service::runtime_orchestrator) struct CompleteRepoRuntimeHealthInput {
    repo_key: String,
    checked_at: String,
    runtime_kind: AgentRuntimeKind,
    runtime: RuntimeInstanceSummary,
    host_status: Option<RepoRuntimeStartupStatus>,
    observation: Option<RepoRuntimeHealthObservation>,
    allow_restart: bool,
}

fn repo_runtime_is_within_mcp_startup_grace_window(
    runtime: &RuntimeInstanceSummary,
    host_status: Option<&RepoRuntimeStartupStatus>,
    checked_at: &str,
) -> bool {
    if host_status.is_some_and(|status| {
        matches!(
            status.stage,
            RepoRuntimeStartupStage::StartupRequested | RepoRuntimeStartupStage::WaitingForRuntime
        )
    }) {
        return true;
    }

    let Ok(started_at) = DateTime::parse_from_rfc3339(runtime.started_at.as_str()) else {
        return false;
    };
    let Ok(checked_at) = DateTime::parse_from_rfc3339(checked_at) else {
        return false;
    };

    let elapsed = checked_at.with_timezone(&Utc) - started_at.with_timezone(&Utc);
    elapsed >= chrono::TimeDelta::zero()
        && elapsed
            .to_std()
            .is_ok_and(|duration| duration <= MCP_CONNECT_STARTUP_GRACE_PERIOD)
}
