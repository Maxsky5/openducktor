use crate::{as_error, AppState, TaskCreatePayload, TaskUpdatePayload};
use host_domain::{CreateTaskInput, TaskCard, TaskStatus, UpdateTaskPatch};
use tauri::State;

#[tauri::command]
pub async fn tasks_list(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<Vec<TaskCard>, String> {
    as_error(state.service.tasks_list(&repo_path))
}

#[tauri::command]
pub async fn task_create(
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
pub async fn task_update(
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
pub async fn task_delete(
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
pub async fn task_transition(
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
pub async fn task_defer(
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
pub async fn task_resume_deferred(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<TaskCard, String> {
    as_error(state.service.task_resume_deferred(&repo_path, &task_id))
}
