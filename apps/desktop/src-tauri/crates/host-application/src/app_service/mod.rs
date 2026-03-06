use anyhow::{anyhow, Context, Result};
use fs2::FileExt;
use host_domain::{
    AgentRuntimeSummary, GitPort, RunEvent, RunSummary, RuntimeCheck, RuntimeRole, TaskCard,
    TaskStore,
};
use host_infra_system::{AppConfigStore, GitCliPort, RepoConfig, RuntimeConfigStore};
use serde::{Deserialize, Serialize};

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

pub mod build_orchestrator;

mod events;
mod hook_security;
mod opencode_runtime;
mod process_registry;
mod qa_worktree;
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

pub(crate) use events::{emit_event, spawn_output_forwarder};
pub(crate) use hook_security::{run_parsed_hook_command_allow_failure, validate_hook_trust};
pub(crate) use opencode_runtime::{
    opencode_server_parent_pid, process_exists, read_opencode_version,
    resolve_opencode_binary_path, spawn_opencode_server, terminate_child_process,
    terminate_process_by_pid, wait_for_local_server_with_process, OpencodeStartupReadinessPolicy,
    OpencodeStartupWaitReport, StartupCancelEpoch,
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
    AgentRuntimeProcess, CachedRuntimeCheck, RunProcess, RuntimeCleanupTarget,
};
pub use service_core::{AppService, RunEmitter};
#[cfg(test)]
pub(crate) use startup_metrics::{
    build_opencode_startup_event_payload, OpencodeStartupMetricsSnapshot,
};
pub(crate) use startup_metrics::{
    StartupEventContext, StartupEventCorrelation, StartupEventPayload,
    STARTUP_CONFIG_INVALID_REASON,
};
pub(crate) use workflow_rules::{
    can_replace_epic_subtask_status, can_set_plan, can_set_spec_from_status,
    default_qa_required_for_issue_type, derive_agent_workflows, derive_available_actions,
    is_open_state, normalize_required_markdown, normalize_subtask_plan_inputs,
    normalize_title_key, validate_parent_relationships_for_create,
    validate_parent_relationships_for_update, validate_plan_subtask_rules, validate_transition,
};

#[cfg(test)]
pub(crate) use opencode_runtime::{
    build_opencode_config_content, default_mcp_workspace_root, is_orphaned_opencode_server_process,
    parse_mcp_command_json, resolve_mcp_command, wait_for_local_server,
};
#[cfg(test)]
pub(crate) use workflow_rules::allows_transition;

#[cfg(test)]
mod tests;
