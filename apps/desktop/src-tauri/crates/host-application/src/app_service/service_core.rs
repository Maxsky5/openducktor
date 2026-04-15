use super::process_registry::TrackedOpencodeProcessGuard;
use super::runtime_registry::AppRuntimeRegistry;
use super::startup_metrics::OpencodeStartupMetrics;
use super::workspace_policy::HookTrustChallenge;
use super::*;
use host_domain::{
    now_rfc3339, AgentRuntimeKind, RepoRuntimeHealthCheck, RepoRuntimeStartupFailureKind,
    RepoRuntimeStartupStage, RepoRuntimeStartupStatus, SystemOpenInToolInfo,
};

pub type RunEmitter = Arc<dyn Fn(RunEvent) + Send + Sync + 'static>;
pub type DevServerEmitter = Arc<dyn Fn(DevServerEvent) + Send + Sync + 'static>;

pub(super) struct RuntimeEnsureFlight {
    pub(super) state: Mutex<RuntimeEnsureFlightState>,
    pub(super) condvar: Condvar,
}

pub(super) enum RuntimeEnsureFlightState {
    Starting,
    Finished(Box<Result<RuntimeInstanceSummary, String>>),
}

#[derive(Debug, Clone)]
pub(super) struct RuntimeStartupStatusEntry {
    pub(super) runtime_kind: AgentRuntimeKind,
    pub(super) repo_path: String,
    pub(super) stage: RepoRuntimeStartupStage,
    pub(super) runtime: Option<RuntimeInstanceSummary>,
    pub(super) started_at: Option<String>,
    pub(super) started_at_instant: Option<Instant>,
    pub(super) updated_at: String,
    pub(super) elapsed_ms: Option<u64>,
    pub(super) attempts: Option<u32>,
    pub(super) failure_kind: Option<RepoRuntimeStartupFailureKind>,
    pub(super) failure_reason: Option<String>,
    pub(super) detail: Option<String>,
}

impl RuntimeStartupStatusEntry {
    pub(super) fn new(
        runtime_kind: AgentRuntimeKind,
        repo_path: String,
        stage: RepoRuntimeStartupStage,
    ) -> Self {
        let now = now_rfc3339();
        Self {
            runtime_kind,
            repo_path,
            stage,
            runtime: None,
            started_at: None,
            started_at_instant: None,
            updated_at: now,
            elapsed_ms: None,
            attempts: None,
            failure_kind: None,
            failure_reason: None,
            detail: None,
        }
    }

    pub(super) fn to_public_status(&self) -> RepoRuntimeStartupStatus {
        let elapsed_ms = self.elapsed_ms.or_else(|| {
            self.started_at_instant
                .map(|started_at| started_at.elapsed().as_millis().min(u64::MAX as u128) as u64)
        });
        RepoRuntimeStartupStatus {
            runtime_kind: self.runtime_kind.clone(),
            repo_path: self.repo_path.clone(),
            stage: self.stage,
            runtime: self.runtime.clone(),
            started_at: self.started_at.clone(),
            updated_at: self.updated_at.clone(),
            elapsed_ms,
            attempts: self.attempts,
            failure_kind: self.failure_kind,
            failure_reason: self.failure_reason.clone(),
            detail: self.detail.clone(),
        }
    }
}

impl RuntimeEnsureFlight {
    pub(super) fn new() -> Self {
        Self {
            state: Mutex::new(RuntimeEnsureFlightState::Starting),
            condvar: Condvar::new(),
        }
    }
}

pub(super) struct RepoRuntimeHealthFlight {
    pub(super) state: Mutex<RepoRuntimeHealthFlightState>,
    pub(super) condvar: Condvar,
}

pub(super) enum RepoRuntimeHealthFlightState {
    Starting,
    Finished(Box<Result<RepoRuntimeHealthCheck, String>>),
}

impl RepoRuntimeHealthFlight {
    pub(super) fn new() -> Self {
        Self {
            state: Mutex::new(RepoRuntimeHealthFlightState::Starting),
            condvar: Condvar::new(),
        }
    }
}

pub(super) struct OpencodeSessionStatusFlight {
    pub(super) state: Mutex<OpencodeSessionStatusFlightState>,
    pub(super) condvar: Condvar,
}

pub(super) enum OpencodeSessionStatusFlightState {
    Loading,
    Finished(CachedOpencodeSessionStatusProbeOutcome),
}

impl OpencodeSessionStatusFlight {
    pub(super) fn new() -> Self {
        Self {
            state: Mutex::new(OpencodeSessionStatusFlightState::Loading),
            condvar: Condvar::new(),
        }
    }
}

pub(super) struct OpencodeSessionStatusProbeLimiter {
    pub(super) active: Mutex<usize>,
    pub(super) condvar: Condvar,
    pub(super) max_concurrent: usize,
}

impl OpencodeSessionStatusProbeLimiter {
    pub(super) fn new(max_concurrent: usize) -> Self {
        Self {
            active: Mutex::new(0),
            condvar: Condvar::new(),
            max_concurrent,
        }
    }
}

