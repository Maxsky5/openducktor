use anyhow::{anyhow, Context};
use external_task_sync::{start_task_event_relay, TaskEventRelayState, TASK_EVENT_NAME};
use host_application::{AppService, DevServerEmitter};
#[cfg(test)]
use host_domain::TaskStatus;
use host_domain::{DevServerEvent, TASK_METADATA_NAMESPACE};
use host_infra_beads::BeadsTaskStore;
use host_infra_system::{AppConfigStore, RuntimeConfigStore};
use pull_request_sync::start_pull_request_sync_loop;
use serde::Deserialize;
use std::collections::HashMap;
use std::fmt;
use std::io::IsTerminal;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
#[cfg(test)]
use std::time::SystemTime;
use tauri::{AppHandle, Emitter, Manager, RunEvent as TauriRunEvent};
use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::fmt::format::Writer;
use tracing_subscriber::fmt::{FmtContext, FormatEvent, FormatFields};
use tracing_subscriber::registry::LookupSpan;

mod commands;
mod external_task_sync;
mod headless;
#[cfg(all(feature = "cef", target_os = "macos"))]
mod macos_cef_quit;
mod pull_request_sync;
mod sse_relay;

#[cfg(feature = "cef")]
type TauriRuntime = tauri::Cef;
#[cfg(not(feature = "cef"))]
type TauriRuntime = tauri::Wry;

use commands::agent_sessions::*;
use commands::build::*;
use commands::documents::*;
use commands::filesystem::*;
use commands::git::*;
use commands::runtime::*;
use commands::system::*;
use commands::tasks::*;
use commands::workspace::*;

pub(crate) struct AppState {
    service: Arc<AppService>,
}

pub(crate) struct PullRequestSyncLoopState {
    stop_requested: Arc<AtomicBool>,
}

const ANSI_RESET: &str = "\u{001b}[0m";
const ANSI_DIM: &str = "\u{001b}[2m";
const ANSI_BLUE: &str = "\u{001b}[34m";
const ANSI_GREEN: &str = "\u{001b}[32m";
const ANSI_ORANGE: &str = "\u{001b}[33m";
const ANSI_RED: &str = "\u{001b}[31m";

static TRACING_INITIALIZED: OnceLock<()> = OnceLock::new();

struct HumanLogFormatter {
    use_ansi: bool,
}

#[derive(Default)]
struct HumanLogVisitor {
    message: Option<String>,
    fields: Vec<String>,
}

impl HumanLogFormatter {
    fn timestamp(&self) -> String {
        chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, false)
    }

    fn level(&self, level: &Level) -> String {
        let label = level.as_str();
        if !self.use_ansi {
            return label.to_string();
        }
        let color = match *level {
            Level::INFO => ANSI_BLUE,
            Level::WARN => ANSI_ORANGE,
            Level::ERROR => ANSI_RED,
            Level::DEBUG | Level::TRACE => ANSI_DIM,
        };
        format!("{color}{label}{ANSI_RESET}")
    }

    fn message(&self, level: &Level, message: String) -> String {
        if !self.use_ansi {
            return message;
        }
        let color = match *level {
            Level::WARN => Some(ANSI_ORANGE),
            Level::ERROR => Some(ANSI_RED),
            Level::INFO if is_success_log_message(message.as_str()) => Some(ANSI_GREEN),
            _ => None,
        };
        match color {
            Some(color) => format!("{color}{message}{ANSI_RESET}"),
            None => message,
        }
    }
}

impl HumanLogVisitor {
    fn record_value(&mut self, field: &Field, value: String) {
        if field.name() == "message" {
            self.message = Some(value);
            return;
        }
        self.fields.push(format!("{}={value}", field.name()));
    }
}

impl Visit for HumanLogVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        self.record_value(field, format!("{value:?}"));
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        self.record_value(field, value.to_string());
    }

    fn record_bool(&mut self, field: &Field, value: bool) {
        self.record_value(field, value.to_string());
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.record_value(field, value.to_string());
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.record_value(field, value.to_string());
    }
}

