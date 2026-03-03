use super::process_registry::TrackedOpencodeProcessGuard;
use super::startup_metrics::OpencodeStartupMetrics;
use super::*;

pub type RunEmitter = Arc<dyn Fn(RunEvent) + Send + Sync + 'static>;

#[derive(Clone)]
pub struct AppService {
    pub(super) task_store: Arc<dyn TaskStore>,
    pub(super) git_port: Arc<dyn GitPort>,
    pub(super) config_store: AppConfigStore,
    pub(super) runs: Arc<Mutex<HashMap<String, RunProcess>>>,
    pub(super) agent_runtimes: Arc<Mutex<HashMap<String, AgentRuntimeProcess>>>,
    pub(super) tracked_opencode_processes: Arc<Mutex<HashMap<u32, usize>>>,
    pub(super) opencode_process_registry_path: PathBuf,
    pub(super) instance_pid: u32,
    pub(super) initialized_repos: Arc<Mutex<HashSet<String>>>,
    pub(super) runtime_check_cache: Arc<Mutex<Option<CachedRuntimeCheck>>>,
    pub(super) startup_cancel_epoch: StartupCancelEpoch,
    pub(super) startup_metrics: Arc<Mutex<OpencodeStartupMetrics>>,
    pub(super) enforce_repo_allowlist: bool,
}

pub(crate) struct RunProcess {
    pub(super) summary: RunSummary,
    pub(super) child: Child,
    pub(super) _opencode_process_guard: Option<TrackedOpencodeProcessGuard>,
    pub(super) repo_path: String,
    pub(super) task_id: String,
    pub(super) worktree_path: String,
    pub(super) repo_config: RepoConfig,
}

pub(crate) struct AgentRuntimeProcess {
    pub(super) summary: AgentRuntimeSummary,
    pub(super) child: Child,
    pub(super) _opencode_process_guard: Option<TrackedOpencodeProcessGuard>,
    pub(super) cleanup_target: Option<RuntimeCleanupTarget>,
}

pub(crate) struct RuntimeCleanupTarget {
    pub(super) repo_path: String,
    pub(super) worktree_path: String,
}

pub(crate) struct CachedRuntimeCheck {
    pub(super) checked_at: Instant,
    pub(super) value: RuntimeCheck,
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
            enforce_repo_allowlist,
        };
        if let Err(error) = service.reconcile_opencode_process_registry_on_startup() {
            eprintln!(
                "OpenDucktor warning: failed reconciling orphan OpenCode processes at startup: {error:#}"
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

    /// Public accessor for the git port, used by Tauri commands that need
    /// direct git operations on worktree paths (bypassing repo initialization).
    pub fn git_port(&self) -> &dyn GitPort {
        self.git_port.as_ref()
    }
}