#[derive(Clone)]
pub struct AppService {
    pub(super) task_store: Arc<dyn TaskStore>,
    pub(super) git_port: Arc<dyn GitPort>,
    pub(super) config_store: AppConfigStore,
    pub(super) runtime_config_store: RuntimeConfigStore,
    pub(super) runtime_registry: AppRuntimeRegistry,
    pub(super) runs: Arc<Mutex<HashMap<String, RunProcess>>>,
    pub(super) agent_runtimes: Arc<Mutex<HashMap<String, AgentRuntimeProcess>>>,
    pub(super) tracked_opencode_processes: Arc<Mutex<HashMap<u32, usize>>>,
    pub(super) runtime_ensure_flights: Arc<Mutex<HashMap<String, Arc<RuntimeEnsureFlight>>>>,
    pub(super) repo_runtime_health_flights:
        Arc<Mutex<HashMap<String, Arc<RepoRuntimeHealthFlight>>>>,
    pub(super) runtime_startup_status: Arc<Mutex<HashMap<String, RuntimeStartupStatusEntry>>>,
    pub(super) repo_runtime_health_snapshots: Arc<Mutex<HashMap<String, RepoRuntimeHealthCheck>>>,
    pub(super) opencode_session_status_cache:
        Arc<Mutex<HashMap<RuntimeSessionStatusProbeTarget, CachedOpencodeSessionStatusProbe>>>,
    pub(super) opencode_session_status_flights:
        Arc<Mutex<HashMap<RuntimeSessionStatusProbeTarget, Arc<OpencodeSessionStatusFlight>>>>,
    pub(super) opencode_session_status_probe_limiter: Arc<OpencodeSessionStatusProbeLimiter>,
    pub(super) opencode_process_registry_path: PathBuf,
    pub(super) mcp_bridge_registry_path: PathBuf,
    pub(super) instance_pid: u32,
    pub(super) initialized_repos: Arc<Mutex<HashSet<String>>>,
    pub(super) runtime_check_cache: Arc<Mutex<Option<CachedRuntimeCheck>>>,
    pub(super) open_in_tool_cache: Arc<Mutex<Option<CachedOpenInToolList>>>,
    pub(super) startup_cancel_epoch: StartupCancelEpoch,
    pub(super) startup_metrics: Arc<Mutex<OpencodeStartupMetrics>>,
    pub(super) enforce_repo_allowlist: bool,
    pub(super) hook_trust_challenges: Arc<Mutex<HashMap<String, HookTrustChallenge>>>,
    pub(super) dev_server_groups: Arc<Mutex<HashMap<String, DevServerGroupRuntime>>>,
    pub(super) mcp_bridge_process: Arc<Mutex<Option<McpBridgeProcess>>>,
}

pub(crate) struct RunProcess {
    pub(super) summary: RunSummary,
    pub(super) child: Option<Child>,
    pub(super) _runtime_process_guard: Option<TrackedOpencodeProcessGuard>,
    pub(super) repo_path: String,
    pub(super) task_id: String,
    pub(super) worktree_path: String,
    pub(super) repo_config: RepoConfig,
}

pub(crate) struct AgentRuntimeProcess {
    pub(super) summary: RuntimeInstanceSummary,
    pub(super) child: Option<Child>,
    pub(super) _runtime_process_guard: Option<TrackedOpencodeProcessGuard>,
    pub(super) cleanup_target: Option<RuntimeCleanupTarget>,
}

pub(crate) struct McpBridgeProcess {
    pub(super) base_url: String,
    pub(super) port: u16,
    pub(super) child: Child,
}

#[allow(dead_code)]
pub(crate) struct RuntimeCleanupTarget {
    pub(super) repo_path: String,
    pub(super) worktree_path: String,
}

pub(crate) struct CachedRuntimeCheck {
    pub(super) checked_at: Instant,
    pub(super) value: RuntimeCheck,
}

pub(crate) struct CachedOpenInToolList {
    pub(super) checked_at: Instant,
    pub(super) tools: Vec<SystemOpenInToolInfo>,
}

pub(crate) struct CachedOpencodeSessionStatusProbe {
    pub(super) checked_at: Instant,
    pub(super) outcome: CachedOpencodeSessionStatusProbeOutcome,
}

#[derive(Clone)]
pub(crate) enum CachedOpencodeSessionStatusProbeOutcome {
    Statuses(RuntimeSessionStatusMap),
    ActionableError(CachedOpencodeSessionStatusProbeError),
}

#[derive(Clone)]
pub(crate) enum CachedOpencodeSessionStatusProbeError {
    ProbeFailed(String),
    ProbeAborted,
}

pub(crate) struct DevServerGroupRuntime {
    pub(super) state: DevServerGroupState,
    pub(super) emitter: Option<DevServerEmitter>,
}

