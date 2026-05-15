use super::capabilities::{
    RuntimeApprovalCapabilities, RuntimeApprovalReplyOutcome, RuntimeApprovalRequestType,
    RuntimeCapabilities, RuntimeForkTarget, RuntimeHistoryCapabilities, RuntimeHistoryFidelity,
    RuntimeHistoryReplay, RuntimeHydratedEventType, RuntimeOmittedPermissionBehavior,
    RuntimeOptionalSurfaceCapabilities, RuntimePendingInputVisibility,
    RuntimePromptInputCapabilities, RuntimePromptInputPartType, RuntimeProvisioningMode,
    RuntimeQuestionAnswerMode, RuntimeSessionLifecycleCapabilities, RuntimeSessionStartMode,
    RuntimeStructuredInputCapabilities, RuntimeWorkflowCapabilities,
    REQUIRED_RUNTIME_SUPPORTED_SCOPES,
};
use super::kind::AgentRuntimeKind;
use super::startup::RuntimeStartupReadinessConfig;
use super::{RuntimeDefinition, RuntimeDescriptor};
use std::collections::BTreeMap;

pub(super) fn codex_runtime_definition() -> RuntimeDefinition {
    let kind = AgentRuntimeKind::codex();
    RuntimeDefinition::new(
        RuntimeDescriptor {
            kind,
            label: "Codex".to_string(),
            description:
                "Local Codex app-server runtime connected through the OpenDucktor MCP bridge."
                    .to_string(),
            read_only_role_blocked_tools: vec![
                "patch".to_string(),
                "write".to_string(),
                "shell".to_string(),
                "network".to_string(),
                "permissions".to_string(),
            ],
            workflow_tool_aliases_by_canonical: BTreeMap::new(),
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
                    stable_item_ids: true,
                    stable_item_order: true,
                    exposes_completion_state: false,
                    hydrated_event_types: vec![
                        RuntimeHydratedEventType::Message,
                        RuntimeHydratedEventType::ToolCall,
                    ],
                    limitations: vec![],
                },
                approvals: RuntimeApprovalCapabilities {
                    supported_request_types: vec![
                        RuntimeApprovalRequestType::CommandExecution,
                        RuntimeApprovalRequestType::FileChange,
                        RuntimeApprovalRequestType::PermissionGrant,
                        RuntimeApprovalRequestType::RuntimeTool,
                    ],
                    supported_reply_outcomes: vec![
                        RuntimeApprovalReplyOutcome::ApproveOnce,
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
                    supported_answer_modes: vec![
                        RuntimeQuestionAnswerMode::FreeText,
                        RuntimeQuestionAnswerMode::SingleSelect,
                        RuntimeQuestionAnswerMode::MultiSelect,
                    ],
                    supports_required_questions: true,
                    supports_default_values: false,
                    supports_secret_input: false,
                    supports_custom_answers: true,
                    supports_question_resolution: true,
                    pending_visibility: vec![RuntimePendingInputVisibility::LiveSnapshot],
                },
                prompt_input: RuntimePromptInputCapabilities {
                    supported_parts: vec![RuntimePromptInputPartType::Text],
                    supports_slash_commands: false,
                    supports_file_search: false,
                },
                optional_surfaces: RuntimeOptionalSurfaceCapabilities {
                    supports_profiles: false,
                    supports_variants: true,
                    supports_todos: true,
                    supports_diff: true,
                    supports_file_status: false,
                    supports_mcp_status: true,
                    supports_subagents: false,
                    supported_subagent_execution_modes: vec![],
                },
            },
        },
        RuntimeStartupReadinessConfig {
            connect_timeout_ms: 1_000,
            ..RuntimeStartupReadinessConfig::default()
        },
    )
}
