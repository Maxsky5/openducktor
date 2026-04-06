use host_domain::{
    RepoRuntimeHealthCheck, RepoRuntimeHealthMcp, RepoRuntimeHealthObservation,
    RepoRuntimeHealthRuntime, RepoRuntimeHealthState, RepoRuntimeMcpStatus,
    RepoRuntimeStartupFailureKind, RepoRuntimeStartupStage, RepoRuntimeStartupStatus,
    RuntimeInstanceSummary,
};

const ODT_MCP_SERVER_NAME: &str = "openducktor";

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum RuntimeHealthWorkflowStage {
    Idle,
    StartupRequested,
    WaitingForRuntime,
    RuntimeReady,
    CheckingMcpStatus,
    ReconnectingMcp,
    RestartingRuntime,
    RestartSkippedActiveRun,
    Ready,
    StartupFailed,
}

#[derive(Clone)]
pub(super) struct RuntimeHealthProgress {
    pub(super) stage: RuntimeHealthWorkflowStage,
    pub(super) observation: Option<RepoRuntimeHealthObservation>,
    pub(super) host: Option<RepoRuntimeStartupStatus>,
    pub(super) failure_reason: Option<String>,
    pub(super) started_at: Option<String>,
    pub(super) updated_at: Option<String>,
    pub(super) elapsed_ms: Option<u64>,
    pub(super) attempts: Option<u32>,
}

pub(super) struct RepoRuntimeProgressInput {
    pub(super) stage: RuntimeHealthWorkflowStage,
    pub(super) observation: Option<RepoRuntimeHealthObservation>,
    pub(super) host: Option<RepoRuntimeStartupStatus>,
    pub(super) checked_at: String,
    pub(super) failure_reason: Option<String>,
    pub(super) started_at: Option<String>,
    pub(super) updated_at: Option<String>,
    pub(super) elapsed_ms: Option<u64>,
    pub(super) attempts: Option<u32>,
}

pub(super) struct RepoRuntimeHealthCheckInput {
    pub(super) checked_at: String,
    pub(super) runtime: Option<RuntimeInstanceSummary>,
    pub(super) runtime_ok: bool,
    pub(super) runtime_error: Option<String>,
    pub(super) runtime_failure_kind: Option<RepoRuntimeStartupFailureKind>,
    pub(super) supports_mcp_status: bool,
    pub(super) mcp_ok: bool,
    pub(super) mcp_error: Option<String>,
    pub(super) mcp_failure_kind: Option<RepoRuntimeStartupFailureKind>,
    pub(super) mcp_server_status: Option<String>,
    pub(super) available_tool_ids: Vec<String>,
    pub(super) progress: Option<RuntimeHealthProgress>,
}

pub(super) fn repo_runtime_progress(input: RepoRuntimeProgressInput) -> RuntimeHealthProgress {
    let host_started_at = input
        .host
        .as_ref()
        .and_then(|value| value.started_at.clone());
    let host_updated_at = input.host.as_ref().map(|value| value.updated_at.clone());
    let host_elapsed_ms = input.host.as_ref().and_then(|value| value.elapsed_ms);
    let host_attempts = input.host.as_ref().and_then(|value| value.attempts);
    let host_failure_reason = input
        .host
        .as_ref()
        .and_then(|value| value.failure_reason.clone());

    RuntimeHealthProgress {
        stage: input.stage,
        observation: input.observation,
        host: input.host,
        started_at: input.started_at.or(host_started_at),
        updated_at: Some(
            input
                .updated_at
                .or(host_updated_at)
                .unwrap_or(input.checked_at),
        ),
        elapsed_ms: input.elapsed_ms.or(host_elapsed_ms),
        attempts: input.attempts.or(host_attempts),
        failure_reason: input.failure_reason.or(host_failure_reason),
    }
}

pub(super) fn build_repo_runtime_health_check(
    input: RepoRuntimeHealthCheckInput,
) -> RepoRuntimeHealthCheck {
    let runtime = build_runtime_component(&input);
    let mcp = build_mcp_component(&input, &runtime);
    RepoRuntimeHealthCheck {
        status: summarize_repo_runtime_health_status(&runtime, mcp.as_ref()),
        checked_at: input.checked_at,
        runtime,
        mcp,
    }
}

