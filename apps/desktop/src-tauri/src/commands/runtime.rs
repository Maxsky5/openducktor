use crate::{as_error, run_service_blocking, AppState};
use host_domain::{
    AgentRuntimeRole, AgentRuntimeSummary, BeadsCheck, RuntimeCheck, RuntimeDescriptor,
    SystemCheck,
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
    Ok(state.service.runtime_definitions_list())
}

#[tauri::command]
pub async fn runtime_list(
    state: State<'_, AppState>,
    runtime_kind: String,
    repo_path: Option<String>,
) -> Result<Vec<AgentRuntimeSummary>, String> {
    as_error(state.service.runtime_list(&runtime_kind, repo_path.as_deref()))
}

#[tauri::command]
pub async fn runtime_start(
    state: State<'_, AppState>,
    runtime_kind: String,
    repo_path: String,
    task_id: String,
    role: AgentRuntimeRole,
) -> Result<AgentRuntimeSummary, String> {
    let service = state.service.clone();
    let result = run_service_blocking("runtime_start", move || {
        service.runtime_start(&runtime_kind, &repo_path, &task_id, role)
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
) -> Result<AgentRuntimeSummary, String> {
    let service = state.service.clone();
    let result = run_service_blocking("runtime_ensure", move || {
        service.runtime_ensure(&runtime_kind, &repo_path)
    })
    .await;
    as_error(result)
}

#[cfg(test)]
mod tests {
    use super::AgentRuntimeRole;
    use serde::Deserialize;
    use serde_json::json;

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RuntimeStartPayload {
        runtime_kind: String,
        repo_path: String,
        task_id: String,
        role: AgentRuntimeRole,
    }

    #[test]
    fn runtime_start_payload_accepts_spec_role() {
        let payload = json!({
            "runtimeKind": "opencode",
            "repoPath": "/repo",
            "taskId": "task-1",
            "role": "spec",
        });
        let parsed: RuntimeStartPayload =
            serde_json::from_value(payload).expect("payload should deserialize");
        assert_eq!(parsed.runtime_kind, "opencode");
        assert_eq!(parsed.repo_path, "/repo");
        assert_eq!(parsed.task_id, "task-1");
        assert_eq!(parsed.role, AgentRuntimeRole::Spec);
    }

    #[test]
    fn runtime_start_payload_rejects_workspace_role() {
        let payload = json!({
            "runtimeKind": "opencode",
            "repoPath": "/repo",
            "taskId": "task-1",
            "role": "workspace",
        });
        let error = serde_json::from_value::<RuntimeStartPayload>(payload)
            .expect_err("workspace role should be rejected at command boundary");
        let message = error.to_string();
        assert!(message.contains("unknown variant `workspace`"));
        assert!(message.contains("spec"));
        assert!(message.contains("planner"));
        assert!(message.contains("qa"));
    }
}
