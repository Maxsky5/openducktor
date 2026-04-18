pub(super) use anyhow::{Context, Result};
pub(super) use host_domain::{
    AgentRuntimeKind, AgentSessionDocument, CreateTaskInput, DevServerGroupState,
    DevServerScriptState, DevServerScriptStatus, GitBranch, IssueType, PlanSubtaskInput,
    PullRequestRecord, QaWorkflowVerdict, RuntimeCapabilities, RuntimeDefinition,
    RuntimeDescriptor, RuntimeHealth, RuntimeInstanceSummary, RuntimeProvisioningMode, RuntimeRole,
    RuntimeStartupReadinessConfig, RuntimeSupportedScope, SystemOpenInToolId, SystemOpenInToolInfo,
    TaskAction, TaskCard, TaskStatus, TaskStore, UpdateTaskPatch,
};
pub(super) use host_infra_system::{
    AppConfigStore, OpencodeStartupReadinessConfig, RuntimeConfig, RuntimeConfigStore,
};
pub(super) use serde_json::json;
pub(super) use std::collections::BTreeMap;
pub(super) use std::fs;
pub(super) use std::net::{TcpListener, TcpStream};
pub(super) use std::process::Command;
pub(super) use std::sync::atomic::{AtomicU64, Ordering};
pub(super) use std::sync::{Arc, Mutex};
pub(super) use std::time::{Duration, Instant};

pub(super) use crate::app_service::runtime_registry::{
    AppRuntime, AppRuntimeRegistry, ExternalRuntimeStart,
};
pub(super) use crate::app_service::test_support::{
    build_service_with_git_state, build_service_with_runtime_registry,
    builtin_opencode_runtime_definition, builtin_opencode_runtime_descriptor,
    builtin_opencode_runtime_route, make_task, repo_config_for_workspace,
    spawn_opencode_session_status_server, spawn_sleep_process, spawn_sleep_process_group,
    unique_temp_path, wait_for_process_exit, workspace_update_repo_config_by_repo_path,
    write_private_file, FakeTaskStore, TaskStoreState,
};
pub(super) use crate::app_service::{
    allows_transition, build_opencode_startup_event_payload, can_set_plan,
    can_set_spec_from_status, derive_available_actions, normalize_required_markdown,
    normalize_subtask_plan_inputs, terminate_child_process,
    validate_parent_relationships_for_create, validate_parent_relationships_for_update,
    validate_plan_subtask_rules, validate_transition, wait_for_local_server,
    wait_for_local_server_with_process, AgentRuntimeProcess, AppService, DevServerGroupRuntime,
    OpencodeStartupMetricsSnapshot, OpencodeStartupReadinessPolicy, OpencodeStartupWaitReport,
    RuntimeProcessGuard, RuntimeSessionStatusProbeOutcome, RuntimeSessionStatusProbeTarget,
    RuntimeSessionStatusProbeTargetResolution, RuntimeSessionStatusSnapshot,
    RuntimeStartupFailureReason, StartupEventContext, StartupEventCorrelation, StartupEventPayload,
};

pub(super) fn init_git_repo(path: &std::path::Path) -> Result<()> {
    let status = Command::new("git")
        .args(["init", "--quiet"])
        .arg(path)
        .status()?;
    if status.success() {
        return Ok(());
    }

    Err(anyhow::anyhow!(
        "failed to initialize git repo for test at {}",
        path.display()
    ))
}

pub(super) fn insert_workspace_runtime(
    service: &AppService,
    repo_path: &str,
    port: u16,
) -> Result<()> {
    let summary = RuntimeInstanceSummary {
        kind: AgentRuntimeKind::opencode(),
        runtime_id: "runtime-workspace".to_string(),
        repo_path: repo_path.to_string(),
        task_id: None,
        role: RuntimeRole::Workspace,
        working_directory: repo_path.to_string(),
        runtime_route: builtin_opencode_runtime_route(port),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        descriptor: builtin_opencode_runtime_descriptor(),
    };
    service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .insert(
            "runtime-workspace".to_string(),
            AgentRuntimeProcess {
                summary,
                child: Some(spawn_sleep_process(30)),
                _runtime_process_guard: None,
                cleanup_target: None,
            },
        );
    Ok(())
}

pub(super) fn insert_task_runtime_for_kind_role(
    service: &AppService,
    runtime_kind: AgentRuntimeKind,
    task_id: &str,
    role: RuntimeRole,
    repo_path: &str,
    working_directory: &str,
    runtime_route: host_domain::RuntimeRoute,
) -> Result<()> {
    let descriptor = service
        .runtime_registry
        .definition(&runtime_kind)?
        .descriptor()
        .clone();
    let runtime_id = format!(
        "runtime-{}-{task_id}-{}",
        runtime_kind.as_str(),
        role.as_str()
    );
    let summary = RuntimeInstanceSummary {
        kind: runtime_kind,
        runtime_id: runtime_id.clone(),
        repo_path: repo_path.to_string(),
        task_id: Some(task_id.to_string()),
        role,
        working_directory: working_directory.to_string(),
        runtime_route,
        started_at: "2026-03-17T11:00:00Z".to_string(),
        descriptor,
    };
    service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .insert(
            runtime_id,
            AgentRuntimeProcess {
                summary,
                child: Some(spawn_sleep_process(30)),
                _runtime_process_guard: None,
                cleanup_target: None,
            },
        );
    Ok(())
}