pub(super) fn map_startup_stage_to_health(
    stage: RepoRuntimeStartupStage,
) -> RuntimeHealthWorkflowStage {
    match stage {
        RepoRuntimeStartupStage::Idle => RuntimeHealthWorkflowStage::Idle,
        RepoRuntimeStartupStage::StartupRequested => RuntimeHealthWorkflowStage::StartupRequested,
        RepoRuntimeStartupStage::WaitingForRuntime => RuntimeHealthWorkflowStage::WaitingForRuntime,
        RepoRuntimeStartupStage::RuntimeReady => RuntimeHealthWorkflowStage::RuntimeReady,
        RepoRuntimeStartupStage::StartupFailed => RuntimeHealthWorkflowStage::StartupFailed,
    }
}

pub(super) fn map_startup_stage_to_failed_health(
    stage: RepoRuntimeStartupStage,
) -> RuntimeHealthWorkflowStage {
    match stage {
        RepoRuntimeStartupStage::Idle => RuntimeHealthWorkflowStage::StartupFailed,
        RepoRuntimeStartupStage::StartupRequested => RuntimeHealthWorkflowStage::StartupRequested,
        RepoRuntimeStartupStage::WaitingForRuntime => RuntimeHealthWorkflowStage::WaitingForRuntime,
        RepoRuntimeStartupStage::RuntimeReady => RuntimeHealthWorkflowStage::RuntimeReady,
        RepoRuntimeStartupStage::StartupFailed => RuntimeHealthWorkflowStage::StartupFailed,
    }
}

fn build_runtime_component(input: &RepoRuntimeHealthCheckInput) -> RepoRuntimeHealthRuntime {
    let progress = input.progress.as_ref();
    let workflow_stage = progress
        .map(|value| value.stage)
        .unwrap_or_else(|| default_workflow_stage(input));
    RepoRuntimeHealthRuntime {
        status: summarize_runtime_status(workflow_stage),
        stage: runtime_stage_from_progress(workflow_stage, progress),
        observation: progress.and_then(|value| value.observation),
        instance: input.runtime.clone(),
        started_at: progress
            .and_then(|value| value.started_at.clone())
            .or_else(|| input.runtime.as_ref().map(|value| value.started_at.clone())),
        updated_at: progress
            .and_then(|value| value.updated_at.clone())
            .unwrap_or_else(|| input.checked_at.clone()),
        elapsed_ms: progress.and_then(|value| value.elapsed_ms),
        attempts: progress.and_then(|value| value.attempts),
        detail: input.runtime_error.clone(),
        failure_kind: input.runtime_failure_kind,
        failure_reason: progress.and_then(|value| value.failure_reason.clone()),
    }
}

fn build_mcp_component(
    input: &RepoRuntimeHealthCheckInput,
    runtime: &RepoRuntimeHealthRuntime,
) -> Option<RepoRuntimeHealthMcp> {
    if !input.supports_mcp_status {
        return None;
    }

    Some(RepoRuntimeHealthMcp {
        supported: true,
        status: summarize_mcp_status(input, runtime),
        server_name: ODT_MCP_SERVER_NAME.to_string(),
        server_status: input.mcp_server_status.clone(),
        tool_ids: if input.mcp_ok {
            input.available_tool_ids.clone()
        } else {
            Vec::new()
        },
        detail: input.mcp_error.clone(),
        failure_kind: input.mcp_failure_kind,
    })
}

fn summarize_repo_runtime_health_status(
    runtime: &RepoRuntimeHealthRuntime,
    mcp: Option<&RepoRuntimeHealthMcp>,
) -> RepoRuntimeHealthState {
    match runtime.status {
        RepoRuntimeHealthState::Error => return RepoRuntimeHealthState::Error,
        RepoRuntimeHealthState::Checking => return RepoRuntimeHealthState::Checking,
        RepoRuntimeHealthState::Idle => return RepoRuntimeHealthState::Idle,
        RepoRuntimeHealthState::Ready => {}
    }

    match mcp.map(|value| value.status) {
        Some(RepoRuntimeMcpStatus::Connected) | Some(RepoRuntimeMcpStatus::Unsupported) | None => {
            RepoRuntimeHealthState::Ready
        }
        Some(
            RepoRuntimeMcpStatus::WaitingForRuntime
            | RepoRuntimeMcpStatus::Checking
            | RepoRuntimeMcpStatus::Reconnecting,
        ) => RepoRuntimeHealthState::Checking,
        Some(RepoRuntimeMcpStatus::Error) => RepoRuntimeHealthState::Error,
    }
}

