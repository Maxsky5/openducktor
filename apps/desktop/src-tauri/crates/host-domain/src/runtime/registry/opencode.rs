use super::capabilities::{
    RuntimeApprovalCapabilities, RuntimeApprovalReplyOutcome, RuntimeApprovalRequestType,
    RuntimeCapabilities, RuntimeForkTarget, RuntimeHistoryCapabilities, RuntimeHistoryFidelity,
    RuntimeHistoryReplay, RuntimeHydratedEventType, RuntimeOmittedPermissionBehavior,
    RuntimeOptionalSurfaceCapabilities, RuntimePendingInputVisibility,
    RuntimePromptInputCapabilities, RuntimePromptInputPartType, RuntimeProvisioningMode,
    RuntimeQuestionAnswerMode, RuntimeSessionLifecycleCapabilities, RuntimeSessionStartMode,
    RuntimeStructuredInputCapabilities, RuntimeSubagentExecutionMode, RuntimeWorkflowCapabilities,
    REQUIRED_RUNTIME_SUPPORTED_SCOPES,
};
use super::kind::AgentRuntimeKind;
use super::startup::RuntimeStartupReadinessConfig;
use super::{RuntimeDefinition, RuntimeDescriptor};
use std::collections::BTreeMap;

pub(super) const OPENCODE_ODT_WORKFLOW_TOOL_PREFIXES: [&str; 2] =
    ["openducktor_", "functions.openducktor_"];

pub(super) fn opencode_workflow_tool_aliases_by_canonical() -> BTreeMap<String, Vec<String>> {
    super::odt_tools::ODT_WORKFLOW_TOOL_NAMES
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

pub(super) fn opencode_runtime_definition() -> RuntimeDefinition {
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
                provisioning_mode: RuntimeProvisioningMode::HostManaged,
                workflow: RuntimeWorkflowCapabilities {
                    supports_odt_workflow_tools: true,
                    supported_scopes: REQUIRED_RUNTIME_SUPPORTED_SCOPES.to_vec(),
                },
                session_lifecycle: RuntimeSessionLifecycleCapabilities {
                    supported_start_modes: vec![
                        RuntimeSessionStartMode::Fresh,
                        RuntimeSessionStartMode::Reuse,
                        RuntimeSessionStartMode::Fork,
                    ],
                    supports_session_fork: true,
                    fork_targets: vec![RuntimeForkTarget::Session],
                    supports_attach_live_sessions: true,
                    supports_list_live_sessions: true,
                    supports_queued_user_messages: true,
                    supports_pending_input_snapshots: true,
                },
                history: RuntimeHistoryCapabilities {
                    loadable: true,
                    fidelity: RuntimeHistoryFidelity::Message,
                    replay: RuntimeHistoryReplay::Snapshot,
                    stable_item_ids: false,
                    stable_item_order: true,
                    exposes_completion_state: false,
                    hydrated_event_types: vec![
                        RuntimeHydratedEventType::Message,
                        RuntimeHydratedEventType::ToolCall,
                        RuntimeHydratedEventType::ToolResult,
                    ],
                    limitations: vec![
                        "OpenCode session history is hydrated at message-level fidelity."
                            .to_string(),
                    ],
                },
                approvals: RuntimeApprovalCapabilities {
                    supported_request_types: vec![
                        RuntimeApprovalRequestType::PermissionGrant,
                        RuntimeApprovalRequestType::RuntimeTool,
                    ],
                    supported_reply_outcomes: vec![
                        RuntimeApprovalReplyOutcome::ApproveOnce,
                        RuntimeApprovalReplyOutcome::ApproveSession,
                        RuntimeApprovalReplyOutcome::Reject,
                    ],
                    omitted_permission_behavior: RuntimeOmittedPermissionBehavior::Deny,
                    pending_visibility: vec![RuntimePendingInputVisibility::LiveSnapshot],
                    can_classify_mutating_requests: true,
                    read_only_auto_reject_safe: true,
                },
                structured_input: RuntimeStructuredInputCapabilities {
                    supports_questions: true,
                    supports_multiple_questions: true,
                    supports_required_questions: true,
                    supports_default_values: false,
                    supports_custom_answers: true,
                    supports_secret_input: false,
                    supports_question_resolution: true,
                    supported_answer_modes: vec![
                        RuntimeQuestionAnswerMode::FreeText,
                        RuntimeQuestionAnswerMode::SingleSelect,
                        RuntimeQuestionAnswerMode::MultiSelect,
                    ],
                    pending_visibility: vec![RuntimePendingInputVisibility::LiveSnapshot],
                },
                prompt_input: RuntimePromptInputCapabilities {
                    supported_parts: vec![
                        RuntimePromptInputPartType::Text,
                        RuntimePromptInputPartType::SlashCommand,
                        RuntimePromptInputPartType::FileReference,
                        RuntimePromptInputPartType::FolderReference,
                    ],
                    supports_slash_commands: true,
                    supports_file_search: true,
                },
                optional_surfaces: RuntimeOptionalSurfaceCapabilities {
                    supports_profiles: true,
                    supports_variants: true,
                    supports_todos: true,
                    supports_diff: true,
                    supports_file_status: true,
                    supports_mcp_status: true,
                    supports_subagents: true,
                    supported_subagent_execution_modes: vec![
                        RuntimeSubagentExecutionMode::Foreground,
                        RuntimeSubagentExecutionMode::Background,
                    ],
                },
            },
        },
        RuntimeStartupReadinessConfig::default(),
    )
}
