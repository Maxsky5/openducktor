use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeSubagentExecutionMode {
    Foreground,
    Background,
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
    pub supports_subagents: bool,
    pub supported_subagent_execution_modes: Vec<RuntimeSubagentExecutionMode>,
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

        let has_subagent_execution_modes = !self
            .capabilities
            .supported_subagent_execution_modes
            .is_empty();
        if self.capabilities.supports_subagents && !has_subagent_execution_modes {
            errors.push(
                "supports_subagents requires at least one supported subagent execution mode"
                    .to_string(),
            );
        }
        if !self.capabilities.supports_subagents && has_subagent_execution_modes {
            errors.push(
                "supported subagent execution modes must be empty when supports_subagents is false"
                    .to_string(),
            );
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
                supports_subagents: true,
                supported_subagent_execution_modes: vec![
                    RuntimeSubagentExecutionMode::Foreground,
                    RuntimeSubagentExecutionMode::Background,
                ],
                supported_scopes: REQUIRED_RUNTIME_SUPPORTED_SCOPES.to_vec(),
                provisioning_mode: RuntimeProvisioningMode::HostManaged,
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
        AgentRuntimeKind, RuntimeCapabilities, RuntimeDefinition, RuntimeDescriptor,
        RuntimeProvisioningMode, RuntimeRegistry, RuntimeStartupReadinessConfig,
        RuntimeSubagentExecutionMode, RuntimeSupportedScope, REQUIRED_RUNTIME_SUPPORTED_SCOPES,
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
            supports_subagents: true,
            supported_subagent_execution_modes: vec![
                RuntimeSubagentExecutionMode::Foreground,
                RuntimeSubagentExecutionMode::Background,
            ],
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
        assert!(descriptor.capabilities.supports_subagents);
        assert_eq!(
            descriptor.capabilities.supported_subagent_execution_modes,
            vec![
                RuntimeSubagentExecutionMode::Foreground,
                RuntimeSubagentExecutionMode::Background,
            ]
        );
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
                supports_subagents: false,
                supported_subagent_execution_modes: vec![],
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
    fn runtime_descriptor_validation_requires_execution_modes_when_subagents_are_supported() {
        let mut descriptor = runtime_definition("custom", "Custom").descriptor().clone();
        descriptor
            .capabilities
            .supported_subagent_execution_modes
            .clear();

        assert_eq!(
            descriptor.validate_for_openducktor(),
            vec![
                "supports_subagents requires at least one supported subagent execution mode"
                    .to_string()
            ]
        );
    }

    #[test]
    fn runtime_descriptor_validation_rejects_execution_modes_when_subagents_are_disabled() {
        let mut descriptor = runtime_definition("custom", "Custom").descriptor().clone();
        descriptor.capabilities.supports_subagents = false;

        assert_eq!(
            descriptor.validate_for_openducktor(),
            vec![
                "supported subagent execution modes must be empty when supports_subagents is false"
                    .to_string()
            ]
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
