use crate::{
    as_error, run_emitter, run_service_blocking, AppState, BuildCompletePayload,
    PullRequestContentPayload,
};
use host_application::{BuildResponseAction, CleanupMode};
use host_domain::{
    AgentRuntimeKind, GitMergeMethod, PullRequestRecord, RunSummary, TaskApprovalContext, TaskCard,
};
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn build_start(
    state: State<'_, AppState>,
    app: AppHandle,
    repo_path: String,
    task_id: String,
    runtime_kind: AgentRuntimeKind,
) -> Result<RunSummary, String> {
    let service = state.service.clone();
    let emitter = run_emitter(app);
    let result = run_service_blocking("build_start", move || {
        service.build_start(&repo_path, &task_id, runtime_kind.as_str(), emitter)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn build_respond(
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
pub async fn build_stop(
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
pub async fn build_cleanup(
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
pub async fn build_blocked(
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
pub async fn build_resumed(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<TaskCard, String> {
    as_error(state.service.build_resumed(&repo_path, &task_id))
}

#[tauri::command]
pub async fn build_completed(
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
pub async fn task_approval_context_get(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<TaskApprovalContext, String> {
    as_error(
        state
            .service
            .task_approval_context_get(&repo_path, &task_id),
    )
}

#[tauri::command]
pub async fn task_direct_merge(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    merge_method: GitMergeMethod,
) -> Result<TaskCard, String> {
    as_error(
        state
            .service
            .task_direct_merge(&repo_path, &task_id, merge_method),
    )
}

#[tauri::command]
pub async fn task_pull_request_upsert(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    input: PullRequestContentPayload,
) -> Result<PullRequestRecord, String> {
    as_error(state.service.task_pull_request_upsert(
        &repo_path,
        &task_id,
        &input.title,
        &input.body,
    ))
}

#[tauri::command]
pub async fn repo_pull_request_sync(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<serde_json::Value, String> {
    as_error(
        state
            .service
            .repo_pull_request_sync(&repo_path)
            .map(|ok| serde_json::json!({ "ok": ok })),
    )
}

#[tauri::command]
pub async fn human_request_changes(
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
pub async fn human_approve(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<TaskCard, String> {
    as_error(state.service.human_approve(&repo_path, &task_id))
}

#[tauri::command]
pub async fn runs_list(
    state: State<'_, AppState>,
    repo_path: Option<String>,
) -> Result<Vec<RunSummary>, String> {
    as_error(state.service.runs_list(repo_path.as_deref()))
}
