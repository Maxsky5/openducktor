use host_domain::now_rfc3339;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ExternalTaskSyncEventKind {
    ExternalTaskCreated,
    TasksUpdated,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExternalTaskSyncEvent {
    pub(crate) event_id: String,
    pub(crate) kind: ExternalTaskSyncEventKind,
    pub(crate) repo_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) task_ids: Option<Vec<String>>,
    pub(crate) emitted_at: String,
}

pub(crate) fn build_external_task_created_event(
    repo_path: String,
    task_id: String,
) -> ExternalTaskSyncEvent {
    ExternalTaskSyncEvent {
        event_id: Uuid::new_v4().to_string(),
        kind: ExternalTaskSyncEventKind::ExternalTaskCreated,
        repo_path,
        task_id: Some(task_id),
        task_ids: None,
        emitted_at: now_rfc3339(),
    }
}

pub(crate) fn build_tasks_updated_event(
    repo_path: String,
    task_ids: Vec<String>,
) -> ExternalTaskSyncEvent {
    ExternalTaskSyncEvent {
        event_id: Uuid::new_v4().to_string(),
        kind: ExternalTaskSyncEventKind::TasksUpdated,
        repo_path,
        task_id: None,
        task_ids: Some(task_ids),
        emitted_at: now_rfc3339(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn external_task_created_event_serializes_wire_contract() {
        let event = build_external_task_created_event("/repo".to_string(), "task-1".to_string());

        let value = serde_json::to_value(&event).expect("event should serialize");

        assert_eq!(value["kind"], json!("external_task_created"));
        assert_eq!(value["repoPath"], json!("/repo"));
        assert_eq!(value["taskId"], json!("task-1"));
        assert!(value.get("taskIds").is_none());
        assert_string_field(&value, "eventId");
        assert_string_field(&value, "emittedAt");
    }

    #[test]
    fn tasks_updated_event_serializes_wire_contract() {
        let event = build_tasks_updated_event(
            "/repo".to_string(),
            vec!["task-1".to_string(), "task-2".to_string()],
        );

        let value = serde_json::to_value(&event).expect("event should serialize");

        assert_eq!(value["kind"], json!("tasks_updated"));
        assert_eq!(value["repoPath"], json!("/repo"));
        assert_eq!(value["taskIds"], json!(["task-1", "task-2"]));
        assert!(value.get("taskId").is_none());
        assert_string_field(&value, "eventId");
        assert_string_field(&value, "emittedAt");
    }

    #[test]
    fn optional_task_fields_are_omitted_when_absent() {
        let event = ExternalTaskSyncEvent {
            event_id: "event-1".to_string(),
            kind: ExternalTaskSyncEventKind::TasksUpdated,
            repo_path: "/repo".to_string(),
            task_id: None,
            task_ids: None,
            emitted_at: "2026-05-10T00:00:00Z".to_string(),
        };

        let value = serde_json::to_value(&event).expect("event should serialize");

        assert!(value.get("taskId").is_none());
        assert!(value.get("taskIds").is_none());
    }

    fn assert_string_field(value: &Value, key: &str) {
        assert!(
            value.get(key).and_then(Value::as_str).is_some(),
            "expected {key} to be a string field"
        );
    }
}
