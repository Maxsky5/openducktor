mod capabilities;
mod descriptor;
mod kind;
mod odt_tools;
mod opencode;
mod startup;

#[cfg(test)]
mod tests;

use anyhow::{anyhow, Result};
use std::collections::BTreeMap;
use std::sync::{Arc, LazyLock};

pub use capabilities::{
    RuntimeApprovalCapabilities, RuntimeApprovalReplyOutcome, RuntimeApprovalRequestType,
    RuntimeCapabilities, RuntimeForkTarget, RuntimeHistoryCapabilities, RuntimeHistoryFidelity,
    RuntimeHistoryReplay, RuntimeHydratedEventType, RuntimeOmittedPermissionBehavior,
    RuntimeOptionalSurfaceCapabilities, RuntimePendingInputVisibility,
    RuntimePromptInputCapabilities, RuntimePromptInputPartType, RuntimeProvisioningMode,
    RuntimeQuestionAnswerMode, RuntimeSessionLifecycleCapabilities, RuntimeSessionStartMode,
    RuntimeStructuredInputCapabilities, RuntimeSubagentExecutionMode, RuntimeSupportedScope,
    RuntimeWorkflowCapabilities,
};
pub use descriptor::RuntimeDescriptor;
pub use kind::AgentRuntimeKind;
pub use startup::RuntimeStartupReadinessConfig;

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

static BUILTIN_RUNTIME_REGISTRY: LazyLock<RuntimeRegistry> = LazyLock::new(|| {
    RuntimeRegistry::new_with_default_kind(
        vec![opencode::opencode_runtime_definition()],
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