#[derive(Clone)]
pub(super) enum SessionProbeBehavior {
    Default,
    ReturnUnsupported,
    ReturnError(&'static str),
    ProbeFailure(&'static str),
}

#[derive(Clone)]
pub(super) struct TestRuntimeAdapter {
    pub(super) definition: RuntimeDefinition,
    pub(super) health: RuntimeHealth,
    pub(super) session_probe_behavior: SessionProbeBehavior,
}

impl AppRuntime for TestRuntimeAdapter {
    fn definition(&self) -> RuntimeDefinition {
        self.definition.clone()
    }

    fn startup_policy(&self, _service: &AppService) -> Result<OpencodeStartupReadinessPolicy> {
        Ok(OpencodeStartupReadinessPolicy::default())
    }

    fn start_external(
        &self,
        _service: &AppService,
        _input: &crate::app_service::runtime_orchestrator::RuntimeStartInput<'_>,
        _runtime_id: &str,
    ) -> Result<ExternalRuntimeStart> {
        Ok(ExternalRuntimeStart {
            runtime_route: self.definition.route_for_port(43_123),
            startup_report: crate::app_service::RuntimeStartupWaitReport::zero(),
        })
    }

    fn track_process(&self, _service: &AppService, _child_id: u32) -> Result<RuntimeProcessGuard> {
        Err(anyhow::anyhow!(
            "track_process should not be used in this test"
        ))
    }

    fn spawn_server(
        &self,
        _service: &AppService,
        _working_directory: &std::path::Path,
        _workspace_id_for_mcp: &str,
        _port: u16,
    ) -> Result<std::process::Child> {
        Err(anyhow::anyhow!("spawn should not be used in this test"))
    }

    fn wait_until_ready(
        &self,
        _service: &AppService,
        _input: &crate::app_service::runtime_orchestrator::RuntimeStartInput<'_>,
        _child: &mut std::process::Child,
        _port: u16,
        _runtime_id: &str,
        _startup_policy: crate::app_service::RuntimeStartupReadinessPolicy,
    ) -> Result<crate::app_service::RuntimeStartupWaitReport> {
        Err(anyhow::anyhow!("wait should not be used in this test"))
    }

    fn runtime_health(&self) -> RuntimeHealth {
        self.health.clone()
    }

    fn stop_session(
        &self,
        _runtime_route: &host_domain::RuntimeRoute,
        _external_session_id: &str,
        _working_directory: &str,
    ) -> Result<()> {
        Err(anyhow::anyhow!(
            "stop_session should not be used in this test"
        ))
    }

    fn session_status_probe_target(
        &self,
        runtime_route: &host_domain::RuntimeRoute,
        working_directory: &str,
    ) -> Result<RuntimeSessionStatusProbeTargetResolution> {
        match self.session_probe_behavior {
            SessionProbeBehavior::Default => match runtime_route {
                host_domain::RuntimeRoute::LocalHttp { .. } => {
                    Ok(RuntimeSessionStatusProbeTargetResolution::Target(
                        RuntimeSessionStatusProbeTarget::new(
                            self.definition.kind().clone(),
                            runtime_route,
                            working_directory,
                        ),
                    ))
                }
                host_domain::RuntimeRoute::Stdio => {
                    Ok(RuntimeSessionStatusProbeTargetResolution::Unsupported)
                }
            },
            SessionProbeBehavior::ReturnUnsupported => {
                Ok(RuntimeSessionStatusProbeTargetResolution::Unsupported)
            }
            SessionProbeBehavior::ReturnError(message) => Err(anyhow::anyhow!(message)),
            SessionProbeBehavior::ProbeFailure(_) => {
                Ok(RuntimeSessionStatusProbeTargetResolution::Target(
                    RuntimeSessionStatusProbeTarget::new(
                        self.definition.kind().clone(),
                        runtime_route,
                        working_directory,
                    ),
                ))
            }
        }
    }

    fn probe_session_status(
        &self,
        _target: &RuntimeSessionStatusProbeTarget,
    ) -> RuntimeSessionStatusProbeOutcome {
        match self.session_probe_behavior {
            SessionProbeBehavior::ProbeFailure(message) => {
                RuntimeSessionStatusProbeOutcome::ActionableError(
                    crate::app_service::RuntimeSessionStatusProbeError::ProbeFailed(
                        message.to_string(),
                    ),
                )
            }
            SessionProbeBehavior::ReturnUnsupported => {
                RuntimeSessionStatusProbeOutcome::Unsupported
            }
            _ => RuntimeSessionStatusProbeOutcome::Snapshot(
                RuntimeSessionStatusSnapshot::from_statuses(Default::default()),
            ),
        }
    }
}

pub(super) fn test_runtime_definition(kind: &str, label: &str) -> RuntimeDefinition {
    test_runtime_definition_with_provisioning(kind, label, RuntimeProvisioningMode::HostManaged)
}

pub(super) fn test_runtime_definition_with_provisioning(
    kind: &str,
    label: &str,
    provisioning_mode: RuntimeProvisioningMode,
) -> RuntimeDefinition {
    RuntimeDefinition::new(
        RuntimeDescriptor {
            kind: AgentRuntimeKind::from(kind),
            label: label.to_string(),
            description: format!("{label} runtime"),
            read_only_role_blocked_tools: vec!["apply_patch".to_string()],
            workflow_tool_aliases_by_canonical: Default::default(),
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
                supported_scopes: vec![
                    RuntimeSupportedScope::Workspace,
                    RuntimeSupportedScope::Task,
                    RuntimeSupportedScope::Build,
                ],
                provisioning_mode,
            },
        },
        RuntimeStartupReadinessConfig::default(),
        |port| host_domain::RuntimeRoute::LocalHttp {
            endpoint: format!("http://127.0.0.1:{port}"),
        },
    )
}
