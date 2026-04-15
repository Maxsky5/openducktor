use super::super::{
    RuntimeCleanupTarget, RuntimeStartupReadinessPolicy, RuntimeStartupWaitReport,
    TrackedOpencodeProcessGuard,
};
use host_domain::{AgentRuntimeKind, RuntimeRole, RuntimeRoute};
use std::process::Child;
use std::time::Instant;

#[derive(Clone, Copy)]
pub(super) struct RuntimeExistingLookup<'a> {
    pub(super) repo_key: &'a str,
    pub(super) role: RuntimeRole,
    pub(super) task_id: Option<&'a str>,
}

pub(crate) struct RuntimePostStartPolicy<'a> {
    pub(crate) existing_lookup: RuntimeExistingLookup<'a>,
    pub(crate) prune_error_context: String,
}

pub(crate) struct RuntimeStartInput<'a> {
    pub(crate) runtime_kind: AgentRuntimeKind,
    pub(crate) startup_scope: &'a str,
    pub(crate) repo_path: &'a str,
    pub(crate) repo_key: String,
    pub(crate) startup_started_at_instant: Instant,
    pub(crate) startup_started_at: String,
    pub(crate) task_id: &'a str,
    pub(crate) role: RuntimeRole,
    pub(crate) startup_policy: RuntimeStartupReadinessPolicy,
    pub(crate) working_directory: String,
    pub(crate) cleanup_target: Option<RuntimeCleanupTarget>,
    pub(crate) tracking_error_context: &'static str,
    pub(crate) startup_error_context: String,
    pub(crate) post_start_policy: Option<RuntimePostStartPolicy<'a>>,
}

pub(super) struct SpawnedRuntimeServer {
    pub(super) runtime_id: String,
    pub(super) runtime_route: RuntimeRoute,
    pub(super) child: Option<Child>,
    pub(super) _runtime_process_guard: Option<TrackedOpencodeProcessGuard>,
    pub(super) startup_started_at_instant: Instant,
    pub(super) startup_started_at: String,
    pub(super) startup_report: RuntimeStartupWaitReport,
}
