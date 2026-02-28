use crate::{as_error, AppState, RepoConfigPayload};
use host_infra_system::RepoConfig;
use tauri::State;

#[tauri::command]
pub async fn workspace_list(
    state: State<'_, AppState>,
) -> Result<Vec<host_domain::WorkspaceRecord>, String> {
    as_error(state.service.workspace_list())
}

#[tauri::command]
pub async fn workspace_add(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<host_domain::WorkspaceRecord, String> {
    as_error(state.service.workspace_add(&repo_path))
}

#[tauri::command]
pub async fn workspace_select(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<host_domain::WorkspaceRecord, String> {
    as_error(state.service.workspace_select(&repo_path))
}

#[tauri::command]
pub async fn workspace_update_repo_config(
    state: State<'_, AppState>,
    repo_path: String,
    config: RepoConfigPayload,
) -> Result<host_domain::WorkspaceRecord, String> {
    let existing = as_error(state.service.workspace_get_repo_config_optional(&repo_path))?;

    let repo_config = RepoConfig {
        worktree_base_path: config.worktree_base_path.or_else(|| {
            existing
                .as_ref()
                .and_then(|entry| entry.worktree_base_path.clone())
        }),
        branch_prefix: config
            .branch_prefix
            .or_else(|| existing.as_ref().map(|entry| entry.branch_prefix.clone()))
            .unwrap_or_else(|| "obp".to_string()),
        trusted_hooks: config
            .trusted_hooks
            .or_else(|| existing.as_ref().map(|entry| entry.trusted_hooks))
            .unwrap_or(false),
        hooks: config
            .hooks
            .or_else(|| existing.as_ref().map(|entry| entry.hooks.clone()))
            .unwrap_or_default(),
        agent_defaults: config
            .agent_defaults
            .or_else(|| existing.as_ref().map(|entry| entry.agent_defaults.clone()))
            .unwrap_or_default(),
    };

    as_error(
        state
            .service
            .workspace_update_repo_config(&repo_path, repo_config),
    )
}

#[tauri::command]
pub async fn workspace_get_repo_config(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<host_infra_system::RepoConfig, String> {
    as_error(state.service.workspace_get_repo_config(&repo_path))
}

#[tauri::command]
pub async fn workspace_set_trusted_hooks(
    state: State<'_, AppState>,
    repo_path: String,
    trusted: bool,
) -> Result<host_domain::WorkspaceRecord, String> {
    as_error(
        state
            .service
            .workspace_set_trusted_hooks(&repo_path, trusted),
    )
}

#[tauri::command]
pub async fn get_theme(
    state: State<'_, AppState>,
) -> Result<String, String> {
    as_error(state.service.get_theme())
}

#[tauri::command]
pub async fn set_theme(
    state: State<'_, AppState>,
    theme: String,
) -> Result<(), String> {
    as_error(state.service.set_theme(&theme))
}
