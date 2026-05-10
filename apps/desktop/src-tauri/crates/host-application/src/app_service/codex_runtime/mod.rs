pub(crate) mod process_lifecycle;
pub(crate) mod transport;

#[cfg(test)]
pub(crate) mod test_support;

use super::{
    runtime_registry::{RuntimeHealthCheckFailure, RuntimeMcpServerStatus},
    AppService, RuntimeExternalSessionStatus, RuntimeProcessGuard, RuntimeRoute,
    RuntimeSessionStatusMap, RuntimeSessionStatusProbeError, RuntimeSessionStatusProbeOutcome,
    RuntimeSessionStatusProbeTarget, RuntimeSessionStatusProbeTargetResolution,
    RuntimeSessionStatusSnapshot, RuntimeStartupReadinessPolicy, RuntimeStartupWaitReport,
};
use anyhow::{anyhow, Result};
use host_domain::{AgentRuntimeKind, RuntimeDefinition, RuntimeHealth, RuntimeInstanceSummary};
use process_lifecycle::CODEX_ODT_TOOL_IDS;
use serde::Deserialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::Child;
use std::sync::Arc;

pub type CodexAppServerEventEmitter = Arc<dyn Fn(Value) + Send + Sync>;

#[allow(unused_imports)]
pub(crate) use process_lifecycle::{read_codex_version, resolve_codex_binary_path};

impl AppService {
    pub(crate) fn spawn_codex_app_server(
        &self,
        working_directory: &Path,
        workspace_id_for_mcp: &str,
        runtime_id: &str,
    ) -> Result<Child> {
        let codex_binary = resolve_codex_binary_path()
            .ok_or_else(|| anyhow!("codex binary not found in bundled locations or PATH"))?;
        let (host_url, host_token) = self.ensure_mcp_bridge_connection()?;
        process_lifecycle::spawn_codex_app_server_with_binary(
            codex_binary.as_str(),
            working_directory,
            workspace_id_for_mcp,
            host_url.as_str(),
            host_token.as_str(),
            runtime_id,
        )
    }

    pub(crate) fn register_codex_app_server_transport(
        &self,
        runtime_id: &str,
        transport: Arc<transport::CodexAppServerTransport>,
    ) -> Result<()> {
        let mut transports = self
            .codex_app_server_transports
            .lock()
            .map_err(|_| anyhow!("Codex app-server transport registry is poisoned"))?;
        if transports.contains_key(runtime_id) {
            return Err(anyhow!(
                "Codex app-server transport already registered for runtime {runtime_id}"
            ));
        }
        transports.insert(runtime_id.to_string(), transport);
        Ok(())
    }

    pub fn set_codex_app_server_event_emitter(
        &self,
        emitter: Option<CodexAppServerEventEmitter>,
    ) -> Result<()> {
        *self
            .codex_app_server_event_emitter
            .lock()
            .map_err(|_| anyhow!("Codex app-server event emitter is poisoned"))? = emitter;
        Ok(())
    }

    pub(crate) fn cleanup_codex_app_server_transport(&self, runtime_id: &str) -> Result<()> {
        let transport = self
            .codex_app_server_transports
            .lock()
            .map_err(|_| anyhow!("Codex app-server transport registry is poisoned"))?
            .remove(runtime_id);
        if let Some(transport) = transport {
            transport.close()?;
        }
        Ok(())
    }

    pub fn codex_app_server_request(
        &self,
        runtime_id: &str,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value> {
        self.codex_transport(runtime_id)?.request(method, params)
    }

    pub fn codex_app_server_notifications(&self, runtime_id: &str) -> Result<Vec<Value>> {
        self.codex_transport(runtime_id)?.drain_notifications()
    }

    pub fn codex_app_server_requests(&self, runtime_id: &str) -> Result<Vec<Value>> {
        self.codex_transport(runtime_id)?.drain_server_requests()
    }

    pub fn codex_app_server_respond(
        &self,
        runtime_id: &str,
        request_id: u64,
        result: Option<Value>,
        error: Option<Value>,
    ) -> Result<()> {
        self.codex_transport(runtime_id)?
            .respond_server_request(request_id, result, error)
    }

    fn codex_transport(&self, runtime_id: &str) -> Result<Arc<transport::CodexAppServerTransport>> {
        self.codex_app_server_transports
            .lock()
            .map_err(|_| anyhow!("Codex app-server transport registry is poisoned"))?
            .get(runtime_id)
            .cloned()
            .ok_or_else(|| anyhow!("Codex app-server transport not found for runtime {runtime_id}"))
    }
}

#[derive(Clone)]
pub(crate) struct CodexRuntime;

impl Default for CodexRuntime {
    fn default() -> Self {
        Self
    }
}

impl CodexRuntime {
    fn codex_runtime_definition() -> RuntimeDefinition {
        host_domain::builtin_runtime_registry()
            .definition_by_str("codex")
            .expect("builtin runtime registry should include codex")
            .clone()
    }

