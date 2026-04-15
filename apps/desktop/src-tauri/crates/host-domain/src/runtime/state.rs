use super::{AgentRuntimeKind, RuntimeDescriptor, RuntimeRoute};
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Starting,
    Running,
    Blocked,
    AwaitingDoneConfirmation,
    Completed,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeRole {
    Workspace,
    Spec,
    Planner,
    Build,
    Qa,
}

impl RuntimeRole {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Workspace => "workspace",
            Self::Spec => "spec",
            Self::Planner => "planner",
            Self::Build => "build",
            Self::Qa => "qa",
        }
    }
}

impl fmt::Display for RuntimeRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BuildContinuationTargetSource {
    ActiveBuildRun,
    BuilderSession,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuildContinuationTarget {
    pub working_directory: String,
    pub source: BuildContinuationTargetSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub run_id: String,
    pub runtime_kind: AgentRuntimeKind,
    pub runtime_route: RuntimeRoute,
    pub repo_path: String,
    pub task_id: String,
    pub branch: String,
    pub worktree_path: String,
    pub port: Option<u16>,
    pub state: RunState,
    pub last_message: Option<String>,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInstanceSummary {
    pub kind: AgentRuntimeKind,
    pub runtime_id: String,
    pub repo_path: String,
    pub task_id: Option<String>,
    pub role: RuntimeRole,
    pub working_directory: String,
    pub runtime_route: RuntimeRoute,
    pub started_at: String,
    pub descriptor: RuntimeDescriptor,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepoRuntimeStartupStage {
    Idle,
    StartupRequested,
    WaitingForRuntime,
    RuntimeReady,
    StartupFailed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepoRuntimeStartupFailureKind {
    Timeout,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoRuntimeStartupStatus {
    pub runtime_kind: AgentRuntimeKind,
    pub repo_path: String,
    pub stage: RepoRuntimeStartupStage,
    pub runtime: Option<RuntimeInstanceSummary>,
    pub started_at: Option<String>,
    pub updated_at: String,
    pub elapsed_ms: Option<u64>,
    pub attempts: Option<u32>,
    pub failure_kind: Option<RepoRuntimeStartupFailureKind>,
    pub failure_reason: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepoRuntimeHealthState {
    Idle,
    Checking,
    Ready,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepoRuntimeHealthObservation {
    ObservedExistingRuntime,
    ObservingExistingStartup,
    StartedByDiagnostics,
    RestartedForMcp,
    RestartSkippedActiveRun,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoRuntimeHealthRuntime {
    pub status: RepoRuntimeHealthState,
    pub stage: RepoRuntimeStartupStage,
    pub observation: Option<RepoRuntimeHealthObservation>,
    pub instance: Option<RuntimeInstanceSummary>,
    pub started_at: Option<String>,
    pub updated_at: String,
    pub elapsed_ms: Option<u64>,
    pub attempts: Option<u32>,
    pub detail: Option<String>,
    pub failure_kind: Option<RepoRuntimeStartupFailureKind>,
    pub failure_reason: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepoRuntimeMcpStatus {
    WaitingForRuntime,
    Checking,
    Reconnecting,
    Connected,
    Error,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoRuntimeHealthMcp {
    pub supported: bool,
    pub status: RepoRuntimeMcpStatus,
    pub server_name: String,
    pub server_status: Option<String>,
    pub tool_ids: Vec<String>,
    pub detail: Option<String>,
    pub failure_kind: Option<RepoRuntimeStartupFailureKind>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoRuntimeHealthCheck {
    pub status: RepoRuntimeHealthState,
    pub checked_at: String,
    pub runtime: RepoRuntimeHealthRuntime,
    pub mcp: Option<RepoRuntimeHealthMcp>,
}
