use anyhow::{anyhow, Context};
use host_application::{AppService, BuildResponseAction, CleanupMode, RunEmitter};
use host_domain::{
    AgentRuntimeSummary, AgentSessionDocument, CreateTaskInput, PlanSubtaskInput, RunEvent,
    RunSummary, TaskCard, TaskStatus, UpdateTaskPatch,
};
use host_infra_beads::BeadsTaskStore;
use host_infra_system::{AppConfigStore, RepoConfig};
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter, RunEvent as TauriRunEvent, State};

struct AppState {
    service: Arc<AppService>,
    startup_errors: Vec<String>,
}

const FALLBACK_TASK_METADATA_NAMESPACE: &str = "openducktor";
static TRACING_INITIALIZED: OnceLock<()> = OnceLock::new();

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
    trusted_hooks: Option<bool>,
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

#[tauri::command]
async fn system_check(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<host_domain::SystemCheck, String> {
    as_error(state.service.system_check(&repo_path))
}

#[tauri::command]
async fn runtime_check(
    state: State<'_, AppState>,
    force: Option<bool>,
) -> Result<host_domain::RuntimeCheck, String> {
    let check = as_error(
        state
            .service
            .runtime_check_with_refresh(force.unwrap_or(false)),
    )?;
    Ok(extend_runtime_errors_with_startup(
        check,
        &state.startup_errors,
    ))
}

#[tauri::command]
async fn beads_check(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<host_domain::BeadsCheck, String> {
    as_error(state.service.beads_check(&repo_path))
}

#[tauri::command]
async fn workspace_list(
    state: State<'_, AppState>,
) -> Result<Vec<host_domain::WorkspaceRecord>, String> {
    as_error(state.service.workspace_list())
}

#[tauri::command]
async fn workspace_add(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<host_domain::WorkspaceRecord, String> {
    as_error(state.service.workspace_add(&repo_path))
}

#[tauri::command]
async fn workspace_select(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<host_domain::WorkspaceRecord, String> {
    as_error(state.service.workspace_select(&repo_path))
}

#[tauri::command]
async fn workspace_update_repo_config(
    state: State<'_, AppState>,
    repo_path: String,
    config: RepoConfigPayload,
) -> Result<host_domain::WorkspaceRecord, String> {
    let existing = as_error(state.service.workspace_get_repo_config_optional(&repo_path))?;

    let repo_config = RepoConfig {
        worktree_base_path: config.worktree_base_path.or_else(|| {
            existing
                .as_ref()
                .and_then(|entry| entry.worktree_base_path.clone())
        }),
        branch_prefix: config
            .branch_prefix
            .or_else(|| existing.as_ref().map(|entry| entry.branch_prefix.clone()))
            .unwrap_or_else(|| "obp".to_string()),
        trusted_hooks: config
            .trusted_hooks
            .or_else(|| existing.as_ref().map(|entry| entry.trusted_hooks))
            .unwrap_or(false),
        hooks: config
            .hooks
            .or_else(|| existing.as_ref().map(|entry| entry.hooks.clone()))
            .unwrap_or_default(),
        agent_defaults: config
            .agent_defaults
            .or_else(|| existing.as_ref().map(|entry| entry.agent_defaults.clone()))
            .unwrap_or_default(),
    };

    as_error(
        state
            .service
            .workspace_update_repo_config(&repo_path, repo_config),
    )
}

#[tauri::command]
async fn workspace_get_repo_config(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<host_infra_system::RepoConfig, String> {
    as_error(state.service.workspace_get_repo_config(&repo_path))
}

#[tauri::command]
async fn workspace_set_trusted_hooks(
    state: State<'_, AppState>,
    repo_path: String,
    trusted: bool,
) -> Result<host_domain::WorkspaceRecord, String> {
    as_error(
        state
            .service
            .workspace_set_trusted_hooks(&repo_path, trusted),
    )
}

#[tauri::command]
async fn git_get_branches(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<Vec<host_domain::GitBranch>, String> {
    as_error(state.service.git_get_branches(&repo_path))
}

#[tauri::command]
async fn git_get_current_branch(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<host_domain::GitCurrentBranch, String> {
    as_error(state.service.git_get_current_branch(&repo_path))
}

#[tauri::command]
async fn git_switch_branch(
    state: State<'_, AppState>,
    repo_path: String,
    branch: String,
    create: Option<bool>,
) -> Result<host_domain::GitCurrentBranch, String> {
    as_error(
        state
            .service
            .git_switch_branch(&repo_path, &branch, create.unwrap_or(false)),
    )
}

#[tauri::command]
async fn git_create_worktree(
    state: State<'_, AppState>,
    repo_path: String,
    worktree_path: String,
    branch: String,
    create_branch: Option<bool>,
) -> Result<host_domain::GitWorktreeSummary, String> {
    as_error(state.service.git_create_worktree(
        &repo_path,
        &worktree_path,
        &branch,
        create_branch.unwrap_or(false),
    ))
}

#[tauri::command]
async fn git_remove_worktree(
    state: State<'_, AppState>,
    repo_path: String,
    worktree_path: String,
    force: Option<bool>,
) -> Result<serde_json::Value, String> {
    as_error(
        state
            .service
            .git_remove_worktree(&repo_path, &worktree_path, force.unwrap_or(false))
            .map(|ok| serde_json::json!({ "ok": ok })),
    )
}

#[tauri::command]
async fn git_push_branch(
    state: State<'_, AppState>,
    repo_path: String,
    branch: String,
    remote: Option<String>,
    set_upstream: Option<bool>,
    force_with_lease: Option<bool>,
) -> Result<host_domain::GitPushSummary, String> {
    as_error(state.service.git_push_branch(
        &repo_path,
        remote.as_deref(),
        &branch,
        set_upstream.unwrap_or(false),
        force_with_lease.unwrap_or(false),
    ))
}

#[tauri::command]
async fn tasks_list(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<Vec<TaskCard>, String> {
    as_error(state.service.tasks_list(&repo_path))
}

#[tauri::command]
async fn task_create(
    state: State<'_, AppState>,
    repo_path: String,
    input: TaskCreatePayload,
) -> Result<TaskCard, String> {
    let create = CreateTaskInput {
        title: input.title,
        issue_type: input.issue_type,
        priority: input.priority,
        description: input.description,
        acceptance_criteria: input.acceptance_criteria,
        labels: input.labels,
        ai_review_enabled: input.ai_review_enabled,
        parent_id: input.parent_id,
    };
    as_error(state.service.task_create(&repo_path, create))
}

#[tauri::command]
async fn task_update(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    patch: TaskUpdatePayload,
) -> Result<TaskCard, String> {
    as_error(state.service.task_update(
        &repo_path,
        &task_id,
        UpdateTaskPatch {
            title: patch.title,
            description: patch.description,
            acceptance_criteria: patch.acceptance_criteria,
            notes: None,
            status: None,
            priority: patch.priority,
            issue_type: patch.issue_type,
            ai_review_enabled: patch.ai_review_enabled,
            labels: patch.labels,
            assignee: patch.assignee,
            parent_id: patch.parent_id,
        },
    ))
}

#[tauri::command]
async fn task_delete(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    delete_subtasks: Option<bool>,
) -> Result<serde_json::Value, String> {
    as_error(
        state
            .service
            .task_delete(&repo_path, &task_id, delete_subtasks.unwrap_or(false))
            .map(|()| serde_json::json!({ "ok": true })),
    )
}

#[tauri::command]
async fn task_transition(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    status: TaskStatus,
    reason: Option<String>,
) -> Result<TaskCard, String> {
    as_error(
        state
            .service
            .task_transition(&repo_path, &task_id, status, reason.as_deref()),
    )
}

#[tauri::command]
async fn task_defer(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    reason: Option<String>,
) -> Result<TaskCard, String> {
    as_error(
        state
            .service
            .task_defer(&repo_path, &task_id, reason.as_deref()),
    )
}

#[tauri::command]
async fn task_resume_deferred(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<TaskCard, String> {
    as_error(state.service.task_resume_deferred(&repo_path, &task_id))
}

#[tauri::command]
async fn spec_get(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<host_domain::SpecDocument, String> {
    as_error(state.service.spec_get(&repo_path, &task_id))
}

#[tauri::command]
async fn task_metadata_get(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<host_domain::TaskMetadata, String> {
    as_error(state.service.task_metadata_get(&repo_path, &task_id))
}

#[tauri::command]
async fn set_spec(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    markdown: String,
) -> Result<host_domain::SpecDocument, String> {
    as_error(state.service.set_spec(&repo_path, &task_id, &markdown))
}

#[tauri::command]
async fn spec_save_document(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    markdown: String,
) -> Result<host_domain::SpecDocument, String> {
    as_error(
        state
            .service
            .save_spec_document(&repo_path, &task_id, &markdown),
    )
}

#[tauri::command]
async fn plan_get(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<host_domain::SpecDocument, String> {
    as_error(state.service.plan_get(&repo_path, &task_id))
}

#[tauri::command]
async fn set_plan(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    input: PlanPayload,
) -> Result<host_domain::SpecDocument, String> {
    as_error(
        state
            .service
            .set_plan(&repo_path, &task_id, &input.markdown, input.subtasks),
    )
}

#[tauri::command]
async fn plan_save_document(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    markdown: String,
) -> Result<host_domain::SpecDocument, String> {
    as_error(
        state
            .service
            .save_plan_document(&repo_path, &task_id, &markdown),
    )
}

#[tauri::command]
async fn qa_get_report(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<host_domain::SpecDocument, String> {
    as_error(state.service.qa_get_report(&repo_path, &task_id))
}

#[tauri::command]
async fn qa_approved(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    input: MarkdownPayload,
) -> Result<TaskCard, String> {
    as_error(
        state
            .service
            .qa_approved(&repo_path, &task_id, &input.markdown),
    )
}

#[tauri::command]
async fn qa_rejected(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    input: MarkdownPayload,
) -> Result<TaskCard, String> {
    as_error(
        state
            .service
            .qa_rejected(&repo_path, &task_id, &input.markdown),
    )
}

#[tauri::command]
async fn build_start(
    state: State<'_, AppState>,
    app: AppHandle,
    repo_path: String,
    task_id: String,
) -> Result<RunSummary, String> {
    let service = state.service.clone();
    let emitter = run_emitter(app);
    let result = run_service_blocking("build_start", move || {
        service.build_start(&repo_path, &task_id, emitter)
    })
    .await;
    as_error(result)
}

#[tauri::command]
async fn build_respond(
    state: State<'_, AppState>,
    app: AppHandle,
    run_id: String,
    action: BuildResponseAction,
    payload: Option<String>,
) -> Result<serde_json::Value, String> {
    as_error(
        state
            .service
            .build_respond(&run_id, action, payload.as_deref(), run_emitter(app))
            .map(|ok| serde_json::json!({ "ok": ok })),
    )
}

#[tauri::command]
async fn build_stop(
    state: State<'_, AppState>,
    app: AppHandle,
    run_id: String,
) -> Result<serde_json::Value, String> {
    as_error(
        state
            .service
            .build_stop(&run_id, run_emitter(app))
            .map(|ok| serde_json::json!({ "ok": ok })),
    )
}

#[tauri::command]
async fn build_cleanup(
    state: State<'_, AppState>,
    app: AppHandle,
    run_id: String,
    mode: CleanupMode,
) -> Result<serde_json::Value, String> {
    as_error(
        state
            .service
            .build_cleanup(&run_id, mode, run_emitter(app))
            .map(|ok| serde_json::json!({ "ok": ok })),
    )
}

#[tauri::command]
async fn build_blocked(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    reason: Option<String>,
) -> Result<TaskCard, String> {
    as_error(
        state
            .service
            .build_blocked(&repo_path, &task_id, reason.as_deref()),
    )
}

#[tauri::command]
async fn build_resumed(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<TaskCard, String> {
    as_error(state.service.build_resumed(&repo_path, &task_id))
}

#[tauri::command]
async fn build_completed(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    input: Option<BuildCompletePayload>,
) -> Result<TaskCard, String> {
    as_error(state.service.build_completed(
        &repo_path,
        &task_id,
        input.as_ref().and_then(|entry| entry.summary.as_deref()),
    ))
}

#[tauri::command]
async fn human_request_changes(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    note: Option<String>,
) -> Result<TaskCard, String> {
    as_error(
        state
            .service
            .human_request_changes(&repo_path, &task_id, note.as_deref()),
    )
}

#[tauri::command]
async fn human_approve(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<TaskCard, String> {
    as_error(state.service.human_approve(&repo_path, &task_id))
}

#[tauri::command]
async fn runs_list(
    state: State<'_, AppState>,
    repo_path: Option<String>,
) -> Result<Vec<RunSummary>, String> {
    as_error(state.service.runs_list(repo_path.as_deref()))
}

#[tauri::command]
async fn opencode_runtime_list(
    state: State<'_, AppState>,
    repo_path: Option<String>,
) -> Result<Vec<AgentRuntimeSummary>, String> {
    as_error(state.service.opencode_runtime_list(repo_path.as_deref()))
}

#[tauri::command]
async fn opencode_runtime_start(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    role: String,
) -> Result<AgentRuntimeSummary, String> {
    let service = state.service.clone();
    let result = run_service_blocking("opencode_runtime_start", move || {
        service.opencode_runtime_start(&repo_path, &task_id, &role)
    })
    .await;
    as_error(result)
}

#[tauri::command]
async fn opencode_runtime_stop(
    state: State<'_, AppState>,
    runtime_id: String,
) -> Result<serde_json::Value, String> {
    as_error(
        state
            .service
            .opencode_runtime_stop(&runtime_id)
            .map(|ok| serde_json::json!({ "ok": ok })),
    )
}

#[tauri::command]
async fn opencode_repo_runtime_ensure(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<AgentRuntimeSummary, String> {
    let service = state.service.clone();
    let result = run_service_blocking("opencode_repo_runtime_ensure", move || {
        service.opencode_repo_runtime_ensure(&repo_path)
    })
    .await;
    as_error(result)
}

#[tauri::command]
async fn agent_sessions_list(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<Vec<AgentSessionDocument>, String> {
    as_error(state.service.agent_sessions_list(&repo_path, &task_id))
}

#[tauri::command]
async fn agent_session_upsert(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    session: AgentSessionDocument,
) -> Result<serde_json::Value, String> {
    as_error(
        state
            .service
            .agent_session_upsert(&repo_path, &task_id, session)
            .map(|ok| serde_json::json!({ "ok": ok })),
    )
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
        })
        .invoke_handler(tauri::generate_handler![
            system_check,
            runtime_check,
            beads_check,
            workspace_list,
            workspace_add,
            workspace_select,
            workspace_update_repo_config,
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
            agent_session_upsert
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
}
