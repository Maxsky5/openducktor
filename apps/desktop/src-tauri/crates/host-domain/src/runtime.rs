use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;
use url::Url;

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
pub enum AgentRuntimeKind {
    Opencode,
}

impl AgentRuntimeKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Opencode => "opencode",
        }
    }

    pub fn descriptor(self) -> RuntimeDescriptor {
        match self {
            Self::Opencode => RuntimeDescriptor {
                kind: self,
                label: "OpenCode".to_string(),
                description: "OpenCode local runtime with OpenDucktor MCP integration.".to_string(),
                read_only_role_blocked_tools: vec![
                    "edit".to_string(),
                    "write".to_string(),
                    "apply_patch".to_string(),
                    "ast_grep_replace".to_string(),
                    "lsp_rename".to_string(),
                ],
                workflow_tool_aliases_by_canonical: opencode_workflow_tool_aliases_by_canonical(),
                capabilities: RuntimeCapabilities {
                    supports_profiles: true,
                    supports_variants: true,
                    supports_slash_commands: true,
                    supports_file_search: true,
                    supports_odt_workflow_tools: true,
                    supports_session_fork: true,
                    supports_queued_user_messages: true,
                    supports_permission_requests: true,
                    supports_question_requests: true,
                    supports_todos: true,
                    supports_diff: true,
                    supports_file_status: true,
                    supports_mcp_status: true,
                    supported_scopes: REQUIRED_RUNTIME_SUPPORTED_SCOPES.to_vec(),
                    provisioning_mode: RuntimeProvisioningMode::HostManaged,
                },
            },
        }
    }

    pub fn endpoint_for_port(self, port: u16) -> String {
        match self {
            Self::Opencode => {
                let mut endpoint = String::new();
                endpoint.push_str("http://127.0.0.1:");
                endpoint.push_str(port.to_string().as_str());
                endpoint
            }
        }
    }

    pub fn route_for_port(self, port: u16) -> RuntimeRoute {
        RuntimeRoute::LocalHttp {
            endpoint: self.endpoint_for_port(port),
        }
    }
}

// Keep this list in sync with `agentToolNameValues` in
// `packages/contracts/src/agent-workflow-schemas.ts`.
const ODT_WORKFLOW_TOOL_NAMES: [&str; 10] = [
    "odt_read_task",
    "odt_read_task_documents",
    "odt_set_spec",
    "odt_set_plan",
    "odt_build_blocked",
    "odt_build_resumed",
    "odt_build_completed",
    "odt_set_pull_request",
    "odt_qa_approved",
    "odt_qa_rejected",
];

const OPENCODE_ODT_WORKFLOW_TOOL_PREFIXES: [&str; 2] = ["openducktor_", "functions.openducktor_"];

fn opencode_workflow_tool_aliases_by_canonical() -> BTreeMap<String, Vec<String>> {
    ODT_WORKFLOW_TOOL_NAMES
        .iter()
        .map(|tool_name| {
            (
                (*tool_name).to_string(),
                OPENCODE_ODT_WORKFLOW_TOOL_PREFIXES
                    .iter()
                    .map(|prefix| format!("{prefix}{tool_name}"))
                    .collect::<Vec<_>>(),
            )
        })
        .collect()
}

impl fmt::Display for AgentRuntimeKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeProvisioningMode {
    HostManaged,
    External,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeSupportedScope {
    Workspace,
    Task,
    Build,
}

impl RuntimeSupportedScope {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Workspace => "workspace",
            Self::Task => "task",
            Self::Build => "build",
        }
    }
}