    fn initialize_transport(
        service: &AppService,
        runtime_id: &str,
        child: &mut Child,
    ) -> Result<()> {
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("Codex app-server child is missing stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("Codex app-server child is missing stdout"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| anyhow!("Codex app-server child is missing stderr"))?;
        let transport = transport::CodexAppServerTransport::spawn(
            runtime_id.to_string(),
            stdin,
            stdout,
            stderr,
            service
                .codex_app_server_event_emitter
                .lock()
                .map_err(|_| anyhow!("Codex app-server event emitter is poisoned"))?
                .clone(),
        )?;
        service.register_codex_app_server_transport(runtime_id, transport)?;
        Ok(())
    }

    fn handshake_transport(
        service: &AppService,
        runtime_id: &str,
        startup_policy: RuntimeStartupReadinessPolicy,
    ) -> Result<()> {
        let transport = service.codex_transport(runtime_id)?;
        transport.request_with_timeout(
            "initialize",
            Some(serde_json::json!({
                "clientInfo": {
                    "name": "openducktor",
                    "title": "OpenDucktor",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": {
                    "experimentalApi": true,
                    "optOutNotificationMethods": []
                }
            })),
            startup_policy.connect_timeout,
        )?;
        transport.notify("initialized", Some(serde_json::json!({})))?;
        Ok(())
    }

    fn load_session_statuses(
        service: &AppService,
        runtime_id: &str,
        working_directory: &str,
    ) -> Result<RuntimeSessionStatusMap> {
        let loaded_thread_ids = Self::load_loaded_thread_ids(service, runtime_id)?;
        if loaded_thread_ids.is_empty() {
            return Ok(RuntimeSessionStatusMap::new());
        }

        Self::load_thread_statuses(service, runtime_id, working_directory, &loaded_thread_ids)
    }

    fn load_loaded_thread_ids(service: &AppService, runtime_id: &str) -> Result<HashSet<String>> {
        let mut loaded_thread_ids = HashSet::new();
        let mut cursor: Option<String> = None;
        let mut seen_cursors = HashSet::new();

        loop {
            if let Some(cursor_value) = cursor.as_ref() {
                if !seen_cursors.insert(cursor_value.clone()) {
                    return Err(anyhow!(
                        "Codex thread/loaded/list returned a repeated pagination cursor"
                    ));
                }
            }

            let response = service.codex_app_server_request(
                runtime_id,
                "thread/loaded/list",
                Some(serde_json::json!({ "cursor": cursor, "limit": 100 })),
            )?;
            let response: CodexLoadedThreadListResponse = serde_json::from_value(response)
                .map_err(|error| anyhow!("Invalid Codex thread/loaded/list response: {error}"))?;
            loaded_thread_ids.extend(response.data.into_iter().map(CodexLoadedThreadEntry::id));

            cursor = response.next_cursor;
            if cursor.is_none() {
                return Ok(loaded_thread_ids);
            }
        }
    }

    fn load_thread_statuses(
        service: &AppService,
        runtime_id: &str,
        working_directory: &str,
        loaded_thread_ids: &HashSet<String>,
    ) -> Result<RuntimeSessionStatusMap> {
        let mut statuses = RuntimeSessionStatusMap::new();
        let mut cursor: Option<String> = None;
        let mut seen_cursors = HashSet::new();

        loop {
            if let Some(cursor_value) = cursor.as_ref() {
                if !seen_cursors.insert(cursor_value.clone()) {
                    return Err(anyhow!(
                        "Codex thread/list returned a repeated pagination cursor"
                    ));
                }
            }

            let response = service.codex_app_server_request(
                runtime_id,
                "thread/list",
                Some(serde_json::json!({ "cursor": cursor, "limit": 100 })),
            )?;
            let response: CodexThreadListResponse = serde_json::from_value(response)
                .map_err(|error| anyhow!("Invalid Codex thread/list response: {error}"))?;

            for thread in response.data {
                if !loaded_thread_ids.contains(thread.id.as_str()) {
                    continue;
                }
                if thread.cwd != working_directory {
                    continue;
                }
                statuses.insert(thread.id, thread.status.into_runtime_status());
            }

            cursor = response.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        Ok(statuses)
    }
}

#[derive(Debug, Deserialize)]
struct CodexLoadedThreadListResponse {
    data: Vec<CodexLoadedThreadEntry>,
    #[serde(default, rename = "nextCursor")]
    next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum CodexLoadedThreadEntry {
    Id(String),
    Object { id: String },
}

impl CodexLoadedThreadEntry {
    fn id(self) -> String {
        match self {
            Self::Id(id) | Self::Object { id } => id,
        }
    }
}

#[derive(Debug, Deserialize)]
struct CodexThreadListResponse {
    data: Vec<CodexThreadStatusEntry>,
    #[serde(default, rename = "nextCursor")]
    next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CodexThreadStatusEntry {
    id: String,
    cwd: String,
    status: CodexThreadStatus,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum CodexThreadStatus {
    #[serde(rename = "active")]
    Active,
    #[serde(rename = "idle")]
    Idle,
    #[serde(rename = "notLoaded")]
    NotLoaded,
    #[serde(rename = "stale")]
    Stale,
}

impl CodexThreadStatus {
    fn into_runtime_status(self) -> RuntimeExternalSessionStatus {
        match self {
            Self::Active => RuntimeExternalSessionStatus::Busy,
            Self::Idle | Self::NotLoaded | Self::Stale => RuntimeExternalSessionStatus::Idle,
        }
    }
}

impl crate::app_service::runtime_registry::AppRuntime for CodexRuntime {
    fn definition(&self) -> RuntimeDefinition {
        Self::codex_runtime_definition()
    }

    fn kind(&self) -> AgentRuntimeKind {
        AgentRuntimeKind::codex()
    }

    fn runtime_health(&self) -> RuntimeHealth {
        let codex_binary = resolve_codex_binary_path();
        match codex_binary {
            Some(binary) => {
                let version = read_codex_version(binary.as_str())
                    .map(|version| format!("{version} ({binary})"));
                let ok = version.is_some();
                RuntimeHealth {
                    kind: "codex".to_string(),
                    enabled: true,
                    ok,
                    version: version.clone(),
                    error: (!ok).then(|| format!("Failed reading codex --version from {binary}")),
                }
            }
            None => RuntimeHealth {
                kind: "codex".to_string(),
                enabled: true,
                ok: false,
                version: None,
                error: Some("codex not found in bundled locations or PATH".to_string()),
            },
        }
    }

    fn load_mcp_status(
        &self,
        runtime: &RuntimeInstanceSummary,
    ) -> std::result::Result<HashMap<String, RuntimeMcpServerStatus>, RuntimeHealthCheckFailure>
    {
        match &runtime.runtime_route {
            RuntimeRoute::Stdio { .. } => Ok(HashMap::from([(
                "openducktor".to_string(),
                RuntimeMcpServerStatus {
                    status: "connected".to_string(),
                    error: None,
                },
            )])),
            RuntimeRoute::LocalHttp { .. } => Err(RuntimeHealthCheckFailure::error(
                "Codex MCP status probing requires a host-managed stdio app-server runtime."
                    .to_string(),
            )),
        }
    }

    fn load_tool_ids(
        &self,
        runtime: &RuntimeInstanceSummary,
    ) -> std::result::Result<Vec<String>, RuntimeHealthCheckFailure> {
        match &runtime.runtime_route {
            RuntimeRoute::Stdio { .. } => Ok(CODEX_ODT_TOOL_IDS
                .iter()
                .map(|tool_id| (*tool_id).to_string())
                .collect()),
            RuntimeRoute::LocalHttp { .. } => Err(RuntimeHealthCheckFailure::error(
                "Codex tool probing requires a host-managed stdio app-server runtime.".to_string(),
            )),
        }
    }

    fn start_host_managed(
        &self,
        service: &AppService,
        input: &crate::app_service::runtime_orchestrator::RuntimeStartInput<'_>,
        runtime_id: &str,
        startup_policy: RuntimeStartupReadinessPolicy,
    ) -> Result<crate::app_service::runtime_registry::HostManagedRuntimeStart> {
        let mut child = service.spawn_codex_app_server(
            Path::new(input.working_directory.as_str()),
            input.workspace_id_for_mcp,
            runtime_id,
        )?;
        if let Err(error) = Self::initialize_transport(service, runtime_id, &mut child)
            .and_then(|_| Self::handshake_transport(service, runtime_id, startup_policy))
        {
            let mut final_error = error;
            if let Err(cleanup_error) = AppService::cleanup_failed_host_managed_start(
                Some(&mut child),
                input.cleanup_target.as_ref(),
            ) {
                final_error = AppService::append_runtime_cleanup_error(final_error, cleanup_error);
            }
            if let Err(cleanup_error) = service.cleanup_codex_app_server_transport(runtime_id) {
                final_error = AppService::append_runtime_cleanup_error(final_error, cleanup_error);
            }
            return Err(final_error);
        }

        Ok(
            crate::app_service::runtime_registry::HostManagedRuntimeStart {
                child,
                runtime_process_guard: RuntimeProcessGuard::new(()),
                runtime_route: RuntimeRoute::stdio(runtime_id)?,
                startup_report: RuntimeStartupWaitReport::zero(),
            },
        )
    }

    fn validate_build_session_bootstrap(&self, runtime: &RuntimeInstanceSummary) -> Result<()> {
        match &runtime.runtime_route {
            RuntimeRoute::Stdio { .. } => Ok(()),
            RuntimeRoute::LocalHttp { .. } => Err(anyhow!(
                "Codex build session startup requires a stdio runtime route"
            )),
        }
    }

    fn stop_session(
        &self,
        _runtime_route: &RuntimeRoute,
        _external_session_id: &str,
        _working_directory: &str,
    ) -> Result<()> {
        Err(anyhow!(
            "Codex app-server does not expose a supported session cancellation RPC yet"
        ))
    }

    fn session_status_probe_target(
        &self,
        runtime_route: &RuntimeRoute,
        working_directory: &str,
    ) -> Result<RuntimeSessionStatusProbeTargetResolution> {
        match runtime_route {
            RuntimeRoute::Stdio { .. } => Ok(RuntimeSessionStatusProbeTargetResolution::Target(
                RuntimeSessionStatusProbeTarget::new(
                    AgentRuntimeKind::codex(),
                    runtime_route,
                    working_directory,
                ),
            )),
            RuntimeRoute::LocalHttp { .. } => {
                Ok(RuntimeSessionStatusProbeTargetResolution::Unsupported)
            }
        }
    }

    fn probe_session_status(
        &self,
        service: &AppService,
        target: &RuntimeSessionStatusProbeTarget,
    ) -> RuntimeSessionStatusProbeOutcome {
        let runtime_id = match target.runtime_route() {
            RuntimeRoute::Stdio { identity, .. } => identity.as_str(),
            RuntimeRoute::LocalHttp { .. } => return RuntimeSessionStatusProbeOutcome::Unsupported,
        };

        match Self::load_session_statuses(service, runtime_id, target.working_directory()) {
            Ok(statuses) => RuntimeSessionStatusProbeOutcome::Snapshot(
                RuntimeSessionStatusSnapshot::from_statuses(statuses),
            ),
            Err(error) => RuntimeSessionStatusProbeOutcome::ActionableError(
                RuntimeSessionStatusProbeError::ProbeFailed(error.to_string()),
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::CodexRuntime;
    use crate::app_service::runtime_registry::AppRuntime;
    use crate::app_service::test_support::{
        build_service_with_store, create_fake_codex_app_server, create_fake_opencode,
        init_git_repo, lock_env, set_fake_codex_binary, set_fake_opencode_and_bridge_binaries,
        unique_temp_path, EnvVarGuard,
    };
    use crate::app_service::{
        AppService, RuntimeExternalSessionStatus, RuntimeSessionStatusProbeOutcome,
        RuntimeSessionStatusProbeTargetResolution,
    };
    use anyhow::Result;
    use host_domain::RuntimeRoute;
    use host_infra_system::{AgentRuntimeConfig, AppConfigStore};
    use serde_json::json;
    use std::fs;
    use std::time::{Duration, Instant};

    fn enable_codex_runtime(service: &AppService) -> Result<()> {
        let mut snapshot = service.workspace_get_settings_snapshot()?;
        snapshot
            .agent_runtimes
            .insert("codex".to_string(), AgentRuntimeConfig { enabled: true });
        service.workspace_save_settings_snapshot(snapshot)?;
        Ok(())
    }

    fn install_fake_mcp_bridge(root: &std::path::Path) -> Result<(EnvVarGuard, EnvVarGuard)> {
        let fake_bridge = root.join("opencode-bridge");
        create_fake_opencode(fake_bridge.as_path())?;
        Ok(set_fake_opencode_and_bridge_binaries(fake_bridge.as_path()))
    }

    fn codex_status_probe_target(
        runtime: &host_domain::RuntimeInstanceSummary,
        working_directory: &str,
    ) -> Result<crate::app_service::RuntimeSessionStatusProbeTarget> {
        match CodexRuntime.session_status_probe_target(&runtime.runtime_route, working_directory)? {
            RuntimeSessionStatusProbeTargetResolution::Target(target) => Ok(target),
            RuntimeSessionStatusProbeTargetResolution::Unsupported => {
                panic!("Codex stdio runtime should expose a session status target")
            }
        }
    }

    #[test]
    fn runtime_health_missing_binary_reports_codex() {
        let _env_lock = lock_env();
        let _guard = set_fake_codex_binary(std::path::Path::new("/definitely/missing/codex"));

        let health = CodexRuntime.runtime_health();

        assert_eq!(health.kind, "codex");
        assert!(!health.ok);
        assert!(health
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("codex"));
    }

    #[test]
    fn missing_binary_error_names_codex_during_startup() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("codex-runtime-missing-binary");
        fs::create_dir_all(&root)?;
        let missing_codex = root.join("missing-codex");
        let _guard = set_fake_codex_binary(missing_codex.as_path());
        let _bridge_guards = install_fake_mcp_bridge(root.as_path())?;
        assert_eq!(
            super::resolve_codex_binary_path().as_deref(),
            Some(missing_codex.to_string_lossy().as_ref())
        );
        let repo = root.join("repo");
        init_git_repo(&repo)?;
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            host_domain::GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
                revision: None,
            },
            config_store,
        );
        service.workspace_add(repo.to_string_lossy().as_ref())?;
        enable_codex_runtime(&service)?;

        let error = service
            .runtime_ensure("codex", repo.to_string_lossy().as_ref())
            .expect_err("missing codex binary should fail startup");

        assert!(error.to_string().contains("codex"));
        Ok(())
    }

    #[test]
    fn codex_runtime_starts_stdio_transport_and_records_working_directory() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("codex-runtime-startup");
        fs::create_dir_all(&root)?;
        let repo = root.join("repo");
        init_git_repo(&repo)?;

        let fake_codex = root.join("codex");
        create_fake_codex_app_server(&fake_codex)?;
        let _codex_guard = set_fake_codex_binary(fake_codex.as_path());
        let _bridge_guards = install_fake_mcp_bridge(root.as_path())?;
        let workdir_file = root.join("codex-working-directory.txt");
        let stdin_file = root.join("codex-stdin.log");
        let args_file = root.join("codex-args.log");
        let env_file = root.join("codex-env.log");
        let fake_mcp = root.join("fake odt mcp");
        let _mcp_command_guard = crate::app_service::test_support::set_env_var(
            "OPENDUCKTOR_MCP_COMMAND_JSON",
            json!([fake_mcp.to_string_lossy(), "--transport", "stdio"])
                .to_string()
                .as_str(),
        );
        let _workdir_guard = crate::app_service::test_support::set_env_var(
            "OPENDUCKTOR_TEST_CODEX_WORKDIR_FILE",
            workdir_file.to_string_lossy().as_ref(),
        );
        let _stdin_guard = crate::app_service::test_support::set_env_var(
            "OPENDUCKTOR_TEST_CODEX_STDIN_FILE",
            stdin_file.to_string_lossy().as_ref(),
        );
        let _args_guard = crate::app_service::test_support::set_env_var(
            "OPENDUCKTOR_TEST_CODEX_ARGS_FILE",
            args_file.to_string_lossy().as_ref(),
        );
        let _env_guard = crate::app_service::test_support::set_env_var(
            "OPENDUCKTOR_TEST_CODEX_ENV_FILE",
            env_file.to_string_lossy().as_ref(),
        );

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            host_domain::GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
                revision: None,
            },
            config_store,
        );
        service.workspace_add(repo.to_string_lossy().as_ref())?;
        let workspace_id_for_mcp =
            service.workspace_id_for_repo_path(repo.to_string_lossy().as_ref())?;
        enable_codex_runtime(&service)?;
        let runtime = service.runtime_ensure("codex", repo.to_string_lossy().as_ref())?;
        assert!(matches!(runtime.runtime_route, RuntimeRoute::Stdio { .. }));

        let args = fs::read_to_string(&args_file)?
            .lines()
            .map(str::to_string)
            .collect::<Vec<_>>();
        assert_eq!(args.last().map(String::as_str), Some("app-server"));
        assert_eq!(&args[0], "--config");
        assert_eq!(
            &args[1],
            format!(
                "mcp_servers.openducktor.command={}",
                serde_json::to_string(fake_mcp.to_string_lossy().as_ref())?
            )
            .as_str()
        );
        assert_eq!(&args[2], "--config");
        assert_eq!(
            &args[3],
            "mcp_servers.openducktor.args=[\"--transport\", \"stdio\"]"
        );
        assert_eq!(&args[4], "--config");
        assert_eq!(
            &args[5],
            "mcp_servers.openducktor.env_vars=[\"ODT_WORKSPACE_ID\", \"ODT_HOST_URL\", \"ODT_HOST_TOKEN\", \"ODT_FORBID_WORKSPACE_ID_INPUT\", \"ODT_ALLOWED_TOOLS\"]"
        );
        assert_eq!(&args[6], "--config");
        assert_eq!(&args[7], "mcp_servers.openducktor.enabled=true");

        let env_lines = fs::read_to_string(&env_file)?;
        assert!(env_lines.contains(format!("ODT_WORKSPACE_ID={workspace_id_for_mcp}\n").as_str()));
        assert!(env_lines.contains("ODT_HOST_URL=http://127.0.0.1:"));
        assert!(env_lines.contains("ODT_HOST_TOKEN="));
        assert!(env_lines.contains("ODT_FORBID_WORKSPACE_ID_INPUT=true\n"));
        assert!(env_lines.contains("ODT_ALLOWED_TOOLS=odt_read_task,odt_read_task_documents,odt_set_spec,odt_set_plan,odt_build_blocked,odt_build_resumed,odt_build_completed,odt_set_pull_request,odt_qa_approved,odt_qa_rejected\n"));

        let raw_workdir = fs::read_to_string(&workdir_file)?;
        let expected_workdir = fs::canonicalize(&repo)?.to_string_lossy().to_string();
        assert_eq!(raw_workdir, expected_workdir);

        let stdin_lines = fs::read_to_string(&stdin_file)?;
        assert!(stdin_lines.contains("\"method\":\"initialize\""));
        assert!(stdin_lines.contains("\"clientInfo\""));
        assert!(stdin_lines.contains("\"experimentalApi\":true"));
        assert!(stdin_lines.contains("\"method\":\"initialized\""));

        let mut notifications = Vec::new();
        for _ in 0..50 {
            notifications = service.codex_app_server_notifications(runtime.runtime_id.as_str())?;
            if !notifications.is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(notifications.len(), 1);
        assert_eq!(notifications[0]["method"], "codex/app-server/ready");

        let response = service.codex_app_server_request(
            runtime.runtime_id.as_str(),
            "model/list",
            Some(json!({ "request": "catalog" })),
        )?;
        assert_eq!(response["method"], "model/list");
        assert_eq!(response["params"]["request"], "catalog");

        let health = service.repo_runtime_health("codex", repo.to_string_lossy().as_ref())?;
        assert_eq!(health.status, host_domain::RepoRuntimeHealthState::Ready);
        let mcp = health.mcp.expect("Codex MCP health should be reported");
        assert_eq!(mcp.status, host_domain::RepoRuntimeMcpStatus::Connected);
        assert!(mcp.tool_ids.contains(&"odt_read_task".to_string()));

        assert!(service.runtime_stop(runtime.runtime_id.as_str())?);
        Ok(())
    }

    #[test]
    fn codex_session_status_probe_marks_active_loaded_thread_busy() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("codex-runtime-status-active");
        fs::create_dir_all(&root)?;
        let repo = root.join("repo");
        init_git_repo(&repo)?;

        let fake_codex = root.join("codex");
        create_fake_codex_app_server(&fake_codex)?;
        let _codex_guard = set_fake_codex_binary(fake_codex.as_path());
        let _bridge_guards = install_fake_mcp_bridge(root.as_path())?;
        let _loaded_guard = crate::app_service::test_support::set_env_var(
            "OPENDUCKTOR_TEST_CODEX_THREAD_LOADED_LIST_RESULT",
            json!({ "data": ["thread-active"] }).to_string().as_str(),
        );
        let _list_guard = crate::app_service::test_support::set_env_var(
            "OPENDUCKTOR_TEST_CODEX_THREAD_LIST_RESULT",
            json!({
                "data": [{
                    "id": "thread-active",
                    "cwd": repo.to_string_lossy(),
                    "status": { "type": "active" }
                }]
            })
            .to_string()
            .as_str(),
        );

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            host_domain::GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
                revision: None,
            },
            config_store,
        );
        service.workspace_add(repo.to_string_lossy().as_ref())?;
        enable_codex_runtime(&service)?;
        let runtime = service.runtime_ensure("codex", repo.to_string_lossy().as_ref())?;
        let target = codex_status_probe_target(&runtime, repo.to_string_lossy().as_ref())?;

        let RuntimeSessionStatusProbeOutcome::Snapshot(snapshot) =
            CodexRuntime.probe_session_status(&service, &target)
        else {
            panic!("Codex status probe should return a snapshot");
        };
        assert_eq!(
            snapshot.session_status("thread-active"),
            Some(&RuntimeExternalSessionStatus::Busy)
        );
        assert!(snapshot.has_live_session("thread-active"));

        assert!(service.runtime_stop(runtime.runtime_id.as_str())?);
        Ok(())
    }

