use anyhow::{anyhow, Context, Result};
use fs2::FileExt;
use host_domain::{
    AgentRuntimeSummary, GitPort, RunEvent, RunSummary, RuntimeCheck, TaskCard, TaskStore,
};
use host_infra_system::{AppConfigStore, GitCliPort, RepoConfig};
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
mod opencode_runtime;
mod runtime_orchestrator;
mod system_workspace_git;
mod task_workflow;
#[cfg(test)]
pub(crate) mod test_support;
mod workflow_rules;

pub(crate) use events::{emit_event, spawn_output_forwarder};
pub(crate) use opencode_runtime::{
    opencode_server_parent_pid, process_exists, read_opencode_version,
    resolve_opencode_binary_path, spawn_opencode_server, terminate_child_process,
    terminate_process_by_pid, wait_for_local_server_with_process, OpencodeStartupReadinessPolicy,
    OpencodeStartupWaitReport, StartupCancelEpoch,
};
pub(crate) use workflow_rules::{
    can_replace_epic_subtask_status, can_set_plan, can_set_spec_from_status,
    default_qa_required_for_issue_type, derive_available_actions, normalize_issue_type,
    normalize_required_markdown, normalize_subtask_plan_inputs, normalize_title_key,
    validate_parent_relationships_for_create, validate_parent_relationships_for_update,
    validate_plan_subtask_rules, validate_transition,
};

#[cfg(test)]
pub(crate) use opencode_runtime::{
    build_opencode_config_content, default_mcp_workspace_root, is_orphaned_opencode_server_process,
    parse_mcp_command_json, resolve_mcp_command, wait_for_local_server,
};
#[cfg(test)]
pub(crate) use workflow_rules::allows_transition;

pub type RunEmitter = Arc<dyn Fn(RunEvent) + Send + Sync + 'static>;

#[derive(Clone)]
pub struct AppService {
    task_store: Arc<dyn TaskStore>,
    git_port: Arc<dyn GitPort>,
    config_store: AppConfigStore,
    runs: Arc<Mutex<HashMap<String, RunProcess>>>,
    agent_runtimes: Arc<Mutex<HashMap<String, AgentRuntimeProcess>>>,
    tracked_opencode_processes: Arc<Mutex<HashMap<u32, usize>>>,
    opencode_process_registry_path: PathBuf,
    instance_pid: u32,
    initialized_repos: Arc<Mutex<HashSet<String>>>,
    runtime_check_cache: Arc<Mutex<Option<CachedRuntimeCheck>>>,
    startup_cancel_epoch: StartupCancelEpoch,
    startup_metrics: Arc<Mutex<OpencodeStartupMetrics>>,
}

pub(crate) struct TrackedOpencodeProcessGuard {
    tracked_opencode_processes: Arc<Mutex<HashMap<u32, usize>>>,
    opencode_process_registry_path: PathBuf,
    parent_pid: u32,
    child_pid: u32,
}