impl Drop for AppService {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

impl AppService {
    pub(super) const WORKSPACE_RUNTIME_ROLE: RuntimeRole = RuntimeRole::Workspace;
    pub(super) const WORKSPACE_RUNTIME_TASK_ID: &'static str = "__workspace__";

    pub fn new(task_store: Arc<dyn TaskStore>, config_store: AppConfigStore) -> Self {
        Self::with_git_port(task_store, config_store, Arc::new(GitCliPort::new()))
    }

    pub fn with_git_port(
        task_store: Arc<dyn TaskStore>,
        config_store: AppConfigStore,
        git_port: Arc<dyn GitPort>,
    ) -> Self {
        Self::with_git_port_allowlist(task_store, config_store, git_port, true)
    }

    fn with_git_port_allowlist(
        task_store: Arc<dyn TaskStore>,
        config_store: AppConfigStore,
        git_port: Arc<dyn GitPort>,
        enforce_repo_allowlist: bool,
    ) -> Self {
        Self::with_git_port_allowlist_and_runtime_registry(
            task_store,
            config_store,
            git_port,
            AppRuntimeRegistry::builtin(),
            enforce_repo_allowlist,
        )
    }

    fn with_git_port_allowlist_and_runtime_registry(
        task_store: Arc<dyn TaskStore>,
        config_store: AppConfigStore,
        git_port: Arc<dyn GitPort>,
        runtime_registry: AppRuntimeRegistry,
        enforce_repo_allowlist: bool,
    ) -> Self {
        let runtime_config_store =
            RuntimeConfigStore::from_user_settings_store_with_runtime_registry(
                &config_store,
                runtime_registry.runtime_definitions().clone(),
            );
        let opencode_process_registry_path = Self::opencode_process_registry_path(&config_store);
        let mcp_bridge_registry_path = Self::mcp_bridge_registry_path(&config_store);
        let instance_pid = std::process::id();
        let service = Self {
            task_store,
            git_port,
            config_store,
            runtime_config_store,
            runtime_registry,
            runs: Arc::new(Mutex::new(HashMap::new())),
            agent_runtimes: Arc::new(Mutex::new(HashMap::new())),
            tracked_opencode_processes: Arc::new(Mutex::new(HashMap::new())),
            runtime_ensure_flights: Arc::new(Mutex::new(HashMap::new())),
            repo_runtime_health_flights: Arc::new(Mutex::new(HashMap::new())),
            runtime_startup_status: Arc::new(Mutex::new(HashMap::new())),
            repo_runtime_health_snapshots: Arc::new(Mutex::new(HashMap::new())),
            opencode_session_status_cache: Arc::new(Mutex::new(HashMap::new())),
            opencode_session_status_flights: Arc::new(Mutex::new(HashMap::new())),
            opencode_session_status_probe_limiter: Arc::new(
                OpencodeSessionStatusProbeLimiter::new(4),
            ),
            opencode_process_registry_path,
            mcp_bridge_registry_path,
            instance_pid,
            initialized_repos: Arc::new(Mutex::new(HashSet::new())),
            runtime_check_cache: Arc::new(Mutex::new(None)),
            open_in_tool_cache: Arc::new(Mutex::new(None)),
            startup_cancel_epoch: Arc::new(AtomicU64::new(0)),
            startup_metrics: Arc::new(Mutex::new(OpencodeStartupMetrics::default())),
            enforce_repo_allowlist,
            hook_trust_challenges: Arc::new(Mutex::new(HashMap::new())),
            dev_server_groups: Arc::new(Mutex::new(HashMap::new())),
            mcp_bridge_process: Arc::new(Mutex::new(None)),
        };
        if let Err(error) = service.reconcile_opencode_process_registry_on_startup() {
            eprintln!(
                "OpenDucktor warning: failed reconciling orphan OpenCode processes at startup: {error:#}"
            );
        }
        if let Err(error) = service.reconcile_mcp_bridge_registry_on_startup() {
            eprintln!(
                "OpenDucktor warning: failed reconciling MCP bridge discovery registry at startup: {error:#}"
            );
        }
        service
    }

    #[cfg(test)]
    pub(crate) fn with_git_port_unrestricted(
        task_store: Arc<dyn TaskStore>,
        config_store: AppConfigStore,
        git_port: Arc<dyn GitPort>,
    ) -> Self {
        Self::with_git_port_allowlist(task_store, config_store, git_port, false)
    }

    #[cfg(test)]
    pub(crate) fn with_git_port_and_runtime_registry_unrestricted(
        task_store: Arc<dyn TaskStore>,
        config_store: AppConfigStore,
        git_port: Arc<dyn GitPort>,
        runtime_registry: AppRuntimeRegistry,
    ) -> Self {
        Self::with_git_port_allowlist_and_runtime_registry(
            task_store,
            config_store,
            git_port,
            runtime_registry,
            false,
        )
    }

    /// Public accessor for the git port, used by Tauri commands that need
    /// direct git operations on worktree paths (bypassing repo initialization).
    pub fn git_port(&self) -> &dyn GitPort {
        self.git_port.as_ref()
    }
}
