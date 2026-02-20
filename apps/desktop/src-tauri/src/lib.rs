use host_application::{AppService, RunEmitter};
use host_domain::{
    AgentRuntimeSummary, AgentSessionDocument, CreateTaskInput, PlanSubtaskInput, RunEvent,
    RunSummary, TaskCard, TaskStatus, UpdateTaskPatch,
};
use host_infra_beads::BeadsTaskStore;
use host_infra_system::{AppConfigStore, RepoConfig};
use serde::Deserialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, RunEvent as TauriRunEvent, State};

struct AppState {
    service: Arc<AppService>,
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
async fn set_spec(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    markdown: String,
) -> Result<host_domain::SpecDocument, String> {
    as_error(state.service.set_spec(&repo_path, &task_id, &markdown))
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
    as_error(
        state
            .service
            .build_start(&repo_path, &task_id, run_emitter(app)),
    )
}

#[tauri::command]
async fn build_respond(
    state: State<'_, AppState>,
    app: AppHandle,
    run_id: String,
    action: String,
    payload: Option<String>,
) -> Result<serde_json::Value, String> {
    as_error(
        state
            .service
            .build_respond(&run_id, &action, payload.as_deref(), run_emitter(app))
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
    mode: String,
) -> Result<serde_json::Value, String> {
    as_error(
        state
            .service
            .build_cleanup(&run_id, &mode, run_emitter(app))
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
    as_error(
        state
            .service
            .opencode_runtime_start(&repo_path, &task_id, &role),
    )
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
    as_error(state.service.opencode_repo_runtime_ensure(&repo_path))
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

pub fn run() {
    let config_store = AppConfigStore::new().expect("failed to initialize config store");
    let metadata_namespace = config_store
        .task_metadata_namespace()
        .expect("failed to read task metadata namespace from config");
    let task_store = Arc::new(BeadsTaskStore::with_metadata_namespace(&metadata_namespace));
    let service = Arc::new(AppService::new(task_store, config_store));

    let app_service = service.clone();
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
            task_delete,
            task_transition,
            task_defer,
            task_resume_deferred,
            spec_get,
            set_spec,
            plan_get,
            set_plan,
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
        .expect("error while building openblueprint")
        .run(move |_handle, event| {
            if matches!(
                event,
                TauriRunEvent::ExitRequested { .. } | TauriRunEvent::Exit
            ) {
                let _ = app_service.shutdown();
            }
        });
}
