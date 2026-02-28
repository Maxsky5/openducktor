use anyhow::{anyhow, Context};
use host_application::{AppService, RunEmitter};
#[cfg(test)]
use host_domain::TaskStatus;
use host_domain::{PlanSubtaskInput, RunEvent};
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
    startup_errors: Vec<String>,
    hook_trust_challenges: Mutex<HashMap<String, HookTrustChallenge>>,
}

const FALLBACK_TASK_METADATA_NAMESPACE: &str = "openducktor";
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
    subtasks: Option<Vec<PlanSubtaskInput>>,
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

fn extend_runtime_errors_with_startup(
    mut check: host_domain::RuntimeCheck,
    startup_errors: &[String],
) -> host_domain::RuntimeCheck {
    check.errors.extend(startup_errors.iter().cloned());
    check
}

fn namespace_with_startup_warning(
    namespace_result: anyhow::Result<String>,
) -> (String, Option<String>) {
    match namespace_result {
        Ok(namespace) => (namespace, None),
        Err(error) => (
            FALLBACK_TASK_METADATA_NAMESPACE.to_string(),
            Some(format!(
                "Failed to read task metadata namespace from config; using fallback namespace '{}': {error:#}",
                FALLBACK_TASK_METADATA_NAMESPACE
            )),
        ),
    }
}

fn run_emitter(app: AppHandle) -> RunEmitter {
    Arc::new(move |event: RunEvent| {
        let _ = app.emit("openducktor://run-event", event);
    })
}

fn bootstrap_service() -> anyhow::Result<(Arc<AppService>, Vec<String>)> {
    let config_store = AppConfigStore::new().context("failed to initialize config store")?;
    let mut startup_errors = Vec::new();
    let (metadata_namespace, startup_warning) =
        namespace_with_startup_warning(config_store.task_metadata_namespace());
    if let Some(message) = startup_warning {
        tracing::warn!(
            target: "openducktor.startup",
            warning = %message,
            "OpenDucktor startup warning"
        );
        startup_errors.push(message);
    }

    let task_store = Arc::new(BeadsTaskStore::with_metadata_namespace(&metadata_namespace));
    let service = Arc::new(AppService::new(task_store, config_store));

    Ok((service, startup_errors))
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

pub fn run() -> anyhow::Result<()> {
    init_tracing_subscriber();
    let (service, startup_errors) = bootstrap_service()?;
    install_shutdown_signal_handler(service.clone());

    let app_service = service.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            service,
            startup_errors,
            hook_trust_challenges: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            system_check,
            runtime_check,
            beads_check,
            workspace_list,
            workspace_add,
            workspace_select,
            workspace_update_repo_config,
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
        .build(tauri::generate_context!())
        .context("error while building openducktor")?
        .run(move |_handle, event| {
            if matches!(
                event,
                TauriRunEvent::ExitRequested { .. } | TauriRunEvent::Exit
            ) {
                let _ = app_service.shutdown();
            }
        });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::anyhow;
    use host_domain::RuntimeCheck;
    use serde_json::json;

    #[test]
    fn namespace_with_startup_warning_uses_configured_namespace() {
        let (namespace, warning) =
            namespace_with_startup_warning(Ok("custom-namespace".to_string()));

        assert_eq!(namespace, "custom-namespace");
        assert!(warning.is_none());
    }

    #[test]
    fn namespace_with_startup_warning_falls_back_and_reports_error_context() {
        let (namespace, warning) =
            namespace_with_startup_warning(Err(anyhow!("config parse failure")));

        assert_eq!(namespace, FALLBACK_TASK_METADATA_NAMESPACE);

        let warning = warning.expect("expected startup warning for fallback namespace");
        assert!(
            warning.contains("using fallback namespace 'openducktor'"),
            "warning should mention fallback namespace: {warning}"
        );
        assert!(
            warning.contains("config parse failure"),
            "warning should include original error context: {warning}"
        );
    }

    #[test]
    fn extend_runtime_errors_with_startup_appends_startup_messages() {
        let runtime = RuntimeCheck {
            git_ok: true,
            git_version: Some("git version 2.0.0".to_string()),
            opencode_ok: true,
            opencode_version: Some("1.0.0".to_string()),
            errors: vec!["runtime issue".to_string()],
        };

        let startup_errors = vec!["startup warning".to_string()];
        let updated = extend_runtime_errors_with_startup(runtime, &startup_errors);

        assert_eq!(
            updated.errors,
            vec!["runtime issue".to_string(), "startup warning".to_string()]
        );
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
    fn task_status_deserialization_rejects_unknown_status() {
        let error = serde_json::from_value::<TaskStatus>(json!("backlog"))
            .expect_err("unknown status should fail deserialization");
        assert!(
            error.to_string().contains("unknown variant"),
            "status parse error should include variant details: {error}"
        );
    }
}
