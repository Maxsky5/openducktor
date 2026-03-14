use super::issue_type::parse_issue_type;
use crate::{as_error, AppState, TaskCreatePayload, TaskUpdatePayload};
use host_domain::{CreateTaskInput, TaskCard, TaskStatus, UpdateTaskPatch};
use tauri::State;

pub(crate) fn map_task_create_payload(input: TaskCreatePayload) -> Result<CreateTaskInput, String> {
    Ok(CreateTaskInput {
        title: input.title,
        issue_type: parse_issue_type(&input.issue_type, "issueType")?,
        priority: input.priority,
        description: input.description,
        labels: input.labels,
        ai_review_enabled: input.ai_review_enabled,
        parent_id: input.parent_id,
    })
}

pub(crate) fn map_task_update_payload(patch: TaskUpdatePayload) -> Result<UpdateTaskPatch, String> {
    let issue_type = match patch.issue_type {
        Some(issue_type) => Some(parse_issue_type(&issue_type, "issueType")?),
        None => None,
    };

    Ok(UpdateTaskPatch {
        title: patch.title,
        description: patch.description,
        notes: None,
        status: None,
        priority: patch.priority,
        issue_type,
        ai_review_enabled: patch.ai_review_enabled,
        labels: patch.labels,
        assignee: patch.assignee,
        parent_id: patch.parent_id,
    })
}

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
    let create = map_task_create_payload(input)?;
    as_error(state.service.task_create(&repo_path, create))
}

#[tauri::command]
pub async fn task_update(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    patch: TaskUpdatePayload,
) -> Result<TaskCard, String> {
    let mapped = map_task_update_payload(patch)?;
    as_error(state.service.task_update(&repo_path, &task_id, mapped))
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

#[cfg(test)]
mod tests {
    use super::{map_task_create_payload, map_task_update_payload};
    use crate::{TaskCreatePayload, TaskUpdatePayload};
    use host_domain::IssueType;

    #[test]
    fn map_task_create_payload_rejects_unknown_issue_type() {
        let error = map_task_create_payload(TaskCreatePayload {
            title: "Task".to_string(),
            issue_type: "epik".to_string(),
            priority: 2,
            description: None,
            labels: None,
            ai_review_enabled: None,
            parent_id: None,
        })
        .expect_err("unknown issue type should fail");

        assert!(error.contains("Invalid issueType"));
        assert!(error.contains("task, feature, bug, epic"));
    }

    #[test]
    fn map_task_update_payload_rejects_unknown_issue_type() {
        let error = map_task_update_payload(TaskUpdatePayload {
            title: None,
            description: None,
            priority: None,
            issue_type: Some("bugg".to_string()),
            ai_review_enabled: None,
            labels: None,
            assignee: None,
            parent_id: None,
        })
        .expect_err("unknown issue type should fail");

        assert!(error.contains("Invalid issueType"));
    }

    #[test]
    fn map_task_update_payload_parses_valid_issue_type() -> Result<(), String> {
        let patch = map_task_update_payload(TaskUpdatePayload {
            title: None,
            description: None,
            priority: None,
            issue_type: Some("feature".to_string()),
            ai_review_enabled: None,
            labels: None,
            assignee: None,
            parent_id: None,
        })?;

        assert_eq!(patch.issue_type, Some(IssueType::Feature));
        Ok(())
    }
}
