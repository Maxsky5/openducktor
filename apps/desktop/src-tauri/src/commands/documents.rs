use super::issue_type::parse_issue_type;
use crate::{as_error, AppState, MarkdownPayload, PlanPayload, PlanSubtaskPayload};
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

fn map_plan_subtasks(
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
    let mapped_subtasks = map_plan_subtasks(input.subtasks)?;
    as_error(
        state
            .service
            .set_plan(&repo_path, &task_id, &input.markdown, mapped_subtasks),
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
    fn map_plan_subtasks_parses_valid_issue_type() {
        let subtasks = map_plan_subtasks(Some(vec![PlanSubtaskPayload {
            title: "Build API".to_string(),
            issue_type: Some("bug".to_string()),
            priority: Some(1),
            description: Some("Fix bug".to_string()),
        }]))
        .expect("valid issue type should parse")
        .expect("subtasks should be present");

        assert_eq!(subtasks[0].issue_type, Some(IssueType::Bug));
    }
}