impl Drop for TrackedOpencodeProcessGuard {
    fn drop(&mut self) {
        let mut should_remove_from_registry = false;
        if let Ok(mut tracked_processes) = self.tracked_opencode_processes.lock() {
            if let Some(count) = tracked_processes.get_mut(&self.child_pid) {
                if *count > 1 {
                    *count -= 1;
                } else {
                    tracked_processes.remove(&self.child_pid);
                    should_remove_from_registry = true;
                }
            }
        }
        if !should_remove_from_registry {
            return;
        }

        let _ = with_locked_opencode_process_registry(
            self.opencode_process_registry_path.as_path(),
            |instances| {
                for instance in instances.iter_mut() {
                    if instance.parent_pid == self.parent_pid {
                        instance.child_pids.retain(|pid| *pid != self.child_pid);
                    }
                }
                Ok(())
            },
        );
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct OpencodeProcessRegistryInstance {
    parent_pid: u32,
    #[serde(default)]
    child_pids: Vec<u32>,
}

impl OpencodeProcessRegistryInstance {
    fn with_child(parent_pid: u32, child_pid: u32) -> Self {
        Self {
            parent_pid,
            child_pids: vec![child_pid],
        }
    }

    fn with_children(parent_pid: u32, child_pids: Vec<u32>) -> Self {
        Self {
            parent_pid,
            child_pids,
        }
    }
}

pub(crate) struct RunProcess {
    summary: RunSummary,
    child: Child,
    _opencode_process_guard: Option<TrackedOpencodeProcessGuard>,
    repo_path: String,
    task_id: String,
    worktree_path: String,
    repo_config: RepoConfig,
}

pub(crate) struct AgentRuntimeProcess {
    summary: AgentRuntimeSummary,
    child: Child,
    _opencode_process_guard: Option<TrackedOpencodeProcessGuard>,
    cleanup_repo_path: Option<String>,
    cleanup_worktree_path: Option<String>,
}

pub(crate) struct CachedRuntimeCheck {
    checked_at: Instant,
    value: RuntimeCheck,
}

const OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH: &str = "runtime/opencode-processes.json";
const STARTUP_DURATION_WARN_MS: u64 = 5_000;
const STARTUP_ATTEMPTS_WARN: u32 = 20;
const STARTUP_FAILURE_RATE_WARN_MIN_SAMPLES: u64 = 10;
const STARTUP_FAILURE_RATE_WARN_PCT: u64 = 30;
const STARTUP_MS_BUCKETS: [&str; 7] = [
    "<=100",
    "<=250",
    "<=500",
    "<=1000",
    "<=2000",
    "<=5000",
    ">5000",
];
const STARTUP_ATTEMPTS_BUCKETS: [&str; 6] = ["<=1", "<=3", "<=5", "<=10", "<=20", ">20"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpencodeStartupPolicyPayload {
    timeout_ms: u64,
    connect_timeout_ms: u64,
    initial_retry_delay_ms: u64,
    max_retry_delay_ms: u64,
    child_check_interval_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpencodeStartupReportPayload {
    startup_ms: u64,
    attempts: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpencodeStartupMetricsSnapshot {
    total: u64,
    ready: u64,
    failed: u64,
    failed_by_reason: BTreeMap<String, u64>,
    startup_ms_histogram: BTreeMap<String, u64>,
    attempts_histogram: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpencodeStartupEventPayload {
    event: String,
    scope: String,
    repo_path: String,
    task_id: Option<String>,
    role: String,
    port: u16,
    correlation_type: Option<String>,
    correlation_id: Option<String>,
    policy: Option<OpencodeStartupPolicyPayload>,
    report: Option<OpencodeStartupReportPayload>,
    reason: Option<String>,
    metrics: Option<OpencodeStartupMetricsSnapshot>,
    #[serde(default)]
    alerts: Vec<String>,
}

#[derive(Debug, Clone)]
struct OpencodeStartupMetrics {
    total: u64,
    ready: u64,
    failed: u64,
    failed_by_reason: BTreeMap<String, u64>,
    startup_ms_histogram: BTreeMap<String, u64>,
    attempts_histogram: BTreeMap<String, u64>,
}

impl OpencodeStartupMetrics {
    fn default_histogram(buckets: &[&str]) -> BTreeMap<String, u64> {
        buckets
            .iter()
            .map(|bucket| ((*bucket).to_string(), 0))
            .collect()
    }

    fn startup_ms_bucket(startup_ms: u64) -> &'static str {
        if startup_ms <= 100 {
            "<=100"
        } else if startup_ms <= 250 {
            "<=250"
        } else if startup_ms <= 500 {
            "<=500"
        } else if startup_ms <= 1_000 {
            "<=1000"
        } else if startup_ms <= 2_000 {
            "<=2000"
        } else if startup_ms <= 5_000 {
            "<=5000"
        } else {
            ">5000"
        }
    }

    fn attempts_bucket(attempts: u32) -> &'static str {
        if attempts <= 1 {
            "<=1"
        } else if attempts <= 3 {
            "<=3"
        } else if attempts <= 5 {
            "<=5"
        } else if attempts <= 10 {
            "<=10"
        } else if attempts <= 20 {
            "<=20"
        } else {
            ">20"
        }
    }

    fn snapshot(&self) -> OpencodeStartupMetricsSnapshot {
        OpencodeStartupMetricsSnapshot {
            total: self.total,
            ready: self.ready,
            failed: self.failed,
            failed_by_reason: self.failed_by_reason.clone(),
            startup_ms_histogram: self.startup_ms_histogram.clone(),
            attempts_histogram: self.attempts_histogram.clone(),
        }
    }

    fn failure_rate_percent(&self) -> u64 {
        if self.total == 0 {
            return 0;
        }
        ((self.failed * 100) / self.total).min(100)
    }

    fn ensure_histograms_initialized(&mut self) {
        if self.startup_ms_histogram.is_empty() {
            self.startup_ms_histogram = Self::default_histogram(&STARTUP_MS_BUCKETS);
        }
        if self.attempts_histogram.is_empty() {
            self.attempts_histogram = Self::default_histogram(&STARTUP_ATTEMPTS_BUCKETS);
        }
    }

    fn record_terminal(
        &mut self,
        event: &str,
        report: OpencodeStartupWaitReport,
        reason: Option<&str>,
    ) -> (OpencodeStartupMetricsSnapshot, Vec<String>) {
        self.ensure_histograms_initialized();
        self.total += 1;
        if event == "startup_ready" {
            self.ready += 1;
        } else if event == "startup_failed" {
            self.failed += 1;
            let reason_key = reason.unwrap_or("unknown").to_string();
            *self.failed_by_reason.entry(reason_key).or_insert(0) += 1;
        }

        let startup_bucket = Self::startup_ms_bucket(report.startup_ms()).to_string();
        if let Some(entry) = self.startup_ms_histogram.get_mut(&startup_bucket) {
            *entry += 1;
        }
        let attempts_bucket = Self::attempts_bucket(report.attempts()).to_string();
        if let Some(entry) = self.attempts_histogram.get_mut(&attempts_bucket) {
            *entry += 1;
        }

        let mut alerts = Vec::new();
        if report.startup_ms() >= STARTUP_DURATION_WARN_MS {
            alerts.push(format!("startup_duration_high:{}", report.startup_ms()));
        }
        if report.attempts() >= STARTUP_ATTEMPTS_WARN {
            alerts.push(format!("startup_attempts_high:{}", report.attempts()));
        }
        let failure_rate_pct = self.failure_rate_percent();
        if self.total >= STARTUP_FAILURE_RATE_WARN_MIN_SAMPLES
            && failure_rate_pct >= STARTUP_FAILURE_RATE_WARN_PCT
        {
            alerts.push(format!("startup_failure_rate_high:{failure_rate_pct}"));
        }

        (self.snapshot(), alerts)
    }
}

impl Default for OpencodeStartupMetricsSnapshot {
    fn default() -> Self {
        Self {
            total: 0,
            ready: 0,
            failed: 0,
            failed_by_reason: BTreeMap::new(),
            startup_ms_histogram: OpencodeStartupMetrics::default_histogram(&STARTUP_MS_BUCKETS),
            attempts_histogram: OpencodeStartupMetrics::default_histogram(
                &STARTUP_ATTEMPTS_BUCKETS,
            ),
        }
    }
}

impl Default for OpencodeStartupMetrics {
    fn default() -> Self {
        Self {
            total: 0,
            ready: 0,
            failed: 0,
            failed_by_reason: BTreeMap::new(),
            startup_ms_histogram: OpencodeStartupMetrics::default_histogram(&STARTUP_MS_BUCKETS),
            attempts_histogram: OpencodeStartupMetrics::default_histogram(
                &STARTUP_ATTEMPTS_BUCKETS,
            ),
        }
    }
}

fn build_opencode_startup_event_payload(
    event: &str,
    scope: &str,
    repo_path: &str,
    task_id: Option<&str>,
    role: &str,
    port: u16,
    correlation_type: Option<&str>,
    correlation_id: Option<&str>,
    policy: Option<OpencodeStartupReadinessPolicy>,
    report: Option<OpencodeStartupWaitReport>,
    reason: Option<&str>,
    metrics: Option<OpencodeStartupMetricsSnapshot>,
    alerts: Vec<String>,
) -> OpencodeStartupEventPayload {
    let policy_payload = policy.map(|entry| OpencodeStartupPolicyPayload {
        timeout_ms: entry.timeout_ms(),
        connect_timeout_ms: entry.connect_timeout_ms(),
        initial_retry_delay_ms: entry.initial_retry_delay_ms(),
        max_retry_delay_ms: entry.max_retry_delay_ms(),
        child_check_interval_ms: entry.child_state_check_interval_ms(),
    });
    let report_payload = report.map(|entry| OpencodeStartupReportPayload {
        startup_ms: entry.startup_ms(),
        attempts: entry.attempts(),
    });

    OpencodeStartupEventPayload {
        event: event.to_string(),
        scope: scope.to_string(),
        repo_path: repo_path.to_string(),
        task_id: task_id.map(str::to_string),
        role: role.to_string(),
        port,
        correlation_type: correlation_type.map(str::to_string),
        correlation_id: correlation_id.map(str::to_string),
        policy: policy_payload,
        report: report_payload,
        reason: reason.map(str::to_string),
        metrics,
        alerts,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct OpencodeProcessRegistryFile {
    #[serde(default)]
    instances: Vec<OpencodeProcessRegistryInstance>,
}

fn normalize_opencode_process_registry_instances(
    instances: &mut Vec<OpencodeProcessRegistryInstance>,
) {
    for instance in instances.iter_mut() {
        instance.child_pids.sort_unstable();
        instance.child_pids.dedup();
    }

    instances.sort_by_key(|instance| instance.parent_pid);
    let mut merged: Vec<OpencodeProcessRegistryInstance> = Vec::with_capacity(instances.len());
    for instance in instances.drain(..) {
        if let Some(previous) = merged
            .last_mut()
            .filter(|entry| entry.parent_pid == instance.parent_pid)
        {
            previous.child_pids.extend(instance.child_pids);
        } else {
            merged.push(instance);
        }
    }

    for instance in merged.iter_mut() {
        instance.child_pids.sort_unstable();
        instance.child_pids.dedup();
    }
    merged.retain(|instance| !instance.child_pids.is_empty());
    *instances = merged;
}

fn with_locked_opencode_process_registry<T>(
    path: &Path,
    mutator: impl FnOnce(&mut Vec<OpencodeProcessRegistryInstance>) -> Result<T>,
) -> Result<T> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "Failed creating OpenCode process registry directory {}",
                parent.display()
            )
        })?;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(path)
        .with_context(|| {
            format!(
                "Failed opening OpenCode process registry {}",
                path.display()
            )
        })?;
    file.lock_exclusive().with_context(|| {
        format!(
            "Failed acquiring lock for OpenCode process registry {}",
            path.display()
        )
    })?;

    let mut data = String::new();
    file.read_to_string(&mut data).with_context(|| {
        format!(
            "Failed reading OpenCode process registry {}",
            path.display()
        )
    })?;

    let mut parsed = if data.trim().is_empty() {
        OpencodeProcessRegistryFile::default()
    } else {
        serde_json::from_str::<OpencodeProcessRegistryFile>(&data).with_context(|| {
            format!(
                "Failed parsing OpenCode process registry payload {}",
                path.display()
            )
        })?
    };
    normalize_opencode_process_registry_instances(&mut parsed.instances);

    let output = mutator(&mut parsed.instances)?;
    normalize_opencode_process_registry_instances(&mut parsed.instances);

    let payload = serde_json::to_string_pretty(&parsed)
        .context("Failed serializing OpenCode process registry payload")?;
    file.set_len(0).with_context(|| {
        format!(
            "Failed truncating OpenCode process registry {}",
            path.display()
        )
    })?;
    file.seek(SeekFrom::Start(0)).with_context(|| {
        format!(
            "Failed seeking OpenCode process registry {}",
            path.display()
        )
    })?;
    file.write_all(payload.as_bytes()).with_context(|| {
        format!(
            "Failed writing OpenCode process registry {}",
            path.display()
        )
    })?;
    file.flush().with_context(|| {
        format!(
            "Failed flushing OpenCode process registry {}",
            path.display()
        )
    })?;

    Ok(output)
}

#[cfg(test)]
fn read_opencode_process_registry(path: &Path) -> Result<Vec<OpencodeProcessRegistryInstance>> {
    with_locked_opencode_process_registry(path, |instances| Ok(instances.clone()))
}

impl Drop for AppService {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

impl AppService {
    const WORKSPACE_RUNTIME_ROLE: &'static str = "workspace";
    const WORKSPACE_RUNTIME_TASK_ID: &'static str = "__workspace__";

    pub fn new(task_store: Arc<dyn TaskStore>, config_store: AppConfigStore) -> Self {
        Self::with_git_port(task_store, config_store, Arc::new(GitCliPort::new()))
    }

    pub fn with_git_port(
        task_store: Arc<dyn TaskStore>,
        config_store: AppConfigStore,
        git_port: Arc<dyn GitPort>,
    ) -> Self {
        let opencode_process_registry_path = Self::opencode_process_registry_path(&config_store);
        let instance_pid = std::process::id();
        let service = Self {
            task_store,
            git_port,
            config_store,
            runs: Arc::new(Mutex::new(HashMap::new())),
            agent_runtimes: Arc::new(Mutex::new(HashMap::new())),
            tracked_opencode_processes: Arc::new(Mutex::new(HashMap::new())),
            opencode_process_registry_path,
            instance_pid,
            initialized_repos: Arc::new(Mutex::new(HashSet::new())),
            runtime_check_cache: Arc::new(Mutex::new(None)),
            startup_cancel_epoch: Arc::new(AtomicU64::new(0)),
            startup_metrics: Arc::new(Mutex::new(OpencodeStartupMetrics::default())),
        };
        if let Err(error) = service.reconcile_opencode_process_registry_on_startup() {
            eprintln!(
                "OpenDucktor warning: failed reconciling orphan OpenCode processes at startup: {error:#}"
            );
        }
        service
    }

    fn repo_key(repo_path: &str) -> String {
        fs::canonicalize(repo_path)
            .unwrap_or_else(|_| Path::new(repo_path).to_path_buf())
            .to_string_lossy()
            .to_string()
    }

    fn ensure_repo_initialized(&self, repo_path: &str) -> Result<()> {
        let repo_key = Self::repo_key(repo_path);
        {
            let cache = self
                .initialized_repos
                .lock()
                .map_err(|_| anyhow!("Initialized repo cache lock poisoned"))?;
            if cache.contains(&repo_key) {
                return Ok(());
            }
        }

        self.task_store
            .ensure_repo_initialized(Path::new(repo_path))
            .with_context(|| format!("Failed to initialize task store for {repo_path}"))?;

        let mut cache = self
            .initialized_repos
            .lock()
            .map_err(|_| anyhow!("Initialized repo cache lock poisoned"))?;
        cache.insert(repo_key);

        Ok(())
    }

    pub(crate) fn opencode_startup_readiness_policy(&self) -> OpencodeStartupReadinessPolicy {
        match self.config_store.opencode_startup_readiness() {
            Ok(config) => OpencodeStartupReadinessPolicy::from_config(config),
            Err(error) => {
                tracing::warn!(
                    target: "openducktor.opencode.startup",
                    error = %format!("{error:#}"),
                    "Failed loading OpenCode startup readiness config; using defaults"
                );
                OpencodeStartupReadinessPolicy::default()
            }
        }
    }

    pub(crate) fn startup_cancel_epoch(&self) -> StartupCancelEpoch {
        Arc::clone(&self.startup_cancel_epoch)
    }

    pub(crate) fn startup_cancel_snapshot(&self) -> u64 {
        self.startup_cancel_epoch.load(Ordering::SeqCst)
    }

    pub(crate) fn emit_opencode_startup_event(
        &self,
        event: &str,
        scope: &str,
        repo_path: &str,
        task_id: Option<&str>,
        role: &str,
        port: u16,
        correlation_type: Option<&str>,
        correlation_id: Option<&str>,
        policy: Option<OpencodeStartupReadinessPolicy>,
        report: Option<OpencodeStartupWaitReport>,
        reason: Option<&str>,
    ) {
        let (metrics, alerts) = match report {
            Some(report) if matches!(event, "startup_ready" | "startup_failed") => {
                match self.startup_metrics.lock() {
                    Ok(mut metrics) => metrics.record_terminal(event, report, reason),
                    Err(_) => {
                        tracing::warn!(
                            target: "openducktor.opencode.startup",
                            event,
                            scope,
                            repo_path,
                            "OpenCode startup metrics lock poisoned; continuing without metrics"
                        );
                        (OpencodeStartupMetricsSnapshot::default(), Vec::new())
                    }
                }
            }
            _ => (OpencodeStartupMetricsSnapshot::default(), Vec::new()),
        };
        let include_metrics = matches!(event, "startup_ready" | "startup_failed");
        let payload = build_opencode_startup_event_payload(
            event,
            scope,
            repo_path,
            task_id,
            role,
            port,
            correlation_type,
            correlation_id,
            policy,
            report,
            reason,
            include_metrics.then_some(metrics),
            alerts.clone(),
        );
        let payload_json = serde_json::to_string(&payload)
            .unwrap_or_else(|_| "{\"serializationError\":\"startup-event\"}".to_string());
        let startup_ms = report.map(|entry| entry.startup_ms()).unwrap_or_default();
        let attempts = report.map(|entry| entry.attempts()).unwrap_or_default();
        tracing::info!(
            target: "openducktor.opencode.startup",
            event,
            scope,
            repo_path,
            task_id = task_id.unwrap_or(""),
            role,
            port,
            correlation_type = correlation_type.unwrap_or(""),
            correlation_id = correlation_id.unwrap_or(""),
            reason = reason.unwrap_or(""),
            startup_ms,
            attempts,
            payload = %payload_json,
        );
        for alert in alerts {
            tracing::warn!(
                target: "openducktor.opencode.startup.alert",
                alert = %alert,
                event,
                scope,
                repo_path,
                task_id = task_id.unwrap_or(""),
                role,
                port,
                correlation_type = correlation_type.unwrap_or(""),
                correlation_id = correlation_id.unwrap_or(""),
                reason = reason.unwrap_or(""),
                startup_ms,
                attempts,
                "OpenCode startup threshold exceeded"
            );
        }
    }

    fn enrich_task(&self, task: TaskCard, all_tasks: &[TaskCard]) -> TaskCard {
        let mut enriched = task;
        enriched.available_actions = derive_available_actions(&enriched, all_tasks);
        enriched
    }

    fn enrich_tasks(&self, tasks: Vec<TaskCard>) -> Vec<TaskCard> {
        let snapshot = tasks.clone();
        tasks
            .into_iter()
            .map(|task| self.enrich_task(task, &snapshot))
            .collect()
    }

    fn opencode_process_registry_path(config_store: &AppConfigStore) -> PathBuf {
        let base = config_store
            .path()
            .parent()
            .map(|entry| entry.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));
        base.join(OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH)
    }

    fn reconcile_opencode_process_registry_on_startup(&self) -> Result<()> {
        with_locked_opencode_process_registry(
            self.opencode_process_registry_path.as_path(),
            |instances| {
                let mut retained_instances = Vec::new();
                for instance in instances.iter() {
                    let parent_pid = instance.parent_pid;
                    let mut retained_child_pids = Vec::new();
                    let parent_is_alive = process_exists(parent_pid);
                    for child_pid in instance.child_pids.iter().copied() {
                        let Some(child_parent_pid) = opencode_server_parent_pid(child_pid) else {
                            continue;
                        };

                        // Never trust records that claim ownership by the current PID; they can only
                        // come from a stale file after PID reuse.
                        if parent_pid == self.instance_pid {
                            if child_parent_pid == 1 {
                                terminate_process_by_pid(child_pid);
                            }
                            continue;
                        }

                        if child_parent_pid == 1 {
                            terminate_process_by_pid(child_pid);
                            continue;
                        }

                        if child_parent_pid != parent_pid {
                            continue;
                        }

                        if parent_is_alive {
                            retained_child_pids.push(child_pid);
                            continue;
                        }

                        terminate_process_by_pid(child_pid);
                    }

                    if !retained_child_pids.is_empty() {
                        retained_instances.push(OpencodeProcessRegistryInstance::with_children(
                            parent_pid,
                            retained_child_pids,
                        ));
                    }
                }

                *instances = retained_instances;
                Ok(())
            },
        )
    }

    pub(crate) fn track_pending_opencode_process(
        &self,
        pid: u32,
    ) -> Result<TrackedOpencodeProcessGuard> {
        let mut tracked = self
            .tracked_opencode_processes
            .lock()
            .map_err(|_| anyhow!("Tracked OpenCode process state lock poisoned"))?;
        *tracked.entry(pid).or_insert(0) += 1;
        if let Err(error) = with_locked_opencode_process_registry(
            self.opencode_process_registry_path.as_path(),
            |instances| {
                if let Some(instance) = instances
                    .iter_mut()
                    .find(|entry| entry.parent_pid == self.instance_pid)
                {
                    instance.child_pids.push(pid);
                } else {
                    instances.push(OpencodeProcessRegistryInstance::with_child(
                        self.instance_pid,
                        pid,
                    ));
                }
                Ok(())
            },
        ) {
            if let Some(count) = tracked.get_mut(&pid) {
                if *count > 1 {
                    *count -= 1;
                } else {
                    tracked.remove(&pid);
                }
            }
            return Err(error);
        }

        Ok(TrackedOpencodeProcessGuard {
            tracked_opencode_processes: self.tracked_opencode_processes.clone(),
            opencode_process_registry_path: self.opencode_process_registry_path.clone(),
            parent_pid: self.instance_pid,
            child_pid: pid,
        })
    }

    pub(crate) fn terminate_pending_opencode_processes(&self) -> Result<()> {
        let tracked_processes = self
            .tracked_opencode_processes
            .lock()
            .map_err(|_| anyhow!("Tracked OpenCode process state lock poisoned"))?
            .iter()
            .map(|(pid, count)| (*pid, *count))
            .collect::<Vec<_>>();

        let mut surviving_processes = HashMap::new();
        for (pid, count) in tracked_processes {
            let Some(parent_pid) = opencode_server_parent_pid(pid) else {
                continue;
            };
            if parent_pid != self.instance_pid {
                continue;
            }
            terminate_process_by_pid(pid);
            if opencode_server_parent_pid(pid) == Some(self.instance_pid) {
                surviving_processes.insert(pid, count);
            }
        }

        {
            let mut tracked = self
                .tracked_opencode_processes
                .lock()
                .map_err(|_| anyhow!("Tracked OpenCode process state lock poisoned"))?;
            *tracked = surviving_processes.clone();
        }

        let surviving_pids_vec = surviving_processes.keys().copied().collect::<Vec<_>>();
        with_locked_opencode_process_registry(
            self.opencode_process_registry_path.as_path(),
            |instances| {
                instances.retain(|instance| instance.parent_pid != self.instance_pid);
                if !surviving_pids_vec.is_empty() {
                    instances.push(OpencodeProcessRegistryInstance::with_children(
                        self.instance_pid,
                        surviving_pids_vec.clone(),
                    ));
                }
                Ok(())
            },
        )?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::build_orchestrator::{BuildResponseAction, CleanupMode};
    use super::{
        allows_transition, build_opencode_config_content, build_opencode_startup_event_payload,
        can_set_plan, can_set_spec_from_status, default_mcp_workspace_root,
        derive_available_actions, is_orphaned_opencode_server_process, normalize_required_markdown,
        normalize_subtask_plan_inputs, parse_mcp_command_json, read_opencode_version,
        resolve_mcp_command, resolve_opencode_binary_path, terminate_child_process,
        terminate_process_by_pid, validate_parent_relationships_for_create,
        validate_parent_relationships_for_update, validate_plan_subtask_rules, validate_transition,
        wait_for_local_server, wait_for_local_server_with_process, AppService,
        OpencodeStartupMetricsSnapshot, OpencodeStartupReadinessPolicy, OpencodeStartupWaitReport,
    };
    use anyhow::{anyhow, Context, Result};
    use host_domain::{
        AgentRuntimeSummary, AgentSessionDocument, CreateTaskInput, GitBranch, GitCurrentBranch,
        GitPort, GitPushSummary, PlanSubtaskInput, QaReportDocument, QaVerdict, RunEvent, RunState,
        RunSummary, SpecDocument, TaskAction, TaskCard, TaskDocumentSummary, TaskMetadata,
        TaskStatus, TaskStore, UpdateTaskPatch,
    };
    use host_infra_system::{
        AppConfigStore, GlobalConfig, HookSet, OpencodeStartupReadinessConfig, RepoConfig,
    };
    use serde_json::Value;
    use std::ffi::OsString;
    use std::fs;
    use std::io::Write;
    use std::net::{TcpListener, TcpStream};
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, LazyLock, Mutex};
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    fn make_task(id: &str, issue_type: &str, status: TaskStatus) -> TaskCard {
        TaskCard {
            id: id.to_string(),
            title: format!("Task {id}"),
            description: String::new(),
            acceptance_criteria: String::new(),
            notes: String::new(),
            status,
            priority: 2,
            issue_type: issue_type.to_string(),
            ai_review_enabled: true,
            available_actions: Vec::new(),
            labels: Vec::new(),
            assignee: None,
            parent_id: None,
            subtask_ids: Vec::new(),
            document_summary: TaskDocumentSummary::default(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[derive(Debug, Default)]
    struct TaskStoreState {
        ensure_calls: Vec<String>,
        ensure_error: Option<String>,
        tasks: Vec<TaskCard>,
        list_error: Option<String>,
        delete_calls: Vec<(String, bool)>,
        created_inputs: Vec<CreateTaskInput>,
        updated_patches: Vec<(String, UpdateTaskPatch)>,
        spec_get_calls: Vec<String>,
        spec_set_calls: Vec<(String, String)>,
        plan_get_calls: Vec<String>,
        plan_set_calls: Vec<(String, String)>,
        metadata_get_calls: Vec<String>,
        qa_append_calls: Vec<(String, String, QaVerdict)>,
        latest_qa_report: Option<QaReportDocument>,
        agent_sessions: Vec<AgentSessionDocument>,
        upserted_sessions: Vec<(String, AgentSessionDocument)>,
    }

    #[derive(Clone)]
    struct FakeTaskStore {
        state: Arc<Mutex<TaskStoreState>>,
    }

    impl TaskStore for FakeTaskStore {
        fn ensure_repo_initialized(&self, repo_path: &Path) -> Result<()> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            if let Some(message) = state.ensure_error.as_ref() {
                return Err(anyhow!(message.clone()));
            }
            state
                .ensure_calls
                .push(repo_path.to_string_lossy().to_string());
            Ok(())
        }

        fn list_tasks(&self, _repo_path: &Path) -> Result<Vec<TaskCard>> {
            let state = self.state.lock().expect("task store lock poisoned");
            if let Some(message) = state.list_error.as_ref() {
                return Err(anyhow!(message.clone()));
            }
            Ok(state.tasks.clone())
        }

        fn create_task(&self, _repo_path: &Path, input: CreateTaskInput) -> Result<TaskCard> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            state.created_inputs.push(input.clone());
            let task = TaskCard {
                id: format!("generated-{}", state.tasks.len() + 1),
                title: input.title,
                description: input.description.unwrap_or_default(),
                acceptance_criteria: input.acceptance_criteria.unwrap_or_default(),
                notes: String::new(),
                status: TaskStatus::Open,
                priority: input.priority,
                issue_type: input.issue_type,
                ai_review_enabled: input.ai_review_enabled.unwrap_or(true),
                available_actions: Vec::new(),
                labels: input.labels.unwrap_or_default(),
                assignee: None,
                parent_id: input.parent_id,
                subtask_ids: Vec::new(),
                document_summary: TaskDocumentSummary::default(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
                created_at: "2026-01-01T00:00:00Z".to_string(),
            };
            state.tasks.push(task.clone());
            Ok(task)
        }

        fn update_task(
            &self,
            _repo_path: &Path,
            task_id: &str,
            patch: UpdateTaskPatch,
        ) -> Result<TaskCard> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            state
                .updated_patches
                .push((task_id.to_string(), patch.clone()));
            let index = state
                .tasks
                .iter()
                .position(|task| task.id == task_id)
                .ok_or_else(|| anyhow!("task not found: {task_id}"))?;

            let mut updated = state.tasks[index].clone();
            if let Some(title) = patch.title {
                updated.title = title;
            }
            if let Some(status) = patch.status {
                updated.status = status;
            }
            if let Some(issue_type) = patch.issue_type {
                updated.issue_type = issue_type;
            }
            if let Some(ai_review_enabled) = patch.ai_review_enabled {
                updated.ai_review_enabled = ai_review_enabled;
            }
            if let Some(parent_id) = patch.parent_id {
                updated.parent_id = Some(parent_id);
            }
            if let Some(labels) = patch.labels {
                updated.labels = labels;
            }

            state.tasks[index] = updated.clone();
            Ok(updated)
        }

        fn delete_task(
            &self,
            _repo_path: &Path,
            task_id: &str,
            delete_subtasks: bool,
        ) -> Result<bool> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            state
                .delete_calls
                .push((task_id.to_string(), delete_subtasks));
            Ok(true)
        }

        fn get_spec(&self, _repo_path: &Path, _task_id: &str) -> Result<SpecDocument> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            state.spec_get_calls.push(_task_id.to_string());
            Ok(SpecDocument {
                markdown: String::new(),
                updated_at: None,
            })
        }

        fn set_spec(
            &self,
            _repo_path: &Path,
            _task_id: &str,
            markdown: &str,
        ) -> Result<SpecDocument> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            state
                .spec_set_calls
                .push((_task_id.to_string(), markdown.to_string()));
            Ok(SpecDocument {
                markdown: markdown.to_string(),
                updated_at: Some("2026-01-01T00:00:00Z".to_string()),
            })
        }

        fn get_plan(&self, _repo_path: &Path, _task_id: &str) -> Result<SpecDocument> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            state.plan_get_calls.push(_task_id.to_string());
            Ok(SpecDocument {
                markdown: String::new(),
                updated_at: None,
            })
        }

