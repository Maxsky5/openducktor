use crate::{as_error, AppState, MarkdownPayload, PlanPayload};
use host_domain::{SpecDocument, TaskCard, TaskMetadata};
use tauri::State;

#[tauri::command]
pub async fn spec_get(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<SpecDocument, String> {
    as_error(state.service.spec_get(&repo_path, &task_id))
}

#[tauri::command]
pub async fn task_metadata_get(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<TaskMetadata, String> {
    as_error(state.service.task_metadata_get(&repo_path, &task_id))
}

#[tauri::command]
pub async fn set_spec(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    markdown: String,
) -> Result<SpecDocument, String> {
    as_error(state.service.set_spec(&repo_path, &task_id, &markdown))
}

#[tauri::command]
pub async fn spec_save_document(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    markdown: String,
) -> Result<SpecDocument, String> {
    as_error(
        state
            .service
            .save_spec_document(&repo_path, &task_id, &markdown),
    )
}

#[tauri::command]
pub async fn plan_get(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<SpecDocument, String> {
    as_error(state.service.plan_get(&repo_path, &task_id))
}

#[tauri::command]
pub async fn set_plan(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    input: PlanPayload,
) -> Result<SpecDocument, String> {
    as_error(
        state
            .service
            .set_plan(&repo_path, &task_id, &input.markdown, input.subtasks),
    )
}

#[tauri::command]
pub async fn plan_save_document(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    markdown: String,
) -> Result<SpecDocument, String> {
    as_error(
        state
            .service
            .save_plan_document(&repo_path, &task_id, &markdown),
    )
}

#[tauri::command]
pub async fn qa_get_report(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<SpecDocument, String> {
    as_error(state.service.qa_get_report(&repo_path, &task_id))
}

#[tauri::command]
pub async fn qa_approved(
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
pub async fn qa_rejected(
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
