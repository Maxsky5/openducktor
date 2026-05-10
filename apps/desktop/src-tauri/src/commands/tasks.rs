use crate::app_state::AppState;
use crate::command_helpers::{as_error, run_service_blocking};
use host_command_services::command_payloads::{TaskCreatePayload, TaskUpdatePayload};
use host_command_services::command_services::error::CommandServiceResult;
use host_command_services::command_services::tasks as task_service;
use host_domain::{TaskCard, TaskStatus};
use tauri::State;

async fn run_task_command<T, F>(operation_name: &'static str, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> CommandServiceResult<T> + Send + 'static,
{
    let result = run_service_blocking(operation_name, move || Ok(operation()))
        .await
        .map_err(|error| format!("{error:#}"))?;
    result.map_err(|error| error.to_tauri_error())
}

#[tauri::command]
pub async fn tasks_list(
    state: State<'_, AppState>,
    repo_path: String,
    done_visible_days: Option<i32>,
) -> Result<Vec<TaskCard>, String> {
    let service = state.service.clone();
    run_task_command("tasks_list", move || {
        task_service::list(
            service,
            task_service::TasksListRequest {
                repo_path,
                done_visible_days,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn task_create(
    state: State<'_, AppState>,
    repo_path: String,
    input: TaskCreatePayload,
) -> Result<TaskCard, String> {
    let service = state.service.clone();
    run_task_command("task_create", move || {
        task_service::create(
            service,
            task_service::TaskCreateRequest { repo_path, input },
        )
    })
    .await
}

#[tauri::command]
pub async fn task_update(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    patch: TaskUpdatePayload,
) -> Result<TaskCard, String> {
    let service = state.service.clone();
    run_task_command("task_update", move || {
        task_service::update(
            service,
            task_service::TaskUpdateRequest {
                repo_path,
                task_id,
                patch,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn task_delete(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    delete_subtasks: Option<bool>,
) -> Result<serde_json::Value, String> {
    let service = state.service.clone();
    let response = run_task_command("task_delete", move || {
        task_service::delete(
            service,
            task_service::TaskDeleteRequest {
                repo_path,
                task_id,
                delete_subtasks,
            },
        )
    })
    .await?;
    Ok(serde_json::json!({ "ok": response.ok }))
}

#[tauri::command]
pub async fn task_reset_implementation(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<TaskCard, String> {
    let service = state.service.clone();
    let result = run_service_blocking("task_reset_implementation", move || {
        service.task_reset_implementation(&repo_path, &task_id)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn task_reset(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<TaskCard, String> {
    let service = state.service.clone();
    let result = run_service_blocking("task_reset", move || {
        service.task_reset(&repo_path, &task_id)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn task_transition(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    status: TaskStatus,
    reason: Option<String>,
) -> Result<TaskCard, String> {
    let service = state.service.clone();
    run_task_command("task_transition", move || {
        task_service::transition(
            service,
            task_service::TaskTransitionRequest {
                repo_path,
                task_id,
                status,
                reason,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn task_defer(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    reason: Option<String>,
) -> Result<TaskCard, String> {
    let service = state.service.clone();
    run_task_command("task_defer", move || {
        task_service::defer(
            service,
            task_service::TaskDeferRequest {
                repo_path,
                task_id,
                reason,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn task_resume_deferred(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<TaskCard, String> {
    let service = state.service.clone();
    let result = run_service_blocking("task_resume_deferred", move || {
        service.task_resume_deferred(&repo_path, &task_id)
    })
    .await;
    as_error(result)
}
