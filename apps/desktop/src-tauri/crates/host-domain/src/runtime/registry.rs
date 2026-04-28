use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fmt;
use std::sync::{Arc, LazyLock};

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

impl fmt::Display for AgentRuntimeKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

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
        if values.iter().any(|value| !seen.insert(value.as_str())) {
            return vec![format!("[baseline] {label} must not contain duplicates")];
        }
        Vec::new()
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

    fn uniqueness_errors(&self) -> Vec<String> {
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

    fn lifecycle_errors(&self) -> Vec<String> {
        let mut errors = Vec::new();
        let supported_start_modes = &self.session_lifecycle.supported_start_modes;
        if !supported_start_modes.contains(&RuntimeSessionStartMode::Fresh) {
            errors.push("[baseline] session lifecycle must support fresh starts".to_string());
        }
        if supported_start_modes.contains(&RuntimeSessionStartMode::Fork)
            && !self.session_lifecycle.supports_session_fork
        {
            errors.push(
                "[scenario_scoped] fork start mode requires sessionLifecycle.supportsSessionFork"
                    .to_string(),
            );
        }
        if self.session_lifecycle.supports_session_fork {
            if !supported_start_modes.contains(&RuntimeSessionStartMode::Fork) {
                errors.push(
                    "[scenario_scoped] session fork support requires fork start mode".to_string(),
                );
            }
            if self.session_lifecycle.fork_targets.is_empty() {
                errors.push(
                    "[scenario_scoped] session fork support requires at least one fork target"
                        .to_string(),
                );
            }
        } else if !self.session_lifecycle.fork_targets.is_empty() {
            errors.push(
                "[scenario_scoped] fork targets must be empty when session fork is unsupported"
                    .to_string(),
            );
        }
        errors
    }

    fn history_errors(&self) -> Vec<String> {
        let mut errors = Vec::new();
        if matches!(self.history.fidelity, RuntimeHistoryFidelity::Item) {
            if !self.history.loadable {
                errors.push("[baseline] item-level history requires loadable history".to_string());
            }
            if !self.history.stable_item_ids {
                errors.push("[baseline] item-level history requires stable item ids".to_string());
            }
            if !self.history.stable_item_order {
                errors.push("[baseline] item-level history requires stable item order".to_string());
            }
            if !self.history.exposes_completion_state {
                errors.push(
                    "[baseline] item-level history requires completion state exposure".to_string(),
                );
            }
        }
        if !self.history.loadable {
            if !matches!(self.history.fidelity, RuntimeHistoryFidelity::None) {
                errors.push("[baseline] unloaded history must use none fidelity".to_string());
            }
            if !matches!(self.history.replay, RuntimeHistoryReplay::None) {
                errors.push("[baseline] unloaded history must use none replay".to_string());
            }
            if !self.history.hydrated_event_types.is_empty() {
                errors.push(
                    "[baseline] unloaded history cannot expose hydrated event types".to_string(),
                );
            }
        }
        errors
    }

    fn approval_errors(&self) -> Vec<String> {
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
        if self.approvals.read_only_auto_reject_safe {
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

    fn structured_input_errors(&self) -> Vec<String> {
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

    fn prompt_input_errors(&self) -> Vec<String> {
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

    fn optional_surface_errors(&self) -> Vec<String> {
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

    fn scenario_config_errors(&self) -> Vec<String> {
        let required_pull_request_modes = [
            RuntimeSessionStartMode::Reuse,
            RuntimeSessionStartMode::Fork,
        ];
        let missing_pull_request_modes = required_pull_request_modes
            .iter()
            .copied()
            .filter(|mode| !self.session_lifecycle.supported_start_modes.contains(mode))
            .collect::<Vec<_>>();
        if missing_pull_request_modes.is_empty() {
            return Vec::new();
        }
        vec![format!(
            "[scenario_scoped] scenario build_pull_request_generation requires start modes: {}",
            missing_pull_request_modes
                .into_iter()
                .map(|mode| mode.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )]
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeDescriptor {
    pub kind: AgentRuntimeKind,
    pub label: String,
    pub description: String,
    pub read_only_role_blocked_tools: Vec<String>,
    pub workflow_tool_aliases_by_canonical: BTreeMap<String, Vec<String>>,
    pub capabilities: RuntimeCapabilities,
}

impl RuntimeDescriptor {
    fn normalized_tool_id(tool_id: &str) -> Option<&str> {
        // Match the TypeScript `z.string().trim().min(1)` validation semantics while
        // leaving descriptor payloads unchanged for callers that inspect raw values.
        let trimmed = tool_id.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    }

    fn read_only_role_blocked_tool_errors(&self) -> Vec<String> {
        let mut errors = Vec::new();
        let mut seen_tool_ids = HashSet::new();
        let mut reported_blank = false;
        let mut reported_duplicate = false;

        for tool_id in &self.read_only_role_blocked_tools {
            let Some(tool_id) = Self::normalized_tool_id(tool_id) else {
                if !reported_blank {
                    errors.push(
                        "[workflow] read-only blocked runtime tool IDs must not be blank"
                            .to_string(),
                    );
                    reported_blank = true;
                }
                continue;
            };

            if !seen_tool_ids.insert(tool_id) && !reported_duplicate {
                errors.push(
                    "[workflow] read-only blocked runtime tool IDs must be unique".to_string(),
                );
                reported_duplicate = true;
            }
        }

        errors
    }

    fn workflow_alias_errors(&self) -> Vec<String> {
        let canonical_tool_names = ODT_WORKFLOW_TOOL_NAMES
            .iter()
            .copied()
            .collect::<HashSet<_>>();
        let mut errors = Vec::new();
        let mut canonical_by_alias = BTreeMap::<&str, &str>::new();

        for (canonical_tool, aliases) in &self.workflow_tool_aliases_by_canonical {
            if !canonical_tool_names.contains(canonical_tool.as_str()) {
                errors.push(format!(
                    "[workflow] unknown workflow tool alias canonical key: {canonical_tool}"
                ));
                continue;
            }
            if aliases.is_empty() {
                errors.push(format!(
                    "[workflow] workflow aliases for canonical tool {canonical_tool} must not be empty"
                ));
                continue;
            }
            let mut seen_aliases = HashSet::new();
            for alias in aliases {
                let Some(alias) = Self::normalized_tool_id(alias) else {
                    errors.push(format!(
                        "[workflow] workflow aliases for canonical tool {canonical_tool} must not be blank"
                    ));
                    continue;
                };
                if !seen_aliases.insert(alias) {
                    errors.push(format!(
                        "[workflow] workflow aliases for canonical tool {canonical_tool} must be unique"
                    ));
                    continue;
                }
                if canonical_tool_names.contains(alias) {
                    errors.push(format!(
                        "[workflow] workflow alias {alias} for canonical tool {canonical_tool} must not repeat canonical odt_* tool IDs"
                    ));
                    continue;
                }
                if let Some(existing_canonical_tool) = canonical_by_alias.get(alias) {
                    if *existing_canonical_tool != canonical_tool.as_str() {
                        errors.push(format!(
                            "[workflow] workflow alias {alias} for canonical tool {canonical_tool} is already assigned to canonical tool {existing_canonical_tool}"
                        ));
                        continue;
                    }
                }
                canonical_by_alias.insert(alias, canonical_tool.as_str());
            }
        }

        errors
    }

    pub fn validate_for_openducktor(&self) -> Vec<String> {
        let mut errors = Vec::new();

        if !self.capabilities.workflow.supports_odt_workflow_tools {
            errors.push("[workflow] missing OpenDucktor workflow tool support".to_string());
        }

        let missing_supported_scopes = self.capabilities.missing_required_supported_scopes();
        if !missing_supported_scopes.is_empty() {
            errors.push(format!(
                "[role_scoped] missing required workflow scopes: {}",
                missing_supported_scopes
                    .into_iter()
                    .map(|scope| scope.to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }

        errors.extend(self.read_only_role_blocked_tool_errors());
        errors.extend(self.workflow_alias_errors());
        errors.extend(self.capabilities.uniqueness_errors());
        errors.extend(self.capabilities.lifecycle_errors());
        errors.extend(self.capabilities.history_errors());
        errors.extend(self.capabilities.approval_errors());
        errors.extend(self.capabilities.structured_input_errors());
        errors.extend(self.capabilities.prompt_input_errors());
        errors.extend(self.capabilities.optional_surface_errors());
        errors.extend(self.capabilities.scenario_config_errors());

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
}

impl RuntimeDefinition {
    pub fn new(
        descriptor: RuntimeDescriptor,
        default_startup_config: RuntimeStartupReadinessConfig,
    ) -> Self {
        Self {
            descriptor,
            default_startup_config,
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
        Self::new_with_default_kind(definitions, None)
    }

    pub fn new_with_default_kind(
        definitions: Vec<RuntimeDefinition>,
        default_kind: Option<AgentRuntimeKind>,
    ) -> Result<Self> {
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

        if definitions_by_kind.is_empty() {
            return Err(anyhow!(
                "Runtime registry requires at least one registered runtime"
            ));
        }

        let default_kind = match default_kind {
            Some(default_kind) => {
                let default_kind_key = default_kind.as_str().trim();
                if !definitions_by_kind.contains_key(default_kind_key) {
                    return Err(anyhow!(
                        "Default runtime '{}' is not registered",
                        default_kind.as_str()
                    ));
                }
                default_kind
            }
            None if definitions_by_kind.len() == 1 => definitions_by_kind
                .values()
                .next()
                .expect("single runtime registry should contain one value")
                .kind()
                .clone(),
            None => {
                return Err(anyhow!(
                    "Runtime registry requires an explicit default when registering multiple runtimes"
                ));
            }
        };

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

// Keep this list in sync with `ODT_WORKFLOW_AGENT_TOOL_NAMES` in
// `packages/contracts/src/odt-tool-names.ts`.
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

static BUILTIN_RUNTIME_REGISTRY: LazyLock<RuntimeRegistry> = LazyLock::new(|| {
    RuntimeRegistry::new_with_default_kind(
        vec![opencode_runtime_definition()],
        Some(AgentRuntimeKind::opencode()),
    )
    .expect("builtin runtime registry should be valid")
});

pub fn builtin_runtime_registry() -> &'static RuntimeRegistry {
    &BUILTIN_RUNTIME_REGISTRY
}

pub fn default_runtime_kind() -> AgentRuntimeKind {
    builtin_runtime_registry().default_kind().clone()
}

#[cfg(test)]
mod tests {
    use super::{
        AgentRuntimeKind, RuntimeApprovalCapabilities, RuntimeApprovalReplyOutcome,
        RuntimeApprovalRequestType, RuntimeCapabilities, RuntimeDefinition, RuntimeDescriptor,
        RuntimeForkTarget, RuntimeHistoryCapabilities, RuntimeHistoryFidelity,
        RuntimeHistoryReplay, RuntimeHydratedEventType, RuntimeOmittedPermissionBehavior,
        RuntimeOptionalSurfaceCapabilities, RuntimePendingInputVisibility,
        RuntimePromptInputCapabilities, RuntimePromptInputPartType, RuntimeProvisioningMode,
        RuntimeQuestionAnswerMode, RuntimeRegistry, RuntimeSessionLifecycleCapabilities,
        RuntimeSessionStartMode, RuntimeStartupReadinessConfig, RuntimeStructuredInputCapabilities,
        RuntimeSubagentExecutionMode, RuntimeSupportedScope, RuntimeWorkflowCapabilities,
        REQUIRED_RUNTIME_SUPPORTED_SCOPES,
    };
    use anyhow::Result;
    use std::collections::BTreeMap;

    const OPENCODE_RUNTIME_DESCRIPTOR_FIXTURE: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../../docs/contracts/opencode-runtime-descriptor.fixture.json"
    ));
    const RUNTIME_DESCRIPTOR_INVALID_CASES_FIXTURE: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../../docs/contracts/runtime-descriptor-invalid-cases.fixture.json"
    ));

    #[derive(Debug, serde::Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct RuntimeDescriptorInvalidCase {
        name: String,
        patch: Vec<RuntimeDescriptorFixturePatch>,
    }

    #[derive(Debug, serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct RuntimeDescriptorFixturePatch {
        path: Vec<String>,
        value: serde_json::Value,
    }

    fn apply_fixture_patch(
        target: &mut serde_json::Value,
        patch: &[RuntimeDescriptorFixturePatch],
    ) {
        for operation in patch {
            let Some((final_segment, parent_path)) = operation.path.split_last() else {
                panic!("runtime descriptor fixture patch path must not be empty");
            };
            let mut current = &mut *target;
            for segment in parent_path {
                current = current.get_mut(segment).unwrap_or_else(|| {
                    panic!("invalid runtime descriptor fixture path segment: {segment}")
                });
            }

            let parent = current
                .as_object_mut()
                .expect("runtime descriptor fixture patch parent should be an object");
            parent.insert(final_segment.clone(), operation.value.clone());
        }
    }

    fn capabilities_with_scopes(scopes: Vec<RuntimeSupportedScope>) -> RuntimeCapabilities {
        RuntimeCapabilities {
            provisioning_mode: RuntimeProvisioningMode::HostManaged,
            workflow: RuntimeWorkflowCapabilities {
                supports_odt_workflow_tools: true,
                supported_scopes: scopes,
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
                limitations: vec!["message-level history only".to_string()],
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
        )
    }

    #[test]
    fn opencode_descriptor_fixture_stays_aligned_with_rust_builtin() {
        let fixture_value: serde_json::Value =
            serde_json::from_str(OPENCODE_RUNTIME_DESCRIPTOR_FIXTURE)
                .expect("OpenCode runtime descriptor fixture should be valid JSON");
        let fixture_descriptor: RuntimeDescriptor = serde_json::from_value(fixture_value.clone())
            .expect("OpenCode runtime descriptor fixture should deserialize");
        assert_eq!(
            fixture_descriptor.validate_for_openducktor(),
            Vec::<String>::new()
        );

        let builtin_value = serde_json::to_value(
            super::builtin_runtime_registry()
                .definition_by_str("opencode")
                .expect("opencode runtime should be registered")
                .descriptor(),
        )
        .expect("OpenCode runtime descriptor should serialize");

        assert_eq!(builtin_value, fixture_value);
    }

    #[test]
    fn shared_invalid_runtime_descriptor_fixtures_are_rejected() {
        let fixture_value: serde_json::Value =
            serde_json::from_str(OPENCODE_RUNTIME_DESCRIPTOR_FIXTURE)
                .expect("OpenCode runtime descriptor fixture should be valid JSON");
        let invalid_cases: Vec<RuntimeDescriptorInvalidCase> =
            serde_json::from_str(RUNTIME_DESCRIPTOR_INVALID_CASES_FIXTURE)
                .expect("runtime descriptor invalid cases fixture should be valid JSON");

        for invalid_case in invalid_cases {
            let mut descriptor_value = fixture_value.clone();
            apply_fixture_patch(&mut descriptor_value, &invalid_case.patch);

            if let Ok(descriptor) = serde_json::from_value::<RuntimeDescriptor>(descriptor_value) {
                assert!(
                    !descriptor.validate_for_openducktor().is_empty(),
                    "invalid runtime descriptor fixture should fail validation: {}",
                    invalid_case.name
                );
            }
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
        let descriptor = super::builtin_runtime_registry()
            .definition_by_str("opencode")
            .expect("opencode runtime should be registered")
            .descriptor()
            .clone();

        assert_eq!(
            descriptor.capabilities.workflow.supported_scopes,
            REQUIRED_RUNTIME_SUPPORTED_SCOPES.to_vec()
        );
        assert!(descriptor.capabilities.prompt_input.supports_slash_commands);
        assert!(descriptor.capabilities.prompt_input.supports_file_search);
        assert!(descriptor.capabilities.optional_surfaces.supports_subagents);
        assert_eq!(
            descriptor
                .capabilities
                .optional_surfaces
                .supported_subagent_execution_modes,
            vec![
                RuntimeSubagentExecutionMode::Foreground,
                RuntimeSubagentExecutionMode::Background,
            ]
        );
        assert_eq!(
            descriptor.capabilities.history.fidelity,
            RuntimeHistoryFidelity::Message
        );
        assert!(descriptor
            .capabilities
            .approvals
            .supported_reply_outcomes
            .contains(&RuntimeApprovalReplyOutcome::Reject));
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
    fn builtin_opencode_runtime_stays_host_managed_with_local_http_routes() {
        let definition = super::builtin_runtime_registry()
            .definition_by_str("opencode")
            .expect("opencode runtime should be registered");

        assert!(matches!(
            definition.descriptor().capabilities.provisioning_mode,
            RuntimeProvisioningMode::HostManaged
        ));
        assert_eq!(
            definition.default_startup_config().timeout_ms,
            RuntimeStartupReadinessConfig::default().timeout_ms
        );
    }

    #[test]
    fn runtime_descriptor_validation_reports_mandatory_capabilities_and_scopes() {
        let descriptor = RuntimeDescriptor {
            kind: AgentRuntimeKind::opencode(),
            label: "OpenCode".to_string(),
            description: "desc".to_string(),
            read_only_role_blocked_tools: vec![],
            workflow_tool_aliases_by_canonical: BTreeMap::new(),
            capabilities: {
                let mut capabilities =
                    capabilities_with_scopes(vec![RuntimeSupportedScope::Workspace]);
                capabilities.workflow.supports_odt_workflow_tools = false;
                capabilities
            },
        };

        assert_eq!(
            descriptor.validate_for_openducktor(),
            vec![
                "[workflow] missing OpenDucktor workflow tool support".to_string(),
                "[role_scoped] missing required workflow scopes: task, build".to_string(),
            ]
        );
    }

    #[test]
    fn runtime_descriptor_validation_rejects_invalid_workflow_alias_maps() {
        let mut descriptor = runtime_definition("custom", "Custom").descriptor().clone();
        descriptor.workflow_tool_aliases_by_canonical = BTreeMap::from([
            (
                "odt_set_spec".to_string(),
                vec![
                    "runtime_set_spec".to_string(),
                    "runtime_set_spec".to_string(),
                ],
            ),
            ("odt_set_plan".to_string(), vec!["odt_set_spec".to_string()]),
            (
                "odt_build_completed".to_string(),
                vec!["shared_alias".to_string()],
            ),
            (
                "odt_build_blocked".to_string(),
                vec!["shared_alias".to_string()],
            ),
            (
                "odt_set_specc".to_string(),
                vec!["runtime_unknown".to_string()],
            ),
            ("odt_qa_approved".to_string(), vec![]),
        ]);

        assert_eq!(
            descriptor.validate_for_openducktor(),
            vec![
                "[workflow] workflow alias shared_alias for canonical tool odt_build_completed is already assigned to canonical tool odt_build_blocked".to_string(),
                "[workflow] workflow aliases for canonical tool odt_qa_approved must not be empty".to_string(),
                "[workflow] workflow alias odt_set_spec for canonical tool odt_set_plan must not repeat canonical odt_* tool IDs".to_string(),
                "[workflow] workflow aliases for canonical tool odt_set_spec must be unique".to_string(),
                "[workflow] unknown workflow tool alias canonical key: odt_set_specc".to_string(),
            ]
        );
    }

    #[test]
    fn runtime_descriptor_validation_rejects_invalid_read_only_blocked_tool_ids() {
        let mut descriptor = runtime_definition("custom", "Custom").descriptor().clone();
        descriptor.read_only_role_blocked_tools = vec![
            " apply_patch ".to_string(),
            "apply_patch".to_string(),
            "   ".to_string(),
        ];

        assert_eq!(
            descriptor.validate_for_openducktor(),
            vec![
                "[workflow] read-only blocked runtime tool IDs must be unique".to_string(),
                "[workflow] read-only blocked runtime tool IDs must not be blank".to_string(),
            ]
        );
    }

    #[test]
    fn runtime_descriptor_validation_normalizes_workflow_alias_tool_ids() {
        let mut descriptor = runtime_definition("custom", "Custom").descriptor().clone();
        descriptor.workflow_tool_aliases_by_canonical = BTreeMap::from([
            (
                "odt_build_blocked".to_string(),
                vec![" shared_alias ".to_string()],
            ),
            (
                "odt_build_completed".to_string(),
                vec!["shared_alias".to_string()],
            ),
            (
                "odt_set_plan".to_string(),
                vec![" odt_set_spec ".to_string()],
            ),
            (
                "odt_set_spec".to_string(),
                vec![
                    " runtime_set_spec ".to_string(),
                    "runtime_set_spec".to_string(),
                    "   ".to_string(),
                ],
            ),
        ]);

        assert_eq!(
            descriptor.validate_for_openducktor(),
            vec![
                "[workflow] workflow alias shared_alias for canonical tool odt_build_completed is already assigned to canonical tool odt_build_blocked".to_string(),
                "[workflow] workflow alias odt_set_spec for canonical tool odt_set_plan must not repeat canonical odt_* tool IDs".to_string(),
                "[workflow] workflow aliases for canonical tool odt_set_spec must be unique".to_string(),
                "[workflow] workflow aliases for canonical tool odt_set_spec must not be blank".to_string(),
            ]
        );
    }

    #[test]
    fn runtime_descriptor_validation_rejects_duplicate_history_limitations() {
        let mut descriptor = runtime_definition("custom", "Custom").descriptor().clone();
        descriptor.capabilities.history.limitations = vec![
            "message-level only".to_string(),
            "message-level only".to_string(),
        ];

        assert_eq!(
            descriptor.validate_for_openducktor(),
            vec!["[baseline] history.limitations must not contain duplicates".to_string()]
        );
    }

    #[test]
    fn runtime_descriptor_validation_requires_execution_modes_when_subagents_are_supported() {
        let mut descriptor = runtime_definition("custom", "Custom").descriptor().clone();
        descriptor
            .capabilities
            .optional_surfaces
            .supported_subagent_execution_modes
            .clear();

        assert_eq!(
            descriptor.validate_for_openducktor(),
            vec![
                "[optional_enhancement] subagent support requires at least one supported execution mode"
                    .to_string()
            ]
        );
    }

    #[test]
    fn runtime_descriptor_validation_rejects_execution_modes_when_subagents_are_disabled() {
        let mut descriptor = runtime_definition("custom", "Custom").descriptor().clone();
        descriptor.capabilities.optional_surfaces.supports_subagents = false;

        assert_eq!(
            descriptor.validate_for_openducktor(),
            vec![
                "[optional_enhancement] subagent execution modes must be empty when subagents are unsupported"
                    .to_string()
            ]
        );
    }

    #[test]
    fn runtime_descriptor_validation_reports_capability_invariants() {
        let mut descriptor = runtime_definition("custom", "Custom").descriptor().clone();
        descriptor
            .capabilities
            .session_lifecycle
            .supports_session_fork = false;
        descriptor.capabilities.history.fidelity = RuntimeHistoryFidelity::Item;
        descriptor.capabilities.history.stable_item_ids = false;
        descriptor
            .capabilities
            .approvals
            .supported_reply_outcomes
            .retain(|outcome| !matches!(outcome, RuntimeApprovalReplyOutcome::Reject));
        descriptor.capabilities.prompt_input.supported_parts =
            vec![RuntimePromptInputPartType::Text];

        assert_eq!(
            descriptor.validate_for_openducktor(),
            vec![
                "[scenario_scoped] fork start mode requires sessionLifecycle.supportsSessionFork"
                    .to_string(),
                "[scenario_scoped] fork targets must be empty when session fork is unsupported"
                    .to_string(),
                "[baseline] item-level history requires stable item ids".to_string(),
                "[baseline] item-level history requires completion state exposure".to_string(),
                "[workflow] approval requests require reject reply outcome".to_string(),
                "[workflow] read-only auto-reject safety requires reject reply outcome".to_string(),
                "[optional_enhancement] slash command support requires slash_command prompt part"
                    .to_string(),
                "[optional_enhancement] file search support requires file or folder prompt references"
                    .to_string(),
            ]
        );
    }

    #[test]
    fn runtime_descriptor_validation_reports_scenario_start_mode_gaps() {
        let mut descriptor = runtime_definition("custom", "Custom").descriptor().clone();
        descriptor
            .capabilities
            .session_lifecycle
            .supported_start_modes = vec![
            RuntimeSessionStartMode::Fresh,
            RuntimeSessionStartMode::Reuse,
        ];
        descriptor
            .capabilities
            .session_lifecycle
            .supports_session_fork = false;
        descriptor
            .capabilities
            .session_lifecycle
            .fork_targets
            .clear();

        assert_eq!(
            descriptor.validate_for_openducktor(),
            vec![
                "[scenario_scoped] scenario build_pull_request_generation requires start modes: fork"
                    .to_string()
            ]
        );
    }

    #[test]
    fn runtime_descriptor_deserialization_rejects_unknown_capability_fields() {
        let mut descriptor_value = serde_json::to_value(
            super::builtin_runtime_registry()
                .definition_by_str("opencode")
                .expect("opencode runtime should be registered")
                .descriptor(),
        )
        .expect("runtime descriptor should serialize");

        descriptor_value["capabilities"]["supportsMcpStatus"] = serde_json::json!(true);
        descriptor_value["capabilities"]["promptInput"]["legacyFileSearch"] =
            serde_json::json!(true);
        descriptor_value["runtimeEndpoint"] = serde_json::json!("http://127.0.0.1:4444");

        let error = serde_json::from_value::<RuntimeDescriptor>(descriptor_value)
            .expect_err("unknown descriptor fields should fail fast");
        let message = error.to_string();

        assert!(
            message.contains("unknown field"),
            "unexpected deserialization error: {message}"
        );
    }

    #[test]
    fn runtime_registry_resolves_known_kinds_and_rejects_unknown_entries() -> Result<()> {
        let registry = RuntimeRegistry::new_with_default_kind(
            vec![
                runtime_definition("opencode", "OpenCode"),
                runtime_definition("test-runtime", "Test Runtime"),
            ],
            Some(AgentRuntimeKind::opencode()),
        )
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
        let registry = RuntimeRegistry::new_with_default_kind(
            vec![
                runtime_definition("opencode", "OpenCode"),
                runtime_definition("test-runtime", "Test Runtime"),
            ],
            Some(AgentRuntimeKind::opencode()),
        )
        .expect("runtime registry should build");

        let definitions = registry.definitions();
        assert_eq!(definitions.len(), 2);
        assert_eq!(definitions[0].kind().as_str(), "opencode");
        assert_eq!(definitions[1].kind().as_str(), "test-runtime");
        assert_eq!(
            definitions[1].default_startup_config().timeout_ms,
            RuntimeStartupReadinessConfig::default().timeout_ms
        );
    }
}
