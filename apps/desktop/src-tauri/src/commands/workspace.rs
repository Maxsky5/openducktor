use crate::{
    as_error, run_service_blocking, AppState, HookTrustChallenge, RepoConfigPayload,
    HOOK_TRUST_CHALLENGE_TTL,
};
use host_infra_system::{hook_set_fingerprint, HookSet, RepoConfig};
use std::path::Path;
use std::time::SystemTime;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use uuid::Uuid;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookTrustChallengePayload {
    nonce: String,
    repo_path: String,
    fingerprint: String,
    expires_at: String,
    pre_start_count: usize,
    post_complete_count: usize,
}

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
        trusted_hooks: existing
            .as_ref()
            .map(|entry| entry.trusted_hooks)
            .unwrap_or(false),
        trusted_hooks_fingerprint: existing
            .as_ref()
            .and_then(|entry| entry.trusted_hooks_fingerprint.clone()),
        hooks: existing
            .as_ref()
            .map(|entry| entry.hooks.clone())
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
pub async fn workspace_update_repo_hooks(
    state: State<'_, AppState>,
    repo_path: String,
    hooks: HookSet,
) -> Result<host_domain::WorkspaceRecord, String> {
    as_error(state.service.workspace_update_repo_hooks(&repo_path, hooks))
}

#[tauri::command]
pub async fn workspace_prepare_trusted_hooks_challenge(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<HookTrustChallengePayload, String> {
    let repo_config = as_error(state.service.workspace_get_repo_config(&repo_path))?;
    let canonical_repo_path = canonical_repo_key(&repo_path);
    let fingerprint = hook_set_fingerprint(&repo_config.hooks);
    let nonce = format!("hooks-trust-{}", Uuid::new_v4().simple());
    let expires_at = SystemTime::now()
        .checked_add(HOOK_TRUST_CHALLENGE_TTL)
        .ok_or_else(|| "Failed to allocate hook trust challenge window.".to_string())?;

    {
        let mut challenges = state
            .hook_trust_challenges
            .lock()
            .map_err(|_| "Hook trust challenge lock poisoned".to_string())?;
        prune_expired_hook_trust_challenges(&mut challenges);
        challenges.insert(
            nonce.clone(),
            HookTrustChallenge {
                repo_path: canonical_repo_path.clone(),
                fingerprint: fingerprint.clone(),
                expires_at,
            },
        );
    }

    Ok(HookTrustChallengePayload {
        nonce,
        repo_path: canonical_repo_path,
        fingerprint,
        expires_at: chrono::DateTime::<chrono::Utc>::from(expires_at).to_rfc3339(),
        pre_start_count: repo_config.hooks.pre_start.len(),
        post_complete_count: repo_config.hooks.post_complete.len(),
    })
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
    app: AppHandle,
    repo_path: String,
    trusted: bool,
    challenge_nonce: Option<String>,
    challenge_fingerprint: Option<String>,
) -> Result<host_domain::WorkspaceRecord, String> {
    if !trusted {
        return as_error(
            state
                .service
                .workspace_set_trusted_hooks(&repo_path, false, None),
        );
    }

    let nonce = challenge_nonce
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Hook trust confirmation requires challenge nonce.".to_string())?;
    let expected_fingerprint = challenge_fingerprint
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Hook trust confirmation requires challenge fingerprint.".to_string())?;

    let canonical_repo_path = canonical_repo_key(&repo_path);
    let challenge = {
        let mut challenges = state
            .hook_trust_challenges
            .lock()
            .map_err(|_| "Hook trust challenge lock poisoned".to_string())?;
        prune_expired_hook_trust_challenges(&mut challenges);
        let Some(challenge) = challenges.remove(&nonce) else {
            return Err(
                "Hook trust challenge is missing or expired. Retry confirmation.".to_string(),
            );
        };

        if challenge.repo_path != canonical_repo_path {
            return Err(
                "Hook trust challenge repository mismatch. Retry confirmation.".to_string(),
            );
        }

        if challenge.fingerprint != expected_fingerprint {
            return Err(
                "Hook trust challenge fingerprint mismatch. Retry confirmation.".to_string(),
            );
        }

        if challenge.expires_at <= SystemTime::now() {
            return Err("Hook trust challenge expired. Retry confirmation.".to_string());
        }

        challenge
    };

    let repo_config = as_error(state.service.workspace_get_repo_config(&repo_path))?;
    let latest_fingerprint = hook_set_fingerprint(&repo_config.hooks);
    if latest_fingerprint != challenge.fingerprint {
        return Err(
            "Hook commands changed after challenge generation. Request trust confirmation again."
                .to_string(),
        );
    }

    let dialog_message = format!(
        "Approve trusted hooks for this workspace?\n\nRepository:\n{repo}\n\nPre-start hooks:\n{pre}\n\nPost-complete hooks:\n{post}\n\nTrusted hooks can execute shell commands on this machine.",
        repo = canonical_repo_path,
        pre = format_hook_list(&repo_config.hooks.pre_start),
        post = format_hook_list(&repo_config.hooks.post_complete),
    );

    let confirmed = as_error(
        run_service_blocking("workspace_set_trusted_hooks_confirm", move || {
            Ok(app
                .dialog()
                .message(dialog_message)
                .title("Trust Workspace Hooks")
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Trust hooks".to_string(),
                    "Cancel".to_string(),
                ))
                .blocking_show())
        })
        .await,
    )?;

    if !confirmed {
        return Err("Hook trust confirmation was cancelled by the user.".to_string());
    }

    as_error(state.service.workspace_set_trusted_hooks(
        &repo_path,
        true,
        Some(challenge.fingerprint.as_str()),
    ))
}

#[tauri::command]
pub async fn get_theme(state: State<'_, AppState>) -> Result<String, String> {
    as_error(state.service.get_theme())
}

#[tauri::command]
pub async fn set_theme(state: State<'_, AppState>, theme: String) -> Result<(), String> {
    as_error(state.service.set_theme(&theme))
}

fn canonical_repo_key(repo_path: &str) -> String {
    std::fs::canonicalize(Path::new(repo_path))
        .ok()
        .and_then(|path| path.to_str().map(|value| value.to_string()))
        .unwrap_or_else(|| repo_path.trim().to_string())
}

fn prune_expired_hook_trust_challenges(
    challenges: &mut std::collections::HashMap<String, HookTrustChallenge>,
) {
    let now = SystemTime::now();
    challenges.retain(|_, challenge| challenge.expires_at > now);
}

fn format_hook_list(commands: &[String]) -> String {
    if commands.is_empty() {
        return "(none)".to_string();
    }

    let preview_limit = 5;
    let mut lines = commands
        .iter()
        .take(preview_limit)
        .map(|command| format!("- {command}"))
        .collect::<Vec<_>>();
    if commands.len() > preview_limit {
        lines.push(format!("- ... and {} more", commands.len() - preview_limit));
    }
    lines.join("\n")
}
