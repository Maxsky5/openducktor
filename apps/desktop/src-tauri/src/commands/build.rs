use crate::{
    as_error, dev_server_emitter, run_emitter, run_service_blocking, AppState,
    BuildCompletePayload, PullRequestContentPayload, TaskDirectMergePayload,
};
use host_application::{BuildResponseAction, CleanupMode};
use host_domain::{
    AgentRuntimeKind, DevServerGroupState, PullRequestRecord, RunSummary, TaskApprovalContext,
    TaskCard, TaskDirectMergeResult, TaskPullRequestDetectResult,
};
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn build_start<R: tauri::Runtime>(
    state: State<'_, AppState>,
    app: AppHandle<R>,
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
pub async fn dev_server_get_state(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<DevServerGroupState, String> {
    let service = state.service.clone();
    let result = run_service_blocking("dev_server_get_state", move || {
        service.dev_server_get_state(&repo_path, &task_id)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn dev_server_start<R: tauri::Runtime>(
    state: State<'_, AppState>,
    app: AppHandle<R>,
    repo_path: String,
    task_id: String,
) -> Result<DevServerGroupState, String> {
    let service = state.service.clone();
    let emitter = dev_server_emitter(app);
    let result = run_service_blocking("dev_server_start", move || {
        service.dev_server_start(&repo_path, &task_id, emitter)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn dev_server_stop(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<DevServerGroupState, String> {
    let service = state.service.clone();
    let result = run_service_blocking("dev_server_stop", move || {
        service.dev_server_stop(&repo_path, &task_id)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn dev_server_restart<R: tauri::Runtime>(
    state: State<'_, AppState>,
    app: AppHandle<R>,
    repo_path: String,
    task_id: String,
) -> Result<DevServerGroupState, String> {
    let service = state.service.clone();
    let emitter = dev_server_emitter(app);
    let result = run_service_blocking("dev_server_restart", move || {
        service.dev_server_restart(&repo_path, &task_id, emitter)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn build_respond<R: tauri::Runtime>(
    state: State<'_, AppState>,
    app: AppHandle<R>,
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
pub async fn build_stop<R: tauri::Runtime>(
    state: State<'_, AppState>,
    app: AppHandle<R>,
    run_id: String,
) -> Result<serde_json::Value, String> {
    let service = state.service.clone();
    let emitter = run_emitter(app);
    let result = run_service_blocking("build_stop", move || {
        service
            .build_stop(&run_id, emitter)
            .map(|ok| serde_json::json!({ "ok": ok }))
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn build_cleanup<R: tauri::Runtime>(
    state: State<'_, AppState>,
    app: AppHandle<R>,
    run_id: String,
    mode: CleanupMode,
) -> Result<serde_json::Value, String> {
    let service = state.service.clone();
    let emitter = run_emitter(app);
    let result = run_service_blocking("build_cleanup", move || {
        service
            .build_cleanup(&run_id, mode, emitter)
            .map(|ok| serde_json::json!({ "ok": ok }))
    })
    .await;
    as_error(result)
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
    input: TaskDirectMergePayload,
) -> Result<TaskDirectMergeResult, String> {
    let service = state.service.clone();
    let result = run_service_blocking("task_direct_merge", move || {
        service.task_direct_merge(
            &repo_path,
            &task_id,
            input.merge_method,
            input.squash_commit_message,
        )
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn task_direct_merge_complete(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<TaskCard, String> {
    let service = state.service.clone();
    let result = run_service_blocking("task_direct_merge_complete", move || {
        service.task_direct_merge_complete(&repo_path, &task_id)
    })
    .await;
    as_error(result)
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
pub async fn task_pull_request_unlink(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<serde_json::Value, String> {
    as_error(
        state
            .service
            .task_pull_request_unlink(&repo_path, &task_id)
            .map(|ok| serde_json::json!({ "ok": ok })),
    )
}

#[tauri::command]
pub async fn task_pull_request_detect(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<TaskPullRequestDetectResult, String> {
    as_error(state.service.task_pull_request_detect(&repo_path, &task_id))
}

#[tauri::command]
pub async fn task_pull_request_link_merged(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    pull_request: PullRequestRecord,
) -> Result<TaskCard, String> {
    let service = state.service.clone();
    let result = run_service_blocking("task_pull_request_link_merged", move || {
        service.task_pull_request_link_merged(&repo_path, &task_id, pull_request)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn repo_pull_request_sync(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<serde_json::Value, String> {
    let service = state.service.clone();
    let result = run_service_blocking("repo_pull_request_sync", move || {
        service
            .repo_pull_request_sync(&repo_path)
            .map(|ok| serde_json::json!({ "ok": ok }))
    })
    .await;
    as_error(result)
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
    let service = state.service.clone();
    let result =
        run_service_blocking("runs_list", move || service.runs_list(repo_path.as_deref())).await;
    as_error(result)
}
