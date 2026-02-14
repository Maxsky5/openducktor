use host_application::{AppService, RunEmitter};
use host_domain::{CreateTaskInput, RunEvent, RunSummary, TaskCard, TaskPhase, UpdateTaskPatch};
use host_infra_beads::BeadsTaskStore;
use host_infra_system::{AppConfigStore, RepoConfig};
use serde::Deserialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

struct AppState {
    service: Arc<AppService>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskCreatePayload {
    title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskUpdatePayload {
    title: Option<String>,
    description: Option<String>,
    status: Option<host_domain::TaskStatus>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoConfigPayload {
    worktree_base_path: Option<String>,
    branch_prefix: Option<String>,
    trusted_hooks: Option<bool>,
    hooks: Option<host_infra_system::HookSet>,
}

fn as_error<T>(result: anyhow::Result<T>) -> Result<T, String> {
    result.map_err(|error| error.to_string())
}

fn run_emitter(app: AppHandle) -> RunEmitter {
    Arc::new(move |event: RunEvent| {
        let _ = app.emit("openblueprint://run-event", event);
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
async fn runtime_check(state: State<'_, AppState>) -> Result<host_domain::RuntimeCheck, String> {
    as_error(state.service.runtime_check())
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
        worktree_base_path: config
            .worktree_base_path
            .or_else(|| existing.as_ref().and_then(|entry| entry.worktree_base_path.clone())),
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
    let create = CreateTaskInput { title: input.title };
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
            status: patch.status,
        },
    ))
}

#[tauri::command]
async fn task_set_phase(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    phase: TaskPhase,
    reason: Option<String>,
) -> Result<TaskCard, String> {
    as_error(
        state
            .service
            .task_set_phase(&repo_path, &task_id, phase, reason.as_deref()),
    )
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
async fn spec_set_markdown(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    markdown: String,
) -> Result<host_domain::SpecDocument, String> {
    as_error(
        state
            .service
            .spec_set_markdown(&repo_path, &task_id, &markdown),
    )
}

#[tauri::command]
async fn delegate_start(
    state: State<'_, AppState>,
    app: AppHandle,
    repo_path: String,
    task_id: String,
) -> Result<RunSummary, String> {
    as_error(
        state
            .service
            .delegate_start(&repo_path, &task_id, run_emitter(app)),
    )
}

#[tauri::command]
async fn delegate_respond(
    state: State<'_, AppState>,
    app: AppHandle,
    run_id: String,
    action: String,
    payload: Option<String>,
) -> Result<serde_json::Value, String> {
    as_error(
        state
            .service
            .delegate_respond(&run_id, &action, payload.as_deref(), run_emitter(app))
            .map(|ok| serde_json::json!({ "ok": ok })),
    )
}

#[tauri::command]
async fn delegate_stop(
    state: State<'_, AppState>,
    app: AppHandle,
    run_id: String,
) -> Result<serde_json::Value, String> {
    as_error(
        state
            .service
            .delegate_stop(&run_id, run_emitter(app))
            .map(|ok| serde_json::json!({ "ok": ok })),
    )
}

#[tauri::command]
async fn delegate_cleanup(
    state: State<'_, AppState>,
    app: AppHandle,
    run_id: String,
    mode: String,
) -> Result<serde_json::Value, String> {
    as_error(
        state
            .service
            .delegate_cleanup(&run_id, &mode, run_emitter(app))
            .map(|ok| serde_json::json!({ "ok": ok })),
    )
}

#[tauri::command]
async fn runs_list(
    state: State<'_, AppState>,
    repo_path: Option<String>,
) -> Result<Vec<RunSummary>, String> {
    as_error(state.service.runs_list(repo_path.as_deref()))
}

pub fn run() {
    let task_store = Arc::new(BeadsTaskStore::new());
    let config_store = AppConfigStore::new().expect("failed to initialize config store");
    let service = Arc::new(AppService::new(task_store, config_store));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState { service })
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
            tasks_list,
            task_create,
            task_update,
            task_set_phase,
            spec_get,
            spec_set_markdown,
            delegate_start,
            delegate_respond,
            delegate_stop,
            delegate_cleanup,
            runs_list
        ])
        .run(tauri::generate_context!())
        .expect("error while running openblueprint");
}