impl<S, N> FormatEvent<S, N> for HumanLogFormatter
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        _ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &Event<'_>,
    ) -> fmt::Result {
        let metadata = event.metadata();
        let mut visitor = HumanLogVisitor::default();
        event.record(&mut visitor);
        let message = visitor
            .message
            .unwrap_or_else(|| metadata.target().to_string());
        let fields = if visitor.fields.is_empty() {
            String::new()
        } else {
            format!(" ({})", visitor.fields.join(" "))
        };
        let timestamp = if self.use_ansi {
            format!("{ANSI_DIM}{}{ANSI_RESET}", self.timestamp())
        } else {
            self.timestamp()
        };
        writeln!(
            writer,
            "{timestamp}  {} {}{fields}",
            self.level(metadata.level()),
            self.message(metadata.level(), message)
        )
    }
}

fn is_success_log_message(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains(" is ready")
        || message.contains(" is listening")
        || message.contains(" stopped")
        || message.contains("shutdown complete")
        || message.contains("web is ready")
}

pub(crate) fn init_tracing_subscriber() {
    TRACING_INITIALIZED.get_or_init(|| {
        let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
        let force_color = std::env::var("FORCE_COLOR")
            .ok()
            .map(|value| {
                let trimmed = value.trim();
                !trimmed.is_empty() && trimmed != "0"
            })
            .unwrap_or(false);
        let use_ansi = std::env::var_os("NO_COLOR").is_none()
            && (force_color || std::io::stderr().is_terminal());
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(env_filter)
            .with_target(false)
            .with_ansi(use_ansi)
            .event_format(HumanLogFormatter { use_ansi })
            .finish();
        if let Err(error) = tracing::subscriber::set_global_default(subscriber) {
            eprintln!("OpenDucktor warning: failed to initialize tracing subscriber: {error:#}");
        }
    });
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskCreatePayload {
    title: String,
    issue_type: String,
    priority: i32,
    description: Option<String>,
    labels: Option<Vec<String>>,
    ai_review_enabled: Option<bool>,
    parent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskUpdatePayload {
    title: Option<String>,
    description: Option<String>,
    priority: Option<i32>,
    issue_type: Option<String>,
    ai_review_enabled: Option<bool>,
    labels: Option<Vec<String>>,
    assignee: Option<String>,
    parent_id: Option<String>,
    target_branch: Option<host_domain::GitTargetBranch>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarkdownPayload {
    markdown: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanPayload {
    markdown: String,
    subtasks: Option<Vec<PlanSubtaskPayload>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanSubtaskPayload {
    title: String,
    issue_type: Option<String>,
    priority: Option<i32>,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BuildCompletePayload {
    summary: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PullRequestContentPayload {
    title: String,
    body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskDirectMergePayload {
    merge_method: host_domain::GitMergeMethod,
    squash_commit_message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepoConfigPayload {
    default_runtime_kind: Option<String>,
    worktree_base_path: Option<String>,
    branch_prefix: Option<String>,
    default_target_branch: Option<host_infra_system::GitTargetBranch>,
    git: Option<host_infra_system::RepoGitConfig>,
    dev_servers: Option<Vec<host_infra_system::RepoDevServerScript>>,
    worktree_file_copies: Option<Vec<String>>,
    prompt_overrides: Option<host_infra_system::PromptOverrides>,
    agent_defaults: Option<host_infra_system::AgentDefaults>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepoSettingsPayload {
    default_runtime_kind: Option<String>,
    worktree_base_path: Option<String>,
    branch_prefix: Option<String>,
    default_target_branch: Option<host_infra_system::GitTargetBranch>,
    git: Option<host_infra_system::RepoGitConfig>,
    hooks: Option<host_infra_system::HookSet>,
    dev_servers: Option<Vec<host_infra_system::RepoDevServerScript>>,
    worktree_file_copies: Option<Vec<String>>,
    prompt_overrides: Option<host_infra_system::PromptOverrides>,
    agent_defaults: Option<host_infra_system::AgentDefaults>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SettingsSnapshotPayload {
    theme: String,
    git: host_infra_system::GlobalGitConfig,
    chat: host_infra_system::ChatSettings,
    kanban: host_infra_system::KanbanSettings,
    autopilot: host_infra_system::AutopilotSettings,
    workspaces: HashMap<String, host_infra_system::RepoConfig>,
    global_prompt_overrides: host_infra_system::PromptOverrides,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SettingsSnapshotResponsePayload {
    theme: String,
    git: host_infra_system::GlobalGitConfig,
    chat: host_infra_system::ChatSettings,
    kanban: host_infra_system::KanbanSettings,
    autopilot: host_infra_system::AutopilotSettings,
    workspaces: HashMap<String, host_infra_system::RepoConfig>,
    global_prompt_overrides: host_infra_system::PromptOverrides,
}

pub(crate) fn as_error<T>(result: anyhow::Result<T>) -> Result<T, String> {
    result.map_err(|error| format!("{error:#}"))
}

pub(crate) fn runtime_ensure_failure_kind(error: &anyhow::Error) -> Option<&'static str> {
    error.chain().find_map(|cause| {
        cause
            .downcast_ref::<host_application::RuntimeStartupWaitFailure>()
            .map(|failure| {
                if failure.reason().is_timeout() {
                    "timeout"
                } else {
                    "error"
                }
            })
    })
}

pub(crate) async fn run_service_blocking<T, F>(
    operation_name: &'static str,
    operation: F,
) -> anyhow::Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> anyhow::Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| anyhow!("{operation_name} worker join failure: {error}"))?
}

pub(crate) async fn run_service_blocking_tokio<T, F>(
    operation_name: &'static str,
    operation: F,
) -> anyhow::Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> anyhow::Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|error| anyhow!("{operation_name} worker join failure: {error}"))?
}

fn validate_startup_config(
    config_store: &AppConfigStore,
    runtime_config_store: &RuntimeConfigStore,
) -> anyhow::Result<()> {
    config_store.load().with_context(|| {
        format!(
            "Failed loading startup config from {}. Fix invalid JSON in this file or delete it so OpenDucktor can recreate defaults.",
            config_store.path().display()
        )
    })?;
    runtime_config_store.load().with_context(|| {
        format!(
            "Failed loading runtime config from {}. Fix invalid JSON in this file or delete it so OpenDucktor can recreate defaults.",
            runtime_config_store.path().display()
        )
    })?;
    Ok(())
}
pub(crate) fn dev_server_emitter<R: tauri::Runtime>(app: AppHandle<R>) -> DevServerEmitter {
    Arc::new(move |event: DevServerEvent| {
        let _ = app.emit("openducktor://dev-server-event", event);
    })
}

pub(crate) fn startup_phase_tracing() {
    init_tracing_subscriber();
}

pub(crate) fn startup_phase_service_bootstrap() -> anyhow::Result<Arc<AppService>> {
    let config_store = AppConfigStore::new().context("failed to initialize config store")?;
    let runtime_config_store = RuntimeConfigStore::from_user_settings_store(&config_store);
    validate_startup_config(&config_store, &runtime_config_store)?;
    let instance_pid = resolve_host_owner_pid()?;
    let task_store = Arc::new(
        BeadsTaskStore::with_metadata_namespace_config_and_owner_pid(
            TASK_METADATA_NAMESPACE,
            config_store.clone(),
            instance_pid,
        ),
    );
    let service = Arc::new(AppService::with_instance_pid(
        task_store,
        config_store,
        instance_pid,
    ));

    Ok(service)
}

fn resolve_host_owner_pid() -> anyhow::Result<u32> {
    const HOST_OWNER_PID_ENV: &str = "OPENDUCKTOR_HOST_OWNER_PID";
    match std::env::var(HOST_OWNER_PID_ENV) {
        Ok(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return Err(anyhow::anyhow!(
                    "{HOST_OWNER_PID_ENV} is set but empty; expected the owning OpenDucktor process id"
                ));
            }
            trimmed.parse::<u32>().with_context(|| {
                format!("{HOST_OWNER_PID_ENV} must be a positive process id, got {trimmed:?}")
            })
        }
        Err(std::env::VarError::NotPresent) => Ok(std::process::id()),
        Err(error) => Err(error).context(format!("failed reading {HOST_OWNER_PID_ENV}")),
    }
}

fn startup_phase_prepare_external_mcp_discovery<T>(
    value: T,
    ensure_ready: impl FnOnce(&T) -> anyhow::Result<()>,
) -> anyhow::Result<T> {
    ensure_ready(&value).context(
        "failed to initialize the local MCP bridge used for external OpenDucktor discovery",
    )?;
    Ok(value)
}

fn install_shutdown_signal_handler(
    service: Arc<AppService>,
    shutdown_requested: Arc<AtomicBool>,
    shutdown_signal: Option<Arc<tokio::sync::Notify>>,
) {
    let shutdown_service = service.clone();
    let shutdown_requested_signal = shutdown_requested.clone();
    let shutdown_signal_for_handler = shutdown_signal.clone();
    if let Err(error) = ctrlc::set_handler(move || {
        if shutdown_requested_signal.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Some(shutdown_signal) = &shutdown_signal_for_handler {
            shutdown_signal.notify_waiters();
        }
        let exit_code = match shutdown_service.shutdown() {
            Ok(()) => shutdown_exit_code(true),
            Err(error) => {
                tracing::error!(
                    target: "openducktor.startup",
                    error = %error,
                    "Signal-triggered shutdown failed"
                );
                shutdown_exit_code(false)
            }
        };
        std::process::exit(exit_code);
    }) {
        tracing::warn!(
            target: "openducktor.startup",
            error = %format!("{error:#}"),
            "Failed to install process signal handler; cleanup on SIGTERM/SIGINT may be incomplete"
        );
    }
}

pub(crate) fn startup_phase_shutdown_hooks(service: Arc<AppService>) {
    startup_phase_shutdown_hooks_with_gate(service, Arc::new(AtomicBool::new(false)), None);
}

pub(crate) fn startup_phase_shutdown_hooks_with_gate(
    service: Arc<AppService>,
    shutdown_requested: Arc<AtomicBool>,
    shutdown_signal: Option<Arc<tokio::sync::Notify>>,
) {
    install_shutdown_signal_handler(service, shutdown_requested, shutdown_signal);
}

fn startup_phase_command_registration<R: tauri::Runtime>(
    builder: tauri::Builder<R>,
) -> tauri::Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
        system_check,
        system_list_open_in_tools,
        system_open_directory_in_tool,
        open_external_url,
        runtime_check,
        beads_check,
        filesystem_list_directory,
        workspace_list,
        workspace_add,
        workspace_select,
        workspace_reorder,
        workspace_update_repo_config,
        workspace_save_repo_settings,
        workspace_update_repo_hooks,
        workspace_stage_local_attachment,
        workspace_resolve_local_attachment_path,
        workspace_get_repo_config,
        workspace_detect_github_repository,
        workspace_get_settings_snapshot,
        workspace_update_global_git_config,
        workspace_save_settings_snapshot,
        git_get_branches,
        git_get_current_branch,
        git_switch_branch,
        git_create_worktree,
        git_remove_worktree,
        git_push_branch,
        git_get_status,
        git_get_diff,
        git_commits_ahead_behind,
        git_get_worktree_status,
        git_get_worktree_status_summary,
        git_commit_all,
        git_reset_worktree_selection,
        git_fetch_remote,
        git_pull_branch,
        git_rebase_branch,
        git_rebase_abort,
        git_abort_conflict,
        tasks_list,
        task_create,
        task_update,
        task_delete,
        task_reset_implementation,
        task_reset,
        task_transition,
        task_defer,
        task_resume_deferred,
        spec_get,
        task_metadata_get,
        set_spec,
        spec_save_document,
        plan_get,
        set_plan,
        plan_save_document,
        qa_get_report,
        qa_approved,
        qa_rejected,
        build_start,
        dev_server_get_state,
        dev_server_start,
        dev_server_stop,
        dev_server_restart,
        agent_session_stop,
        build_blocked,
        build_resumed,
        build_completed,
        task_approval_context_get,
        task_direct_merge,
        task_direct_merge_complete,
        task_pull_request_upsert,
        task_pull_request_unlink,
        task_pull_request_detect,
        task_pull_request_link_merged,
        repo_pull_request_sync,
        human_request_changes,
        human_approve,
        runtime_definitions_list,
        runtime_list,
        task_worktree_get,
        runtime_stop,
        runtime_ensure,
        runtime_startup_status,
        repo_runtime_health,
        repo_runtime_health_status,
        agent_sessions_list,
        agent_sessions_list_bulk,
        agent_session_upsert,
        set_theme
    ])
}

fn startup_phase_build_tauri_app(
    service: Arc<AppService>,
) -> anyhow::Result<tauri::App<TauriRuntime>> {
    let builder = tauri::Builder::<TauriRuntime>::default();
    let setup_service = service.clone();

    #[cfg(all(feature = "cef", target_os = "macos"))]
    let builder = builder.command_line_args([
        ("--use-mock-keychain", None::<String>),
        ("--password-store", Some("basic".to_string())),
        ("--no-first-run", None::<String>),
    ]);

    let builder = builder.manage(AppState { service }).setup(move |app| {
        #[cfg(all(feature = "cef", target_os = "macos"))]
        macos_cef_quit::install(app)?;

        let stop_requested = start_task_event_relay(setup_service.clone(), app.handle().clone());
        let pull_request_sync_stop_requested =
            start_pull_request_sync_loop(setup_service.clone(), {
                let app_handle = app.handle().clone();
                move |event| {
                    if let Err(error) = app_handle.emit(TASK_EVENT_NAME, event) {
                        tracing::error!(
                            target: "openducktor.task-sync",
                            error = %error,
                            "Pull request sync loop failed to emit a desktop task event"
                        );
                    }
                }
            });
        app.manage(TaskEventRelayState { stop_requested });
        app.manage(PullRequestSyncLoopState {
            stop_requested: pull_request_sync_stop_requested,
        });
        Ok(())
    });

    startup_phase_command_registration(builder)
        .build(tauri::generate_context!())
        .context("error while building openducktor")
}

fn startup_phase_exit_shutdown_handler(
    app_service: Arc<AppService>,
) -> impl FnMut(&AppHandle<TauriRuntime>, TauriRunEvent) {
    let shutdown_started = Arc::new(AtomicBool::new(false));

    move |handle, event| {
        if let TauriRunEvent::ExitRequested { api, code, .. } = event {
            let action =
                classify_exit_request(code.is_some(), shutdown_started.load(Ordering::SeqCst));
            if action == ExitRequestAction::AllowProgrammaticExit {
                return;
            }

            api.prevent_exit();

            if action == ExitRequestAction::IgnoreRepeatedUserExit
                || shutdown_started.swap(true, Ordering::SeqCst)
            {
                return;
            }

            handle
                .state::<TaskEventRelayState>()
                .stop_requested
                .store(true, Ordering::SeqCst);
            handle
                .state::<PullRequestSyncLoopState>()
                .stop_requested
                .store(true, Ordering::SeqCst);

            for window in handle.webview_windows().into_values() {
                let _ = window.hide();
            }

            let shutdown_service = app_service.clone();
            let exit_handle = handle.clone();
            std::thread::spawn(move || {
                let exit_code =
                    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
                        shutdown_service.shutdown()
                    })) {
                        Ok(Ok(())) => shutdown_exit_code(true),
                        Ok(Err(error)) => {
                            tracing::error!(
                                target: "openducktor.desktop-shutdown",
                                error = %error,
                                "Desktop shutdown failed"
                            );
                            shutdown_exit_code(false)
                        }
                        Err(_) => {
                            tracing::error!(
                                target: "openducktor.desktop-shutdown",
                                "Desktop shutdown panicked"
                            );
                            shutdown_exit_code(false)
                        }
                    };
                exit_handle.exit(exit_code);
            });
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExitRequestAction {
    AllowProgrammaticExit,
    StartUserShutdown,
    IgnoreRepeatedUserExit,
}

fn classify_exit_request(code_present: bool, shutdown_already_started: bool) -> ExitRequestAction {
    if code_present {
        ExitRequestAction::AllowProgrammaticExit
    } else if shutdown_already_started {
        ExitRequestAction::IgnoreRepeatedUserExit
    } else {
        ExitRequestAction::StartUserShutdown
    }
}

fn shutdown_exit_code(success: bool) -> i32 {
    if success {
        0
    } else {
        1
    }
}

pub fn run() -> anyhow::Result<()> {
    startup_phase_tracing();
    let service = startup_phase_prepare_external_mcp_discovery(
        startup_phase_service_bootstrap()?,
        |service| service.ensure_external_mcp_discovery_ready(),
    )?;
    let app_service = service.clone();
    startup_phase_shutdown_hooks(app_service.clone());

    startup_phase_build_tauri_app(service)?.run(startup_phase_exit_shutdown_handler(app_service));

    Ok(())
}

pub async fn run_web_host(
    port: u16,
    frontend_origin: String,
    control_token: String,
    app_token: String,
) -> anyhow::Result<()> {
    headless::run_web_host(port, frontend_origin, control_token, app_token).await
}

pub fn validate_web_frontend_origin(origin: &str) -> anyhow::Result<String> {
    headless::validate_web_frontend_origin(origin)
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::anyhow;
    use serde_json::{json, Value};
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;

    fn unique_temp_path(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system clock should be after UNIX_EPOCH")
            .as_nanos();
        std::env::temp_dir().join(format!("openducktor-lib-tests-{prefix}-{nanos}"))
    }

    #[test]
    fn validate_startup_config_succeeds_with_valid_config() -> anyhow::Result<()> {
        let root = unique_temp_path("startup-config-valid");
        let config_path = root.join("config.json");
        let config_store = AppConfigStore::from_path(config_path);
        let runtime_store = RuntimeConfigStore::from_user_settings_store(&config_store);
        let config = host_infra_system::GlobalConfig::default();
        let runtime_config = host_infra_system::RuntimeConfig::default();
        config_store.save(&config)?;
        runtime_store.save(&runtime_config)?;

        validate_startup_config(&config_store, &runtime_store)?;
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn classify_exit_request_distinguishes_programmatic_and_user_paths() {
        assert_eq!(
            classify_exit_request(true, false),
            ExitRequestAction::AllowProgrammaticExit
        );
        assert_eq!(
            classify_exit_request(false, false),
            ExitRequestAction::StartUserShutdown
        );
        assert_eq!(
            classify_exit_request(false, true),
            ExitRequestAction::IgnoreRepeatedUserExit
        );
    }

    #[test]
    fn shutdown_exit_code_maps_success_and_failure() {
        assert_eq!(shutdown_exit_code(true), 0);
        assert_eq!(shutdown_exit_code(false), 1);
    }

    #[test]
    fn validate_startup_config_returns_actionable_error_on_config_failure() -> anyhow::Result<()> {
        let root = unique_temp_path("startup-config-invalid");
        let config_path = root.join("config.json");
        fs::create_dir_all(&root)?;
        fs::write(&config_path, "{ invalid json")?;
        fs::set_permissions(&config_path, fs::Permissions::from_mode(0o600))?;

        let config_store = AppConfigStore::from_path(config_path.clone());
        let runtime_store = RuntimeConfigStore::from_user_settings_store(&config_store);
        let error = validate_startup_config(&config_store, &runtime_store)
            .expect_err("invalid config should fail startup config validation");
        let message = format!("{error:#}");

        assert!(
            message.contains(&format!(
                "Failed loading startup config from {}",
                config_path.display()
            )),
            "error should include config path and startup context: {message}"
        );
        assert!(
            message.contains(
                "Fix invalid JSON in this file or delete it so OpenDucktor can recreate defaults"
            ),
            "error should include recovery instruction: {message}"
        );
        assert!(
            message.contains("Failed parsing config file"),
            "error should preserve parse failure context: {message}"
        );
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn validate_startup_config_returns_actionable_error_on_runtime_config_failure(
    ) -> anyhow::Result<()> {
        let root = unique_temp_path("runtime-config-invalid");
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        config_store.save(&host_infra_system::GlobalConfig::default())?;

        let runtime_path = root.join("runtime-config.json");
        fs::create_dir_all(&root)?;
        fs::write(&runtime_path, "{ invalid json")?;
        fs::set_permissions(&runtime_path, fs::Permissions::from_mode(0o600))?;
        let runtime_store = RuntimeConfigStore::from_user_settings_store(&config_store);

        let error = validate_startup_config(&config_store, &runtime_store)
            .expect_err("invalid runtime config should fail startup config validation");
        let message = format!("{error:#}");

        assert!(
            message.contains(&format!(
                "Failed loading runtime config from {}",
                runtime_path.display()
            )),
            "error should include runtime config path and startup context: {message}"
        );
        assert!(
            message.contains(
                "Fix invalid JSON in this file or delete it so OpenDucktor can recreate defaults"
            ),
            "error should include recovery instruction: {message}"
        );
        assert!(
            message.contains("Failed parsing config file"),
            "error should preserve parse failure context: {message}"
        );

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn startup_phase_prepare_external_mcp_discovery_returns_value_on_success() -> anyhow::Result<()>
    {
        let value = Arc::new("service".to_string());

        let prepared = startup_phase_prepare_external_mcp_discovery(value.clone(), |_| Ok(()))?;

        assert!(Arc::ptr_eq(&prepared, &value));
        Ok(())
    }

    #[test]
    fn startup_phase_prepare_external_mcp_discovery_adds_context_on_failure() {
        let error = startup_phase_prepare_external_mcp_discovery(Arc::new(()), |_| {
            Err(anyhow!("bridge unavailable"))
        })
        .expect_err("startup phase should fail");

        assert!(error.to_string().contains(
            "failed to initialize the local MCP bridge used for external OpenDucktor discovery",
        ));
        assert!(format!("{error:#}").contains("bridge unavailable"));
    }
    #[test]
    fn run_service_blocking_propagates_operation_error() {
        let result = tauri::async_runtime::block_on(run_service_blocking(
            "test-op",
            || -> anyhow::Result<()> { Err(anyhow!("service failure")) },
        ));
        let error = result.expect_err("service error should propagate");
        assert!(error.to_string().contains("service failure"));
    }

    #[test]
    fn run_service_blocking_maps_join_failures() {
        let result = tauri::async_runtime::block_on(run_service_blocking(
            "test-join",
            || -> anyhow::Result<()> { panic!("simulated join panic") },
        ));
        let error = result.expect_err("panic in worker should map to join failure");
        assert!(error.to_string().contains("test-join worker join failure"));
    }

    #[tokio::test]
    async fn run_service_blocking_tokio_propagates_operation_error() {
        let result = run_service_blocking_tokio("tokio-test-op", || -> anyhow::Result<()> {
            Err(anyhow!("service failure"))
        })
        .await;
        let error = result.expect_err("service error should propagate");
        assert!(error.to_string().contains("service failure"));
    }

    #[tokio::test]
    async fn run_service_blocking_tokio_maps_join_failures() {
        let result = run_service_blocking_tokio("tokio-test-join", || -> anyhow::Result<()> {
            panic!("simulated join panic")
        })
        .await;
        let error = result.expect_err("panic in worker should map to join failure");
        assert!(error
            .to_string()
            .contains("tokio-test-join worker join failure"));
    }

    #[test]
    fn task_create_payload_deserialization_surfaces_missing_required_fields() {
        let payload = json!({
            "issueType": "task",
            "priority": 2
        });

        let error = serde_json::from_value::<TaskCreatePayload>(payload)
            .expect_err("missing title should fail deserialization");
        assert!(
            error.to_string().contains("title"),
            "deserialization error should mention missing title: {error}"
        );
    }

    #[test]
    fn plan_payload_deserialization_rejects_non_array_subtasks() {
        let payload = json!({
            "markdown": "## Plan",
            "subtasks": {
                "title": "Not an array payload"
            }
        });

        let error = serde_json::from_value::<PlanPayload>(payload)
            .expect_err("non-array subtasks should fail deserialization");
        assert!(
            error.to_string().contains("expected a sequence"),
            "deserialization error should preserve serde type detail: {error}"
        );
    }

    #[test]
    fn repo_payloads_deserialize_default_target_branch_field() {
        let config_payload = json!({
            "defaultTargetBranch": {
                "remote": "origin",
                "branch": "release"
            }
        });
        let parsed_config = serde_json::from_value::<RepoConfigPayload>(config_payload)
            .expect("repo config payload should deserialize");
        assert_eq!(
            parsed_config
                .default_target_branch
                .as_ref()
                .map(host_infra_system::GitTargetBranch::canonical)
                .as_deref(),
            Some("origin/release"),
        );

        let settings_payload = json!({
            "defaultTargetBranch": {
                "remote": "origin",
                "branch": "develop"
            }
        });
        let parsed_settings = serde_json::from_value::<RepoSettingsPayload>(settings_payload)
            .expect("repo settings payload should deserialize");
        assert_eq!(
            parsed_settings
                .default_target_branch
                .as_ref()
                .map(host_infra_system::GitTargetBranch::canonical)
                .as_deref(),
            Some("origin/develop"),
        );
    }

    #[test]
    fn repo_payloads_reject_legacy_string_default_target_branch_field() {
        let error = serde_json::from_value::<RepoConfigPayload>(json!({
            "defaultTargetBranch": "origin/release"
        }))
        .expect_err("legacy string target branch should fail deserialization");
        assert!(
            error.to_string().contains("invalid type"),
            "expected serde type error, got: {error}"
        );
    }

    #[test]
    fn task_direct_merge_payload_deserializes_camel_case_fields() {
        let payload = json!({
            "mergeMethod": "squash",
            "squashCommitMessage": "feat: add Microsoft login"
        });
        let parsed = serde_json::from_value::<TaskDirectMergePayload>(payload)
            .expect("direct merge payload should deserialize");

        assert!(matches!(
            parsed.merge_method,
            host_domain::GitMergeMethod::Squash
        ));
        assert_eq!(
            parsed.squash_commit_message.as_deref(),
            Some("feat: add Microsoft login")
        );
    }

    #[test]
    fn task_direct_merge_payload_allows_missing_squash_commit_message() {
        let payload = json!({
            "mergeMethod": "merge_commit"
        });
        let parsed = serde_json::from_value::<TaskDirectMergePayload>(payload)
            .expect("direct merge payload without squash message should deserialize");

        assert!(matches!(
            parsed.merge_method,
            host_domain::GitMergeMethod::MergeCommit
        ));
        assert_eq!(parsed.squash_commit_message, None);
    }

    #[test]
    fn task_status_deserialization_rejects_unknown_status() {
        let error = serde_json::from_value::<TaskStatus>(json!("backlog"))
            .expect_err("unknown status should fail deserialization");
        assert!(
            error.to_string().contains("unknown variant"),
            "status parse error should include variant details: {error}"
        );
    }

    #[test]
    fn default_capability_permissions_are_minimal_and_shell_free() {
        let capability: Value = serde_json::from_str(include_str!("../capabilities/default.json"))
            .expect("default capability JSON should parse");
        let permissions = capability
            .get("permissions")
            .and_then(Value::as_array)
            .expect("default capability should contain permissions array");
        let expected = vec![Value::String("core:default".to_string())];

        assert_eq!(
            permissions, &expected,
            "default capability should keep exact minimum approved permissions"
        );
        assert!(
            permissions.iter().all(|entry| {
                !matches!(
                    entry,
                    Value::String(value) if value.starts_with("shell:")
                )
            }),
            "default capability must not expose shell permissions"
        );
    }
}
