use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;
use std::sync::{Arc, LazyLock};
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(transparent)]
pub struct AgentRuntimeKind(String);

impl AgentRuntimeKind {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn opencode() -> Self {
        Self::new("opencode")
    }

    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }

    pub fn descriptor(&self) -> RuntimeDescriptor {
        builtin_runtime_registry()
            .definition(self)
            .expect("runtime kind should be registered before descriptor lookup")
            .descriptor()
            .clone()
    }

    pub fn endpoint_for_port(&self, port: u16) -> String {
        match self.route_for_port(port) {
            RuntimeRoute::LocalHttp { endpoint } => endpoint,
            RuntimeRoute::Stdio => {
                panic!(
                    "runtime kind {} does not support local_http routes",
                    self.as_str()
                )
            }
        }
    }

    pub fn route_for_port(&self, port: u16) -> RuntimeRoute {
        builtin_runtime_registry()
            .definition(self)
            .expect("runtime kind should be registered before route lookup")
            .route_for_port(port)
    }
}

impl From<&str> for AgentRuntimeKind {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}

impl From<String> for AgentRuntimeKind {
    fn from(value: String) -> Self {
        Self::new(value)
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStartupReadinessConfig {
    pub timeout_ms: u64,
    pub connect_timeout_ms: u64,
    pub initial_retry_delay_ms: u64,
    pub max_retry_delay_ms: u64,
    pub child_check_interval_ms: u64,
}

impl Default for RuntimeStartupReadinessConfig {
    fn default() -> Self {
        Self {
            timeout_ms: 15_000,
            connect_timeout_ms: 250,
            initial_retry_delay_ms: 25,
            max_retry_delay_ms: 250,
            child_check_interval_ms: 75,
        }
    }
}

impl RuntimeStartupReadinessConfig {
    pub fn normalize(&mut self) {
        self.timeout_ms = self.timeout_ms.clamp(15_000, 120_000);
        self.connect_timeout_ms = self.connect_timeout_ms.clamp(25, 10_000);
        self.initial_retry_delay_ms = self.initial_retry_delay_ms.clamp(5, 5_000);
        self.max_retry_delay_ms = self.max_retry_delay_ms.clamp(10, 10_000);
        self.child_check_interval_ms = self.child_check_interval_ms.clamp(10, 2_000);
        if self.max_retry_delay_ms < self.initial_retry_delay_ms {
            self.max_retry_delay_ms = self.initial_retry_delay_ms;
        }
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeDefinition {
    descriptor: RuntimeDescriptor,
    default_startup_config: RuntimeStartupReadinessConfig,
    route_for_port: fn(u16) -> RuntimeRoute,
}

impl RuntimeDefinition {
    pub fn new(
        descriptor: RuntimeDescriptor,
        default_startup_config: RuntimeStartupReadinessConfig,
        route_for_port: fn(u16) -> RuntimeRoute,
    ) -> Self {
        Self {
            descriptor,
            default_startup_config,
            route_for_port,
        }
    }

    pub fn kind(&self) -> &AgentRuntimeKind {
        &self.descriptor.kind
    }

    pub fn descriptor(&self) -> &RuntimeDescriptor {
        &self.descriptor
    }

    pub fn default_startup_config(&self) -> &RuntimeStartupReadinessConfig {
        &self.default_startup_config
    }

    pub fn route_for_port(&self, port: u16) -> RuntimeRoute {
        (self.route_for_port)(port)
    }

    pub fn validate_for_openducktor(&self) -> Vec<String> {
        self.descriptor.validate_for_openducktor()
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeRegistry {
    definitions_by_kind: Arc<BTreeMap<String, RuntimeDefinition>>,
    default_kind: AgentRuntimeKind,
}

impl RuntimeRegistry {
    pub fn new(definitions: Vec<RuntimeDefinition>) -> Result<Self> {
        let mut definitions_by_kind = BTreeMap::new();
        for definition in definitions {
            let kind = definition.kind().as_str().trim().to_string();
            if kind.is_empty() {
                return Err(anyhow!("Registered runtime kind cannot be blank"));
            }
            let validation_errors = definition.validate_for_openducktor();
            if !validation_errors.is_empty() {
                return Err(anyhow!(
                    "Runtime '{}' is incompatible with OpenDucktor: {}.",
                    definition.kind().as_str(),
                    validation_errors.join("; "),
                ));
            }
            if definitions_by_kind
                .insert(kind.clone(), definition)
                .is_some()
            {
                return Err(anyhow!("Duplicate runtime registration: {kind}"));
            }
        }

        let default_kind = definitions_by_kind
            .values()
            .next()
            .map(|definition| definition.kind().clone())
            .ok_or_else(|| anyhow!("Runtime registry requires at least one registered runtime"))?;

        Ok(Self {
            definitions_by_kind: Arc::new(definitions_by_kind),
            default_kind,
        })
    }

    pub fn default_kind(&self) -> &AgentRuntimeKind {
        &self.default_kind
    }

    pub fn definitions(&self) -> Vec<RuntimeDefinition> {
        self.definitions_by_kind.values().cloned().collect()
    }

    pub fn definition(&self, kind: &AgentRuntimeKind) -> Result<&RuntimeDefinition> {
        self.definition_by_str(kind.as_str())
    }

    pub fn definition_by_str(&self, runtime_kind: &str) -> Result<&RuntimeDefinition> {
        let runtime_kind = runtime_kind.trim();
        if runtime_kind.is_empty() {
            return Err(anyhow!("Agent runtime kind cannot be blank"));
        }
        self.definitions_by_kind
            .get(runtime_kind)
            .ok_or_else(|| anyhow!("Unsupported agent runtime kind: {runtime_kind}"))
    }

    pub fn resolve_kind(&self, runtime_kind: &str) -> Result<AgentRuntimeKind> {
        Ok(self.definition_by_str(runtime_kind)?.kind().clone())
    }
}

fn local_http_endpoint_for_port(port: u16) -> String {
    let mut endpoint = String::new();
    endpoint.push_str("http://127.0.0.1:");
    endpoint.push_str(port.to_string().as_str());
    endpoint
}

fn local_http_route_for_port(port: u16) -> RuntimeRoute {
    RuntimeRoute::LocalHttp {
        endpoint: local_http_endpoint_for_port(port),
    }
}

fn opencode_runtime_definition() -> RuntimeDefinition {
    let kind = AgentRuntimeKind::opencode();
    RuntimeDefinition::new(
        RuntimeDescriptor {
            kind,
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
        RuntimeStartupReadinessConfig::default(),
        local_http_route_for_port,
    )
}

static BUILTIN_RUNTIME_REGISTRY: LazyLock<RuntimeRegistry> = LazyLock::new(|| {
    RuntimeRegistry::new(vec![opencode_runtime_definition()])
        .expect("builtin runtime registry should be valid")
});

pub fn builtin_runtime_registry() -> &'static RuntimeRegistry {
    &BUILTIN_RUNTIME_REGISTRY
}

pub fn default_runtime_kind() -> AgentRuntimeKind {
    builtin_runtime_registry().default_kind().clone()
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
        local_http_route_for_port, AgentRuntimeKind, DevServerEvent, DevServerGroupState,
        DevServerScriptState, DevServerScriptStatus, DevServerTerminalChunk, RuntimeCapabilities,
        RuntimeDefinition, RuntimeDescriptor, RuntimeProvisioningMode, RuntimeRegistry,
        RuntimeRoute, RuntimeStartupReadinessConfig, RuntimeSupportedScope,
        REQUIRED_RUNTIME_SUPPORTED_SCOPES,
    };
    use anyhow::Result;
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

    fn runtime_definition(kind: &str, label: &str) -> RuntimeDefinition {
        RuntimeDefinition::new(
            RuntimeDescriptor {
                kind: AgentRuntimeKind::from(kind),
                label: label.to_string(),
                description: format!("{label} runtime"),
                read_only_role_blocked_tools: vec!["apply_patch".to_string()],
                workflow_tool_aliases_by_canonical: BTreeMap::new(),
                capabilities: capabilities_with_scopes(REQUIRED_RUNTIME_SUPPORTED_SCOPES.to_vec()),
            },
            RuntimeStartupReadinessConfig::default(),
            local_http_route_for_port,
        )
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
        let descriptor = super::builtin_runtime_registry()
            .definition_by_str("opencode")
            .expect("opencode runtime should be registered")
            .descriptor()
            .clone();

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
            kind: AgentRuntimeKind::opencode(),
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
    fn runtime_registry_resolves_known_kinds_and_rejects_unknown_entries() -> Result<()> {
        let registry = RuntimeRegistry::new(vec![
            runtime_definition("opencode", "OpenCode"),
            runtime_definition("test-runtime", "Test Runtime"),
        ])
        .expect("runtime registry should build");

        assert_eq!(
            registry.resolve_kind(" test-runtime ")?.as_str(),
            "test-runtime"
        );
        assert_eq!(registry.default_kind().as_str(), "opencode");

        let error = registry
            .resolve_kind("missing-runtime")
            .expect_err("unknown runtime kinds must fail fast");
        assert_eq!(
            error.to_string(),
            "Unsupported agent runtime kind: missing-runtime"
        );

        Ok(())
    }

    #[test]
    fn runtime_registry_exposes_multiple_descriptors_without_generic_code_changes() {
        let registry = RuntimeRegistry::new(vec![
            runtime_definition("opencode", "OpenCode"),
            runtime_definition("test-runtime", "Test Runtime"),
        ])
        .expect("runtime registry should build");

        let definitions = registry.definitions();
        assert_eq!(definitions.len(), 2);
        assert_eq!(definitions[0].kind().as_str(), "opencode");
        assert_eq!(definitions[1].kind().as_str(), "test-runtime");
        assert_eq!(
            definitions[1].route_for_port(4311).local_http_port(),
            Some(4311)
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
