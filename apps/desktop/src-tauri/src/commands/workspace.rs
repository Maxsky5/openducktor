use crate::{
    as_error, run_service_blocking, AppState, HookTrustChallenge, RepoConfigPayload,
    RepoSettingsPayload, HOOK_TRUST_CHALLENGE_TTL,
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
pub async fn workspace_save_repo_settings(
    state: State<'_, AppState>,
    app: AppHandle,
    repo_path: String,
    settings: RepoSettingsPayload,
) -> Result<host_domain::WorkspaceRecord, String> {
    let existing =
        as_error(state.service.workspace_get_repo_config_optional(&repo_path))?.unwrap_or_default();

    let normalized_hooks =
        normalize_hook_set(settings.hooks.unwrap_or_else(|| existing.hooks.clone()));
    let hooks_fingerprint = hook_set_fingerprint(&normalized_hooks);
    let trust_already_approved_for_same_hooks = existing.trusted_hooks
        && existing.hooks == normalized_hooks
        && existing.trusted_hooks_fingerprint.as_deref() == Some(hooks_fingerprint.as_str());

    if settings.trusted_hooks && !trust_already_approved_for_same_hooks {
        confirm_hook_trust_dialog(&app, &repo_path, &normalized_hooks).await?;
    }

    let final_repo_config = RepoConfig {
        worktree_base_path: settings.worktree_base_path.or(existing.worktree_base_path),
        branch_prefix: settings.branch_prefix.unwrap_or(existing.branch_prefix),
        trusted_hooks: settings.trusted_hooks,
        trusted_hooks_fingerprint: if settings.trusted_hooks {
            Some(hooks_fingerprint)
        } else {
            None
        },
        hooks: normalized_hooks,
        agent_defaults: settings.agent_defaults.unwrap_or(existing.agent_defaults),
    };

    as_error(
        state
            .service
            .workspace_update_repo_config(&repo_path, final_repo_config),
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

        validate_trust_challenge_entry(
            &challenge,
            canonical_repo_path.as_str(),
            expected_fingerprint.as_str(),
            SystemTime::now(),
        )?;

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

    confirm_hook_trust_dialog(&app, canonical_repo_path.as_str(), &repo_config.hooks).await?;

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
        .map(|command| format!("- {}", sanitize_hook_preview(command)))
        .collect::<Vec<_>>();
    if commands.len() > preview_limit {
        lines.push(format!("- ... and {} more", commands.len() - preview_limit));
    }
    lines.join("\n")
}

fn sanitize_hook_preview(command: &str) -> String {
    const PREVIEW_LIMIT: usize = 240;
    let mut escaped = String::new();
    for ch in command.chars() {
        match ch {
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            _ if ch.is_control() => escaped.push_str(&format!("\\u{{{:04X}}}", ch as u32)),
            _ => escaped.push(ch),
        }
        if escaped.len() > PREVIEW_LIMIT {
            escaped.truncate(PREVIEW_LIMIT);
            escaped.push_str("...");
            return escaped;
        }
    }
    escaped
}

async fn confirm_hook_trust_dialog(
    app: &AppHandle,
    repo_path: &str,
    hooks: &HookSet,
) -> Result<(), String> {
    let dialog_message = format!(
        "Approve trusted hooks for this workspace?\n\nRepository:\n{repo}\n\nPre-start hooks:\n{pre}\n\nPost-complete hooks:\n{post}\n\nTrusted hooks can execute shell commands on this machine.",
        repo = repo_path,
        pre = format_hook_list(&hooks.pre_start),
        post = format_hook_list(&hooks.post_complete),
    );

    let app_handle = app.clone();
    let confirmed = as_error(
        run_service_blocking("workspace_set_trusted_hooks_confirm", move || {
            Ok(app_handle
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

    Ok(())
}

fn validate_trust_challenge_entry(
    challenge: &HookTrustChallenge,
    canonical_repo_path: &str,
    expected_fingerprint: &str,
    now: SystemTime,
) -> Result<(), String> {
    if challenge.repo_path != canonical_repo_path {
        return Err("Hook trust challenge repository mismatch. Retry confirmation.".to_string());
    }
    if challenge.fingerprint != expected_fingerprint {
        return Err("Hook trust challenge fingerprint mismatch. Retry confirmation.".to_string());
    }
    if challenge.expires_at <= now {
        return Err("Hook trust challenge expired. Retry confirmation.".to_string());
    }
    Ok(())
}

fn normalize_hook_set(mut hooks: HookSet) -> HookSet {
    normalize_hook_commands(&mut hooks.pre_start);
    normalize_hook_commands(&mut hooks.post_complete);
    hooks
}

fn normalize_hook_commands(commands: &mut Vec<String>) {
    *commands = std::mem::take(commands)
        .into_iter()
        .filter_map(|command| {
            let trimmed = command.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .collect();
}

#[cfg(test)]
mod tests {
    use super::{
        canonical_repo_key, format_hook_list, normalize_hook_set, sanitize_hook_preview,
        validate_trust_challenge_entry, HookSet, HookTrustChallenge,
    };
    use std::time::{Duration, SystemTime};

    #[test]
    fn sanitize_hook_preview_escapes_controls_and_truncates() {
        let preview = sanitize_hook_preview("echo\tok\nnext\rline\u{0007}");
        assert!(preview.contains("\\t"));
        assert!(preview.contains("\\n"));
        assert!(preview.contains("\\r"));
        assert!(preview.contains("\\u{0007}"));

        let long = "x".repeat(300);
        let preview = sanitize_hook_preview(long.as_str());
        assert!(preview.ends_with("..."));
        assert!(preview.len() <= 243);
    }

    #[test]
    fn format_hook_list_sanitizes_entries_and_limits_output() {
        let hooks = vec![
            "echo a".to_string(),
            "echo b\nline".to_string(),
            "echo c".to_string(),
            "echo d".to_string(),
            "echo e".to_string(),
            "echo f".to_string(),
        ];
        let formatted = format_hook_list(&hooks);
        assert!(formatted.contains("- echo b\\nline"));
        assert!(formatted.contains("... and 1 more"));
    }

    #[test]
    fn normalize_hook_set_trims_and_removes_blank_commands() {
        let normalized = normalize_hook_set(HookSet {
            pre_start: vec!["  echo pre  ".to_string(), "   ".to_string()],
            post_complete: vec!["".to_string(), " echo post ".to_string()],
        });
        assert_eq!(normalized.pre_start, vec!["echo pre".to_string()]);
        assert_eq!(normalized.post_complete, vec!["echo post".to_string()]);
    }

    #[test]
    fn validate_trust_challenge_entry_checks_repo_and_fingerprint_and_expiry() -> Result<(), String>
    {
        let now = SystemTime::now();
        let challenge = HookTrustChallenge {
            repo_path: "/repo".to_string(),
            fingerprint: "abc".to_string(),
            expires_at: now
                .checked_add(Duration::from_secs(5))
                .ok_or_else(|| "challenge expiry".to_string())?,
        };
        assert!(
            validate_trust_challenge_entry(&challenge, "/repo", "abc", now).is_ok(),
            "valid challenge should pass"
        );

        let repo_error = validate_trust_challenge_entry(&challenge, "/repo-2", "abc", now)
            .expect_err("repo mismatch should fail");
        assert!(repo_error.contains("repository mismatch"));

        let fingerprint_error = validate_trust_challenge_entry(&challenge, "/repo", "def", now)
            .expect_err("fingerprint mismatch should fail");
        assert!(fingerprint_error.contains("fingerprint mismatch"));

        let expired = HookTrustChallenge {
            expires_at: now
                .checked_sub(Duration::from_secs(1))
                .ok_or_else(|| "expired instant".to_string())?,
            ..challenge
        };
        let expired_error = validate_trust_challenge_entry(&expired, "/repo", "abc", now)
            .expect_err("expired challenge should fail");
        assert!(expired_error.contains("expired"));
        Ok(())
    }

    #[test]
    fn canonical_repo_key_keeps_input_when_path_does_not_exist() {
        let missing_path = "/this/path/should/not/exist-for-openducktor";
        assert_eq!(canonical_repo_key(missing_path), missing_path.to_string());
    }
}