impl fmt::Display for RuntimeSupportedScope {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

pub const REQUIRED_RUNTIME_SUPPORTED_SCOPES: [RuntimeSupportedScope; 3] = [
    RuntimeSupportedScope::Workspace,
    RuntimeSupportedScope::Task,
    RuntimeSupportedScope::Build,
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCapabilities {
    pub supports_profiles: bool,
    pub supports_variants: bool,
    pub supports_slash_commands: bool,
    pub supports_file_search: bool,
    pub supports_odt_workflow_tools: bool,
    pub supports_session_fork: bool,
    pub supports_queued_user_messages: bool,
    pub supports_permission_requests: bool,
    pub supports_question_requests: bool,
    pub supports_todos: bool,
    pub supports_diff: bool,
    pub supports_file_status: bool,
    pub supports_mcp_status: bool,
    pub supported_scopes: Vec<RuntimeSupportedScope>,
    pub provisioning_mode: RuntimeProvisioningMode,
}

impl RuntimeCapabilities {
    pub fn missing_mandatory_capabilities(&self) -> Vec<&'static str> {
        let mut missing = Vec::new();
        if !self.supports_odt_workflow_tools {
            missing.push("supports_odt_workflow_tools");
        }
        if !self.supports_session_fork {
            missing.push("supports_session_fork");
        }
        missing
    }

    pub fn missing_required_supported_scopes(&self) -> Vec<RuntimeSupportedScope> {
        REQUIRED_RUNTIME_SUPPORTED_SCOPES
            .iter()
            .copied()
            .filter(|scope| !self.supported_scopes.contains(scope))
            .collect()
    }

    pub fn supports_all_workflow_scopes(&self) -> bool {
        self.missing_required_supported_scopes().is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDescriptor {
    pub kind: AgentRuntimeKind,
    pub label: String,
    pub description: String,
    pub read_only_role_blocked_tools: Vec<String>,
    pub workflow_tool_aliases_by_canonical: BTreeMap<String, Vec<String>>,
    pub capabilities: RuntimeCapabilities,
}

impl RuntimeDescriptor {
    pub fn validate_for_openducktor(&self) -> Vec<String> {
        let mut errors = Vec::new();

        let missing_mandatory_capabilities = self.capabilities.missing_mandatory_capabilities();
        if !missing_mandatory_capabilities.is_empty() {
            errors.push(format!(
                "missing mandatory capabilities: {}",
                missing_mandatory_capabilities.join(", ")
            ));
        }

        let missing_supported_scopes = self.capabilities.missing_required_supported_scopes();
        if !missing_supported_scopes.is_empty() {
            errors.push(format!(
                "missing required workflow scopes: {}",
                missing_supported_scopes
                    .into_iter()
                    .map(|scope| scope.to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }

        errors
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
pub enum RuntimeRoute {
    LocalHttp { endpoint: String },
    Stdio,
}

impl RuntimeRoute {
    pub fn local_http_port(&self) -> Option<u16> {
        match self {
            Self::LocalHttp { endpoint } => Url::parse(endpoint).ok()?.port(),
            Self::Stdio => None,
        }
    }
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DevServerScriptStatus {
    Stopped,
    Starting,
    Running,
    Stopping,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DevServerTerminalChunk {
    pub script_id: String,
    pub sequence: u64,
    pub data: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DevServerScriptState {
    pub script_id: String,
    pub name: String,
    pub command: String,
    pub status: DevServerScriptStatus,
    pub pid: Option<u32>,
    pub started_at: Option<String>,
    pub exit_code: Option<i32>,
    pub last_error: Option<String>,
    #[serde(default)]
    pub buffered_terminal_chunks: Vec<DevServerTerminalChunk>,
    #[serde(skip)]
    pub next_terminal_sequence: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DevServerGroupState {
    pub repo_path: String,
    pub task_id: String,
    pub worktree_path: Option<String>,
    #[serde(default)]
    pub scripts: Vec<DevServerScriptState>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
#[serde(rename_all_fields = "camelCase")]
pub enum DevServerEvent {
    Snapshot {
        state: DevServerGroupState,
    },
    ScriptStatusChanged {
        repo_path: String,
        task_id: String,
        script: DevServerScriptState,
        updated_at: String,
    },
    TerminalChunk {
        repo_path: String,
        task_id: String,
        terminal_chunk: DevServerTerminalChunk,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
pub enum RunEvent {
    RunStarted {
        run_id: String,
        message: String,
        timestamp: String,
    },
    AgentThought {
        run_id: String,
        message: String,
        timestamp: String,
    },
    ToolExecution {
        run_id: String,
        message: String,
        timestamp: String,
    },
    PermissionRequired {
        run_id: String,
        message: String,
        command: Option<String>,
        timestamp: String,
    },
    PostHookStarted {
        run_id: String,
        message: String,
        timestamp: String,
    },
    PostHookFailed {
        run_id: String,
        message: String,
        timestamp: String,
    },
    ReadyForManualDoneConfirmation {
        run_id: String,
        message: String,
        timestamp: String,
    },
    RunFinished {
        run_id: String,
        message: String,
        timestamp: String,
        success: bool,
    },
    Error {
        run_id: String,
        message: String,
        timestamp: String,
    },
}

#[cfg(test)]
mod tests {
    use super::{
        AgentRuntimeKind, DevServerEvent, DevServerGroupState, DevServerScriptState,
        DevServerScriptStatus, DevServerTerminalChunk, RuntimeCapabilities, RuntimeDescriptor,
        RuntimeProvisioningMode, RuntimeRoute, RuntimeSupportedScope,
        REQUIRED_RUNTIME_SUPPORTED_SCOPES,
    };
    use std::collections::BTreeMap;

    fn capabilities_with_scopes(scopes: Vec<RuntimeSupportedScope>) -> RuntimeCapabilities {
        RuntimeCapabilities {
            supports_profiles: true,
            supports_variants: true,
            supports_slash_commands: true,
            supports_file_search: true,
            supports_odt_workflow_tools: true,
            supports_session_fork: true,
            supports_queued_user_messages: true,
            supports_permission_requests: true,
            supports_question_requests: true,
            supports_todos: true,
            supports_diff: true,
            supports_file_status: true,
            supports_mcp_status: true,
            supported_scopes: scopes,
            provisioning_mode: RuntimeProvisioningMode::HostManaged,
        }
    }

    #[test]
    fn missing_required_supported_scopes_reports_uncovered_workflow_scopes() {
        let capabilities = capabilities_with_scopes(vec![RuntimeSupportedScope::Workspace]);

        assert_eq!(
            capabilities.missing_required_supported_scopes(),
            vec![RuntimeSupportedScope::Task, RuntimeSupportedScope::Build]
        );
        assert!(!capabilities.supports_all_workflow_scopes());
    }

    #[test]
    fn supports_all_workflow_scopes_accepts_full_runtime_scope_coverage() {
        let capabilities = capabilities_with_scopes(REQUIRED_RUNTIME_SUPPORTED_SCOPES.to_vec());

        assert!(capabilities.missing_required_supported_scopes().is_empty());
        assert!(capabilities.supports_all_workflow_scopes());
    }

    #[test]
    fn opencode_descriptor_uses_required_workflow_scope_set() {
        let descriptor = AgentRuntimeKind::Opencode.descriptor();

        assert_eq!(
            descriptor.capabilities.supported_scopes,
            REQUIRED_RUNTIME_SUPPORTED_SCOPES.to_vec()
        );
        assert!(descriptor.capabilities.supports_slash_commands);
        assert!(descriptor.capabilities.supports_file_search);
        assert!(descriptor
            .read_only_role_blocked_tools
            .contains(&"apply_patch".to_string()));
        assert!(!descriptor
            .read_only_role_blocked_tools
            .contains(&"bash".to_string()));
        assert_eq!(
            descriptor
                .workflow_tool_aliases_by_canonical
                .get("odt_set_spec")
                .cloned(),
            Some(vec![
                "openducktor_odt_set_spec".to_string(),
                "functions.openducktor_odt_set_spec".to_string(),
            ])
        );
        assert!(descriptor.capabilities.supports_all_workflow_scopes());
    }

    #[test]
    fn runtime_descriptor_validation_reports_mandatory_capabilities_and_scopes() {
        let descriptor = RuntimeDescriptor {
            kind: AgentRuntimeKind::Opencode,
            label: "OpenCode".to_string(),
            description: "desc".to_string(),
            read_only_role_blocked_tools: vec![],
            workflow_tool_aliases_by_canonical: BTreeMap::new(),
            capabilities: RuntimeCapabilities {
                supports_profiles: true,
                supports_variants: true,
                supports_slash_commands: true,
                supports_file_search: true,
                supports_odt_workflow_tools: false,
                supports_session_fork: false,
                supports_queued_user_messages: true,
                supports_permission_requests: true,
                supports_question_requests: true,
                supports_todos: true,
                supports_diff: true,
                supports_file_status: true,
                supports_mcp_status: true,
                supported_scopes: vec![RuntimeSupportedScope::Workspace],
                provisioning_mode: RuntimeProvisioningMode::HostManaged,
            },
        };

        assert_eq!(
            descriptor.validate_for_openducktor(),
            vec![
                "missing mandatory capabilities: supports_odt_workflow_tools, supports_session_fork"
                    .to_string(),
                "missing required workflow scopes: task, build".to_string(),
            ]
        );
    }

    #[test]
    fn dev_server_event_serializes_with_expected_shape() {
        let event = DevServerEvent::TerminalChunk {
            repo_path: "/repo".to_string(),
            task_id: "task-1".to_string(),
            terminal_chunk: DevServerTerminalChunk {
                script_id: "server-1".to_string(),
                sequence: 3,
                data: "\u{1b}[32mready\u{1b}[0m\r\n".to_string(),
                timestamp: "2026-03-19T00:00:00Z".to_string(),
            },
        };

        let json = serde_json::to_value(event).expect("event should serialize");
        assert_eq!(json["type"], "terminal_chunk");
        assert_eq!(json["repoPath"], "/repo");
        assert_eq!(json["taskId"], "task-1");
        assert_eq!(json["terminalChunk"]["sequence"], 3);
        assert_eq!(
            json["terminalChunk"]["data"],
            "\u{1b}[32mready\u{1b}[0m\r\n"
        );
    }

    #[test]
    fn dev_server_group_state_supports_buffered_terminal_chunks() {
        let state = DevServerGroupState {
            repo_path: "/repo".to_string(),
            task_id: "task-1".to_string(),
            worktree_path: Some("/repo/.worktrees/task-1".to_string()),
            scripts: vec![DevServerScriptState {
                script_id: "server-1".to_string(),
                name: "Backend".to_string(),
                command: "bun run dev".to_string(),
                status: DevServerScriptStatus::Running,
                pid: Some(1234),
                started_at: Some("2026-03-19T00:00:00Z".to_string()),
                exit_code: None,
                last_error: None,
                buffered_terminal_chunks: vec![DevServerTerminalChunk {
                    script_id: "server-1".to_string(),
                    sequence: 1,
                    data: "started\r\n".to_string(),
                    timestamp: "2026-03-19T00:00:00Z".to_string(),
                }],
                next_terminal_sequence: 2,
            }],
            updated_at: "2026-03-19T00:00:00Z".to_string(),
        };

        let json = serde_json::to_value(state).expect("state should serialize");
        assert_eq!(
            json["scripts"][0]["bufferedTerminalChunks"][0]["data"],
            "started\r\n"
        );
    }

    #[test]
    fn local_http_route_port_supports_paths() {
        let route = RuntimeRoute::LocalHttp {
            endpoint: "http://127.0.0.1:4321/api/runtime".to_string(),
        };

        assert_eq!(route.local_http_port(), Some(4321));
    }

    #[test]
    fn local_http_route_port_rejects_invalid_endpoints() {
        let route = RuntimeRoute::LocalHttp {
            endpoint: "127.0.0.1:4321".to_string(),
        };

        assert_eq!(route.local_http_port(), None);
    }

    #[test]
    fn stdio_route_serializes_without_endpoint_fields() {
        let json = serde_json::to_value(RuntimeRoute::Stdio).expect("route should serialize");

        assert_eq!(json["type"], "stdio");
        assert!(json.get("endpoint").is_none());
    }

    #[test]
    fn stdio_route_has_no_http_port() {
        assert_eq!(RuntimeRoute::Stdio.local_http_port(), None);
    }
}
