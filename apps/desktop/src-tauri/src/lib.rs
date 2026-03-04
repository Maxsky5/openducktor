use anyhow::{anyhow, Context};
use host_application::{AppService, RunEmitter};
#[cfg(test)]
use host_domain::TaskStatus;
use host_domain::{RunEvent, TASK_METADATA_NAMESPACE};
use host_infra_beads::BeadsTaskStore;
use host_infra_system::AppConfigStore;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, RunEvent as TauriRunEvent};

mod commands;

use commands::agent_sessions::*;
use commands::build::*;
use commands::documents::*;
use commands::git::*;
use commands::runtime::*;
use commands::tasks::*;
use commands::workspace::*;

struct AppState {
    service: Arc<AppService>,
    hook_trust_challenges: Mutex<HashMap<String, HookTrustChallenge>>,
    #[cfg(test)]
    hook_trust_dialog_test_response: Mutex<Option<bool>>,
}

const HOOK_TRUST_CHALLENGE_TTL: Duration = Duration::from_secs(120);
static TRACING_INITIALIZED: OnceLock<()> = OnceLock::new();

#[derive(Debug, Clone)]
struct HookTrustChallenge {
    repo_path: String,
    fingerprint: String,
    expires_at: SystemTime,
}

fn init_tracing_subscriber() {
    TRACING_INITIALIZED.get_or_init(|| {
        let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(env_filter)
            .with_target(true)
            .with_ansi(false)
            .json()
            .flatten_event(true)
            .with_current_span(false)
            .with_span_list(false)
            .finish();
        if let Err(error) = tracing::subscriber::set_global_default(subscriber) {
            eprintln!("OpenDucktor warning: failed to initialize tracing subscriber: {error:#}");
        }
    });
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskCreatePayload {
    title: String,
    issue_type: String,
    priority: i32,
    description: Option<String>,
    acceptance_criteria: Option<String>,
    labels: Option<Vec<String>>,
    ai_review_enabled: Option<bool>,
    parent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskUpdatePayload {
    title: Option<String>,
    description: Option<String>,
    acceptance_criteria: Option<String>,
    priority: Option<i32>,
    issue_type: Option<String>,
    ai_review_enabled: Option<bool>,
    labels: Option<Vec<String>>,
    assignee: Option<String>,
    parent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownPayload {
    markdown: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanPayload {
    markdown: String,
    subtasks: Option<Vec<PlanSubtaskPayload>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanSubtaskPayload {
    title: String,
    issue_type: Option<String>,
    priority: Option<i32>,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildCompletePayload {
    summary: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoConfigPayload {
    worktree_base_path: Option<String>,
    branch_prefix: Option<String>,
    default_target_branch: Option<String>,
    agent_defaults: Option<host_infra_system::AgentDefaults>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoSettingsPayload {
    worktree_base_path: Option<String>,
    branch_prefix: Option<String>,
    default_target_branch: Option<String>,
    trusted_hooks: bool,
    hooks: Option<host_infra_system::HookSet>,
    agent_defaults: Option<host_infra_system::AgentDefaults>,
}

fn as_error<T>(result: anyhow::Result<T>) -> Result<T, String> {
    result.map_err(|error| format!("{error:#}"))
}

async fn run_service_blocking<T, F>(operation_name: &'static str, operation: F) -> anyhow::Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> anyhow::Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| anyhow!("{operation_name} worker join failure: {error}"))?
}

fn validate_startup_config(config_store: &AppConfigStore) -> anyhow::Result<()> {
    config_store.load().with_context(|| {
        format!(
            "Failed loading startup config from {}. Fix invalid JSON in this file or delete it so OpenDucktor can recreate defaults.",
            config_store.path().display()
        )
    })?;
    Ok(())
}
fn run_emitter(app: AppHandle) -> RunEmitter {
    Arc::new(move |event: RunEvent| {
        let _ = app.emit("openducktor://run-event", event);
    })
}

fn startup_phase_tracing() {
    init_tracing_subscriber();
}

fn startup_phase_service_bootstrap() -> anyhow::Result<Arc<AppService>> {
    let config_store = AppConfigStore::new().context("failed to initialize config store")?;
    validate_startup_config(&config_store)?;
    let task_store = Arc::new(BeadsTaskStore::with_metadata_namespace(
        TASK_METADATA_NAMESPACE,
    ));
    let service = Arc::new(AppService::new(task_store, config_store));

    Ok(service)
}

fn install_shutdown_signal_handler(service: Arc<AppService>) {
    let shutdown_requested = Arc::new(AtomicBool::new(false));
    let shutdown_service = service.clone();
    let shutdown_requested_signal = shutdown_requested.clone();
    if let Err(error) = ctrlc::set_handler(move || {
        if shutdown_requested_signal.swap(true, Ordering::SeqCst) {
            return;
        }
        let _ = shutdown_service.shutdown();
        std::process::exit(0);
    }) {
        tracing::warn!(
            target: "openducktor.startup",
            error = %format!("{error:#}"),
            "Failed to install process signal handler; cleanup on SIGTERM/SIGINT may be incomplete"
        );
    }
}

fn startup_phase_shutdown_hooks(service: Arc<AppService>) {
    install_shutdown_signal_handler(service);
}

fn startup_phase_command_registration(
    builder: tauri::Builder<tauri::Wry>,
) -> tauri::Builder<tauri::Wry> {
    builder.invoke_handler(tauri::generate_handler![
        system_check,
        runtime_check,
        beads_check,
        workspace_list,
        workspace_add,
        workspace_select,
        workspace_update_repo_config,
        workspace_save_repo_settings,
        workspace_update_repo_hooks,
        workspace_prepare_trusted_hooks_challenge,
        workspace_get_repo_config,
        workspace_set_trusted_hooks,
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
        git_commit_all,
        git_pull_branch,
        git_rebase_branch,
        tasks_list,
        task_create,
        task_update,
        task_delete,
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
        build_respond,
        build_stop,
        build_cleanup,
        build_blocked,
        build_resumed,
        build_completed,
        human_request_changes,
        human_approve,
        runs_list,
        opencode_runtime_list,
        opencode_runtime_start,
        opencode_runtime_stop,
        opencode_repo_runtime_ensure,
        agent_sessions_list,
        agent_session_upsert,
        get_theme,
        set_theme
    ])
}

fn startup_phase_build_tauri_app(
    service: Arc<AppService>,
) -> anyhow::Result<tauri::App<tauri::Wry>> {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            service,
            hook_trust_challenges: Mutex::new(HashMap::new()),
            #[cfg(test)]
            hook_trust_dialog_test_response: Mutex::new(None),
        });

    startup_phase_command_registration(builder)
        .build(tauri::generate_context!())
        .context("error while building openducktor")
}

fn startup_phase_exit_shutdown_handler(
    app_service: Arc<AppService>,
) -> impl FnMut(&AppHandle, TauriRunEvent) {
    move |_handle, event| {
        if matches!(
            event,
            TauriRunEvent::ExitRequested { .. } | TauriRunEvent::Exit
        ) {
            let _ = app_service.shutdown();
        }
    }
}

pub fn run() -> anyhow::Result<()> {
    startup_phase_tracing();
    let service = startup_phase_service_bootstrap()?;
    let app_service = service.clone();
    startup_phase_shutdown_hooks(app_service.clone());

    startup_phase_build_tauri_app(service)?.run(startup_phase_exit_shutdown_handler(app_service));

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::anyhow;
    use serde_json::{json, Value};
    use std::fs;
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
        let config = host_infra_system::GlobalConfig::default();
        config_store.save(&config)?;

        validate_startup_config(&config_store)?;
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn validate_startup_config_returns_actionable_error_on_config_failure() -> anyhow::Result<()> {
        let root = unique_temp_path("startup-config-invalid");
        let config_path = root.join("config.json");
        fs::create_dir_all(&root)?;
        fs::write(&config_path, "{ invalid json")?;

        let config_store = AppConfigStore::from_path(config_path.clone());
        let error = validate_startup_config(&config_store)
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
            "defaultTargetBranch": "origin/release"
        });
        let parsed_config = serde_json::from_value::<RepoConfigPayload>(config_payload)
            .expect("repo config payload should deserialize");
        assert_eq!(
            parsed_config.default_target_branch.as_deref(),
            Some("origin/release")
        );

        let settings_payload = json!({
            "trustedHooks": false,
            "defaultTargetBranch": "origin/develop"
        });
        let parsed_settings = serde_json::from_value::<RepoSettingsPayload>(settings_payload)
            .expect("repo settings payload should deserialize");
        assert_eq!(
            parsed_settings.default_target_branch.as_deref(),
            Some("origin/develop")
        );
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
        let expected = vec![
            Value::String("core:default".to_string()),
            Value::String("dialog:allow-open".to_string()),
        ];

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
