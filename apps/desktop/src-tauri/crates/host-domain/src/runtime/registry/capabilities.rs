use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fmt;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeSubagentExecutionMode {
    Foreground,
    Background,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeSessionStartMode {
    Fresh,
    Reuse,
    Fork,
}

impl RuntimeSessionStartMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Fresh => "fresh",
            Self::Reuse => "reuse",
            Self::Fork => "fork",
        }
    }
}

impl fmt::Display for RuntimeSessionStartMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

struct LaunchStartModeRequirement {
    id: &'static str,
    modes: &'static [RuntimeSessionStartMode],
}

const LAUNCH_START_MODE_REQUIREMENTS: &[LaunchStartModeRequirement] = &[
    LaunchStartModeRequirement {
        id: "spec_initial",
        modes: &[RuntimeSessionStartMode::Fresh],
    },
    LaunchStartModeRequirement {
        id: "planner_initial",
        modes: &[RuntimeSessionStartMode::Fresh],
    },
    LaunchStartModeRequirement {
        id: "build_implementation_start",
        modes: &[RuntimeSessionStartMode::Fresh],
    },
    LaunchStartModeRequirement {
        id: "build_after_qa_rejected",
        modes: &[
            RuntimeSessionStartMode::Fresh,
            RuntimeSessionStartMode::Reuse,
        ],
    },
    LaunchStartModeRequirement {
        id: "build_after_human_request_changes",
        modes: &[
            RuntimeSessionStartMode::Fresh,
            RuntimeSessionStartMode::Reuse,
        ],
    },
    LaunchStartModeRequirement {
        id: "build_pull_request_generation",
        modes: &[
            RuntimeSessionStartMode::Reuse,
            RuntimeSessionStartMode::Fork,
        ],
    },
    LaunchStartModeRequirement {
        id: "build_rebase_conflict_resolution",
        modes: &[
            RuntimeSessionStartMode::Fresh,
            RuntimeSessionStartMode::Reuse,
        ],
    },
    LaunchStartModeRequirement {
        id: "qa_review",
        modes: &[
            RuntimeSessionStartMode::Fresh,
            RuntimeSessionStartMode::Reuse,
        ],
    },
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeForkTarget {
    Session,
    Message,
    Item,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeHistoryFidelity {
    None,
    Message,
    Item,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeHistoryReplay {
    None,
    Snapshot,
    TurnItems,
    EventReplay,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeHydratedEventType {
    Message,
    ToolCall,
    ToolResult,
    ApprovalRequest,
    QuestionRequest,
    StatusChange,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeApprovalRequestType {
    CommandExecution,
    FileChange,
    PermissionGrant,
    RuntimeTool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeApprovalReplyOutcome {
    ApproveOnce,
    ApproveTurn,
    ApproveSession,
    Reject,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeOmittedPermissionBehavior {
    Deny,
    RequiresExplicitResponse,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RuntimePendingInputVisibility {
    LiveSnapshot,
    History,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeQuestionAnswerMode {
    FreeText,
    SingleSelect,
    MultiSelect,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RuntimePromptInputPartType {
    Text,
    SlashCommand,
    FileReference,
    FolderReference,
    SkillMention,
    AppMention,
    PluginMention,
    RuntimeSpecific,
}

pub const REQUIRED_RUNTIME_SUPPORTED_SCOPES: [RuntimeSupportedScope; 3] = [
    RuntimeSupportedScope::Workspace,
    RuntimeSupportedScope::Task,
    RuntimeSupportedScope::Build,
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeWorkflowCapabilities {
    pub supports_odt_workflow_tools: bool,
    pub supported_scopes: Vec<RuntimeSupportedScope>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeSessionLifecycleCapabilities {
    pub supported_start_modes: Vec<RuntimeSessionStartMode>,
    pub supports_session_fork: bool,
    pub fork_targets: Vec<RuntimeForkTarget>,
    pub supports_attach_live_sessions: bool,
    pub supports_list_live_sessions: bool,
    pub supports_queued_user_messages: bool,
    pub supports_pending_input_snapshots: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeHistoryCapabilities {
    pub loadable: bool,
    pub fidelity: RuntimeHistoryFidelity,
    pub replay: RuntimeHistoryReplay,
    pub stable_item_ids: bool,
    pub stable_item_order: bool,
    pub exposes_completion_state: bool,
    pub hydrated_event_types: Vec<RuntimeHydratedEventType>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeApprovalCapabilities {
    pub supported_request_types: Vec<RuntimeApprovalRequestType>,
    pub supported_reply_outcomes: Vec<RuntimeApprovalReplyOutcome>,
    pub omitted_permission_behavior: RuntimeOmittedPermissionBehavior,
    pub pending_visibility: Vec<RuntimePendingInputVisibility>,
    pub can_classify_mutating_requests: bool,
    pub read_only_auto_reject_safe: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeStructuredInputCapabilities {
    pub supports_questions: bool,
    pub supports_multiple_questions: bool,
    pub supports_required_questions: bool,
    pub supports_default_values: bool,
    pub supports_custom_answers: bool,
    pub supports_secret_input: bool,
    pub supports_question_resolution: bool,
    pub supported_answer_modes: Vec<RuntimeQuestionAnswerMode>,
    pub pending_visibility: Vec<RuntimePendingInputVisibility>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimePromptInputCapabilities {
    pub supported_parts: Vec<RuntimePromptInputPartType>,
    pub supports_slash_commands: bool,
    pub supports_file_search: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeOptionalSurfaceCapabilities {
    pub supports_profiles: bool,
    pub supports_variants: bool,
    pub supports_todos: bool,
    pub supports_diff: bool,
    pub supports_file_status: bool,
    pub supports_mcp_status: bool,
    pub supports_subagents: bool,
    pub supported_subagent_execution_modes: Vec<RuntimeSubagentExecutionMode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeCapabilities {
    pub provisioning_mode: RuntimeProvisioningMode,
    pub workflow: RuntimeWorkflowCapabilities,
    pub session_lifecycle: RuntimeSessionLifecycleCapabilities,
    pub history: RuntimeHistoryCapabilities,
    pub approvals: RuntimeApprovalCapabilities,
    pub structured_input: RuntimeStructuredInputCapabilities,
    pub prompt_input: RuntimePromptInputCapabilities,
    pub optional_surfaces: RuntimeOptionalSurfaceCapabilities,
}

impl RuntimeCapabilities {
    fn duplicate_value_errors<T>(values: &[T], label: &'static str) -> Vec<String>
    where
        T: Copy + Eq + std::hash::Hash,
    {
        let mut seen = HashSet::new();
        if values.iter().copied().any(|value| !seen.insert(value)) {
            return vec![format!("[baseline] {label} must not contain duplicates")];
        }
        Vec::new()
    }

    fn duplicate_string_errors(values: &[String], label: &'static str) -> Vec<String> {
        let mut seen = HashSet::new();
        let mut errors = Vec::new();
        let mut reported_blank = false;
        let mut reported_duplicate = false;

        for value in values {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                if !reported_blank {
                    errors.push(format!("[baseline] {label} must not contain blank entries"));
                    reported_blank = true;
                }
                continue;
            }
            if !seen.insert(trimmed) && !reported_duplicate {
                errors.push(format!("[baseline] {label} must not contain duplicates"));
                reported_duplicate = true;
            }
        }

        errors
    }

    pub fn missing_mandatory_capabilities(&self) -> Vec<&'static str> {
        let mut missing = Vec::new();
        if !self.workflow.supports_odt_workflow_tools {
            missing.push("workflow.supportsOdtWorkflowTools");
        }
        if !self
            .session_lifecycle
            .supported_start_modes
            .contains(&RuntimeSessionStartMode::Fresh)
        {
            missing.push("sessionLifecycle.supportedStartModes");
        }
        if !self
            .prompt_input
            .supported_parts
            .contains(&RuntimePromptInputPartType::Text)
        {
            missing.push("promptInput.supportedParts");
        }
        missing
    }

    pub fn missing_required_supported_scopes(&self) -> Vec<RuntimeSupportedScope> {
        REQUIRED_RUNTIME_SUPPORTED_SCOPES
            .iter()
            .copied()
            .filter(|scope| !self.workflow.supported_scopes.contains(scope))
            .collect()
    }

    pub fn supports_all_workflow_scopes(&self) -> bool {
        self.missing_required_supported_scopes().is_empty()
    }

    pub(super) fn uniqueness_errors(&self) -> Vec<String> {
        let mut errors = Vec::new();
        errors.extend(Self::duplicate_value_errors(
            &self.workflow.supported_scopes,
            "workflow.supportedScopes",
        ));
        errors.extend(Self::duplicate_value_errors(
            &self.session_lifecycle.supported_start_modes,
            "sessionLifecycle.supportedStartModes",
        ));
        errors.extend(Self::duplicate_value_errors(
            &self.session_lifecycle.fork_targets,
            "sessionLifecycle.forkTargets",
        ));
        errors.extend(Self::duplicate_value_errors(
            &self.history.hydrated_event_types,
            "history.hydratedEventTypes",
        ));
        errors.extend(Self::duplicate_string_errors(
            &self.history.limitations,
            "history.limitations",
        ));
        errors.extend(Self::duplicate_value_errors(
            &self.approvals.supported_request_types,
            "approvals.supportedRequestTypes",
        ));
        errors.extend(Self::duplicate_value_errors(
            &self.approvals.supported_reply_outcomes,
            "approvals.supportedReplyOutcomes",
        ));
        errors.extend(Self::duplicate_value_errors(
            &self.approvals.pending_visibility,
            "approvals.pendingVisibility",
        ));
        errors.extend(Self::duplicate_value_errors(
            &self.structured_input.supported_answer_modes,
            "structuredInput.supportedAnswerModes",
        ));
        errors.extend(Self::duplicate_value_errors(
            &self.structured_input.pending_visibility,
            "structuredInput.pendingVisibility",
        ));
        errors.extend(Self::duplicate_value_errors(
            &self.prompt_input.supported_parts,
            "promptInput.supportedParts",
        ));
        errors.extend(Self::duplicate_value_errors(
            &self.optional_surfaces.supported_subagent_execution_modes,
            "optionalSurfaces.supportedSubagentExecutionModes",
        ));
        errors
    }

    pub(super) fn lifecycle_errors(&self) -> Vec<String> {
        let mut errors = Vec::new();
        let supported_start_modes = &self.session_lifecycle.supported_start_modes;
        if !supported_start_modes.contains(&RuntimeSessionStartMode::Fresh) {
            errors.push("[baseline] session lifecycle must support fresh starts".to_string());
        }
        if supported_start_modes.contains(&RuntimeSessionStartMode::Fork)
            && !self.session_lifecycle.supports_session_fork
        {
            errors.push(
                "[launch_scoped] fork start mode requires sessionLifecycle.supportsSessionFork"
                    .to_string(),
            );
        }
        if self.session_lifecycle.supports_session_fork {
            if !supported_start_modes.contains(&RuntimeSessionStartMode::Fork) {
                errors.push(
                    "[launch_scoped] session fork support requires fork start mode".to_string(),
                );
            }
            if self.session_lifecycle.fork_targets.is_empty() {
                errors.push(
                    "[launch_scoped] session fork support requires at least one fork target"
                        .to_string(),
                );
            }
        } else if !self.session_lifecycle.fork_targets.is_empty() {
            errors.push(
                "[launch_scoped] fork targets must be empty when session fork is unsupported"
                    .to_string(),
            );
        }
        errors
    }

    pub(super) fn history_errors(&self) -> Vec<String> {
        let mut errors = Vec::new();
        if matches!(self.history.fidelity, RuntimeHistoryFidelity::Item) {
            if !self.history.loadable {
                errors.push(
                    "[launch_scoped] item-level history requires loadable history".to_string(),
                );
            }
            if !self.history.stable_item_ids {
                errors.push(
                    "[launch_scoped] item-level history requires stable item ids".to_string(),
                );
            }
            if !self.history.stable_item_order {
                errors.push(
                    "[launch_scoped] item-level history requires stable item order".to_string(),
                );
            }
            if !self.history.exposes_completion_state {
                errors.push(
                    "[launch_scoped] item-level history requires completion state exposure"
                        .to_string(),
                );
            }
        }
        if !self.history.loadable {
            if !matches!(self.history.fidelity, RuntimeHistoryFidelity::None) {
                errors.push("[launch_scoped] unloaded history must use none fidelity".to_string());
            }
            if !matches!(self.history.replay, RuntimeHistoryReplay::None) {
                errors.push("[launch_scoped] unloaded history must use none replay".to_string());
            }
            if !self.history.hydrated_event_types.is_empty() {
                errors.push(
                    "[baseline] unloaded history cannot expose hydrated event types".to_string(),
                );
            }
        }
        errors
    }

    pub(super) fn approval_errors(&self) -> Vec<String> {
        let mut errors = Vec::new();
        let has_request_types = !self.approvals.supported_request_types.is_empty();
        let has_reject = self
            .approvals
            .supported_reply_outcomes
            .contains(&RuntimeApprovalReplyOutcome::Reject);
        let has_approval_outcome = self
            .approvals
            .supported_reply_outcomes
            .iter()
            .any(|outcome| !matches!(outcome, RuntimeApprovalReplyOutcome::Reject));
        if has_request_types && !has_reject {
            errors.push("[workflow] approval requests require reject reply outcome".to_string());
        }
        if has_request_types && !has_approval_outcome {
            errors.push(
                "[workflow] approval requests require at least one approve reply outcome"
                    .to_string(),
            );
        }
        if !self.approvals.read_only_auto_reject_safe {
            errors.push(
                "[workflow] read-only roles must auto-reject mutating permission requests"
                    .to_string(),
            );
        } else {
            if !self.approvals.can_classify_mutating_requests {
                errors.push(
                    "[workflow] read-only auto-reject safety requires mutating request classification"
                        .to_string(),
                );
            }
            if !has_reject {
                errors.push(
                    "[workflow] read-only auto-reject safety requires reject reply outcome"
                        .to_string(),
                );
            }
        }
        errors
    }

    pub(super) fn structured_input_errors(&self) -> Vec<String> {
        let mut errors = Vec::new();
        if self.structured_input.supports_questions {
            if self.structured_input.supported_answer_modes.is_empty() {
                errors.push(
                    "[workflow] structured question support requires answer modes".to_string(),
                );
            }
            if !self.structured_input.supports_question_resolution {
                errors.push(
                    "[workflow] structured question support requires resolution tracking"
                        .to_string(),
                );
            }
        } else {
            if self.structured_input.supports_multiple_questions
                || self.structured_input.supports_required_questions
                || self.structured_input.supports_default_values
                || self.structured_input.supports_custom_answers
                || self.structured_input.supports_secret_input
                || self.structured_input.supports_question_resolution
            {
                errors.push(
                    "[workflow] structured question details must be false when questions are unsupported"
                        .to_string(),
                );
            }
            if !self.structured_input.supported_answer_modes.is_empty()
                || !self.structured_input.pending_visibility.is_empty()
            {
                errors.push(
                    "[workflow] structured question lists must be empty when questions are unsupported"
                        .to_string(),
                );
            }
        }
        errors
    }

    pub(super) fn pending_visibility_errors(&self) -> Vec<String> {
        let mut errors = Vec::new();
        if self.session_lifecycle.supports_pending_input_snapshots {
            return errors;
        }

        if self
            .approvals
            .pending_visibility
            .contains(&RuntimePendingInputVisibility::LiveSnapshot)
        {
            errors.push(
                "[workflow] approvals.pendingVisibility live_snapshot requires sessionLifecycle.supportsPendingInputSnapshots"
                    .to_string(),
            );
        }
        if self
            .structured_input
            .pending_visibility
            .contains(&RuntimePendingInputVisibility::LiveSnapshot)
        {
            errors.push(
                "[workflow] structuredInput.pendingVisibility live_snapshot requires sessionLifecycle.supportsPendingInputSnapshots"
                    .to_string(),
            );
        }

        errors
    }

    pub(super) fn prompt_input_errors(&self) -> Vec<String> {
        let mut errors = Vec::new();
        if !self
            .prompt_input
            .supported_parts
            .contains(&RuntimePromptInputPartType::Text)
        {
            errors.push("[baseline] prompt input must support text".to_string());
        }
        if self.prompt_input.supports_slash_commands
            && !self
                .prompt_input
                .supported_parts
                .contains(&RuntimePromptInputPartType::SlashCommand)
        {
            errors.push(
                "[optional_enhancement] slash command support requires slash_command prompt part"
                    .to_string(),
            );
        }
        if self.prompt_input.supports_file_search
            && !self.prompt_input.supported_parts.iter().any(|part| {
                matches!(
                    part,
                    RuntimePromptInputPartType::FileReference
                        | RuntimePromptInputPartType::FolderReference
                )
            })
        {
            errors.push(
                "[optional_enhancement] file search support requires file or folder prompt references"
                    .to_string(),
            );
        }
        errors
    }

    pub(super) fn optional_surface_errors(&self) -> Vec<String> {
        let has_subagent_execution_modes = !self
            .optional_surfaces
            .supported_subagent_execution_modes
            .is_empty();
        if self.optional_surfaces.supports_subagents && !has_subagent_execution_modes {
            return vec![
                "[optional_enhancement] subagent support requires at least one supported execution mode"
                    .to_string(),
            ];
        }
        if !self.optional_surfaces.supports_subagents && has_subagent_execution_modes {
            return vec![
                "[optional_enhancement] subagent execution modes must be empty when subagents are unsupported"
                    .to_string(),
            ];
        }
        Vec::new()
    }

    pub(super) fn launch_config_errors(&self) -> Vec<String> {
        LAUNCH_START_MODE_REQUIREMENTS
            .iter()
            .filter_map(|requirement| {
                let missing_modes = requirement
                    .modes
                    .iter()
                    .copied()
                    .filter(|mode| !self.session_lifecycle.supported_start_modes.contains(mode))
                    .map(|mode| mode.to_string())
                    .collect::<Vec<_>>();
                if missing_modes.is_empty() {
                    return None;
                }
                Some(format!(
                    "[launch_scoped] launch action {} requires start modes: {}",
                    requirement.id,
                    missing_modes.join(", ")
                ))
            })
            .collect()
    }
}
