use anyhow::{anyhow, Context, Result};
use fs2::FileExt;
use host_domain::{
    DevServerEvent, DevServerGroupState, GitPort, RunEvent, RunSummary, RuntimeCheck,
    RuntimeInstanceSummary, RuntimeRole, TaskCard, TaskStore,
};
use host_infra_system::{AppConfigStore, GitCliPort, RepoConfig, RuntimeConfigStore};
use serde::{Deserialize, Serialize};

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Instant;

pub mod build_orchestrator;

mod dev_server_manager;
mod events;
mod git_provider;
mod hook_security;
mod mcp_bridge_process;
mod mcp_bridge_registry;
mod odt_mcp;
mod opencode_runtime;
mod opencode_session_status;
mod process_registry;
mod repo_init;
mod runtime_orchestrator;
mod service_core;
mod startup_metrics;
mod system_workspace_git;
mod task_enrichment;
mod task_workflow;
#[cfg(test)]
pub(crate) mod test_support;
mod workflow_rules;
mod workspace_policy;

pub(crate) use events::emit_event;
pub(crate) use hook_security::{run_parsed_hook_command_allow_failure, validate_hook_trust};
#[cfg(test)]
pub(crate) use mcp_bridge_registry::{read_mcp_bridge_registry, MCP_BRIDGE_REGISTRY_RELATIVE_PATH};
pub use odt_mcp::{
    OdtCreateTaskInput, OdtHostBridgeReady, OdtSearchTasksInput, OdtSearchTasksResult,
    OdtSetPlanResult, OdtSetPullRequestResult, OdtSetSpecResult, OdtTaskDocumentsRead,
    OdtTaskResult, OdtTaskSummary,
};
pub use opencode_runtime::OpencodeStartupWaitFailure;
pub(crate) use opencode_runtime::{
    opencode_server_parent_pid, process_exists, read_opencode_version,
    resolve_opencode_binary_path, terminate_child_process, terminate_process_by_pid,
    wait_for_local_server_with_process, wait_for_process_exit_by_pid,
    OpencodeStartupReadinessPolicy, OpencodeStartupWaitReport, StartupCancelEpoch,
};
pub(crate) use opencode_session_status::{
    dedupe_probe_targets as dedupe_opencode_session_status_probe_targets,
    has_live_opencode_session_status, OpencodeSessionStatusMap, OpencodeSessionStatusProbeTarget,
};
#[cfg(test)]
pub(crate) use process_registry::read_opencode_process_registry;
pub(crate) use process_registry::TrackedOpencodeProcessGuard;
#[cfg(test)]
pub(crate) use process_registry::{
    with_locked_opencode_process_registry, OpencodeProcessRegistryInstance,
    OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH,
};
pub(crate) use service_core::{
    AgentRuntimeProcess, CachedRuntimeCheck, DevServerGroupRuntime, McpBridgeProcess, RunProcess,
    RuntimeCleanupTarget,
};
pub use service_core::{AppService, DevServerEmitter, RunEmitter};
#[cfg(test)]
pub(crate) use startup_metrics::{
    build_opencode_startup_event_payload, OpencodeStartupMetricsSnapshot,
};
pub(crate) use startup_metrics::{
    StartupEventContext, StartupEventCorrelation, StartupEventPayload,
    STARTUP_CONFIG_INVALID_REASON,
};
pub(crate) use workflow_rules::{
    derive_agent_workflows, derive_available_actions, validate_transition_without_related_tasks,
};
pub use workspace_policy::{
    HookTrustConfirmationPort, HookTrustConfirmationRequest, PreparedHookTrustChallenge,
    RepoConfigUpdate, RepoSettingsUpdate, WorkspaceSettingsSnapshotUpdate,
};

#[cfg(test)]
pub(crate) use workflow_rules::{
    can_set_plan, can_set_spec_from_status, normalize_required_markdown,
    normalize_subtask_plan_inputs, validate_parent_relationships_for_create,
    validate_parent_relationships_for_update, validate_plan_subtask_rules, validate_transition,
};

#[cfg(test)]
pub(crate) use opencode_runtime::{
    build_opencode_config_content, default_mcp_workspace_root, find_openducktor_workspace_root,
    is_orphaned_opencode_server_process, parse_mcp_command_json, resolve_mcp_command,
    wait_for_local_server,
};
#[cfg(test)]
pub(crate) use workflow_rules::allows_transition;

#[cfg(test)]
mod tests;
