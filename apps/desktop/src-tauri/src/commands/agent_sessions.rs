use crate::{as_error, AppState};
use host_domain::AgentSessionDocument;
use tauri::State;

#[tauri::command]
pub async fn agent_sessions_list(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
) -> Result<Vec<AgentSessionDocument>, String> {
    as_error(state.service.agent_sessions_list(&repo_path, &task_id))
}

#[tauri::command]
pub async fn agent_session_upsert(
    state: State<'_, AppState>,
    repo_path: String,
    task_id: String,
    session: AgentSessionDocument,
) -> Result<serde_json::Value, String> {
    as_error(
        state
            .service
            .agent_session_upsert(&repo_path, &task_id, session)
            .map(|ok| serde_json::json!({ "ok": ok })),
    )
}
