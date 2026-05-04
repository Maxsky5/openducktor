use crate::command_services::error::{CommandServiceError, CommandServiceResult};
use crate::command_services::issue_type::parse_issue_type;
use crate::{TaskCreatePayload, TaskUpdatePayload};
use host_application::AppService;
use host_domain::{CreateTaskInput, TaskCard, TaskStatus, UpdateTaskPatch};
use serde::Deserialize;
use std::sync::Arc;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TasksListRequest {
    pub(crate) repo_path: String,
    pub(crate) done_visible_days: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskCreateRequest {
    pub(crate) repo_path: String,
    pub(crate) input: TaskCreatePayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskUpdateRequest {
    pub(crate) repo_path: String,
    pub(crate) task_id: String,
    pub(crate) patch: TaskUpdatePayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskDeleteRequest {
    pub(crate) repo_path: String,
    pub(crate) task_id: String,
    pub(crate) delete_subtasks: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskTransitionRequest {
    pub(crate) repo_path: String,
    pub(crate) task_id: String,
    pub(crate) status: TaskStatus,
    pub(crate) reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskDeferRequest {
    pub(crate) repo_path: String,
    pub(crate) task_id: String,
    pub(crate) reason: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskDeleteResponse {
    pub(crate) ok: bool,
}

fn request_error(error: impl Into<String>) -> CommandServiceError {
    CommandServiceError::invalid_request(error.into())
}

fn service_error(error: anyhow::Error) -> CommandServiceError {
    CommandServiceError::internal(error)
}

pub(crate) fn map_task_create_payload(
    input: TaskCreatePayload,
) -> CommandServiceResult<CreateTaskInput> {
    Ok(CreateTaskInput {
        title: input.title,
        issue_type: parse_issue_type(&input.issue_type, "issueType")
            .map_err(CommandServiceError::invalid_request)?,
        priority: input.priority,
        description: input.description,
        labels: input.labels,
        ai_review_enabled: input.ai_review_enabled,
        parent_id: input.parent_id,
    })
}

pub(crate) fn map_task_update_payload(
    patch: TaskUpdatePayload,
) -> CommandServiceResult<UpdateTaskPatch> {
    let issue_type = match patch.issue_type {
        Some(issue_type) => Some(
            parse_issue_type(&issue_type, "issueType")
                .map_err(CommandServiceError::invalid_request)?,
        ),
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
        target_branch: patch.target_branch,
    })
}

pub(crate) fn list(
    service: Arc<AppService>,
    request: TasksListRequest,
) -> CommandServiceResult<Vec<TaskCard>> {
    match request.done_visible_days {
        Some(days) if days < 0 => Err(request_error(
            "doneVisibleDays must be greater than or equal to 0",
        )),
        Some(days) => service
            .tasks_list_for_kanban(&request.repo_path, days)
            .map_err(service_error),
        None => service
            .tasks_list(&request.repo_path)
            .map_err(service_error),
    }
}

pub(crate) fn create(
    service: Arc<AppService>,
    request: TaskCreateRequest,
) -> CommandServiceResult<TaskCard> {
    let create = map_task_create_payload(request.input)?;
    service
        .task_create(&request.repo_path, create)
        .map_err(service_error)
}

pub(crate) fn update(
    service: Arc<AppService>,
    request: TaskUpdateRequest,
) -> CommandServiceResult<TaskCard> {
    let patch = map_task_update_payload(request.patch)?;
    service
        .task_update(&request.repo_path, &request.task_id, patch)
        .map_err(service_error)
}

pub(crate) fn delete(
    service: Arc<AppService>,
    request: TaskDeleteRequest,
) -> CommandServiceResult<TaskDeleteResponse> {
    service
        .task_delete(
            &request.repo_path,
            &request.task_id,
            delete_subtasks_or_default(request.delete_subtasks),
        )
        .map(|()| TaskDeleteResponse { ok: true })
        .map_err(service_error)
}

fn delete_subtasks_or_default(delete_subtasks: Option<bool>) -> bool {
    delete_subtasks.unwrap_or(false)
}

pub(crate) fn transition(
    service: Arc<AppService>,
    request: TaskTransitionRequest,
) -> CommandServiceResult<TaskCard> {
    service
        .task_transition(
            &request.repo_path,
            &request.task_id,
            request.status,
            command_reason(&request.reason),
        )
        .map_err(service_error)
}

pub(crate) fn defer(
    service: Arc<AppService>,
    request: TaskDeferRequest,
) -> CommandServiceResult<TaskCard> {
    service
        .task_defer(
            &request.repo_path,
            &request.task_id,
            command_reason(&request.reason),
        )
        .map_err(service_error)
}

fn command_reason(reason: &Option<String>) -> Option<&str> {
    reason.as_deref()
}

#[cfg(test)]
mod tests {
    use super::{
        command_reason, delete_subtasks_or_default, list, map_task_create_payload,
        map_task_update_payload, TasksListRequest,
    };
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

        assert!(error.to_string().contains("Invalid issueType"));
        assert!(error.to_string().contains("task, feature, bug, epic"));
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
            target_branch: None,
        })
        .expect_err("unknown issue type should fail");

        assert!(error.to_string().contains("Invalid issueType"));
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
            target_branch: Some(host_domain::GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "release/2026.04".to_string(),
            }),
        })
        .map_err(|error| error.to_string())?;

        assert_eq!(patch.issue_type, Some(IssueType::Feature));
        assert_eq!(
            patch.target_branch,
            Some(host_domain::GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "release/2026.04".to_string(),
            })
        );
        Ok(())
    }

    #[test]
    fn tasks_list_rejects_negative_done_visible_days_before_service_call() {
        let config_store = host_infra_system::AppConfigStore::from_path(
            std::env::temp_dir().join("openducktor-negative-days-unused-config.json"),
        );
        let task_store: std::sync::Arc<dyn host_domain::TaskStore> = std::sync::Arc::new(
            host_infra_beads::BeadsTaskStore::with_metadata_namespace_and_config(
                "openducktor",
                config_store.clone(),
            ),
        );
        let service =
            std::sync::Arc::new(host_application::AppService::new(task_store, config_store));
        let error = list(
            service,
            TasksListRequest {
                repo_path: "/does/not/matter".to_string(),
                done_visible_days: Some(-1),
            },
        )
        .expect_err("negative doneVisibleDays should fail");

        assert_eq!(
            error.to_string(),
            "doneVisibleDays must be greater than or equal to 0"
        );
    }

    #[test]
    fn task_delete_defaults_missing_delete_subtasks_to_false() {
        assert!(!delete_subtasks_or_default(None));
    }

    #[test]
    fn task_delete_preserves_explicit_delete_subtasks_values() {
        assert!(delete_subtasks_or_default(Some(true)));
        assert!(!delete_subtasks_or_default(Some(false)));
    }

    #[test]
    fn command_reason_preserves_whitespace_and_contents() {
        let reason = Some("  wait for api  ".to_string());

        assert_eq!(command_reason(&reason), Some("  wait for api  "));
    }

    #[test]
    fn command_reason_preserves_absence() {
        assert_eq!(command_reason(&None), None);
    }
}
