use crate::{as_error, run_service_blocking, runtime_ensure_failure_kind, AppState};
use host_domain::{
    BeadsCheck, RepoRuntimeHealthCheck, RepoRuntimeStartupStatus, RuntimeCheck, RuntimeDescriptor,
    RuntimeInstanceSummary, SystemCheck, TaskWorktreeSummary,
};
use tauri::State;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeEnsureCommandError {
    message: String,
    failure_kind: Option<&'static str>,
}

impl RuntimeEnsureCommandError {
    fn from_anyhow(error: anyhow::Error) -> Self {
        Self {
            message: format!("{error:#}"),
            failure_kind: runtime_ensure_failure_kind(&error),
        }
    }
}

#[tauri::command]
pub async fn system_check(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<SystemCheck, String> {
    let service = state.service.clone();
    let result =
        run_service_blocking("system_check", move || service.system_check(&repo_path)).await;
    as_error(result)
}

#[tauri::command]
pub async fn runtime_check(
    state: State<'_, AppState>,
    force: Option<bool>,
) -> Result<RuntimeCheck, String> {
    let service = state.service.clone();
    let force = force.unwrap_or(false);
    let result = run_service_blocking("runtime_check", move || {
        service.runtime_check_with_refresh(force)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn beads_check(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<BeadsCheck, String> {
    let service = state.service.clone();
    let result = run_service_blocking("beads_check", move || service.beads_check(&repo_path)).await;
    as_error(result)
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
    let service = state.service.clone();
    let result = run_service_blocking("runtime_list", move || {
        service.runtime_list(&runtime_kind, repo_path.as_deref())
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn task_worktree_get(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<Option<TaskWorktreeSummary>, String> {
    let service = state.service.clone();
    let result = run_service_blocking("task_worktree_get", move || {
        service.task_worktree_get(&repo_path, &task_id)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn runtime_stop(
    state: State<'_, AppState>,
    runtime_id: String,
) -> Result<serde_json::Value, String> {
    let service = state.service.clone();
    let result = run_service_blocking("runtime_stop", move || {
        service
            .runtime_stop(&runtime_id)
            .map(|ok| serde_json::json!({ "ok": ok }))
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn runtime_ensure(
    state: State<'_, AppState>,
    runtime_kind: String,
    repo_path: String,
) -> Result<RuntimeInstanceSummary, RuntimeEnsureCommandError> {
    let service = state.service.clone();
    let result = run_service_blocking("runtime_ensure", move || {
        service.runtime_ensure(&runtime_kind, &repo_path)
    })
    .await;
    result.map_err(RuntimeEnsureCommandError::from_anyhow)
}

#[tauri::command]
pub async fn runtime_startup_status(
    state: State<'_, AppState>,
    runtime_kind: String,
    repo_path: String,
) -> Result<RepoRuntimeStartupStatus, String> {
    let service = state.service.clone();
    let result = run_service_blocking("runtime_startup_status", move || {
        service.runtime_startup_status(&runtime_kind, &repo_path)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn repo_runtime_health(
    state: State<'_, AppState>,
    runtime_kind: String,
    repo_path: String,
) -> Result<RepoRuntimeHealthCheck, String> {
    let service = state.service.clone();
    let result = run_service_blocking("repo_runtime_health", move || {
        service.repo_runtime_health(&runtime_kind, &repo_path)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn repo_runtime_health_status(
    state: State<'_, AppState>,
    runtime_kind: String,
    repo_path: String,
) -> Result<RepoRuntimeHealthCheck, String> {
    let service = state.service.clone();
    let result = run_service_blocking("repo_runtime_health_status", move || {
        service.repo_runtime_health_status(&runtime_kind, &repo_path)
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
    struct TaskWorktreeGetPayload {
        repo_path: String,
        task_id: String,
    }

    #[test]
    fn task_worktree_get_payload_accepts_task_identifiers() {
        let payload = json!({
            "repoPath": "/repo",
            "taskId": "task-1",
        });
        let parsed: TaskWorktreeGetPayload =
            serde_json::from_value(payload).expect("payload should deserialize");
        assert_eq!(parsed.repo_path, "/repo");
        assert_eq!(parsed.task_id, "task-1");
    }

    #[test]
    fn task_worktree_get_payload_rejects_missing_task_id() {
        let payload = json!({
            "repoPath": "/repo",
        });
        let error = serde_json::from_value::<TaskWorktreeGetPayload>(payload)
            .expect_err("task id should be required at command boundary");
        let message = error.to_string();
        assert!(message.contains("taskId"));
    }
}
