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
pub enum AgentRuntimeKind {
    Opencode,
}

impl AgentRuntimeKind {
    pub fn descriptor(self) -> RuntimeDescriptor {
        match self {
            Self::Opencode => RuntimeDescriptor {
                kind: self,
                label: "OpenCode".to_string(),
                description: "OpenCode local runtime with OpenDucktor MCP integration.".to_string(),
                capabilities: RuntimeCapabilities {
                    supports_session_lifecycle: true,
                    supports_streaming_events: true,
                    supports_model_catalog: true,
                    supports_profiles: true,
                    supports_variants: true,
                    supports_workflow_tools: true,
                    supports_permission_requests: true,
                    supports_question_requests: true,
                    supports_history: true,
                    supports_todos: true,
                    supports_diff: true,
                    supports_file_status: true,
                    supports_diagnostics: true,
                    supports_workspace_runtime: true,
                    supports_task_runtime: true,
                    supports_build_runtime: true,
                    supports_mcp_status: true,
                    supports_mcp_connect: true,
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
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeProvisioningMode {
    HostManaged,
    External,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCapabilities {
    pub supports_session_lifecycle: bool,
    pub supports_streaming_events: bool,
    pub supports_model_catalog: bool,
    pub supports_profiles: bool,
    pub supports_variants: bool,
    pub supports_workflow_tools: bool,
    pub supports_permission_requests: bool,
    pub supports_question_requests: bool,
    pub supports_history: bool,
    pub supports_todos: bool,
    pub supports_diff: bool,
    pub supports_file_status: bool,
    pub supports_diagnostics: bool,
    pub supports_workspace_runtime: bool,
    pub supports_task_runtime: bool,
    pub supports_build_runtime: bool,
    pub supports_mcp_status: bool,
    pub supports_mcp_connect: bool,
    pub provisioning_mode: RuntimeProvisioningMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDescriptor {
    pub kind: AgentRuntimeKind,
    pub label: String,
    pub description: String,
    pub capabilities: RuntimeCapabilities,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeRole {
    Workspace,
    Spec,
    Planner,
    Qa,
}

impl RuntimeRole {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Workspace => "workspace",
            Self::Spec => "spec",
            Self::Planner => "planner",
            Self::Qa => "qa",
        }
    }
}

impl fmt::Display for RuntimeRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum AgentRuntimeRole {
    Spec,
    Planner,
    Qa,
}

impl AgentRuntimeRole {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Spec => "spec",
            Self::Planner => "planner",
            Self::Qa => "qa",
        }
    }
}

impl fmt::Display for AgentRuntimeRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl From<AgentRuntimeRole> for RuntimeRole {
    fn from(value: AgentRuntimeRole) -> Self {
        match value {
            AgentRuntimeRole::Spec => Self::Spec,
            AgentRuntimeRole::Planner => Self::Planner,
            AgentRuntimeRole::Qa => Self::Qa,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub run_id: String,
    pub repo_path: String,
    pub task_id: String,
    pub branch: String,
    pub worktree_path: String,
    pub port: u16,
    pub state: RunState,
    pub last_message: Option<String>,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeSummary {
    pub kind: AgentRuntimeKind,
    pub runtime_id: String,
    pub repo_path: String,
    pub task_id: String,
    pub role: RuntimeRole,
    pub working_directory: String,
    pub endpoint: String,
    pub port: u16,
    pub started_at: String,
    pub descriptor: RuntimeDescriptor,
    pub capabilities: RuntimeCapabilities,
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
