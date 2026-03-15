use super::issue_type::parse_issue_type;
use crate::{
    as_error, run_service_blocking, AppState, MarkdownPayload, PlanPayload, PlanSubtaskPayload,
};
use host_domain::{PlanSubtaskInput, SpecDocument, TaskCard, TaskMetadata};
use tauri::State;

fn map_plan_subtask_payload(
    subtask: PlanSubtaskPayload,
    index: usize,
) -> Result<PlanSubtaskInput, String> {
    let issue_type = match subtask.issue_type {
        Some(issue_type) => Some(parse_issue_type(
            &issue_type,
            &format!("subtasks[{index}].issueType"),
        )?),
        None => None,
    };

    Ok(PlanSubtaskInput {
        title: subtask.title,
        issue_type,
        priority: subtask.priority,
        description: subtask.description,
    })
}

pub(crate) fn map_plan_subtasks(
    subtasks: Option<Vec<PlanSubtaskPayload>>,
) -> Result<Option<Vec<PlanSubtaskInput>>, String> {
    subtasks
        .map(|items| {
            items
                .into_iter()
                .enumerate()
                .map(|(index, item)| map_plan_subtask_payload(item, index))
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()
}

#[tauri::command]
pub async fn spec_get(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<SpecDocument, String> {
    let service = state.service.clone();
    let result =
        run_service_blocking("spec_get", move || service.spec_get(&repo_path, &task_id)).await;
    as_error(result)
}

#[tauri::command]
pub async fn task_metadata_get(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<TaskMetadata, String> {
    let service = state.service.clone();
    let result = run_service_blocking("task_metadata_get", move || {
        service.task_metadata_get(&repo_path, &task_id)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn set_spec(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    markdown: String,
) -> Result<SpecDocument, String> {
    let service = state.service.clone();
    let result = run_service_blocking("set_spec", move || {
        service.set_spec(&repo_path, &task_id, &markdown)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn spec_save_document(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    markdown: String,
) -> Result<SpecDocument, String> {
    let service = state.service.clone();
    let result = run_service_blocking("spec_save_document", move || {
        service.save_spec_document(&repo_path, &task_id, &markdown)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn plan_get(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<SpecDocument, String> {
    let service = state.service.clone();
    let result =
        run_service_blocking("plan_get", move || service.plan_get(&repo_path, &task_id)).await;
    as_error(result)
}

#[tauri::command]
pub async fn set_plan(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    input: PlanPayload,
) -> Result<SpecDocument, String> {
    let mapped_subtasks = map_plan_subtasks(input.subtasks)?;
    let markdown = input.markdown;
    let service = state.service.clone();
    let result = run_service_blocking("set_plan", move || {
        service.set_plan(&repo_path, &task_id, &markdown, mapped_subtasks)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn plan_save_document(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    markdown: String,
) -> Result<SpecDocument, String> {
    let service = state.service.clone();
    let result = run_service_blocking("plan_save_document", move || {
        service.save_plan_document(&repo_path, &task_id, &markdown)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn qa_get_report(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<SpecDocument, String> {
    let service = state.service.clone();
    let result = run_service_blocking("qa_get_report", move || {
        service.qa_get_report(&repo_path, &task_id)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn qa_approved(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    input: MarkdownPayload,
) -> Result<TaskCard, String> {
    let markdown = input.markdown;
    let service = state.service.clone();
    let result = run_service_blocking("qa_approved", move || {
        service.qa_approved(&repo_path, &task_id, &markdown)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn qa_rejected(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    input: MarkdownPayload,
) -> Result<TaskCard, String> {
    let markdown = input.markdown;
    let service = state.service.clone();
    let result = run_service_blocking("qa_rejected", move || {
        service.qa_rejected(&repo_path, &task_id, &markdown)
    })
    .await;
    as_error(result)
}

#[cfg(test)]
mod tests {
    use super::map_plan_subtasks;
    use crate::PlanSubtaskPayload;
    use host_domain::IssueType;

    #[test]
    fn map_plan_subtasks_rejects_unknown_issue_type_with_field_path() {
        let error = map_plan_subtasks(Some(vec![PlanSubtaskPayload {
            title: "Build UI".to_string(),
            issue_type: Some("featur".to_string()),
            priority: Some(2),
            description: None,
        }]))
        .expect_err("unknown issue type should fail");

        assert!(error.contains("subtasks[0].issueType"));
        assert!(error.contains("task, feature, bug, epic"));
    }

    #[test]
    fn map_plan_subtasks_parses_valid_issue_type() -> Result<(), String> {
        let subtasks = map_plan_subtasks(Some(vec![PlanSubtaskPayload {
            title: "Build API".to_string(),
            issue_type: Some("bug".to_string()),
            priority: Some(1),
            description: Some("Fix bug".to_string()),
        }]))?
        .ok_or_else(|| "subtasks should be present".to_string())?;

        assert_eq!(subtasks[0].issue_type, Some(IssueType::Bug));
        Ok(())
    }
}
