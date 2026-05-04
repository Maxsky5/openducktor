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
    if let Some(days) = request.done_visible_days {
        if days < 0 {
            return Err(request_error(
                "doneVisibleDays must be greater than or equal to 0",
            ));
        }
    }

    match request.done_visible_days {
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
    delete_with(request, |repo_path, task_id, delete_subtasks| {
        service.task_delete(repo_path, task_id, delete_subtasks)
    })
}

fn delete_with<F>(
    request: TaskDeleteRequest,
    delete_task: F,
) -> CommandServiceResult<TaskDeleteResponse>
where
    F: FnOnce(&str, &str, bool) -> anyhow::Result<()>,
{
    delete_task(
        &request.repo_path,
        &request.task_id,
        request.delete_subtasks.unwrap_or(false),
    )
    .map(|()| TaskDeleteResponse { ok: true })
    .map_err(service_error)
}

pub(crate) fn transition(
    service: Arc<AppService>,
    request: TaskTransitionRequest,
) -> CommandServiceResult<TaskCard> {
    transition_with(request, |repo_path, task_id, status, reason| {
        service.task_transition(repo_path, task_id, status, reason)
    })
}

fn transition_with<F>(
    request: TaskTransitionRequest,
    transition_task: F,
) -> CommandServiceResult<TaskCard>
where
    F: FnOnce(&str, &str, TaskStatus, Option<&str>) -> anyhow::Result<TaskCard>,
{
    transition_task(
        &request.repo_path,
        &request.task_id,
        request.status,
        request.reason.as_deref(),
    )
    .map_err(service_error)
}

pub(crate) fn defer(
    service: Arc<AppService>,
    request: TaskDeferRequest,
) -> CommandServiceResult<TaskCard> {
    defer_with(request, |repo_path, task_id, reason| {
        service.task_defer(repo_path, task_id, reason)
    })
}

fn defer_with<F>(request: TaskDeferRequest, defer_task: F) -> CommandServiceResult<TaskCard>
where
    F: FnOnce(&str, &str, Option<&str>) -> anyhow::Result<TaskCard>,
{
    defer_task(
        &request.repo_path,
        &request.task_id,
        request.reason.as_deref(),
    )
    .map_err(service_error)
}

#[cfg(test)]
mod tests {
    use super::{
        defer_with, delete_with, list, map_task_create_payload, map_task_update_payload,
        transition_with, TaskDeferRequest, TaskDeleteRequest, TaskTransitionRequest,
        TasksListRequest,
    };
    use crate::{TaskCreatePayload, TaskUpdatePayload};
    use host_domain::{IssueType, TaskCard, TaskStatus};

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
    fn task_delete_defaults_missing_delete_subtasks_to_false_before_service_call(
    ) -> Result<(), String> {
        let request = TaskDeleteRequest {
            repo_path: "/tmp/repo".to_string(),
            task_id: "task-1".to_string(),
            delete_subtasks: None,
        };

        let response = delete_with(request, |repo_path, task_id, delete_subtasks| {
            assert_eq!(repo_path, "/tmp/repo");
            assert_eq!(task_id, "task-1");
            assert!(!delete_subtasks);
            Ok(())
        })
        .map_err(|error| error.to_string())?;

        assert!(response.ok);
        Ok(())
    }

    #[test]
    fn task_transition_forwards_optional_reason_unchanged() -> Result<(), String> {
        let request = TaskTransitionRequest {
            repo_path: "/tmp/repo".to_string(),
            task_id: "task-1".to_string(),
            status: TaskStatus::Blocked,
            reason: Some("  wait for api  ".to_string()),
        };

        let task = transition_with(request, |repo_path, task_id, status, reason| {
            assert_eq!(repo_path, "/tmp/repo");
            assert_eq!(task_id, "task-1");
            assert_eq!(status, TaskStatus::Blocked);
            assert_eq!(reason, Some("  wait for api  "));
            Ok(task_card("task-1", status))
        })
        .map_err(|error| error.to_string())?;

        assert_eq!(task.status, TaskStatus::Blocked);
        Ok(())
    }

    #[test]
    fn task_defer_forwards_optional_reason_unchanged() -> Result<(), String> {
        let request = TaskDeferRequest {
            repo_path: "/tmp/repo".to_string(),
            task_id: "task-1".to_string(),
            reason: Some("  later  ".to_string()),
        };

        let task = defer_with(request, |repo_path, task_id, reason| {
            assert_eq!(repo_path, "/tmp/repo");
            assert_eq!(task_id, "task-1");
            assert_eq!(reason, Some("  later  "));
            Ok(task_card("task-1", TaskStatus::Deferred))
        })
        .map_err(|error| error.to_string())?;

        assert_eq!(task.status, TaskStatus::Deferred);
        Ok(())
    }

    fn task_card(id: &str, status: TaskStatus) -> TaskCard {
        TaskCard {
            id: id.to_string(),
            title: "Task".to_string(),
            description: String::new(),
            notes: String::new(),
            status,
            priority: 1,
            issue_type: IssueType::Task,
            ai_review_enabled: false,
            available_actions: Vec::new(),
            labels: Vec::new(),
            assignee: None,
            parent_id: None,
            subtask_ids: Vec::new(),
            agent_sessions: Vec::new(),
            target_branch: None,
            target_branch_error: None,
            pull_request: None,
            document_summary: Default::default(),
            agent_workflows: Default::default(),
            updated_at: String::new(),
            created_at: String::new(),
        }
    }
}