        fn set_plan(
            &self,
            _repo_path: &Path,
            _task_id: &str,
            markdown: &str,
        ) -> Result<SpecDocument> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            state
                .plan_set_calls
                .push((_task_id.to_string(), markdown.to_string()));
            Ok(SpecDocument {
                markdown: markdown.to_string(),
                updated_at: Some("2026-01-01T00:00:00Z".to_string()),
            })
        }

        fn get_latest_qa_report(
            &self,
            _repo_path: &Path,
            _task_id: &str,
        ) -> Result<Option<QaReportDocument>> {
            let state = self.state.lock().expect("task store lock poisoned");
            Ok(state.latest_qa_report.clone())
        }

        fn append_qa_report(
            &self,
            _repo_path: &Path,
            _task_id: &str,
            markdown: &str,
            verdict: QaVerdict,
        ) -> Result<QaReportDocument> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            state.qa_append_calls.push((
                _task_id.to_string(),
                markdown.to_string(),
                verdict.clone(),
            ));
            Ok(QaReportDocument {
                markdown: markdown.to_string(),
                verdict,
                updated_at: "2026-01-01T00:00:00Z".to_string(),
                revision: 1,
            })
        }

        fn list_agent_sessions(
            &self,
            _repo_path: &Path,
            _task_id: &str,
        ) -> Result<Vec<AgentSessionDocument>> {
            let state = self.state.lock().expect("task store lock poisoned");
            Ok(state.agent_sessions.clone())
        }

        fn upsert_agent_session(
            &self,
            _repo_path: &Path,
            _task_id: &str,
            session: AgentSessionDocument,
        ) -> Result<()> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            state
                .upserted_sessions
                .push((_task_id.to_string(), session.clone()));
            if let Some(index) = state
                .agent_sessions
                .iter()
                .position(|entry| entry.session_id == session.session_id)
            {
                state.agent_sessions[index] = session;
            } else {
                state.agent_sessions.push(session);
            }
            Ok(())
        }

        fn get_task_metadata(&self, _repo_path: &Path, _task_id: &str) -> Result<TaskMetadata> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            state.metadata_get_calls.push(_task_id.to_string());
            let qa_report = state.latest_qa_report.clone();
            let agent_sessions = state.agent_sessions.clone();
            Ok(TaskMetadata {
                spec: SpecDocument {
                    markdown: String::new(),
                    updated_at: None,
                },
                plan: SpecDocument {
                    markdown: String::new(),
                    updated_at: None,
                },
                qa_report,
                agent_sessions,
            })
        }
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    enum GitCall {
        GetBranches {
            repo_path: String,
        },
        GetCurrentBranch {
            repo_path: String,
        },
        SwitchBranch {
            repo_path: String,
            branch: String,
            create: bool,
        },
        CreateWorktree {
            repo_path: String,
            worktree_path: String,
            branch: String,
            create_branch: bool,
        },
        RemoveWorktree {
            repo_path: String,
            worktree_path: String,
            force: bool,
        },
        PushBranch {
            repo_path: String,
            remote: String,
            branch: String,
            set_upstream: bool,
            force_with_lease: bool,
        },
    }

    #[derive(Debug)]
    struct GitState {
        calls: Vec<GitCall>,
        branches: Vec<GitBranch>,
        current_branch: GitCurrentBranch,
    }

    #[derive(Clone)]
    struct FakeGitPort {
        state: Arc<Mutex<GitState>>,
    }

    impl GitPort for FakeGitPort {
        fn get_branches(&self, repo_path: &Path) -> Result<Vec<GitBranch>> {
            let mut state = self.state.lock().expect("git state lock poisoned");
            state.calls.push(GitCall::GetBranches {
                repo_path: repo_path.to_string_lossy().to_string(),
            });
            Ok(state.branches.clone())
        }

        fn get_current_branch(&self, repo_path: &Path) -> Result<GitCurrentBranch> {
            let mut state = self.state.lock().expect("git state lock poisoned");
            state.calls.push(GitCall::GetCurrentBranch {
                repo_path: repo_path.to_string_lossy().to_string(),
            });
            Ok(state.current_branch.clone())
        }

        fn switch_branch(
            &self,
            repo_path: &Path,
            branch: &str,
            create: bool,
        ) -> Result<GitCurrentBranch> {
            let mut state = self.state.lock().expect("git state lock poisoned");
            state.calls.push(GitCall::SwitchBranch {
                repo_path: repo_path.to_string_lossy().to_string(),
                branch: branch.to_string(),
                create,
            });
            state.current_branch = GitCurrentBranch {
                name: Some(branch.to_string()),
                detached: false,
            };
            Ok(state.current_branch.clone())
        }

        fn create_worktree(
            &self,
            repo_path: &Path,
            worktree_path: &Path,
            branch: &str,
            create_branch: bool,
        ) -> Result<()> {
            let mut state = self.state.lock().expect("git state lock poisoned");
            state.calls.push(GitCall::CreateWorktree {
                repo_path: repo_path.to_string_lossy().to_string(),
                worktree_path: worktree_path.to_string_lossy().to_string(),
                branch: branch.to_string(),
                create_branch,
            });
            Ok(())
        }

        fn remove_worktree(
            &self,
            repo_path: &Path,
            worktree_path: &Path,
            force: bool,
        ) -> Result<()> {
            let mut state = self.state.lock().expect("git state lock poisoned");
            state.calls.push(GitCall::RemoveWorktree {
                repo_path: repo_path.to_string_lossy().to_string(),
                worktree_path: worktree_path.to_string_lossy().to_string(),
                force,
            });
            Ok(())
        }

        fn push_branch(
            &self,
            repo_path: &Path,
            remote: &str,
            branch: &str,
            set_upstream: bool,
            force_with_lease: bool,
        ) -> Result<GitPushSummary> {
            let mut state = self.state.lock().expect("git state lock poisoned");
            state.calls.push(GitCall::PushBranch {
                repo_path: repo_path.to_string_lossy().to_string(),
                remote: remote.to_string(),
                branch: branch.to_string(),
                set_upstream,
                force_with_lease,
            });
            Ok(GitPushSummary {
                remote: remote.to_string(),
                branch: branch.to_string(),
                output: "ok".to_string(),
            })
        }
    }

    fn build_service_with_state(
        tasks: Vec<TaskCard>,
        branches: Vec<GitBranch>,
        current_branch: GitCurrentBranch,
    ) -> (AppService, Arc<Mutex<TaskStoreState>>, Arc<Mutex<GitState>>) {
        let task_state = Arc::new(Mutex::new(TaskStoreState {
            ensure_calls: Vec::new(),
            ensure_error: None,
            tasks,
            list_error: None,
            delete_calls: Vec::new(),
            created_inputs: Vec::new(),
            updated_patches: Vec::new(),
            spec_get_calls: Vec::new(),
            spec_set_calls: Vec::new(),
            plan_get_calls: Vec::new(),
            plan_set_calls: Vec::new(),
            metadata_get_calls: Vec::new(),
            qa_append_calls: Vec::new(),
            latest_qa_report: None,
            agent_sessions: Vec::new(),
            upserted_sessions: Vec::new(),
        }));
        let git_state = Arc::new(Mutex::new(GitState {
            calls: Vec::new(),
            branches,
            current_branch,
        }));
        let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
            state: task_state.clone(),
        });
        let git_port: Arc<dyn GitPort> = Arc::new(FakeGitPort {
            state: git_state.clone(),
        });
        let config_store = AppConfigStore::from_path(unique_temp_path("host-app-config"));
        let service = AppService::with_git_port(task_store, config_store, git_port);
        (service, task_state, git_state)
    }

    fn make_session(task_id: &str, session_id: &str) -> AgentSessionDocument {
        AgentSessionDocument {
            session_id: session_id.to_string(),
            external_session_id: format!("external-{session_id}"),
            task_id: task_id.to_string(),
            role: "build".to_string(),
            scenario: "build_default".to_string(),
            status: "running".to_string(),
            started_at: "2026-02-20T12:00:00Z".to_string(),
            updated_at: "2026-02-20T12:00:10Z".to_string(),
            ended_at: None,
            runtime_id: Some("runtime-1".to_string()),
            run_id: Some("run-1".to_string()),
            base_url: "http://127.0.0.1:4173".to_string(),
            working_directory: "/tmp/repo".to_string(),
            selected_model: None,
        }
    }

    #[test]
    fn app_service_new_constructor_is_callable() -> Result<()> {
        let config_store = AppConfigStore::from_path(unique_temp_path("new-constructor"));
        let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
            state: Arc::new(Mutex::new(TaskStoreState {
                ensure_calls: Vec::new(),
                ensure_error: None,
                tasks: Vec::new(),
                list_error: None,
                delete_calls: Vec::new(),
                created_inputs: Vec::new(),
                updated_patches: Vec::new(),
                spec_get_calls: Vec::new(),
                spec_set_calls: Vec::new(),
                plan_get_calls: Vec::new(),
                plan_set_calls: Vec::new(),
                metadata_get_calls: Vec::new(),
                qa_append_calls: Vec::new(),
                latest_qa_report: None,
                agent_sessions: Vec::new(),
                upserted_sessions: Vec::new(),
            })),
        });

        let service = AppService::new(task_store, config_store);
        let _ = service.runtime_check()?;
        Ok(())
    }

    static ENV_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    fn lock_env<'a>() -> std::sync::MutexGuard<'a, ()> {
        ENV_LOCK.lock().unwrap_or_else(|poison| poison.into_inner())
    }

    fn unique_temp_path(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir().join(format!("openducktor-host-app-{name}-{nonce}"))
    }

    fn write_executable_script(path: &Path, script: &str) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = fs::File::create(path)?;
        file.write_all(script.as_bytes())?;
        let status = Command::new("chmod")
            .arg("+x")
            .arg(path)
            .status()
            .map_err(|error| anyhow!("failed running chmod: {error}"))?;
        if !status.success() {
            return Err(anyhow!("chmod +x failed for {}", path.display()));
        }
        Ok(())
    }

    fn init_git_repo(path: &Path) -> Result<()> {
        fs::create_dir_all(path)?;
        Command::new("git")
            .arg("init")
            .arg(path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()?;
        Command::new("git")
            .arg("-C")
            .arg(path)
            .arg("config")
            .arg("user.email")
            .arg("odt-test@example.com")
            .status()?;
        Command::new("git")
            .arg("-C")
            .arg(path)
            .arg("config")
            .arg("user.name")
            .arg("OpenDucktor Test")
            .status()?;
        fs::write(path.join("README.md"), "# test\n")?;
        Command::new("git")
            .arg("-C")
            .arg(path)
            .arg("add")
            .arg(".")
            .status()?;
        Command::new("git")
            .arg("-C")
            .arg(path)
            .arg("commit")
            .arg("-m")
            .arg("initial")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()?;
        Ok(())
    }

    fn create_fake_opencode(path: &Path) -> Result<()> {
        let script = r#"#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "opencode-fake 0.0.1"
  exit 0
fi

if [ "$1" = "serve" ]; then
  HOST="127.0.0.1"
  PORT="0"
  while [ $# -gt 0 ]; do
    case "$1" in
      --hostname)
        HOST="$2"
        shift 2
        ;;
      --port)
        PORT="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done
  echo "permission requested: git push"
  echo "tool execution heartbeat" >&2
  exec python3 - "$HOST" "$PORT" <<'PY'
import os
import signal
import socket
import sys
import time

host = sys.argv[1]
port = int(sys.argv[2])
delay_ms = int(os.environ.get("OPENDUCKTOR_TEST_STARTUP_DELAY_MS", "0") or "0")
pid_file = os.environ.get("OPENDUCKTOR_TEST_PID_FILE", "")
termination_file = os.environ.get("OPENDUCKTOR_TEST_TERM_FILE", "")

if pid_file:
    try:
        with open(pid_file, "w", encoding="utf-8") as file:
            file.write(str(os.getpid()))
    except Exception:
        pass

if delay_ms > 0:
    time.sleep(delay_ms / 1000.0)

server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind((host, port))
server.listen(16)

def _stop(*_):
    try:
        if termination_file:
            try:
                with open(termination_file, "w", encoding="utf-8") as file:
                    file.write("terminated")
            except Exception:
                pass
        server.close()
    finally:
        raise SystemExit(0)

signal.signal(signal.SIGTERM, _stop)
signal.signal(signal.SIGINT, _stop)

while True:
    conn, _ = server.accept()
    try:
        conn.recv(1024)
    except Exception:
        pass
    finally:
        conn.close()
PY
fi

echo "unsupported opencode invocation" >&2
exit 1
"#;
        write_executable_script(path, script)
    }

    fn create_failing_opencode(path: &Path) -> Result<()> {
        let script = r#"#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "opencode-fake 0.0.1"
  exit 0
fi

if [ "$1" = "serve" ]; then
  echo "simulated startup failure" >&2
  exit 42
fi

echo "unsupported opencode invocation" >&2
exit 1
"#;
        write_executable_script(path, script)
    }

    fn create_orphanable_opencode(path: &Path) -> Result<()> {
        let script = r#"#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "opencode-fake 0.0.1"
  exit 0
fi

if [ "$1" = "serve" ]; then
  while true; do
    sleep 1
  done
fi

echo "unsupported opencode invocation" >&2
exit 1
"#;
        write_executable_script(path, script)
    }

    fn create_failing_opencode_with_worktree_cleanup(path: &Path) -> Result<()> {
        let script = r#"#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "opencode-fake 0.0.1"
  exit 0
fi

if [ "$1" = "serve" ]; then
  REPO_PATH=$(python3 - <<'PY'
import json
import os

raw = os.environ.get("OPENCODE_CONFIG_CONTENT", "{}")
try:
    config = json.loads(raw)
except Exception:
    print("")
    raise SystemExit(0)

environment = (
    config.get("mcp", {})
    .get("openducktor", {})
    .get("environment", {})
)
print(environment.get("ODT_REPO_PATH", ""))
PY
)
  if [ -n "$REPO_PATH" ]; then
    rm -rf "$REPO_PATH"
  fi
  echo "simulated startup failure after deleting repo path" >&2
  exit 42
fi

echo "unsupported opencode invocation" >&2
exit 1
"#;
        write_executable_script(path, script)
    }

    fn create_fake_bd(path: &Path) -> Result<()> {
        let script = r#"#!/bin/sh
echo "bd-fake"
"#;
        write_executable_script(path, script)
    }

    struct EnvVarGuard {
        key: String,
        previous: Option<OsString>,
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            if let Some(previous) = self.previous.clone() {
                std::env::set_var(self.key.as_str(), previous);
            } else {
                std::env::remove_var(self.key.as_str());
            }
        }
    }

    fn set_env_var(key: &str, value: &str) -> EnvVarGuard {
        let previous = std::env::var_os(key);
        std::env::set_var(key, value);
        EnvVarGuard {
            key: key.to_string(),
            previous,
        }
    }

    fn remove_env_var(key: &str) -> EnvVarGuard {
        let previous = std::env::var_os(key);
        std::env::remove_var(key);
        EnvVarGuard {
            key: key.to_string(),
            previous,
        }
    }

    fn prepend_path(path_prefix: &Path) -> EnvVarGuard {
        let previous = std::env::var_os("PATH");
        let mut parts = vec![path_prefix.to_string_lossy().to_string()];
        if let Some(current) = previous.as_ref() {
            parts.push(current.to_string_lossy().to_string());
        }
        let value = parts.join(":");
        std::env::set_var("PATH", value);
        EnvVarGuard {
            key: "PATH".to_string(),
            previous,
        }
    }

    fn wait_for_path_exists(path: &Path, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if path.exists() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        path.exists()
    }

    fn process_is_alive(pid: i32) -> bool {
        Command::new("/bin/sh")
            .arg("-lc")
            .arg(format!("kill -0 {pid}"))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    fn wait_for_process_exit(pid: i32, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if !process_is_alive(pid) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        !process_is_alive(pid)
    }

    fn wait_for_orphaned_opencode_process(pid: u32, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if is_orphaned_opencode_server_process(pid) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        is_orphaned_opencode_server_process(pid)
    }

    fn build_service_with_store(
        tasks: Vec<TaskCard>,
        branches: Vec<GitBranch>,
        current_branch: GitCurrentBranch,
        config_store: AppConfigStore,
    ) -> (AppService, Arc<Mutex<TaskStoreState>>, Arc<Mutex<GitState>>) {
        let task_state = Arc::new(Mutex::new(TaskStoreState {
            ensure_calls: Vec::new(),
            ensure_error: None,
            tasks,
            list_error: None,
            delete_calls: Vec::new(),
            created_inputs: Vec::new(),
            updated_patches: Vec::new(),
            spec_get_calls: Vec::new(),
            spec_set_calls: Vec::new(),
            plan_get_calls: Vec::new(),
            plan_set_calls: Vec::new(),
            metadata_get_calls: Vec::new(),
            qa_append_calls: Vec::new(),
            latest_qa_report: None,
            agent_sessions: Vec::new(),
            upserted_sessions: Vec::new(),
        }));
        let git_state = Arc::new(Mutex::new(GitState {
            calls: Vec::new(),
            branches,
            current_branch,
        }));
        let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
            state: task_state.clone(),
        });
        let git_port: Arc<dyn GitPort> = Arc::new(FakeGitPort {
            state: git_state.clone(),
        });
        let service = AppService::with_git_port(task_store, config_store, git_port);
        (service, task_state, git_state)
    }

    fn make_emitter(events: Arc<Mutex<Vec<RunEvent>>>) -> Arc<dyn Fn(RunEvent) + Send + Sync> {
        Arc::new(move |event| {
            events.lock().expect("events lock poisoned").push(event);
        })
    }

    fn spawn_sleep_process(seconds: u64) -> std::process::Child {
        Command::new("/bin/sh")
            .arg("-lc")
            .arg(format!("sleep {seconds}"))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn sleep process")
    }

    fn empty_patch() -> UpdateTaskPatch {
        UpdateTaskPatch {
            title: None,
            description: None,
            acceptance_criteria: None,
            notes: None,
            status: None,
            priority: None,
            issue_type: None,
            ai_review_enabled: None,
            labels: None,
            assignee: None,
            parent_id: None,
        }
    }

    #[test]
    fn bug_can_skip_spec_and_go_in_progress_from_open() {
        let bug = make_task("bug-1", "bug", TaskStatus::Open);
        assert!(allows_transition(
            &bug,
            &TaskStatus::Open,
            &TaskStatus::InProgress
        ));
    }

    #[test]
    fn feature_cannot_skip_to_in_progress_from_open() {
        let feature = make_task("feature-1", "feature", TaskStatus::Open);
        assert!(!allows_transition(
            &feature,
            &TaskStatus::Open,
            &TaskStatus::InProgress
        ));
    }

    #[test]
    fn human_review_is_in_progress_state_not_closed() {
        let task = make_task("task-1", "task", TaskStatus::HumanReview);
        assert!(allows_transition(
            &task,
            &TaskStatus::HumanReview,
            &TaskStatus::InProgress
        ));
        assert!(allows_transition(
            &task,
            &TaskStatus::HumanReview,
            &TaskStatus::Closed
        ));
    }

    #[test]
    fn epic_close_ignores_deferred_subtasks_for_completion_guard() {
        let epic = make_task("epic-1", "epic", TaskStatus::HumanReview);
        let mut deferred_child = make_task("task-1", "task", TaskStatus::Deferred);
        deferred_child.parent_id = Some(epic.id.clone());

        let tasks = vec![epic.clone(), deferred_child];
        let result =
            validate_transition(&epic, &tasks, &TaskStatus::HumanReview, &TaskStatus::Closed);
        assert!(
            result.is_ok(),
            "deferred subtasks should not block epic completion"
        );
    }

    #[test]
    fn epic_close_is_blocked_by_open_direct_subtask() {
        let epic = make_task("epic-1", "epic", TaskStatus::HumanReview);
        let mut active_child = make_task("task-1", "task", TaskStatus::Open);
        active_child.parent_id = Some(epic.id.clone());

        let tasks = vec![epic.clone(), active_child];
        let result =
            validate_transition(&epic, &tasks, &TaskStatus::HumanReview, &TaskStatus::Closed);
        assert!(
            result.is_err(),
            "open direct subtasks must block epic completion"
        );
    }

    #[test]
    fn only_epics_can_have_subtasks_and_depth_is_one_level() {
        let epic = make_task("epic-1", "epic", TaskStatus::Open);
        let mut non_epic_parent = make_task("task-parent", "task", TaskStatus::Open);
        let mut level_two_parent = make_task("epic-child", "epic", TaskStatus::Open);
        level_two_parent.parent_id = Some(epic.id.clone());

        let tasks = vec![
            epic.clone(),
            non_epic_parent.clone(),
            level_two_parent.clone(),
        ];

        let invalid_non_epic_parent = CreateTaskInput {
            title: "child".to_string(),
            issue_type: "task".to_string(),
            priority: 2,
            description: None,
            acceptance_criteria: None,
            labels: None,
            ai_review_enabled: Some(true),
            parent_id: Some(non_epic_parent.id.clone()),
        };
        assert!(
            validate_parent_relationships_for_create(&tasks, &invalid_non_epic_parent).is_err()
        );

        let invalid_depth_two = CreateTaskInput {
            title: "child".to_string(),
            issue_type: "task".to_string(),
            priority: 2,
            description: None,
            acceptance_criteria: None,
            labels: None,
            ai_review_enabled: Some(true),
            parent_id: Some(level_two_parent.id.clone()),
        };
        assert!(validate_parent_relationships_for_create(&tasks, &invalid_depth_two).is_err());

        non_epic_parent.parent_id = Some(epic.id.clone());
        let patch = UpdateTaskPatch {
            title: None,
            description: None,
            acceptance_criteria: None,
            notes: None,
            status: Some(TaskStatus::Deferred),
            priority: None,
            issue_type: None,
            ai_review_enabled: None,
            labels: None,
            assignee: None,
            parent_id: Some(epic.id.clone()),
        };
        assert!(validate_parent_relationships_for_update(&tasks, &non_epic_parent, &patch).is_ok());
    }

    #[test]
    fn markdown_documents_require_non_empty_content() {
        assert!(normalize_required_markdown("   ", "spec").is_err());
        assert_eq!(
            normalize_required_markdown("  # Valid  ", "spec").expect("valid markdown"),
            "# Valid"
        );
    }

    #[test]
    fn subtask_plan_inputs_are_normalized_and_validated() {
        let normalized = normalize_subtask_plan_inputs(vec![PlanSubtaskInput {
            title: "  Build API  ".to_string(),
            issue_type: Some("feature".to_string()),
            priority: Some(99),
            description: Some("  add endpoint ".to_string()),
        }])
        .expect("normalized");

        assert_eq!(normalized.len(), 1);
        let first = &normalized[0];
        assert_eq!(first.title, "Build API");
        assert_eq!(first.issue_type, "feature");
        assert_eq!(first.priority, 4);
        assert_eq!(first.description.as_deref(), Some("add endpoint"));
    }

    #[test]
    fn subtask_plan_inputs_reject_epic_issue_type() {
        let result = normalize_subtask_plan_inputs(vec![PlanSubtaskInput {
            title: "Do work".to_string(),
            issue_type: Some("epic".to_string()),
            priority: Some(2),
            description: None,
        }]);
        assert!(result.is_err());
    }

    #[test]
    fn spec_and_plan_write_status_guards_follow_matrix() {
        assert!(can_set_spec_from_status(&TaskStatus::Open));
        assert!(can_set_spec_from_status(&TaskStatus::SpecReady));
        assert!(!can_set_spec_from_status(&TaskStatus::InProgress));

        let epic_open = make_task("epic-open", "epic", TaskStatus::Open);
        let epic_spec_ready = make_task("epic-spec", "epic", TaskStatus::SpecReady);
        let epic_ready_for_dev = make_task("epic-ready", "epic", TaskStatus::ReadyForDev);
        let feature_open = make_task("feature-open", "feature", TaskStatus::Open);
        let feature_ready_for_dev = make_task("feature-ready", "feature", TaskStatus::ReadyForDev);
        let task_open = make_task("task-open", "task", TaskStatus::Open);
        let task_ready_for_dev = make_task("task-ready", "task", TaskStatus::ReadyForDev);
        let bug_open = make_task("bug-open", "bug", TaskStatus::Open);
        let bug_ready_for_dev = make_task("bug-ready", "bug", TaskStatus::ReadyForDev);
        let feature_in_progress = make_task("feature-progress", "feature", TaskStatus::InProgress);

        assert!(!can_set_plan(&epic_open));
        assert!(can_set_plan(&epic_spec_ready));
        assert!(can_set_plan(&epic_ready_for_dev));
        assert!(!can_set_plan(&feature_open));
        assert!(can_set_plan(&feature_ready_for_dev));
        assert!(can_set_plan(&task_open));
        assert!(can_set_plan(&task_ready_for_dev));
        assert!(can_set_plan(&bug_open));
        assert!(can_set_plan(&bug_ready_for_dev));
        assert!(!can_set_plan(&feature_in_progress));
    }

    #[test]
    fn epic_plan_requires_existing_or_proposed_direct_subtasks() {
        let epic = make_task("epic-1", "epic", TaskStatus::SpecReady);
        let tasks = vec![epic.clone()];
        let result = validate_plan_subtask_rules(&epic, &tasks, &[]);
        assert!(result.is_err());

        let proposals = vec![CreateTaskInput {
            title: "Subtask".to_string(),
            issue_type: "task".to_string(),
            priority: 2,
            description: None,
            acceptance_criteria: None,
            labels: None,
            ai_review_enabled: Some(true),
            parent_id: None,
        }];
        assert!(validate_plan_subtask_rules(&epic, &tasks, &proposals).is_ok());
    }

    #[test]
    fn non_epic_plan_cannot_accept_subtask_proposals() {
        let task = make_task("task-1", "task", TaskStatus::Open);
        let proposals = vec![CreateTaskInput {
            title: "Child".to_string(),
            issue_type: "bug".to_string(),
            priority: 2,
            description: None,
            acceptance_criteria: None,
            labels: None,
            ai_review_enabled: Some(true),
            parent_id: None,
        }];

        let result = validate_plan_subtask_rules(&task, std::slice::from_ref(&task), &proposals);
        assert!(result.is_err());
    }

    #[test]
    fn feature_in_open_exposes_spec_only() {
        let feature = make_task("feature-1", "feature", TaskStatus::Open);
        let actions = derive_available_actions(&feature, std::slice::from_ref(&feature));

        assert!(actions.contains(&TaskAction::SetSpec));
        assert!(!actions.contains(&TaskAction::SetPlan));
        assert!(!actions.contains(&TaskAction::BuildStart));
    }

    #[test]
    fn epic_in_open_exposes_spec_only() {
        let epic = make_task("epic-1", "epic", TaskStatus::Open);
        let actions = derive_available_actions(&epic, std::slice::from_ref(&epic));

        assert!(actions.contains(&TaskAction::SetSpec));
        assert!(!actions.contains(&TaskAction::SetPlan));
        assert!(!actions.contains(&TaskAction::BuildStart));
    }

    #[test]
    fn bug_in_open_can_start_build_directly() {
        let bug = make_task("bug-1", "bug", TaskStatus::Open);
        let actions = derive_available_actions(&bug, std::slice::from_ref(&bug));
        assert!(actions.contains(&TaskAction::BuildStart));
    }

    #[test]
    fn in_progress_tasks_expose_builder_action_and_no_plan_actions() {
        let task = make_task("task-1", "task", TaskStatus::InProgress);
        let actions = derive_available_actions(&task, std::slice::from_ref(&task));
        assert!(actions.contains(&TaskAction::OpenBuilder));
        assert!(!actions.contains(&TaskAction::SetSpec));
        assert!(!actions.contains(&TaskAction::SetPlan));
    }

    #[test]
    fn deferred_parent_task_exposes_resume_and_hides_defer() {
        let deferred = make_task("task-1", "task", TaskStatus::Deferred);
        let actions = derive_available_actions(&deferred, std::slice::from_ref(&deferred));
        assert!(actions.contains(&TaskAction::ResumeDeferred));
        assert!(!actions.contains(&TaskAction::DeferIssue));
    }

    #[test]
    fn wait_for_local_server_returns_ok_when_port_is_open() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
        let port = listener.local_addr().expect("addr").port();
        let result = wait_for_local_server(port, Duration::from_millis(500));
        assert!(result.is_ok());
    }

    fn find_closed_low_port() -> u16 {
        for port in 1..1024 {
            if TcpStream::connect(("127.0.0.1", port)).is_err() {
                return port;
            }
        }
        panic!("expected at least one closed privileged localhost port");
    }

    #[test]
    fn wait_for_local_server_times_out_when_port_is_closed() {
        let port = find_closed_low_port();
        let result = wait_for_local_server(port, Duration::from_millis(250));
        assert!(result.is_err());
    }

    fn test_startup_policy(timeout: Duration) -> OpencodeStartupReadinessPolicy {
        OpencodeStartupReadinessPolicy {
            timeout,
            connect_timeout: Duration::from_millis(50),
            initial_retry_delay: Duration::from_millis(10),
            max_retry_delay: Duration::from_millis(50),
            child_state_check_interval: Duration::from_millis(25),
        }
    }

    #[test]
    fn opencode_startup_event_payload_contract_includes_correlation_and_metrics() {
        let policy = test_startup_policy(Duration::from_millis(8_000));
        let report = OpencodeStartupWaitReport::from_parts(7, Duration::from_millis(321));
        let mut metrics = OpencodeStartupMetricsSnapshot::default();
        metrics.total = 4;
        metrics.ready = 3;
        metrics.failed = 1;
        metrics.failed_by_reason.insert("timeout".to_string(), 1);
        if let Some(bucket) = metrics.startup_ms_histogram.get_mut("<=500") {
            *bucket = 4;
        }
        if let Some(bucket) = metrics.attempts_histogram.get_mut("<=10") {
            *bucket = 4;
        }

        let payload = build_opencode_startup_event_payload(
            "startup_ready",
            "agent_runtime",
            "/tmp/repo",
            Some("task-42"),
            "qa",
            4242,
            Some("runtime_id"),
            Some("runtime-abc"),
            Some(policy),
            Some(report),
            None,
            Some(metrics),
            vec!["startup_duration_high:321".to_string()],
        );
        let payload_json = serde_json::to_value(payload).expect("payload should serialize");

        assert_eq!(payload_json["event"], "startup_ready");
        assert_eq!(payload_json["scope"], "agent_runtime");
        assert_eq!(payload_json["repoPath"], "/tmp/repo");
        assert_eq!(payload_json["taskId"], "task-42");
        assert_eq!(payload_json["role"], "qa");
        assert_eq!(payload_json["port"], 4242);
        assert_eq!(payload_json["correlationType"], "runtime_id");
        assert_eq!(payload_json["correlationId"], "runtime-abc");
        assert_eq!(payload_json["policy"]["timeoutMs"], 8_000);
        assert_eq!(payload_json["report"]["startupMs"], 321);
        assert_eq!(payload_json["report"]["attempts"], 7);
        assert_eq!(payload_json["metrics"]["total"], 4);
        assert_eq!(payload_json["metrics"]["ready"], 3);
        assert_eq!(payload_json["metrics"]["failed"], 1);
        assert_eq!(payload_json["alerts"][0], "startup_duration_high:321");
    }

    #[test]
    fn opencode_startup_readiness_policy_uses_config_overrides() -> Result<()> {
        let root = unique_temp_path("startup-policy-config");
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let config = GlobalConfig {
            opencode_startup: OpencodeStartupReadinessConfig {
                timeout_ms: 12_345,
                connect_timeout_ms: 456,
                initial_retry_delay_ms: 33,
                max_retry_delay_ms: 99,
                child_check_interval_ms: 77,
            },
            ..GlobalConfig::default()
        };
        config_store.save(&config)?;

        let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
            state: Arc::new(Mutex::new(TaskStoreState::default())),
        });
        let service = AppService::new(task_store, config_store);
        let policy = service.opencode_startup_readiness_policy();
        assert_eq!(policy.timeout, Duration::from_millis(12_345));
        assert_eq!(policy.connect_timeout, Duration::from_millis(456));
        assert_eq!(policy.initial_retry_delay, Duration::from_millis(33));
        assert_eq!(policy.max_retry_delay, Duration::from_millis(99));
        assert_eq!(policy.child_state_check_interval, Duration::from_millis(77));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn terminate_child_process_stops_background_process() {
        let mut child = Command::new("/bin/sh")
            .arg("-lc")
            .arg("sleep 5")
            .spawn()
            .expect("spawn sleep");
        terminate_child_process(&mut child);
        let status = child.try_wait().expect("try_wait should succeed");
        assert!(status.is_some(), "child process should be terminated");
    }

    #[test]
    fn wait_for_local_server_with_process_returns_early_when_child_exits() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
        let port = listener.local_addr().expect("addr").port();
        drop(listener);

        let mut child = Command::new("/bin/sh")
            .arg("-lc")
            .arg("echo startup failed >&2; exit 42")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("spawn failing process");
        let cancel_epoch = Arc::new(AtomicU64::new(0));
        let error = wait_for_local_server_with_process(
            &mut child,
            port,
            test_startup_policy(Duration::from_secs(2)),
            &cancel_epoch,
            0,
        )
        .expect_err("should report early process exit");
        assert!(error.to_string().contains("startup failed"));
        assert_eq!(error.reason, "child_exited");
    }

    #[test]
    fn wait_for_local_server_with_process_times_out_when_child_stays_alive() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
        let port = listener.local_addr().expect("addr").port();
        drop(listener);

        let mut child = Command::new("/bin/sh")
            .arg("-lc")
            .arg("sleep 5")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("spawn sleeping process");
        let cancel_epoch = Arc::new(AtomicU64::new(0));
        let error = wait_for_local_server_with_process(
            &mut child,
            port,
            test_startup_policy(Duration::from_millis(250)),
            &cancel_epoch,
            0,
        )
        .expect_err("should time out when child remains alive and port stays closed");
        terminate_child_process(&mut child);
        assert_eq!(error.reason, "timeout");
    }

    #[test]
    fn wait_for_local_server_with_process_honors_cancellation_epoch() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
        let port = listener.local_addr().expect("addr").port();
        drop(listener);

        let mut child = Command::new("/bin/sh")
            .arg("-lc")
            .arg("sleep 5")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("spawn sleeping process");
        let cancel_epoch = Arc::new(AtomicU64::new(1));
        let snapshot = cancel_epoch.load(Ordering::SeqCst);
        cancel_epoch.fetch_add(1, Ordering::SeqCst);
        let error = wait_for_local_server_with_process(
            &mut child,
            port,
            test_startup_policy(Duration::from_secs(2)),
            &cancel_epoch,
            snapshot,
        )
        .expect_err("should stop waiting when cancellation epoch changes");
        terminate_child_process(&mut child);
        assert_eq!(error.reason, "cancelled");
    }

    #[test]
    fn git_get_branches_initializes_repo_and_returns_git_data() -> Result<()> {
        let repo_path = "/tmp/odt-repo";
        let expected = vec![
            GitBranch {
                name: "main".to_string(),
                is_current: true,
                is_remote: false,
            },
            GitBranch {
                name: "origin/main".to_string(),
                is_current: false,
                is_remote: true,
            },
        ];
        let (service, task_state, git_state) = build_service_with_state(
            vec![],
            expected.clone(),
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let branches = service.git_get_branches(repo_path)?;
        assert_eq!(branches, expected);

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(task_state.ensure_calls, vec![repo_path.to_string()]);
        drop(task_state);

        let git_state = git_state.lock().expect("git lock poisoned");
        assert_eq!(
            git_state.calls,
            vec![GitCall::GetBranches {
                repo_path: repo_path.to_string()
            }]
        );
        Ok(())
    }

    #[test]
    fn git_get_current_branch_uses_repo_init_cache() -> Result<()> {
        let repo_path = "/tmp/odt-repo-cache";
        let (service, task_state, git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("feature/demo".to_string()),
                detached: false,
            },
        );

        let first = service.git_get_current_branch(repo_path)?;
        let second = service.git_get_current_branch(repo_path)?;
        assert_eq!(first.name.as_deref(), Some("feature/demo"));
        assert_eq!(second.name.as_deref(), Some("feature/demo"));

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(task_state.ensure_calls.len(), 1);
        drop(task_state);

        let git_state = git_state.lock().expect("git lock poisoned");
        assert_eq!(
            git_state.calls,
            vec![
                GitCall::GetCurrentBranch {
                    repo_path: repo_path.to_string()
                },
                GitCall::GetCurrentBranch {
                    repo_path: repo_path.to_string()
                }
            ]
        );
        Ok(())
    }

    #[test]
    fn git_switch_branch_forwards_create_flag() -> Result<()> {
        let repo_path = "/tmp/odt-repo-switch";
        let (service, _task_state, git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let branch = service.git_switch_branch(repo_path, "feature/new-ui", true)?;
        assert_eq!(branch.name.as_deref(), Some("feature/new-ui"));
        assert!(!branch.detached);

        let git_state = git_state.lock().expect("git lock poisoned");
        assert!(git_state.calls.contains(&GitCall::SwitchBranch {
            repo_path: repo_path.to_string(),
            branch: "feature/new-ui".to_string(),
            create: true,
        }));
        Ok(())
    }

    #[test]
    fn git_create_worktree_rejects_empty_path() {
        let repo_path = "/tmp/odt-repo-worktree";
        let (service, task_state, git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let error = service
            .git_create_worktree(repo_path, "   ", "feature/new", true)
            .expect_err("empty worktree path should fail");
        assert!(error.to_string().contains("worktree path cannot be empty"));

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(task_state.ensure_calls, vec![repo_path.to_string()]);
        drop(task_state);

        let git_state = git_state.lock().expect("git lock poisoned");
        assert!(git_state
            .calls
            .iter()
            .all(|call| !matches!(call, GitCall::CreateWorktree { .. })));
    }

    #[test]
    fn git_remove_worktree_forwards_force_flag() -> Result<()> {
        let repo_path = "/tmp/odt-repo-remove-worktree";
        let (service, _task_state, git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        assert!(service.git_remove_worktree(repo_path, "/tmp/wt-1", true)?);

        let git_state = git_state.lock().expect("git lock poisoned");
        assert!(git_state.calls.contains(&GitCall::RemoveWorktree {
            repo_path: repo_path.to_string(),
            worktree_path: "/tmp/wt-1".to_string(),
            force: true,
        }));
        Ok(())
    }

    #[test]
    fn git_push_branch_defaults_remote_to_origin() -> Result<()> {
        let repo_path = "/tmp/odt-repo-push";
        let (service, _task_state, git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let summary = service.git_push_branch(repo_path, Some("   "), "feature/x", true, false)?;
        assert_eq!(summary.remote, "origin");
        assert_eq!(summary.branch, "feature/x");

        let git_state = git_state.lock().expect("git lock poisoned");
        assert!(git_state.calls.contains(&GitCall::PushBranch {
            repo_path: repo_path.to_string(),
            remote: "origin".to_string(),
            branch: "feature/x".to_string(),
            set_upstream: true,
            force_with_lease: false,
        }));
        Ok(())
    }

    #[test]
    fn task_update_rejects_direct_status_changes() {
        let repo_path = "/tmp/odt-repo-task-update";
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let error = service
            .task_update(
                repo_path,
                "task-1",
                UpdateTaskPatch {
                    title: None,
                    description: None,
                    acceptance_criteria: None,
                    notes: None,
                    status: Some(TaskStatus::Closed),
                    priority: None,
                    issue_type: None,
                    ai_review_enabled: None,
                    labels: None,
                    assignee: None,
                    parent_id: None,
                },
            )
            .expect_err("direct status updates should fail");
        assert!(error
            .to_string()
            .contains("Status cannot be updated directly"));
    }

    #[test]
    fn validate_parent_relationships_for_update_enforces_hierarchy_constraints() {
        let epic = make_task("epic-1", "epic", TaskStatus::Open);
        let current = make_task("task-1", "task", TaskStatus::Open);
        let mut direct_subtask = make_task("sub-1", "task", TaskStatus::Open);
        direct_subtask.parent_id = Some("task-1".to_string());
        let feature_parent = make_task("feature-1", "feature", TaskStatus::Open);
        let mut nested_parent = make_task("nested-parent", "epic", TaskStatus::Open);
        nested_parent.parent_id = Some("epic-1".to_string());

        let tasks = vec![
            epic.clone(),
            current.clone(),
            direct_subtask.clone(),
            feature_parent.clone(),
            nested_parent.clone(),
        ];

        let mut epic_parent_patch = empty_patch();
        epic_parent_patch.parent_id = Some("task-1".to_string());
        let epic_error =
            validate_parent_relationships_for_update(&tasks, &epic, &epic_parent_patch)
                .expect_err("epic should not become subtask");
        assert!(epic_error
            .to_string()
            .contains("Epics cannot be converted to subtasks."));

        let mut become_subtask_patch = empty_patch();
        become_subtask_patch.parent_id = Some("epic-1".to_string());
        let parent_error =
            validate_parent_relationships_for_update(&tasks, &current, &become_subtask_patch)
                .expect_err("task with direct subtasks cannot become subtask");
        assert!(parent_error
            .to_string()
            .contains("Tasks with subtasks cannot become subtasks."));

        let mut non_epic_patch = empty_patch();
        non_epic_patch.issue_type = Some("feature".to_string());
        let type_error =
            validate_parent_relationships_for_update(&tasks, &current, &non_epic_patch)
                .expect_err("task with direct subtasks must remain epic");
        assert!(type_error
            .to_string()
            .contains("Only epics can have subtasks."));

        let standalone = make_task("standalone", "task", TaskStatus::Open);
        let tasks_for_parent_checks = vec![
            epic.clone(),
            standalone.clone(),
            feature_parent.clone(),
            nested_parent.clone(),
        ];

        let mut bad_parent_patch = empty_patch();
        bad_parent_patch.parent_id = Some("feature-1".to_string());
        let bad_parent_error = validate_parent_relationships_for_update(
            &tasks_for_parent_checks,
            &standalone,
            &bad_parent_patch,
        )
        .expect_err("non-epic parent should be rejected");
        assert!(bad_parent_error
            .to_string()
            .contains("Only epics can be selected as parents."));

        let mut nested_parent_patch = empty_patch();
        nested_parent_patch.parent_id = Some("nested-parent".to_string());
        let nested_parent_error = validate_parent_relationships_for_update(
            &tasks_for_parent_checks,
            &standalone,
            &nested_parent_patch,
        )
        .expect_err("nested parent should be rejected");
        assert!(nested_parent_error
            .to_string()
            .contains("Subtask depth is limited to one level."));

        let mut clear_parent_patch = empty_patch();
        clear_parent_patch.parent_id = Some("   ".to_string());
        let mut current_with_parent = standalone.clone();
        current_with_parent.parent_id = Some("epic-1".to_string());
        assert!(validate_parent_relationships_for_update(
            &tasks_for_parent_checks,
            &current_with_parent,
            &clear_parent_patch,
        )
        .is_ok());
    }

    #[test]
    fn task_delete_blocks_when_subtasks_exist_without_confirmation() {
        let repo_path = "/tmp/odt-repo-task-delete";
        let parent = make_task("parent-1", "epic", TaskStatus::Open);
        let mut child = make_task("child-1", "task", TaskStatus::Open);
        child.parent_id = Some("parent-1".to_string());
        let (service, task_state, _git_state) = build_service_with_state(
            vec![parent, child],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let error = service
            .task_delete(repo_path, "parent-1", false)
            .expect_err("delete must require subtask confirmation");
        assert!(error.to_string().contains("Confirm subtask deletion"));

        let task_state = task_state.lock().expect("task lock poisoned");
        assert!(task_state.delete_calls.is_empty());
    }

    #[test]
    fn task_delete_allows_cascade_and_forwards_delete_flag() -> Result<()> {
        let repo_path = "/tmp/odt-repo-task-delete-cascade";
        let parent = make_task("parent-1", "epic", TaskStatus::Open);
        let mut child = make_task("child-1", "task", TaskStatus::Open);
        child.parent_id = Some("parent-1".to_string());
        let (service, task_state, _git_state) = build_service_with_state(
            vec![parent, child],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        service.task_delete(repo_path, "parent-1", true)?;

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(
            task_state.delete_calls,
            vec![("parent-1".to_string(), true)]
        );
        Ok(())
    }

    #[test]
    fn build_blocked_requires_non_empty_reason() {
        let repo_path = "/tmp/odt-repo-build";
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::InProgress)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let error = service
            .build_blocked(repo_path, "task-1", Some("   "))
            .expect_err("blank reason should fail");
        assert!(error.to_string().contains("requires a non-empty reason"));
    }

    #[test]
    fn build_resumed_human_actions_and_resume_deferred_paths_work() -> Result<()> {
        let repo_path = "/tmp/odt-repo-human-actions";
        let mut deferred = make_task("task-deferred", "task", TaskStatus::Deferred);
        deferred.parent_id = None;
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![
                make_task("task-blocked", "task", TaskStatus::Blocked),
                make_task("task-human-review", "task", TaskStatus::HumanReview),
                make_task("task-approve", "task", TaskStatus::HumanReview),
                deferred,
            ],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let resumed = service.build_resumed(repo_path, "task-blocked")?;
        assert_eq!(resumed.status, TaskStatus::InProgress);

        let requested_changes =
            service.human_request_changes(repo_path, "task-human-review", None)?;
        assert_eq!(requested_changes.status, TaskStatus::InProgress);

        let approved = service.human_approve(repo_path, "task-approve")?;
        assert_eq!(approved.status, TaskStatus::Closed);

        let resumed_deferred = service.task_resume_deferred(repo_path, "task-deferred")?;
        assert_eq!(resumed_deferred.status, TaskStatus::Open);
        Ok(())
    }

    #[test]
    fn task_resume_deferred_requires_deferred_state() {
        let repo_path = "/tmp/odt-repo-resume";
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let error = service
            .task_resume_deferred(repo_path, "task-1")
            .expect_err("non-deferred task should fail");
        assert!(error.to_string().contains("Task is not deferred"));
    }

    #[test]
    fn tasks_list_enriches_available_actions() -> Result<()> {
        let repo_path = "/tmp/odt-repo-list";
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![make_task("feature-1", "feature", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let tasks = service.tasks_list(repo_path)?;
        assert_eq!(tasks.len(), 1);
        assert!(tasks[0].available_actions.contains(&TaskAction::SetSpec));
        assert!(tasks[0]
            .available_actions
            .contains(&TaskAction::ViewDetails));
        Ok(())
    }

    #[test]
    fn task_create_normalizes_issue_type_and_defaults_ai_review() -> Result<()> {
        let repo_path = "/tmp/odt-repo-create";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let created = service.task_create(
            repo_path,
            CreateTaskInput {
                title: "New task".to_string(),
                issue_type: "something-unknown".to_string(),
                priority: 2,
                description: None,
                acceptance_criteria: None,
                labels: None,
                ai_review_enabled: None,
                parent_id: None,
            },
        )?;
        assert_eq!(created.issue_type, "task");
        assert!(created.ai_review_enabled);

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(task_state.created_inputs.len(), 1);
        assert_eq!(task_state.created_inputs[0].issue_type, "task");
        assert_eq!(task_state.created_inputs[0].ai_review_enabled, Some(true));
        Ok(())
    }

    #[test]
    fn task_transition_returns_current_task_when_status_is_unchanged() -> Result<()> {
        let repo_path = "/tmp/odt-repo-transition-same";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let task = service.task_transition(repo_path, "task-1", TaskStatus::Open, None)?;
        assert_eq!(task.status, TaskStatus::Open);

        let task_state = task_state.lock().expect("task lock poisoned");
        assert!(task_state.updated_patches.is_empty());
        Ok(())
    }

    #[test]
    fn task_transition_updates_status_when_valid() -> Result<()> {
        let repo_path = "/tmp/odt-repo-transition-update";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![make_task("bug-1", "bug", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let task = service.task_transition(repo_path, "bug-1", TaskStatus::InProgress, None)?;
        assert_eq!(task.status, TaskStatus::InProgress);

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(task_state.updated_patches.len(), 1);
        assert_eq!(
            task_state.updated_patches[0].1.status,
            Some(TaskStatus::InProgress)
        );
        Ok(())
    }

    #[test]
    fn build_completed_routes_to_ai_review_when_enabled() -> Result<()> {
        let repo_path = "/tmp/odt-repo-build-ai";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::InProgress)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let task = service.build_completed(repo_path, "task-1", Some("done"))?;
        assert_eq!(task.status, TaskStatus::AiReview);

        let task_state = task_state.lock().expect("task lock poisoned");
        assert!(task_state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::AiReview)));
        Ok(())
    }

    #[test]
    fn build_completed_routes_to_human_review_when_ai_is_disabled() -> Result<()> {
        let repo_path = "/tmp/odt-repo-build-human";
        let mut task = make_task("task-1", "task", TaskStatus::InProgress);
        task.ai_review_enabled = false;
        let (service, task_state, _git_state) = build_service_with_state(
            vec![task],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let task = service.build_completed(repo_path, "task-1", None)?;
        assert_eq!(task.status, TaskStatus::HumanReview);

        let task_state = task_state.lock().expect("task lock poisoned");
        assert!(task_state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::HumanReview)));
        Ok(())
    }

    #[test]
    fn task_defer_rejects_subtasks() {
        let repo_path = "/tmp/odt-repo-defer-subtask";
        let mut subtask = make_task("task-1", "task", TaskStatus::Open);
        subtask.parent_id = Some("epic-1".to_string());
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![subtask],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let error = service
            .task_defer(repo_path, "task-1", Some("later"))
            .expect_err("subtasks cannot be deferred");
        assert!(error.to_string().contains("Subtasks cannot be deferred"));
    }

    #[test]
    fn task_defer_transitions_open_parent_task() -> Result<()> {
        let repo_path = "/tmp/odt-repo-defer-parent";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let task = service.task_defer(repo_path, "task-1", Some("later"))?;
        assert_eq!(task.status, TaskStatus::Deferred);

        let task_state = task_state.lock().expect("task lock poisoned");
        assert!(task_state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::Deferred)));
        Ok(())
    }

    #[test]
    fn task_defer_rejects_closed_tasks() {
        let repo_path = "/tmp/odt-repo-defer-closed";
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::Closed)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let error = service
            .task_defer(repo_path, "task-1", None)
            .expect_err("closed tasks cannot be deferred");
        assert!(error
            .to_string()
            .contains("Only non-closed open-state tasks"));
    }

    #[test]
    fn set_spec_persists_trimmed_markdown_and_transitions_open_task() -> Result<()> {
        let repo_path = "/tmp/odt-repo-spec";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "feature", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let spec = service.set_spec(repo_path, "task-1", "  # Spec  ")?;
        assert_eq!(spec.markdown, "# Spec");

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(
            task_state.spec_set_calls,
            vec![("task-1".to_string(), "# Spec".to_string())]
        );
        assert!(task_state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::SpecReady)));
        Ok(())
    }

    #[test]
    fn set_spec_rejects_invalid_status() {
        let repo_path = "/tmp/odt-repo-spec-invalid";
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::InProgress)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let error = service
            .set_spec(repo_path, "task-1", "# Spec")
            .expect_err("set_spec should be blocked in in_progress");
        assert!(error.to_string().contains("set_spec is only allowed"));
    }

    #[test]
    fn set_plan_for_non_epic_transitions_ready_for_dev() -> Result<()> {
        let repo_path = "/tmp/odt-repo-plan-task";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let plan = service.set_plan(repo_path, "task-1", "  # Plan  ", None)?;
        assert_eq!(plan.markdown, "# Plan");

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(
            task_state.plan_set_calls,
            vec![("task-1".to_string(), "# Plan".to_string())]
        );
        assert_eq!(task_state.created_inputs.len(), 0);
        assert!(task_state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::ReadyForDev)));
        Ok(())
    }

    #[test]
    fn set_plan_allows_feature_from_ready_for_dev_without_status_transition() -> Result<()> {
        let repo_path = "/tmp/odt-repo-plan-feature-ready";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "feature", TaskStatus::ReadyForDev)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let plan = service.set_plan(repo_path, "task-1", "  # Revised Plan  ", None)?;
        assert_eq!(plan.markdown, "# Revised Plan");

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(
            task_state.plan_set_calls,
            vec![("task-1".to_string(), "# Revised Plan".to_string())]
        );
        assert!(
            !task_state
                .updated_patches
                .iter()
                .any(|(_, patch)| patch.status.is_some()),
            "status update should be skipped when already ready_for_dev"
        );
        Ok(())
    }

    #[test]
    fn set_plan_rejects_invalid_status_for_feature() {
        let repo_path = "/tmp/odt-repo-plan-invalid";
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "feature", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let error = service
            .set_plan(repo_path, "task-1", "# Plan", None)
            .expect_err("feature/open should not allow plan");
        assert!(error.to_string().contains("set_plan is not allowed"));
    }

    #[test]
    fn set_plan_for_epic_replaces_existing_subtasks_with_new_plan_proposals() -> Result<()> {
        let repo_path = "/tmp/odt-repo-plan-epic";
        let epic = make_task("epic-1", "epic", TaskStatus::SpecReady);
        let mut existing_child = make_task("child-1", "task", TaskStatus::Open);
        existing_child.title = "Build API".to_string();
        existing_child.parent_id = Some("epic-1".to_string());

        let (service, task_state, _git_state) = build_service_with_state(
            vec![epic, existing_child],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let plan = service.set_plan(
            repo_path,
            "epic-1",
            "# Epic Plan",
            Some(vec![
                PlanSubtaskInput {
                    title: "Build API".to_string(),
                    issue_type: Some("task".to_string()),
                    priority: Some(2),
                    description: None,
                },
                PlanSubtaskInput {
                    title: "Build UI".to_string(),
                    issue_type: Some("feature".to_string()),
                    priority: Some(2),
                    description: Some("Add interface".to_string()),
                },
                PlanSubtaskInput {
                    title: "Build UI".to_string(),
                    issue_type: Some("feature".to_string()),
                    priority: Some(2),
                    description: Some("Duplicate".to_string()),
                },
            ]),
        )?;
        assert_eq!(plan.markdown, "# Epic Plan");

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(
            task_state.delete_calls,
            vec![("child-1".to_string(), false)]
        );
        assert_eq!(task_state.created_inputs.len(), 2);
        assert_eq!(task_state.created_inputs[0].title, "Build API");
        assert_eq!(
            task_state.created_inputs[0].parent_id.as_deref(),
            Some("epic-1")
        );
        assert_eq!(task_state.created_inputs[1].title, "Build UI");
        assert_eq!(
            task_state.created_inputs[1].parent_id.as_deref(),
            Some("epic-1")
        );
        assert!(task_state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::ReadyForDev)));
        Ok(())
    }

    #[test]
    fn set_plan_for_epic_without_subtasks_clears_existing_direct_subtasks() -> Result<()> {
        let repo_path = "/tmp/odt-repo-plan-epic-clear";
        let epic = make_task("epic-1", "epic", TaskStatus::SpecReady);
        let mut existing_child = make_task("child-1", "task", TaskStatus::Open);
        existing_child.parent_id = Some("epic-1".to_string());

        let (service, task_state, _git_state) = build_service_with_state(
            vec![epic, existing_child],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let plan = service.set_plan(repo_path, "epic-1", "# Epic Plan", None)?;
        assert_eq!(plan.markdown, "# Epic Plan");

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(
            task_state.delete_calls,
            vec![("child-1".to_string(), false)]
        );
        assert!(task_state.created_inputs.is_empty());
        assert!(task_state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::ReadyForDev)));
        Ok(())
    }

    #[test]
    fn set_plan_for_epic_rejects_subtask_replacement_when_existing_subtask_is_active() {
        let repo_path = "/tmp/odt-repo-plan-epic-active-subtask";
        let epic = make_task("epic-1", "epic", TaskStatus::SpecReady);
        let mut active_child = make_task("child-1", "task", TaskStatus::InProgress);
        active_child.parent_id = Some("epic-1".to_string());

        let (service, task_state, _git_state) = build_service_with_state(
            vec![epic, active_child],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let error = service
            .set_plan(
                repo_path,
                "epic-1",
                "# Epic Plan",
                Some(vec![PlanSubtaskInput {
                    title: "Build API".to_string(),
                    issue_type: Some("task".to_string()),
                    priority: Some(2),
                    description: None,
                }]),
            )
            .expect_err("active direct subtasks must block replacement");
        assert!(
            error
                .to_string()
                .contains("Cannot replace epic subtasks while active work exists"),
            "unexpected error: {error}"
        );

        let task_state = task_state.lock().expect("task lock poisoned");
        assert!(task_state.delete_calls.is_empty());
        assert!(task_state.created_inputs.is_empty());
    }

    #[test]
    fn qa_get_report_returns_latest_markdown_when_present() -> Result<()> {
        let repo_path = "/tmp/odt-repo-qa-report";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );
        {
            let mut state = task_state.lock().expect("task lock poisoned");
            state.latest_qa_report = Some(QaReportDocument {
                markdown: "QA body".to_string(),
                verdict: QaVerdict::Approved,
                updated_at: "2026-02-20T12:00:00Z".to_string(),
                revision: 2,
            });
        }

        let report = service.qa_get_report(repo_path, "task-1")?;
        assert_eq!(report.markdown, "QA body");
        assert_eq!(report.updated_at.as_deref(), Some("2026-02-20T12:00:00Z"));
        Ok(())
    }

    #[test]
    fn qa_get_report_returns_empty_when_not_present() -> Result<()> {
        let repo_path = "/tmp/odt-repo-qa-empty";
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let report = service.qa_get_report(repo_path, "task-1")?;
        assert!(report.markdown.is_empty());
        assert!(report.updated_at.is_none());
        Ok(())
    }

    #[test]
    fn spec_get_and_plan_get_use_consolidated_metadata_lookup() -> Result<()> {
        let repo_path = "/tmp/odt-repo-docs-read";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let _ = service.spec_get(repo_path, "task-1")?;
        let _ = service.plan_get(repo_path, "task-1")?;

        let state = task_state.lock().expect("task lock poisoned");
        assert!(state.spec_get_calls.is_empty());
        assert!(state.plan_get_calls.is_empty());
        assert_eq!(
            state.metadata_get_calls,
            vec!["task-1".to_string(), "task-1".to_string()]
        );
        Ok(())
    }

    #[test]
    fn qa_approved_appends_report_and_transitions_to_human_review() -> Result<()> {
        let repo_path = "/tmp/odt-repo-qa-approved";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::AiReview)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let task = service.qa_approved(repo_path, "task-1", "Looks good")?;
        assert_eq!(task.status, TaskStatus::HumanReview);

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(
            task_state.qa_append_calls,
            vec![(
                "task-1".to_string(),
                "Looks good".to_string(),
                QaVerdict::Approved
            )]
        );
        assert!(task_state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::HumanReview)));
        Ok(())
    }

    #[test]
    fn qa_rejected_appends_report_and_transitions_to_in_progress() -> Result<()> {
        let repo_path = "/tmp/odt-repo-qa-rejected";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![make_task("task-1", "task", TaskStatus::AiReview)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let task = service.qa_rejected(repo_path, "task-1", "Needs work")?;
        assert_eq!(task.status, TaskStatus::InProgress);

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(
            task_state.qa_append_calls,
            vec![(
                "task-1".to_string(),
                "Needs work".to_string(),
                QaVerdict::Rejected
            )]
        );
        assert!(task_state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::InProgress)));
        Ok(())
    }

    #[test]
    fn agent_sessions_list_and_upsert_flow_through_store() -> Result<()> {
        let repo_path = "/tmp/odt-repo-sessions";
        let (service, task_state, _git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );
        {
            let mut state = task_state.lock().expect("task lock poisoned");
            state.agent_sessions = vec![make_session("task-1", "session-1")];
        }

        let sessions = service.agent_sessions_list(repo_path, "task-1")?;
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "session-1");

        let upserted = service.agent_session_upsert(
            repo_path,
            "task-1",
            make_session("wrong-task", "session-2"),
        )?;
        assert!(upserted);

        let task_state = task_state.lock().expect("task lock poisoned");
        assert_eq!(task_state.upserted_sessions.len(), 1);
        assert_eq!(task_state.upserted_sessions[0].0, "task-1");
        assert_eq!(task_state.upserted_sessions[0].1.task_id, "task-1");
        Ok(())
    }

    #[test]
    fn runtime_beads_system_and_workspace_paths_are_exercised() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("runtime-workspace");
        let repo = root.join("repo");
        init_git_repo(&repo)?;

        let bin_dir = root.join("bin");
        let fake_opencode = bin_dir.join("opencode");
        let fake_bd = bin_dir.join("bd");
        create_fake_opencode(&fake_opencode)?;
        create_fake_bd(&fake_bd)?;

        let _opencode_guard = set_env_var(
            "OPENDUCKTOR_OPENCODE_BINARY",
            fake_opencode.to_string_lossy().as_ref(),
        );
        let _path_guard = prepend_path(&bin_dir);

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "task", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );

        let repo_path = repo.to_string_lossy().to_string();
        let runtime = service.runtime_check()?;
        assert!(runtime.git_ok);
        assert!(runtime.opencode_ok);
        assert!(runtime
            .opencode_version
            .as_deref()
            .unwrap_or_default()
            .contains("opencode-fake"));

        let beads = service.beads_check(repo_path.as_str())?;
        assert!(beads.beads_ok);
        assert!(beads.beads_path.is_some());

        let system = service.system_check(repo_path.as_str())?;
        assert!(system.git_ok);
        assert!(system.beads_ok);
        assert!(system.opencode_ok);
        assert!(system.errors.is_empty());

        let workspace = service.workspace_add(repo_path.as_str())?;
        assert!(workspace.is_active);
        let selected = service.workspace_select(repo_path.as_str())?;
        assert!(selected.is_active);

        let worktree_base = root.join("worktrees").to_string_lossy().to_string();
        let updated = service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.clone()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: false,
                hooks: HookSet::default(),
                agent_defaults: Default::default(),
            },
        )?;
        assert!(updated.has_config);

        let config = service.workspace_get_repo_config(repo_path.as_str())?;
        assert_eq!(config.branch_prefix, "odt");
        assert_eq!(
            config.worktree_base_path.as_deref(),
            Some(worktree_base.as_str())
        );
        assert!(service
            .workspace_get_repo_config_optional(repo_path.as_str())?
            .is_some());
        let trusted = service.workspace_set_trusted_hooks(repo_path.as_str(), true)?;
        assert!(trusted.has_config);

        let records = service.workspace_list()?;
        assert_eq!(records.len(), 1);
        assert!(records[0].is_active);

        let state = task_state.lock().expect("task lock poisoned");
        assert!(!state.ensure_calls.is_empty());
        drop(state);

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn beads_check_reports_task_store_init_error() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("beads-error");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let bin_dir = root.join("bin");
        create_fake_bd(&bin_dir.join("bd"))?;
        let _path_guard = prepend_path(&bin_dir);

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );
        task_state.lock().expect("task lock poisoned").ensure_error =
            Some("init failed".to_string());

        let repo_path = repo.to_string_lossy().to_string();
        let check = service.beads_check(repo_path.as_str())?;
        assert!(!check.beads_ok);
        let beads_error = check.beads_error.unwrap_or_default();
        assert!(
            beads_error.contains("Failed to initialize task store"),
            "unexpected beads error: {beads_error}"
        );
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn beads_and_system_checks_report_missing_bd_binary() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("beads-missing-binary");
        let _path_guard = set_env_var("PATH", "/usr/bin:/bin");

        let (service, _task_state, _git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let beads = service.beads_check("/tmp/does-not-matter")?;
        assert!(!beads.beads_ok);
        assert!(beads.beads_path.is_none());
        assert!(beads
            .beads_error
            .as_deref()
            .unwrap_or_default()
            .contains("bd not found in PATH"));

        let system = service.system_check("/tmp/does-not-matter")?;
        assert!(system
            .errors
            .iter()
            .any(|entry| entry.contains("beads: bd not found in PATH")));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn opencode_workspace_runtime_ensure_list_and_stop_flow() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("runtime-workspace-flow");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let fake_opencode = root.join("opencode");
        create_fake_opencode(&fake_opencode)?;
        let _opencode_guard = set_env_var(
            "OPENDUCKTOR_OPENCODE_BINARY",
            fake_opencode.to_string_lossy().as_ref(),
        );

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );

        let repo_path = repo.to_string_lossy().to_string();
        let first = service.opencode_repo_runtime_ensure(repo_path.as_str())?;
        let second = service.opencode_repo_runtime_ensure(repo_path.as_str())?;
        assert_eq!(first.runtime_id, second.runtime_id);

        let listed = service.opencode_runtime_list(Some(repo_path.as_str()))?;
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].runtime_id, first.runtime_id);

        assert!(service.opencode_runtime_stop(first.runtime_id.as_str())?);
        assert!(service
            .opencode_runtime_list(Some(repo_path.as_str()))?
            .is_empty());
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn opencode_workspace_runtime_ensure_stops_spawned_child_when_post_start_prune_fails(
    ) -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("runtime-workspace-prune-failure");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let fake_opencode = root.join("opencode");
        create_fake_opencode(&fake_opencode)?;
        let pid_file = root.join("spawned-runtime.pid");
        let _opencode_guard = set_env_var(
            "OPENDUCKTOR_OPENCODE_BINARY",
            fake_opencode.to_string_lossy().as_ref(),
        );
        let _delay_guard = set_env_var("OPENDUCKTOR_TEST_STARTUP_DELAY_MS", "600");
        let _pid_guard = set_env_var(
            "OPENDUCKTOR_TEST_PID_FILE",
            pid_file.to_string_lossy().as_ref(),
        );

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );
        let stale_child = Command::new("/bin/sh")
            .arg("-lc")
            .arg("sleep 0.2")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn stale child");
        service
            .agent_runtimes
            .lock()
            .expect("runtime lock poisoned")
            .insert(
                "runtime-stale-prune-failure-window".to_string(),
                super::AgentRuntimeProcess {
                    summary: AgentRuntimeSummary {
                        runtime_id: "runtime-stale-prune-failure-window".to_string(),
                        repo_path: "/tmp/other-repo-for-prune".to_string(),
                        task_id: "task-1".to_string(),
                        role: "spec".to_string(),
                        working_directory: "/tmp/other-repo-for-prune".to_string(),
                        port: 1,
                        started_at: "2026-02-20T12:00:00Z".to_string(),
                    },
                    child: stale_child,
                    _opencode_process_guard: None,
                    cleanup_repo_path: Some(
                        "/tmp/non-existent-repo-for-ensure-post-start-prune".to_string(),
                    ),
                    cleanup_worktree_path: Some(
                        "/tmp/non-existent-worktree-for-ensure-post-start-prune".to_string(),
                    ),
                },
            );

        let repo_path = repo.to_string_lossy().to_string();
        let error = service
            .opencode_repo_runtime_ensure(repo_path.as_str())
            .expect_err("post-start prune failure should bubble up");
        let message = error.to_string();
        assert!(
            message.contains("Failed pruning stale runtimes while finalizing workspace runtime")
        );
        assert!(wait_for_path_exists(
            pid_file.as_path(),
            Duration::from_secs(2)
        ));
        let spawned_pid = fs::read_to_string(pid_file.as_path())?
            .trim()
            .parse::<i32>()
            .expect("spawned runtime pid should parse as i32");
        assert!(wait_for_process_exit(spawned_pid, Duration::from_secs(2)));
        assert!(service
            .agent_runtimes
            .lock()
            .expect("runtime lock poisoned")
            .is_empty());

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn opencode_runtime_start_supports_spec_and_qa_roles() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("runtime-start");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let fake_opencode = root.join("opencode");
        create_fake_opencode(&fake_opencode)?;
        let _opencode_guard = set_env_var(
            "OPENDUCKTOR_OPENCODE_BINARY",
            fake_opencode.to_string_lossy().as_ref(),
        );

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let worktree_base = root.join("qa-worktrees");
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "task", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );
        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet::default(),
                agent_defaults: Default::default(),
            },
        )?;

        let spec_runtime = service.opencode_runtime_start(repo_path.as_str(), "task-1", "spec")?;
        assert_eq!(spec_runtime.role, "spec");
        assert!(service.opencode_runtime_stop(spec_runtime.runtime_id.as_str())?);

        let qa_runtime = service.opencode_runtime_start(repo_path.as_str(), "task-1", "qa")?;
        assert_eq!(qa_runtime.role, "qa");
        let qa_worktree = PathBuf::from(qa_runtime.working_directory.clone());
        assert!(qa_worktree.exists());
        assert!(service.opencode_runtime_stop(qa_runtime.runtime_id.as_str())?);
        assert!(!qa_worktree.exists());

        let bad_role = service
            .opencode_runtime_start(repo_path.as_str(), "task-1", "build")
            .expect_err("unsupported role should fail");
        assert!(bad_role
            .to_string()
            .contains("Unsupported agent runtime role"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn opencode_runtime_start_reports_missing_task() -> Result<()> {
        let root = unique_temp_path("runtime-missing-task");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );

        let repo_path = repo.to_string_lossy().to_string();
        let error = service
            .opencode_runtime_start(repo_path.as_str(), "missing-task", "spec")
            .expect_err("missing task should fail");
        assert!(error.to_string().contains("Task not found: missing-task"));
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn opencode_runtime_start_qa_validates_config_and_existing_worktree_path() -> Result<()> {
        let root = unique_temp_path("runtime-qa-guards");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let worktree_base = root.join("qa-worktrees");
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "task", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );

        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: None,
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet::default(),
                agent_defaults: Default::default(),
            },
        )?;
        let missing_base_error = service
            .opencode_runtime_start(repo_path.as_str(), "task-1", "qa")
            .expect_err("qa runtime should require worktree base path");
        assert!(missing_base_error
            .to_string()
            .contains("QA blocked: configure repos."));

        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: false,
                hooks: HookSet {
                    pre_start: vec!["echo pre-hook".to_string()],
                    post_complete: Vec::new(),
                },
                agent_defaults: Default::default(),
            },
        )?;
        let trust_error = service
            .opencode_runtime_start(repo_path.as_str(), "task-1", "qa")
            .expect_err("qa runtime should reject untrusted hooks");
        assert!(trust_error
            .to_string()
            .contains("Hooks are configured but not trusted"));

        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet::default(),
                agent_defaults: Default::default(),
            },
        )?;
        fs::create_dir_all(worktree_base.join("qa-task-1"))?;
        let existing_path_error = service
            .opencode_runtime_start(repo_path.as_str(), "task-1", "qa")
            .expect_err("existing qa worktree should fail");
        assert!(existing_path_error
            .to_string()
            .contains("QA worktree path already exists"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn opencode_runtime_start_surfaces_qa_pre_start_cleanup_failure() -> Result<()> {
        let root = unique_temp_path("runtime-pre-start-cleanup-failure");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let worktree_base = root.join("qa-worktrees");
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "task", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );

        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet {
                    pre_start: vec![format!("rm -rf \"{repo_path}\"; exit 1")],
                    post_complete: Vec::new(),
                },
                agent_defaults: Default::default(),
            },
        )?;

        let error = service
            .opencode_runtime_start(repo_path.as_str(), "task-1", "qa")
            .expect_err("cleanup failure should be surfaced when pre-start hook fails");
        let message = error.to_string();
        assert!(message.contains("QA pre-start hook failed"));
        assert!(message.contains("Failed removing QA worktree runtime"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn opencode_runtime_start_surfaces_cleanup_failure_after_startup_error() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("runtime-startup-cleanup-failure");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let failing_opencode = root.join("opencode");
        create_failing_opencode_with_worktree_cleanup(&failing_opencode)?;
        let _opencode_guard = set_env_var(
            "OPENDUCKTOR_OPENCODE_BINARY",
            failing_opencode.to_string_lossy().as_ref(),
        );
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let worktree_base = root.join("qa-worktrees");
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "task", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );
        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet::default(),
                agent_defaults: Default::default(),
            },
        )?;

        let error = service
            .opencode_runtime_start(repo_path.as_str(), "task-1", "qa")
            .expect_err("startup cleanup failure should be surfaced");
        let message = error.to_string();
        assert!(message.contains("OpenCode runtime failed to start for task task-1"));
        assert!(message.contains("Failed removing QA worktree runtime"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn opencode_runtime_start_reuses_existing_runtime_for_same_task_and_role() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("runtime-reuse");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let fake_opencode = root.join("opencode");
        create_fake_opencode(&fake_opencode)?;
        let _opencode_guard = set_env_var(
            "OPENDUCKTOR_OPENCODE_BINARY",
            fake_opencode.to_string_lossy().as_ref(),
        );
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "task", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );
        let repo_path = repo.to_string_lossy().to_string();

        let first = service.opencode_runtime_start(repo_path.as_str(), "task-1", "spec")?;
        let second = service.opencode_runtime_start(repo_path.as_str(), "task-1", "spec")?;
        assert_eq!(first.runtime_id, second.runtime_id);
        assert!(service.opencode_runtime_stop(first.runtime_id.as_str())?);
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn opencode_runtime_stop_reports_cleanup_failure() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let runtime_id = "runtime-cleanup-error".to_string();
        service
            .agent_runtimes
            .lock()
            .expect("runtime lock poisoned")
            .insert(
                runtime_id.clone(),
                super::AgentRuntimeProcess {
                    summary: AgentRuntimeSummary {
                        runtime_id: runtime_id.clone(),
                        repo_path: "/tmp/repo".to_string(),
                        task_id: "task-1".to_string(),
                        role: "qa".to_string(),
                        working_directory: "/tmp/repo".to_string(),
                        port: 1,
                        started_at: "2026-02-20T12:00:00Z".to_string(),
                    },
                    child: spawn_sleep_process(20),
                    _opencode_process_guard: None,
                    cleanup_repo_path: Some("/tmp/non-existent-repo-for-stop".to_string()),
                    cleanup_worktree_path: Some("/tmp/non-existent-worktree-for-stop".to_string()),
                },
            );

        let error = service
            .opencode_runtime_stop(runtime_id.as_str())
            .expect_err("cleanup failure should bubble up");
        assert!(error
            .to_string()
            .contains("Failed removing QA worktree runtime"));
        assert!(service
            .agent_runtimes
            .lock()
            .expect("runtime lock poisoned")
            .is_empty());
        Ok(())
    }

    #[test]
    fn opencode_runtime_list_prunes_stale_entries() -> Result<()> {
        let root = unique_temp_path("runtime-prune");
        let repo = root.join("repo");
        init_git_repo(&repo)?;

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );

        let mut stale_child = Command::new("/bin/sh")
            .arg("-lc")
            .arg("exit 0")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn stale child");
        let _ = stale_child.wait();
        let summary = AgentRuntimeSummary {
            runtime_id: "runtime-stale".to_string(),
            repo_path: repo.to_string_lossy().to_string(),
            task_id: "task-1".to_string(),
            role: "spec".to_string(),
            working_directory: repo.to_string_lossy().to_string(),
            port: 1,
            started_at: "2026-02-20T12:00:00Z".to_string(),
        };
        service
            .agent_runtimes
            .lock()
            .expect("runtime lock poisoned")
            .insert(
                summary.runtime_id.clone(),
                super::AgentRuntimeProcess {
                    summary,
                    child: stale_child,
                    _opencode_process_guard: None,
                    cleanup_repo_path: None,
                    cleanup_worktree_path: None,
                },
            );

        let listed = service.opencode_runtime_list(None)?;
        assert!(listed.is_empty());

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn opencode_runtime_list_surfaces_stale_cleanup_failure() -> Result<()> {
        let root = unique_temp_path("runtime-prune-cleanup-failure");
        let repo = root.join("repo");
        init_git_repo(&repo)?;

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );

        let mut stale_child = Command::new("/bin/sh")
            .arg("-lc")
            .arg("exit 0")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn stale child");
        let _ = stale_child.wait();
        let summary = AgentRuntimeSummary {
            runtime_id: "runtime-stale-cleanup-error".to_string(),
            repo_path: repo.to_string_lossy().to_string(),
            task_id: "task-1".to_string(),
            role: "qa".to_string(),
            working_directory: repo.to_string_lossy().to_string(),
            port: 1,
            started_at: "2026-02-20T12:00:00Z".to_string(),
        };
        service
            .agent_runtimes
            .lock()
            .expect("runtime lock poisoned")
            .insert(
                summary.runtime_id.clone(),
                super::AgentRuntimeProcess {
                    summary,
                    child: stale_child,
                    _opencode_process_guard: None,
                    cleanup_repo_path: Some("/tmp/non-existent-repo-for-prune".to_string()),
                    cleanup_worktree_path: Some("/tmp/non-existent-worktree-for-prune".to_string()),
                },
            );

        let error = service
            .opencode_runtime_list(None)
            .expect_err("stale runtime cleanup failure should be surfaced");
        let message = error.to_string();
        assert!(message.contains("Failed pruning stale agent runtimes"));
        assert!(message.contains("Failed removing QA worktree runtime"));
        assert!(service
            .agent_runtimes
            .lock()
            .expect("runtime lock poisoned")
            .is_empty());

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn build_start_respond_and_cleanup_success_flow() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("build-success");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let fake_opencode = root.join("opencode");
        create_fake_opencode(&fake_opencode)?;
        let _opencode_guard = set_env_var(
            "OPENDUCKTOR_OPENCODE_BINARY",
            fake_opencode.to_string_lossy().as_ref(),
        );

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let worktree_base = root.join("builder-worktrees");
        let (service, task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "bug", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );
        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet::default(),
                agent_defaults: Default::default(),
            },
        )?;

        let events = Arc::new(Mutex::new(Vec::<RunEvent>::new()));
        let emitter = make_emitter(events.clone());

        let run = service.build_start(repo_path.as_str(), "task-1", emitter.clone())?;
        assert!(matches!(run.state, RunState::Running));
        assert_eq!(service.runs_list(Some(repo_path.as_str()))?.len(), 1);

        std::thread::sleep(Duration::from_millis(200));
        assert!(service.build_respond(
            run.run_id.as_str(),
            BuildResponseAction::Approve,
            Some("Allow git push"),
            emitter.clone()
        )?);

        assert!(service.build_cleanup(
            run.run_id.as_str(),
            CleanupMode::Success,
            emitter.clone()
        )?);
        assert!(service.runs_list(Some(repo_path.as_str()))?.is_empty());

        let state = task_state.lock().expect("task lock poisoned");
        assert!(state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::InProgress)));
        assert!(state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::AiReview)));
        drop(state);

        let emitted = events.lock().expect("events lock poisoned");
        assert!(emitted
            .iter()
            .any(|event| matches!(event, RunEvent::RunStarted { .. })));
        assert!(emitted
            .iter()
            .any(|event| matches!(event, RunEvent::PermissionRequired { .. })));
        assert!(emitted
            .iter()
            .any(|event| matches!(event, RunEvent::ToolExecution { .. })));
        assert!(emitted
            .iter()
            .any(|event| matches!(event, RunEvent::RunFinished { success: true, .. })));
        drop(emitted);

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn build_stop_respond_and_cleanup_failure_paths() -> Result<()> {
        let root = unique_temp_path("build-failure");
        let repo = root.join("repo");
        init_git_repo(&repo)?;

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let (service, task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "bug", TaskStatus::InProgress)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );

        let run_id = "run-local".to_string();
        service.runs.lock().expect("run lock poisoned").insert(
            run_id.clone(),
            super::RunProcess {
                summary: RunSummary {
                    run_id: run_id.clone(),
                    repo_path: repo_path.clone(),
                    task_id: "task-1".to_string(),
                    branch: "odt/task-1".to_string(),
                    worktree_path: repo_path.clone(),
                    port: 1,
                    state: RunState::Running,
                    last_message: None,
                    started_at: "2026-02-20T12:00:00Z".to_string(),
                },
                child: spawn_sleep_process(20),
                _opencode_process_guard: None,
                repo_path: repo_path.clone(),
                task_id: "task-1".to_string(),
                worktree_path: repo_path.clone(),
                repo_config: RepoConfig {
                    worktree_base_path: None,
                    branch_prefix: "odt".to_string(),
                    trusted_hooks: true,
                    hooks: HookSet::default(),
                    agent_defaults: Default::default(),
                },
            },
        );

        let events = Arc::new(Mutex::new(Vec::<RunEvent>::new()));
        let emitter = make_emitter(events.clone());
        assert!(service.build_respond(
            run_id.as_str(),
            BuildResponseAction::Message,
            Some("note"),
            emitter.clone()
        )?);
        assert!(service.build_respond(
            run_id.as_str(),
            BuildResponseAction::Deny,
            None,
            emitter.clone()
        )?);

        assert!(service.build_stop(run_id.as_str(), emitter.clone())?);
        assert!(service.build_cleanup(run_id.as_str(), CleanupMode::Failure, emitter.clone())?);
        assert!(service.runs_list(Some(repo_path.as_str()))?.is_empty());

        let state = task_state.lock().expect("task lock poisoned");
        assert!(state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::Blocked)));
        drop(state);

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn build_start_and_cleanup_cover_hook_failure_paths() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("build-hooks");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let fake_opencode = root.join("opencode");
        create_fake_opencode(&fake_opencode)?;
        let _opencode_guard = set_env_var(
            "OPENDUCKTOR_OPENCODE_BINARY",
            fake_opencode.to_string_lossy().as_ref(),
        );

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let worktree_base = root.join("hook-worktrees");
        let (service, task_state, _git_state) = build_service_with_store(
            vec![
                make_task("task-1", "bug", TaskStatus::Open),
                make_task("task-2", "bug", TaskStatus::Open),
            ],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );

        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet {
                    pre_start: vec!["echo pre-fail >&2; exit 1".to_string()],
                    post_complete: Vec::new(),
                },
                agent_defaults: Default::default(),
            },
        )?;

        let pre_start_error = service
            .build_start(
                repo_path.as_str(),
                "task-1",
                make_emitter(Arc::new(Mutex::new(Vec::new()))),
            )
            .expect_err("pre-start failure should fail");
        assert!(pre_start_error
            .to_string()
            .contains("Pre-start hook failed"));

        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet {
                    pre_start: Vec::new(),
                    post_complete: vec!["echo post-fail >&2; exit 1".to_string()],
                },
                agent_defaults: Default::default(),
            },
        )?;

        let events = Arc::new(Mutex::new(Vec::<RunEvent>::new()));
        let emitter = make_emitter(events.clone());
        let run = service.build_start(repo_path.as_str(), "task-2", emitter.clone())?;
        let cleaned =
            service.build_cleanup(run.run_id.as_str(), CleanupMode::Success, emitter.clone())?;
        assert!(!cleaned, "post-hook failure should report false");

        let invalid_mode = service
            .build_cleanup("run-missing", CleanupMode::Success, emitter)
            .expect_err("unknown mode should fail");
        assert!(invalid_mode.to_string().contains("Run not found"));

        let state = task_state.lock().expect("task lock poisoned");
        assert!(state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status == Some(TaskStatus::Blocked)));
        drop(state);

        let emitted = events.lock().expect("events lock poisoned");
        assert!(emitted
            .iter()
            .any(|event| matches!(event, RunEvent::PostHookStarted { .. })));
        assert!(emitted
            .iter()
            .any(|event| matches!(event, RunEvent::PostHookFailed { .. })));
        drop(emitted);

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn build_start_requires_worktree_base_path() -> Result<()> {
        let root = unique_temp_path("build-no-worktree-base");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "bug", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );
        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: None,
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet::default(),
                agent_defaults: Default::default(),
            },
        )?;

        let error = service
            .build_start(
                repo_path.as_str(),
                "task-1",
                make_emitter(Arc::new(Mutex::new(Vec::new()))),
            )
            .expect_err("build_start should require worktree base");
        assert!(error
            .to_string()
            .contains("Build blocked: configure repos."));
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn build_start_rejects_untrusted_hooks_configuration() -> Result<()> {
        let root = unique_temp_path("build-untrusted-hooks");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let worktree_base = root.join("worktrees");
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "bug", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );
        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: false,
                hooks: HookSet {
                    pre_start: vec!["echo pre-hook".to_string()],
                    post_complete: Vec::new(),
                },
                agent_defaults: Default::default(),
            },
        )?;

        let error = service
            .build_start(
                repo_path.as_str(),
                "task-1",
                make_emitter(Arc::new(Mutex::new(Vec::new()))),
            )
            .expect_err("hooks should be rejected when not trusted");
        assert!(error
            .to_string()
            .contains("Hooks are configured but not trusted"));
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn build_start_rejects_existing_worktree_directory() -> Result<()> {
        let root = unique_temp_path("build-existing-worktree");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let worktree_base = root.join("worktrees");
        let task_worktree = worktree_base.join("task-1");
        fs::create_dir_all(&task_worktree)?;

        let (service, _task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "bug", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );
        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet::default(),
                agent_defaults: Default::default(),
            },
        )?;

        let error = service
            .build_start(
                repo_path.as_str(),
                "task-1",
                make_emitter(Arc::new(Mutex::new(Vec::new()))),
            )
            .expect_err("existing worktree path should be rejected");
        assert!(error
            .to_string()
            .contains("Worktree path already exists for task task-1"));
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn build_start_reports_opencode_startup_failure() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("build-startup-failure");
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let failing_opencode = root.join("opencode");
        create_failing_opencode(&failing_opencode)?;
        let _opencode_guard = set_env_var(
            "OPENDUCKTOR_OPENCODE_BINARY",
            failing_opencode.to_string_lossy().as_ref(),
        );

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let repo_path = repo.to_string_lossy().to_string();
        let worktree_base = root.join("worktrees");
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "bug", TaskStatus::Open)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );
        service.workspace_update_repo_config(
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet::default(),
                agent_defaults: Default::default(),
            },
        )?;

        let error = service
            .build_start(
                repo_path.as_str(),
                "task-1",
                make_emitter(Arc::new(Mutex::new(Vec::new()))),
            )
            .expect_err("startup failure should bubble up");
        let message = error.to_string();
        assert!(message.contains("OpenCode build runtime failed to start"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn shutdown_reports_runtime_cleanup_errors_and_drains_state() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let run_id = "run-shutdown".to_string();
        service.runs.lock().expect("run lock poisoned").insert(
            run_id.clone(),
            super::RunProcess {
                summary: RunSummary {
                    run_id: run_id.clone(),
                    repo_path: "/tmp/repo".to_string(),
                    task_id: "task-1".to_string(),
                    branch: "odt/task-1".to_string(),
                    worktree_path: "/tmp/worktree".to_string(),
                    port: 1,
                    state: RunState::Running,
                    last_message: None,
                    started_at: "2026-02-20T12:00:00Z".to_string(),
                },
                child: spawn_sleep_process(20),
                _opencode_process_guard: None,
                repo_path: "/tmp/repo".to_string(),
                task_id: "task-1".to_string(),
                worktree_path: "/tmp/worktree".to_string(),
                repo_config: RepoConfig {
                    worktree_base_path: None,
                    branch_prefix: "odt".to_string(),
                    trusted_hooks: true,
                    hooks: HookSet::default(),
                    agent_defaults: Default::default(),
                },
            },
        );

        let runtime_id = "runtime-shutdown".to_string();
        service
            .agent_runtimes
            .lock()
            .expect("runtime lock poisoned")
            .insert(
                runtime_id.clone(),
                super::AgentRuntimeProcess {
                    summary: AgentRuntimeSummary {
                        runtime_id,
                        repo_path: "/tmp/repo".to_string(),
                        task_id: "task-1".to_string(),
                        role: "qa".to_string(),
                        working_directory: "/tmp/worktree".to_string(),
                        port: 1,
                        started_at: "2026-02-20T12:00:00Z".to_string(),
                    },
                    child: spawn_sleep_process(20),
                    _opencode_process_guard: None,
                    cleanup_repo_path: Some("/tmp/non-existent-repo-for-shutdown".to_string()),
                    cleanup_worktree_path: Some(
                        "/tmp/non-existent-worktree-for-shutdown".to_string(),
                    ),
                },
            );

        let error = service
            .shutdown()
            .expect_err("shutdown should aggregate runtime cleanup failures");
        assert!(error
            .to_string()
            .contains("Failed removing QA worktree runtime"));
        assert!(service.runs.lock().expect("run lock poisoned").is_empty());
        assert!(service
            .agent_runtimes
            .lock()
            .expect("runtime lock poisoned")
            .is_empty());
        Ok(())
    }

    #[test]
    fn shutdown_terminates_pending_opencode_processes() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
        );

        let root = unique_temp_path("shutdown-pending-opencode");
        let orphanable_opencode = root.join("opencode");
        create_orphanable_opencode(&orphanable_opencode)?;
        let mut pending_child = Command::new(orphanable_opencode.as_path())
            .arg("serve")
            .arg("--hostname")
            .arg("127.0.0.1")
            .arg("--port")
            .arg("54323")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .context("failed spawning pending opencode process")?;
        let pending_pid = pending_child.id();
        service
            .tracked_opencode_processes
            .lock()
            .expect("pending OpenCode process lock poisoned")
            .insert(pending_pid, 1);

        service.shutdown()?;

        let deadline = Instant::now() + Duration::from_secs(2);
        let mut exited = false;
        while Instant::now() < deadline {
            if pending_child.try_wait()?.is_some() {
                exited = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        if !exited {
            exited = pending_child.try_wait()?.is_some();
        }

        assert!(
            exited,
            "pending OpenCode process should have exited during shutdown"
        );
        assert!(service
            .tracked_opencode_processes
            .lock()
            .expect("pending OpenCode process lock poisoned")
            .is_empty());

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn shutdown_drains_runs_and_runtimes_when_pending_opencode_cleanup_fails() -> Result<()> {
        let root = unique_temp_path("shutdown-drains-after-pending-cleanup-failure");
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );

        let run_child = spawn_sleep_process(20);
        let run_pid = run_child.id() as i32;
        service.runs.lock().expect("run lock poisoned").insert(
            "run-shutdown-registry-error".to_string(),
            super::RunProcess {
                summary: RunSummary {
                    run_id: "run-shutdown-registry-error".to_string(),
                    repo_path: "/tmp/repo".to_string(),
                    task_id: "task-1".to_string(),
                    branch: "odt/task-1".to_string(),
                    worktree_path: "/tmp/worktree".to_string(),
                    port: 1,
                    state: RunState::Running,
                    last_message: None,
                    started_at: "2026-02-20T12:00:00Z".to_string(),
                },
                child: run_child,
                _opencode_process_guard: None,
                repo_path: "/tmp/repo".to_string(),
                task_id: "task-1".to_string(),
                worktree_path: "/tmp/worktree".to_string(),
                repo_config: RepoConfig {
                    worktree_base_path: None,
                    branch_prefix: "odt".to_string(),
                    trusted_hooks: true,
                    hooks: HookSet::default(),
                    agent_defaults: Default::default(),
                },
            },
        );

        let runtime_child = spawn_sleep_process(20);
        let runtime_pid = runtime_child.id() as i32;
        service
            .agent_runtimes
            .lock()
            .expect("runtime lock poisoned")
            .insert(
                "runtime-shutdown-registry-error".to_string(),
                super::AgentRuntimeProcess {
                    summary: AgentRuntimeSummary {
                        runtime_id: "runtime-shutdown-registry-error".to_string(),
                        repo_path: "/tmp/repo".to_string(),
                        task_id: "task-1".to_string(),
                        role: "spec".to_string(),
                        working_directory: "/tmp/repo".to_string(),
                        port: 1,
                        started_at: "2026-02-20T12:00:00Z".to_string(),
                    },
                    child: runtime_child,
                    _opencode_process_guard: None,
                    cleanup_repo_path: None,
                    cleanup_worktree_path: None,
                },
            );

        let registry_path = root.join(super::OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH);
        if let Some(parent) = registry_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(registry_path.as_path(), "{ this is not valid json")?;

        let error = service
            .shutdown()
            .expect_err("shutdown should surface pending opencode cleanup failure");
        let message = error.to_string();
        assert!(message.contains("Failed terminating pending OpenCode processes"));
        assert!(service.runs.lock().expect("run lock poisoned").is_empty());
        assert!(service
            .agent_runtimes
            .lock()
            .expect("runtime lock poisoned")
            .is_empty());
        assert!(wait_for_process_exit(run_pid, Duration::from_secs(2)));
        assert!(wait_for_process_exit(runtime_pid, Duration::from_secs(2)));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn tracked_guard_drop_refcounts_prevent_pid_reuse_untracking() -> Result<()> {
        let root = unique_temp_path("guard-drop-refcount-pid-reuse");
        let registry_path = root.join(super::OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH);
        let parent_pid = 70_001;
        let child_pid = 80_001;

        super::with_locked_opencode_process_registry(registry_path.as_path(), |instances| {
            instances.push(super::OpencodeProcessRegistryInstance::with_child(
                parent_pid, child_pid,
            ));
            Ok(())
        })?;

        let tracked = Arc::new(Mutex::new(std::collections::HashMap::<u32, usize>::new()));
        tracked
            .lock()
            .expect("tracked lock poisoned")
            .insert(child_pid, 2);

        {
            let first_guard = super::TrackedOpencodeProcessGuard {
                tracked_opencode_processes: tracked.clone(),
                opencode_process_registry_path: registry_path.clone(),
                parent_pid,
                child_pid,
            };
            drop(first_guard);
        }
        assert_eq!(
            tracked
                .lock()
                .expect("tracked lock poisoned")
                .get(&child_pid)
                .copied(),
            Some(1)
        );
        let remaining_after_first = super::read_opencode_process_registry(registry_path.as_path())?;
        assert!(remaining_after_first.iter().any(|instance| {
            instance.parent_pid == parent_pid
                && instance.child_pids.iter().any(|pid| *pid == child_pid)
        }));

        {
            let second_guard = super::TrackedOpencodeProcessGuard {
                tracked_opencode_processes: tracked.clone(),
                opencode_process_registry_path: registry_path.clone(),
                parent_pid,
                child_pid,
            };
            drop(second_guard);
        }
        assert!(tracked
            .lock()
            .expect("tracked lock poisoned")
            .get(&child_pid)
            .is_none());
        assert!(super::read_opencode_process_registry(registry_path.as_path())?.is_empty());

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn startup_reconcile_terminates_orphaned_registered_opencode_processes() -> Result<()> {
        let root = unique_temp_path("startup-reconcile-orphan-opencode");
        let orphanable_opencode = root.join("opencode");
        create_orphanable_opencode(&orphanable_opencode)?;

        let spawn_command = format!(
            "\"{}\" serve --hostname 127.0.0.1 --port 54321 >/dev/null 2>&1 & echo $!",
            orphanable_opencode.display()
        );
        let output = Command::new("/bin/sh")
            .arg("-lc")
            .arg(spawn_command)
            .output()?;
        assert!(output.status.success());

        let orphan_pid = String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<u32>()
            .expect("spawned orphan pid should parse as u32");
        assert!(wait_for_orphaned_opencode_process(
            orphan_pid,
            Duration::from_secs(2)
        ));

        let registry_path = root.join(super::OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH);
        super::with_locked_opencode_process_registry(registry_path.as_path(), |instances| {
            instances.push(super::OpencodeProcessRegistryInstance::with_child(
                999_999, orphan_pid,
            ));
            Ok(())
        })?;

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (_service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );

        assert!(wait_for_process_exit(
            orphan_pid as i32,
            Duration::from_secs(2)
        ));
        assert!(super::read_opencode_process_registry(registry_path.as_path())?.is_empty());

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn startup_reconcile_keeps_non_orphan_registered_opencode_processes() -> Result<()> {
        let root = unique_temp_path("startup-reconcile-live-opencode");
        let orphanable_opencode = root.join("opencode");
        create_orphanable_opencode(&orphanable_opencode)?;
        let pid_file = root.join("live-opencode-pids.txt");
        let spawn_command = format!(
            "\"{}\" serve --hostname 127.0.0.1 --port 54322 >/dev/null 2>&1 & echo \"$$ $!\" > \"{}\"; sleep 30",
            orphanable_opencode.display(),
            pid_file.display()
        );
        let mut live_parent_process = Command::new("/bin/sh")
            .arg("-lc")
            .arg(spawn_command)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;

        assert!(wait_for_path_exists(
            pid_file.as_path(),
            Duration::from_secs(2)
        ));
        let pids = fs::read_to_string(pid_file.as_path())?;
        let mut parts = pids.split_whitespace();
        let live_parent_pid = parts
            .next()
            .ok_or_else(|| anyhow!("missing live parent pid"))?
            .parse::<u32>()
            .context("failed parsing live parent pid")?;
        let live_pid = parts
            .next()
            .ok_or_else(|| anyhow!("missing live child pid"))?
            .parse::<u32>()
            .context("failed parsing live child pid")?;
        assert!(process_is_alive(live_parent_pid as i32));
        assert!(process_is_alive(live_pid as i32));

        let registry_path = root.join(super::OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH);
        super::with_locked_opencode_process_registry(registry_path.as_path(), |instances| {
            instances.push(super::OpencodeProcessRegistryInstance::with_child(
                live_parent_pid,
                live_pid,
            ));
            Ok(())
        })?;

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (_service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
            },
            config_store,
        );

        assert!(process_is_alive(live_pid as i32));
        let remaining = super::read_opencode_process_registry(registry_path.as_path())?;
        assert!(remaining.iter().any(|instance| {
            instance.parent_pid == live_parent_pid
                && instance.child_pids.iter().any(|entry| *entry == live_pid)
        }));

        terminate_child_process(&mut live_parent_process);
        terminate_process_by_pid(live_pid);
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn helper_functions_cover_mcp_and_opencode_resolution_paths() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("helpers");
        let fake_opencode = root.join("opencode");
        create_fake_opencode(&fake_opencode)?;
        let _opencode_guard = set_env_var(
            "OPENDUCKTOR_OPENCODE_BINARY",
            fake_opencode.to_string_lossy().as_ref(),
        );

        let version = read_opencode_version(fake_opencode.to_string_lossy().as_ref());
        assert_eq!(version.as_deref(), Some("opencode-fake 0.0.1"));
        assert_eq!(
            resolve_opencode_binary_path().as_deref(),
            Some(fake_opencode.to_string_lossy().as_ref())
        );

        let _workspace_guard = set_env_var(
            "OPENDUCKTOR_WORKSPACE_ROOT",
            root.to_string_lossy().as_ref(),
        );
        let _command_guard =
            set_env_var("OPENDUCKTOR_MCP_COMMAND_JSON", "[\"mcp-bin\",\"--stdio\"]");
        let parsed = resolve_mcp_command()?;
        assert_eq!(parsed, vec!["mcp-bin".to_string(), "--stdio".to_string()]);
        assert_eq!(
            default_mcp_workspace_root()?,
            root.to_string_lossy().to_string()
        );

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn resolve_opencode_binary_path_uses_home_fallback_when_override_and_path_missing() -> Result<()>
    {
        let _env_lock = lock_env();
        let root = unique_temp_path("opencode-home-fallback");
        let home_bin = root.join(".opencode").join("bin");
        fs::create_dir_all(&home_bin)?;
        let home_opencode = home_bin.join("opencode");
        create_fake_opencode(&home_opencode)?;
        let empty_bin = root.join("empty-bin");
        fs::create_dir_all(&empty_bin)?;
        let fallback_path = format!("{}:/usr/bin:/bin", empty_bin.to_string_lossy());

        let _override_guard = set_env_var("OPENDUCKTOR_OPENCODE_BINARY", "   ");
        let _home_guard = set_env_var("HOME", root.to_string_lossy().as_ref());
        let _path_guard = set_env_var("PATH", fallback_path.as_str());

        let resolved = resolve_opencode_binary_path();
        assert_eq!(
            resolved.as_deref(),
            Some(home_opencode.to_string_lossy().as_ref())
        );
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn resolve_mcp_command_supports_cli_and_bun_fallback_modes() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("mcp-command-fallbacks");
        let cli_bin = root.join("cli-bin");
        let empty_bin = root.join("empty-bin");
        let bun_bin = root.join("bun-bin");
        fs::create_dir_all(&cli_bin)?;
        fs::create_dir_all(&empty_bin)?;
        fs::create_dir_all(&bun_bin)?;
        write_executable_script(&cli_bin.join("openducktor-mcp"), "#!/bin/sh\nexit 0\n")?;
        write_executable_script(&bun_bin.join("bun"), "#!/bin/sh\nexit 0\n")?;

        let _mcp_env_guard = remove_env_var("OPENDUCKTOR_MCP_COMMAND_JSON");

        {
            let _workspace_guard = remove_env_var("OPENDUCKTOR_WORKSPACE_ROOT");
            let path = format!("{}:/usr/bin:/bin", cli_bin.to_string_lossy());
            let _path_guard = set_env_var("PATH", path.as_str());
            let command = resolve_mcp_command()?;
            assert_eq!(command, vec!["openducktor-mcp".to_string()]);
        }

        {
            let _workspace_guard = remove_env_var("OPENDUCKTOR_WORKSPACE_ROOT");
            let path = format!("{}:/usr/bin:/bin", empty_bin.to_string_lossy());
            let _path_guard = set_env_var("PATH", path.as_str());
            let error = resolve_mcp_command().expect_err("missing mcp + bun should fail");
            assert!(error.to_string().contains("Missing MCP runner"));
        }

        let workspace_direct = root.join("workspace-direct");
        let direct_entrypoint = workspace_direct
            .join("packages")
            .join("openducktor-mcp")
            .join("src")
            .join("index.ts");
        fs::create_dir_all(
            direct_entrypoint
                .parent()
                .expect("entrypoint parent should exist"),
        )?;
        fs::write(&direct_entrypoint, "console.log('mcp');\n")?;

        {
            let path = format!("{}:/usr/bin:/bin", bun_bin.to_string_lossy());
            let _path_guard = set_env_var("PATH", path.as_str());
            let _workspace_guard = set_env_var(
                "OPENDUCKTOR_WORKSPACE_ROOT",
                workspace_direct.to_string_lossy().as_ref(),
            );
            let command = resolve_mcp_command()?;
            assert_eq!(
                command,
                vec![
                    "bun".to_string(),
                    direct_entrypoint.to_string_lossy().to_string()
                ]
            );
        }

        let workspace_filter = root.join("workspace-filter");
        fs::create_dir_all(&workspace_filter)?;
        {
            let path = format!("{}:/usr/bin:/bin", bun_bin.to_string_lossy());
            let _path_guard = set_env_var("PATH", path.as_str());
            let _workspace_guard = set_env_var(
                "OPENDUCKTOR_WORKSPACE_ROOT",
                workspace_filter.to_string_lossy().as_ref(),
            );
            let command = resolve_mcp_command()?;
            assert_eq!(
                command,
                vec![
                    "bun".to_string(),
                    "run".to_string(),
                    "--silent".to_string(),
                    "--cwd".to_string(),
                    workspace_filter.to_string_lossy().to_string(),
                    "--filter".to_string(),
                    "@openducktor/openducktor-mcp".to_string(),
                    "start".to_string(),
                ]
            );
        }

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn parse_mcp_command_json_accepts_non_empty_string_array() {
        let parsed = parse_mcp_command_json(r#"["openducktor-mcp","--repo","/tmp/repo"]"#)
            .expect("command should parse");
        assert_eq!(
            parsed,
            vec![
                "openducktor-mcp".to_string(),
                "--repo".to_string(),
                "/tmp/repo".to_string()
            ]
        );
    }

    #[test]
    fn parse_mcp_command_json_rejects_invalid_payloads() {
        assert!(parse_mcp_command_json("{}").is_err());
        assert!(parse_mcp_command_json("[]").is_err());
        assert!(parse_mcp_command_json(r#"["openducktor-mcp",""]"#).is_err());
    }

    #[test]
    fn parse_mcp_command_json_trims_entries() {
        let parsed = parse_mcp_command_json(r#"["  openducktor-mcp  "," --repo "," /tmp/repo "]"#)
            .expect("command should parse");
        assert_eq!(
            parsed,
            vec![
                "openducktor-mcp".to_string(),
                "--repo".to_string(),
                "/tmp/repo".to_string()
            ]
        );
    }

    #[test]
    fn build_opencode_config_content_embeds_mcp_command_and_env() {
        let previous = std::env::var("OPENDUCKTOR_MCP_COMMAND_JSON").ok();
        std::env::set_var(
            "OPENDUCKTOR_MCP_COMMAND_JSON",
            r#"["/usr/local/bin/openducktor-mcp","--stdio"]"#,
        );

        let config = build_opencode_config_content(Path::new("/tmp/openducktor-repo"), "odt-ns")
            .expect("config should serialize");

        match previous {
            Some(value) => std::env::set_var("OPENDUCKTOR_MCP_COMMAND_JSON", value),
            None => std::env::remove_var("OPENDUCKTOR_MCP_COMMAND_JSON"),
        }

        let parsed: Value = serde_json::from_str(&config).expect("valid json");
        assert_eq!(parsed["logLevel"].as_str(), Some("INFO"));
        let command = parsed["mcp"]["openducktor"]["command"]
            .as_array()
            .expect("command array")
            .iter()
            .filter_map(|entry| entry.as_str())
            .collect::<Vec<_>>();
        assert_eq!(command, vec!["/usr/local/bin/openducktor-mcp", "--stdio"]);

        let env = &parsed["mcp"]["openducktor"]["environment"];
        assert_eq!(env["ODT_REPO_PATH"].as_str(), Some("/tmp/openducktor-repo"));
        assert_eq!(env["ODT_METADATA_NAMESPACE"].as_str(), Some("odt-ns"));
        assert!(env["ODT_BEADS_DIR"].as_str().is_some());
    }
}
