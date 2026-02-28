use crate::{as_error, extend_runtime_errors_with_startup, run_service_blocking, AppState};
use host_domain::{AgentRuntimeSummary, BeadsCheck, RuntimeCheck, SystemCheck};
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
    let check = as_error(
        state
            .service
            .runtime_check_with_refresh(force.unwrap_or(false)),
    )?;
    Ok(extend_runtime_errors_with_startup(
        check,
        &state.startup_errors,
    ))
}

#[tauri::command]
pub async fn beads_check(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<BeadsCheck, String> {
    as_error(state.service.beads_check(&repo_path))
}

#[tauri::command]
pub async fn opencode_runtime_list(
    state: State<'_, AppState>,
    repo_path: Option<String>,
) -> Result<Vec<AgentRuntimeSummary>, String> {
    as_error(state.service.opencode_runtime_list(repo_path.as_deref()))
}

#[tauri::command]
pub async fn opencode_runtime_start(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    role: String,
) -> Result<AgentRuntimeSummary, String> {
    let service = state.service.clone();
    let result = run_service_blocking("opencode_runtime_start", move || {
        service.opencode_runtime_start(&repo_path, &task_id, &role)
    })
    .await;
    as_error(result)
}

#[tauri::command]
pub async fn opencode_runtime_stop(
    state: State<'_, AppState>,
    runtime_id: String,
) -> Result<serde_json::Value, String> {
    as_error(
        state
            .service
            .opencode_runtime_stop(&runtime_id)
            .map(|ok| serde_json::json!({ "ok": ok })),
    )
}

#[tauri::command]
pub async fn opencode_repo_runtime_ensure(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<AgentRuntimeSummary, String> {
    let service = state.service.clone();
    let result = run_service_blocking("opencode_repo_runtime_ensure", move || {
        service.opencode_repo_runtime_ensure(&repo_path)
    })
    .await;
    as_error(result)
}