    #[test]
    fn codex_session_status_probe_treats_not_loaded_and_stale_threads_as_idle() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("codex-runtime-status-idle");
        fs::create_dir_all(&root)?;
        let repo = root.join("repo");
        init_git_repo(&repo)?;

        let fake_codex = root.join("codex");
        create_fake_codex_app_server(&fake_codex)?;
        let _codex_guard = set_fake_codex_binary(fake_codex.as_path());
        let _bridge_guards = install_fake_mcp_bridge(root.as_path())?;
        let _loaded_guard = crate::app_service::test_support::set_env_var(
            "OPENDUCKTOR_TEST_CODEX_THREAD_LOADED_LIST_RESULT",
            json!({ "data": ["thread-not-loaded", { "id": "thread-stale" }] })
                .to_string()
                .as_str(),
        );
        let _list_guard = crate::app_service::test_support::set_env_var(
            "OPENDUCKTOR_TEST_CODEX_THREAD_LIST_RESULT",
            json!({
                "data": [
                    {
                        "id": "thread-not-loaded",
                        "cwd": repo.to_string_lossy(),
                        "status": { "type": "notLoaded" }
                    },
                    {
                        "id": "thread-stale",
                        "cwd": repo.to_string_lossy(),
                        "status": { "type": "stale" }
                    }
                ]
            })
            .to_string()
            .as_str(),
        );

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            host_domain::GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
                revision: None,
            },
            config_store,
        );
        service.workspace_add(repo.to_string_lossy().as_ref())?;
        enable_codex_runtime(&service)?;
        let runtime = service.runtime_ensure("codex", repo.to_string_lossy().as_ref())?;
        let target = codex_status_probe_target(&runtime, repo.to_string_lossy().as_ref())?;

        let RuntimeSessionStatusProbeOutcome::Snapshot(snapshot) =
            CodexRuntime.probe_session_status(&service, &target)
        else {
            panic!("Codex status probe should return a snapshot");
        };
        assert!(snapshot.has_no_live_sessions());
        assert!(!snapshot.has_live_session("thread-not-loaded"));
        assert!(!snapshot.has_live_session("thread-stale"));

        assert!(service.runtime_stop(runtime.runtime_id.as_str())?);
        Ok(())
    }

    #[test]
    fn codex_session_status_probe_fails_on_unknown_thread_status() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("codex-runtime-status-unknown");
        fs::create_dir_all(&root)?;
        let repo = root.join("repo");
        init_git_repo(&repo)?;

        let fake_codex = root.join("codex");
        create_fake_codex_app_server(&fake_codex)?;
        let _codex_guard = set_fake_codex_binary(fake_codex.as_path());
        let _bridge_guards = install_fake_mcp_bridge(root.as_path())?;
        let _loaded_guard = crate::app_service::test_support::set_env_var(
            "OPENDUCKTOR_TEST_CODEX_THREAD_LOADED_LIST_RESULT",
            json!({ "data": ["thread-unknown"] }).to_string().as_str(),
        );
        let _list_guard = crate::app_service::test_support::set_env_var(
            "OPENDUCKTOR_TEST_CODEX_THREAD_LIST_RESULT",
            json!({
                "data": [{
                    "id": "thread-unknown",
                    "cwd": repo.to_string_lossy(),
                    "status": { "type": "mystery" }
                }]
            })
            .to_string()
            .as_str(),
        );

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            host_domain::GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
                revision: None,
            },
            config_store,
        );
        service.workspace_add(repo.to_string_lossy().as_ref())?;
        enable_codex_runtime(&service)?;
        let runtime = service.runtime_ensure("codex", repo.to_string_lossy().as_ref())?;
        let target = codex_status_probe_target(&runtime, repo.to_string_lossy().as_ref())?;

        let RuntimeSessionStatusProbeOutcome::ActionableError(error) =
            CodexRuntime.probe_session_status(&service, &target)
        else {
            panic!("unknown Codex status should fail fast");
        };
        assert!(error
            .to_string()
            .contains("Invalid Codex thread/list response"));

        assert!(service.runtime_stop(runtime.runtime_id.as_str())?);
        Ok(())
    }

    #[test]
    fn codex_runtime_queues_and_responds_to_server_requests() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("codex-runtime-server-request");
        fs::create_dir_all(&root)?;
        let repo = root.join("repo");
        init_git_repo(&repo)?;

        let fake_codex = root.join("codex");
        create_fake_codex_app_server(&fake_codex)?;
        let _codex_guard = set_fake_codex_binary(fake_codex.as_path());
        let _bridge_guards = install_fake_mcp_bridge(root.as_path())?;
        let workdir_file = root.join("codex-working-directory.txt");
        let stdin_file = root.join("codex-stdin.log");
        let _workdir_guard = crate::app_service::test_support::set_env_var(
            "OPENDUCKTOR_TEST_CODEX_WORKDIR_FILE",
            workdir_file.to_string_lossy().as_ref(),
        );
        let _stdin_guard = crate::app_service::test_support::set_env_var(
            "OPENDUCKTOR_TEST_CODEX_STDIN_FILE",
            stdin_file.to_string_lossy().as_ref(),
        );
        let _request_method_guard = crate::app_service::test_support::set_env_var(
            "OPENDUCKTOR_TEST_CODEX_SERVER_REQUEST_METHOD",
            "item/tool/call",
        );
        let _request_id_guard = crate::app_service::test_support::set_env_var(
            "OPENDUCKTOR_TEST_CODEX_SERVER_REQUEST_ID",
            "42",
        );
        let _request_params_guard = crate::app_service::test_support::set_env_var(
            "OPENDUCKTOR_TEST_CODEX_SERVER_REQUEST_PARAMS",
            serde_json::json!({
                "threadId": "thread-1",
                "turnId": "turn-1",
                "callId": "call-1",
                "tool": "odt_read_task",
                "arguments": { "taskId": "task-1" }
            })
            .to_string()
            .as_str(),
        );

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            host_domain::GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
                revision: None,
            },
            config_store,
        );
        service.workspace_add(repo.to_string_lossy().as_ref())?;
        enable_codex_runtime(&service)?;
        let runtime = service.runtime_ensure("codex", repo.to_string_lossy().as_ref())?;

        let mut requests = Vec::new();
        for _ in 0..50 {
            requests = service.codex_app_server_requests(runtime.runtime_id.as_str())?;
            if !requests.is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0]["method"], "item/tool/call");
        assert_eq!(requests[0]["id"], 42);

        service.codex_app_server_respond(
            runtime.runtime_id.as_str(),
            42,
            Some(serde_json::json!({
                "contentItems": [{ "type": "inputText", "text": "{}" }],
                "success": true
            })),
            None,
        )?;

        let mut stdin_lines = String::new();
        for _ in 0..50 {
            stdin_lines = fs::read_to_string(&stdin_file)?;
            if stdin_lines.contains("\"result\"") {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(stdin_lines.contains("\"id\":42"));
        assert!(stdin_lines.contains("\"result\""));

        assert!(service.runtime_stop(runtime.runtime_id.as_str())?);
        Ok(())
    }

    #[test]
    fn invalid_json_from_codex_app_server_fails_fast() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("codex-runtime-invalid-json");
        fs::create_dir_all(&root)?;
        let repo = root.join("repo");
        init_git_repo(&repo)?;

        let fake_codex = root.join("codex");
        create_fake_codex_app_server(&fake_codex)?;
        let _codex_guard = set_fake_codex_binary(fake_codex.as_path());
        let _bridge_guards = install_fake_mcp_bridge(root.as_path())?;
        let _invalid_guard = crate::app_service::test_support::set_env_var(
            "OPENDUCKTOR_TEST_CODEX_INVALID_STDOUT",
            "1",
        );

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            host_domain::GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
                revision: None,
            },
            config_store,
        );
        service.workspace_add(repo.to_string_lossy().as_ref())?;
        enable_codex_runtime(&service)?;

        let error = service
            .runtime_ensure("codex", repo.to_string_lossy().as_ref())
            .expect_err("invalid stdout should fail startup");

        let error_message = error.to_string();
        assert!(!error_message.is_empty());
        Ok(())
    }

    #[test]
    fn silent_codex_app_server_startup_times_out_and_cleans_up() -> Result<()> {
        let _env_lock = lock_env();
        let root = unique_temp_path("codex-runtime-silent-startup");
        fs::create_dir_all(&root)?;
        let repo = root.join("repo");
        init_git_repo(&repo)?;

        let fake_codex = root.join("codex");
        create_fake_codex_app_server(&fake_codex)?;
        let _codex_guard = set_fake_codex_binary(fake_codex.as_path());
        let _bridge_guards = install_fake_mcp_bridge(root.as_path())?;
        let _silent_guard =
            crate::app_service::test_support::set_env_var("OPENDUCKTOR_TEST_CODEX_SILENT", "1");

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![],
            vec![],
            host_domain::GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
                revision: None,
            },
            config_store,
        );
        service.workspace_add(repo.to_string_lossy().as_ref())?;
        enable_codex_runtime(&service)?;

        let started = Instant::now();
        let error = service
            .runtime_ensure("codex", repo.to_string_lossy().as_ref())
            .expect_err("silent codex app-server should fail startup");

        let error_message = format!("{error:#}");
        assert!(
            error_message.contains("Timed out waiting for Codex app-server request initialize"),
            "unexpected error: {error_message}"
        );
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "startup timeout should be bounded"
        );
        assert!(service
            .runtime_list("codex", Some(repo.to_string_lossy().as_ref()))?
            .is_empty());
        Ok(())
    }
}
