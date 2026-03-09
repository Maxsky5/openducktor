use crate::{as_error, run_service_blocking, AppState};
use host_domain::{
    BeadsCheck, QaReviewTarget, RuntimeCheck, RuntimeDescriptor, RuntimeInstanceSummary, SystemCheck,
};
use tauri::State;

#[tauri::command]
pub async fn system_check(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<SystemCheck, String> {
    as_error(state.service.system_check(&repo_path))
}

#[tauri::command]
pub async fn runtime_check(
    state: State<'_, AppState>,
    force: Option<bool>,
) -> Result<RuntimeCheck, String> {
    as_error(
        state
            .service
            .runtime_check_with_refresh(force.unwrap_or(false)),
    )
}

#[tauri::command]
pub async fn beads_check(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<BeadsCheck, String> {
    as_error(state.service.beads_check(&repo_path))
}

#[tauri::command]
pub async fn runtime_definitions_list(
    state: State<'_, AppState>,
) -> Result<Vec<RuntimeDescriptor>, String> {
    as_error(state.service.runtime_definitions_list())
}

#[tauri::command]
pub async fn runtime_list(
    state: State<'_, AppState>,
    runtime_kind: String,
    repo_path: Option<String>,
) -> Result<Vec<RuntimeInstanceSummary>, String> {
    as_error(
        state
            .service
            .runtime_list(&runtime_kind, repo_path.as_deref()),
    )
}

#[tauri::command]
pub async fn qa_review_target_get(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
 ) -> Result<QaReviewTarget, String> {
    let service = state.service.clone();
    let result = run_service_blocking("qa_review_target_get", move || {
        service.qa_review_target_get(&repo_path, &task_id)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn runtime_stop(
    state: State<'_, AppState>,
    runtime_id: String,
) -> Result<serde_json::Value, String> {
    as_error(
        state
            .service
            .runtime_stop(&runtime_id)
            .map(|ok| serde_json::json!({ "ok": ok })),
    )
}

#[tauri::command]
pub async fn runtime_ensure(
    state: State<'_, AppState>,
    runtime_kind: String,
    repo_path: String,
) -> Result<RuntimeInstanceSummary, String> {
    let service = state.service.clone();
    let result = run_service_blocking("runtime_ensure", move || {
        service.runtime_ensure(&runtime_kind, &repo_path)
    })
    .await;
    as_error(result)
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;
    use serde_json::json;

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct QaReviewTargetGetPayload {
        repo_path: String,
        task_id: String,
    }

    #[test]
    fn qa_review_target_get_payload_accepts_task_identifiers() {
        let payload = json!({
            "repoPath": "/repo",
            "taskId": "task-1",
        });
        let parsed: QaReviewTargetGetPayload =
            serde_json::from_value(payload).expect("payload should deserialize");
        assert_eq!(parsed.repo_path, "/repo");
        assert_eq!(parsed.task_id, "task-1");
    }

    #[test]
    fn qa_review_target_get_payload_rejects_missing_task_id() {
        let payload = json!({
            "repoPath": "/repo",
        });
        let error = serde_json::from_value::<QaReviewTargetGetPayload>(payload)
            .expect_err("task id should be required at command boundary");
        let message = error.to_string();
        assert!(message.contains("taskId"));
    }
}