fn summarize_runtime_status(stage: RuntimeHealthWorkflowStage) -> RepoRuntimeHealthState {
    match stage {
        RuntimeHealthWorkflowStage::Idle => RepoRuntimeHealthState::Idle,
        RuntimeHealthWorkflowStage::StartupRequested
        | RuntimeHealthWorkflowStage::WaitingForRuntime
        | RuntimeHealthWorkflowStage::RestartingRuntime => RepoRuntimeHealthState::Checking,
        RuntimeHealthWorkflowStage::RuntimeReady
        | RuntimeHealthWorkflowStage::CheckingMcpStatus
        | RuntimeHealthWorkflowStage::ReconnectingMcp
        | RuntimeHealthWorkflowStage::RestartSkippedActiveRun
        | RuntimeHealthWorkflowStage::Ready => RepoRuntimeHealthState::Ready,
        RuntimeHealthWorkflowStage::StartupFailed => RepoRuntimeHealthState::Error,
    }
}

fn summarize_mcp_status(
    input: &RepoRuntimeHealthCheckInput,
    runtime: &RepoRuntimeHealthRuntime,
) -> RepoRuntimeMcpStatus {
    if runtime.status != RepoRuntimeHealthState::Ready {
        return match runtime.status {
            RepoRuntimeHealthState::Idle | RepoRuntimeHealthState::Checking => {
                RepoRuntimeMcpStatus::WaitingForRuntime
            }
            RepoRuntimeHealthState::Error => RepoRuntimeMcpStatus::Error,
            RepoRuntimeHealthState::Ready => unreachable!("ready status excluded by guard"),
        };
    }
    if input.mcp_ok {
        return RepoRuntimeMcpStatus::Connected;
    }
    if input.mcp_failure_kind.is_some() || input.mcp_error.is_some() {
        return RepoRuntimeMcpStatus::Error;
    }

    match input.progress.as_ref().map(|value| value.stage) {
        Some(RuntimeHealthWorkflowStage::ReconnectingMcp) => RepoRuntimeMcpStatus::Reconnecting,
        Some(RuntimeHealthWorkflowStage::CheckingMcpStatus) => RepoRuntimeMcpStatus::Checking,
        _ => RepoRuntimeMcpStatus::Checking,
    }
}

fn runtime_stage_from_progress(
    stage: RuntimeHealthWorkflowStage,
    progress: Option<&RuntimeHealthProgress>,
) -> RepoRuntimeStartupStage {
    if let Some(host_stage) = progress.and_then(|value| value.host.as_ref().map(|host| host.stage))
    {
        return host_stage;
    }

    match stage {
        RuntimeHealthWorkflowStage::Idle => RepoRuntimeStartupStage::Idle,
        RuntimeHealthWorkflowStage::StartupRequested
        | RuntimeHealthWorkflowStage::RestartingRuntime => {
            RepoRuntimeStartupStage::StartupRequested
        }
        RuntimeHealthWorkflowStage::WaitingForRuntime => RepoRuntimeStartupStage::WaitingForRuntime,
        RuntimeHealthWorkflowStage::RuntimeReady
        | RuntimeHealthWorkflowStage::CheckingMcpStatus
        | RuntimeHealthWorkflowStage::ReconnectingMcp
        | RuntimeHealthWorkflowStage::RestartSkippedActiveRun
        | RuntimeHealthWorkflowStage::Ready => RepoRuntimeStartupStage::RuntimeReady,
        RuntimeHealthWorkflowStage::StartupFailed => RepoRuntimeStartupStage::StartupFailed,
    }
}

fn default_workflow_stage(input: &RepoRuntimeHealthCheckInput) -> RuntimeHealthWorkflowStage {
    if input.runtime_ok {
        if input.mcp_ok {
            RuntimeHealthWorkflowStage::Ready
        } else {
            RuntimeHealthWorkflowStage::RuntimeReady
        }
    } else if input.runtime_failure_kind.is_some() || input.runtime_error.is_some() {
        RuntimeHealthWorkflowStage::StartupFailed
    } else {
        RuntimeHealthWorkflowStage::Idle
    }
}
