use super::capabilities::REQUIRED_RUNTIME_SUPPORTED_SCOPES;
use super::{
    AgentRuntimeKind, RuntimeApprovalCapabilities, RuntimeApprovalReplyOutcome,
    RuntimeApprovalRequestType, RuntimeCapabilities, RuntimeDefinition, RuntimeDescriptor,
    RuntimeForkTarget, RuntimeHistoryCapabilities, RuntimeHistoryFidelity, RuntimeHistoryReplay,
    RuntimeHydratedEventType, RuntimeOmittedPermissionBehavior, RuntimeOptionalSurfaceCapabilities,
    RuntimePendingInputVisibility, RuntimePromptInputCapabilities, RuntimePromptInputPartType,
    RuntimeProvisioningMode, RuntimeQuestionAnswerMode, RuntimeRegistry,
    RuntimeSessionLifecycleCapabilities, RuntimeSessionStartMode, RuntimeStartupReadinessConfig,
    RuntimeStructuredInputCapabilities, RuntimeSubagentExecutionMode, RuntimeSupportedScope,
    RuntimeWorkflowCapabilities,
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

fn apply_fixture_patch(target: &mut serde_json::Value, patch: &[RuntimeDescriptorFixturePatch]) {
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
            let mut capabilities = capabilities_with_scopes(vec![RuntimeSupportedScope::Workspace]);
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
fn runtime_descriptor_validation_rejects_live_snapshot_visibility_without_snapshot_support() {
    let mut descriptor = runtime_definition("custom", "Custom").descriptor().clone();
    descriptor
        .capabilities
        .session_lifecycle
        .supports_pending_input_snapshots = false;
    descriptor.capabilities.approvals.pending_visibility =
        vec![RuntimePendingInputVisibility::LiveSnapshot];
    descriptor.capabilities.structured_input.pending_visibility =
        vec![RuntimePendingInputVisibility::LiveSnapshot];

    assert_eq!(
        descriptor.validate_for_openducktor(),
        vec![
            "[workflow] approvals.pendingVisibility live_snapshot requires sessionLifecycle.supportsPendingInputSnapshots"
                .to_string(),
            "[workflow] structuredInput.pendingVisibility live_snapshot requires sessionLifecycle.supportsPendingInputSnapshots"
                .to_string(),
        ]
    );
}

#[test]
fn runtime_descriptor_validation_requires_read_only_auto_reject_safety() {
    let mut descriptor = runtime_definition("custom", "Custom").descriptor().clone();
    descriptor.capabilities.approvals.read_only_auto_reject_safe = false;

    assert_eq!(
        descriptor.validate_for_openducktor(),
        vec![
            "[workflow] read-only roles must auto-reject mutating permission requests".to_string()
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
        " message-level only ".to_string(),
        "message-level only".to_string(),
        "   ".to_string(),
    ];

    assert_eq!(
        descriptor.validate_for_openducktor(),
        vec![
            "[baseline] history.limitations must not contain duplicates".to_string(),
            "[baseline] history.limitations must not contain blank entries".to_string(),
        ]
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
    descriptor.capabilities.prompt_input.supported_parts = vec![RuntimePromptInputPartType::Text];

    assert_eq!(
        descriptor.validate_for_openducktor(),
        vec![
            "[launch_scoped] fork start mode requires sessionLifecycle.supportsSessionFork"
                .to_string(),
            "[launch_scoped] fork targets must be empty when session fork is unsupported"
                .to_string(),
            "[launch_scoped] item-level history requires stable item ids".to_string(),
            "[launch_scoped] item-level history requires completion state exposure".to_string(),
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
fn runtime_descriptor_validation_reports_launch_start_mode_gaps() {
    let mut descriptor = runtime_definition("custom", "Custom").descriptor().clone();
    let supported_start_modes = vec![
        RuntimeSessionStartMode::Fresh,
        RuntimeSessionStartMode::Reuse,
    ];
    descriptor
        .capabilities
        .session_lifecycle
        .supported_start_modes = supported_start_modes;
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
            "[launch_scoped] launch action build_pull_request_generation requires start modes: fork"
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
    descriptor_value["capabilities"]["promptInput"]["legacyFileSearch"] = serde_json::json!(true);
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
