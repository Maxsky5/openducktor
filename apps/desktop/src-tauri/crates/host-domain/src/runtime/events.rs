use serde::{Deserialize, Serialize};

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
        DevServerEvent, DevServerGroupState, DevServerScriptState, DevServerScriptStatus,
        DevServerTerminalChunk,
    };

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
}
