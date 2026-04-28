use super::capabilities::RuntimeCapabilities;
use super::kind::AgentRuntimeKind;
use super::odt_tools::ODT_WORKFLOW_TOOL_NAMES;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

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
        errors.extend(self.capabilities.pending_visibility_errors());
        errors.extend(self.capabilities.prompt_input_errors());
        errors.extend(self.capabilities.optional_surface_errors());
        errors.extend(self.capabilities.scenario_config_errors());

        errors
    }
}
