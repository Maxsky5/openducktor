use crate::{as_error, run_service_blocking, AppState};
use host_domain::AgentSessionDocument;
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub async fn agent_sessions_list(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<Vec<AgentSessionDocument>, String> {
    let service = state.service.clone();
    let result = run_service_blocking("agent_sessions_list", move || {
        service.agent_sessions_list(&repo_path, &task_id)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn agent_session_upsert(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    session: AgentSessionDocument,
) -> Result<serde_json::Value, String> {
    let service = state.service.clone();
    let result = run_service_blocking("agent_session_upsert", move || {
        service
            .agent_session_upsert(&repo_path, &task_id, session)
            .map(|ok| serde_json::json!({ "ok": ok }))
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn agent_sessions_list_bulk(
    state: State<'_, AppState>,
    repo_path: String,
    task_ids: Vec<String>,
) -> Result<HashMap<String, Vec<AgentSessionDocument>>, String> {
    let service = state.service.clone();
    let result = run_service_blocking("agent_sessions_list_bulk", move || {
        service.agent_sessions_list_bulk(&repo_path, &task_ids)
    })
    .await;
    as_error(result)
}

#[cfg(test)]
mod tests {
    use host_domain::AgentSessionDocument;
    use serde::Deserialize;
    use serde_json::json;

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct AgentSessionsListPayload {
        repo_path: String,
        task_id: String,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct AgentSessionUpsertPayload {
        repo_path: String,
        task_id: String,
        session: AgentSessionDocument,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct AgentSessionsListBulkPayload {
        repo_path: String,
        task_ids: Vec<String>,
    }

    #[derive(Debug, Deserialize)]
    struct AgentSessionUpsertResponse {
        ok: bool,
    }

    #[test]
    fn agent_sessions_list_payload_accepts_task_identifier() {
        let payload = json!({
            "repoPath": "/repo",
            "taskId": "task-1",
        });
        let parsed: AgentSessionsListPayload =
            serde_json::from_value(payload).expect("payload should deserialize");

        assert_eq!(parsed.repo_path, "/repo");
        assert_eq!(parsed.task_id, "task-1");
    }

    #[test]
    fn agent_sessions_list_payload_rejects_missing_task_id() {
        let payload = json!({
            "repoPath": "/repo",
        });
        let error = serde_json::from_value::<AgentSessionsListPayload>(payload)
            .expect_err("task id should be required at command boundary");

        assert!(error.to_string().contains("taskId"));
    }

    #[test]
    fn agent_session_upsert_payload_accepts_session_document() {
        let payload = json!({
            "repoPath": "/repo",
            "taskId": "task-1",
            "session": {
                "externalSessionId": "external-session-1",
                "role": "build",
                "scenario": "build_default",
                "startedAt": "2026-02-20T12:00:00Z",
                "runtimeKind": "opencode",
                "workingDirectory": "/repo/worktree/task-1"
            }
        });
        let parsed: AgentSessionUpsertPayload =
            serde_json::from_value(payload).expect("payload should deserialize");

        assert_eq!(parsed.repo_path, "/repo");
        assert_eq!(parsed.task_id, "task-1");
        assert_eq!(parsed.session.external_session_id.as_deref(), Some("external-session-1"));
        assert_eq!(parsed.session.role, "build");
        assert_eq!(parsed.session.working_directory, "/repo/worktree/task-1");
    }

    #[test]
    fn agent_session_upsert_payload_rejects_missing_session() {
        let payload = json!({
            "repoPath": "/repo",
            "taskId": "task-1",
        });
        let error = serde_json::from_value::<AgentSessionUpsertPayload>(payload)
            .expect_err("session should be required at command boundary");

        assert!(error.to_string().contains("session"));
    }

    #[test]
    fn agent_sessions_list_bulk_payload_accepts_task_ids() {
        let payload = json!({
            "repoPath": "/repo",
            "taskIds": ["task-1", "task-2"],
        });
        let parsed: AgentSessionsListBulkPayload =
            serde_json::from_value(payload).expect("payload should deserialize");

        assert_eq!(parsed.repo_path, "/repo");
        assert_eq!(parsed.task_ids, vec!["task-1", "task-2"]);
    }

    #[test]
    fn agent_sessions_list_bulk_payload_rejects_missing_task_ids() {
        let payload = json!({
            "repoPath": "/repo",
        });
        let error = serde_json::from_value::<AgentSessionsListBulkPayload>(payload)
            .expect_err("task ids should be required at command boundary");

        assert!(error.to_string().contains("taskIds"));
    }

    #[test]
    fn agent_session_upsert_response_keeps_ok_envelope() {
        let response = json!({ "ok": true });
        let parsed: AgentSessionUpsertResponse =
            serde_json::from_value(response).expect("response should deserialize");

        assert!(parsed.ok);
    }
}
