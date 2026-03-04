use crate::{
    as_error, run_service_blocking, AppState, HookTrustChallenge, RepoConfigPayload,
    RepoSettingsPayload, SettingsSnapshotPayload, SettingsSnapshotResponsePayload,
    HOOK_TRUST_CHALLENGE_TTL,
};
use host_infra_system::{hook_set_fingerprint, HookSet, RepoConfig};
use std::path::Path;
use std::time::SystemTime;
#[cfg(test)]
use tauri::Manager;
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
    let selected = as_error(state.service.workspace_select(&repo_path))?;
    super::git::invalidate_worktree_resolution_cache_all()?;
    Ok(selected)
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
        default_target_branch: config
            .default_target_branch
            .or_else(|| {
                existing
                    .as_ref()
                    .map(|entry| entry.default_target_branch.clone())
            })
            .unwrap_or_else(|| "origin/main".to_string()),
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
        worktree_file_copies: config
            .worktree_file_copies
            .or_else(|| {
                existing
                    .as_ref()
                    .map(|entry| entry.worktree_file_copies.clone())
            })
            .unwrap_or_default(),
        prompt_overrides: config
            .prompt_overrides
            .or_else(|| {
                existing
                    .as_ref()
                    .map(|entry| entry.prompt_overrides.clone())
            })
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

// Generic runtime keeps this command testable under MockRuntime without changing
// production behavior on the default Wry runtime.
#[tauri::command]
pub async fn workspace_save_repo_settings<R: tauri::Runtime>(
    state: State<'_, AppState>,
    app: AppHandle<R>,
    repo_path: String,
    settings: RepoSettingsPayload,
) -> Result<host_domain::WorkspaceRecord, String> {
    let existing =
        as_error(state.service.workspace_get_repo_config_optional(&repo_path))?.unwrap_or_default();

    let (normalized_hooks, trusted_hooks_fingerprint) = normalize_hooks_with_trust_confirmation(
        &app,
        repo_path.as_str(),
        &existing,
        settings.trusted_hooks,
        settings.hooks.unwrap_or_else(|| existing.hooks.clone()),
    )
    .await?;

    let final_repo_config = RepoConfig {
        worktree_base_path: settings.worktree_base_path.or(existing.worktree_base_path),
        branch_prefix: settings.branch_prefix.unwrap_or(existing.branch_prefix),
        default_target_branch: settings
            .default_target_branch
            .unwrap_or(existing.default_target_branch),
        trusted_hooks: settings.trusted_hooks,
        trusted_hooks_fingerprint,
        hooks: normalized_hooks,
        worktree_file_copies: settings
            .worktree_file_copies
            .unwrap_or(existing.worktree_file_copies),
        prompt_overrides: settings
            .prompt_overrides
            .unwrap_or(existing.prompt_overrides),
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
pub async fn workspace_get_settings_snapshot(
    state: State<'_, AppState>,
) -> Result<SettingsSnapshotResponsePayload, String> {
    let (repos, global_prompt_overrides) =
        as_error(state.service.workspace_get_settings_snapshot())?;
    Ok(SettingsSnapshotResponsePayload {
        repos,
        global_prompt_overrides,
    })
}

#[tauri::command]
pub async fn workspace_save_settings_snapshot<R: tauri::Runtime>(
    state: State<'_, AppState>,
    app: AppHandle<R>,
    snapshot: SettingsSnapshotPayload,
) -> Result<Vec<host_domain::WorkspaceRecord>, String> {
    let SettingsSnapshotPayload {
        mut repos,
        global_prompt_overrides,
    } = snapshot;

    for (repo_path, repo_config) in repos.iter_mut() {
        let existing = as_error(state.service.workspace_get_repo_config_optional(repo_path))?
            .unwrap_or_default();
        let submitted_hooks = std::mem::take(&mut repo_config.hooks);
        let (normalized_hooks, trusted_hooks_fingerprint) =
            normalize_hooks_with_trust_confirmation(
                &app,
                repo_path.as_str(),
                &existing,
                repo_config.trusted_hooks,
                submitted_hooks,
            )
            .await?;
        repo_config.hooks = normalized_hooks;
        repo_config.trusted_hooks_fingerprint = trusted_hooks_fingerprint;
    }

    as_error(
        state
            .service
            .workspace_save_settings_snapshot(repos, global_prompt_overrides),
    )?;
    as_error(state.service.workspace_list())
}

// Generic runtime keeps this command testable under MockRuntime without changing
// production behavior on the default Wry runtime.
#[tauri::command]
pub async fn workspace_set_trusted_hooks<R: tauri::Runtime>(
    state: State<'_, AppState>,
    app: AppHandle<R>,
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

// Generic runtime keeps dialog plumbing compatible with command tests that run
// under MockRuntime.
async fn confirm_hook_trust_dialog<R: tauri::Runtime>(
    app: &AppHandle<R>,
    repo_path: &str,
    hooks: &HookSet,
) -> Result<(), String> {
    #[cfg(test)]
    {
        let test_response = {
            let state = app.state::<AppState>();
            let response = state
                .hook_trust_dialog_test_response
                .lock()
                .map_err(|_| "Hook trust dialog test response lock poisoned".to_string())?;
            *response
        };
        if let Some(confirmed) = test_response {
            if !confirmed {
                return Err("Hook trust confirmation was cancelled by the user.".to_string());
            }
            return Ok(());
        }
    }

    let dialog_message = format!(
        "Approve trusted scripts for this workspace?\n\nRepository:\n{repo}\n\nWorktree setup script commands:\n{pre}\n\nWorktree cleanup script commands:\n{post}\n\nTrusted scripts can execute shell commands on this machine.",
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
                .title("Trust Workspace Scripts")
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Trust scripts".to_string(),
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

async fn normalize_hooks_with_trust_confirmation<R: tauri::Runtime>(
    app: &AppHandle<R>,
    repo_path: &str,
    existing: &RepoConfig,
    trusted_hooks: bool,
    hooks: HookSet,
) -> Result<(HookSet, Option<String>), String> {
    let normalized_hooks = normalize_hook_set(hooks);
    let hooks_fingerprint = hook_set_fingerprint(&normalized_hooks);
    let trust_already_approved_for_same_hooks = existing.trusted_hooks
        && existing.hooks == normalized_hooks
        && existing.trusted_hooks_fingerprint.as_deref() == Some(hooks_fingerprint.as_str());

    if trusted_hooks && !trust_already_approved_for_same_hooks {
        confirm_hook_trust_dialog(app, repo_path, &normalized_hooks).await?;
    }

    let trusted_hooks_fingerprint = if trusted_hooks {
        Some(hooks_fingerprint)
    } else {
        None
    };

    Ok((normalized_hooks, trusted_hooks_fingerprint))
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
        validate_trust_challenge_entry, workspace_save_settings_snapshot,
        workspace_set_trusted_hooks, HookSet, HookTrustChallenge,
    };
    use crate::{AppState, SettingsSnapshotPayload};
    use host_application::AppService;
    use host_domain::{TaskStore, WorkspaceRecord, TASK_METADATA_NAMESPACE};
    use host_infra_beads::BeadsTaskStore;
    use host_infra_system::{hook_set_fingerprint, AppConfigStore, GitCliPort, PromptOverride};
    use serde_json::{json, Value};
    use std::{
        collections::HashMap,
        fs,
        path::PathBuf,
        sync::{Arc, Mutex},
        time::{Duration, SystemTime, UNIX_EPOCH},
    };
    use tauri::{
        ipc::{CallbackFn, InvokeBody},
        test::{mock_builder, mock_context, noop_assets, MockRuntime},
        webview::InvokeRequest,
        App, Manager,
    };

    struct WorkspaceCommandFixture {
        app: App<MockRuntime>,
        service: Arc<AppService>,
        repo_path: String,
        root: PathBuf,
    }

    impl Drop for WorkspaceCommandFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn unique_test_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("openducktor-workspace-command-{prefix}-{nanos}"));
        fs::create_dir_all(&root).expect("test root should be created");
        root
    }

    fn setup_workspace_command_fixture(prefix: &str, hooks: HookSet) -> WorkspaceCommandFixture {
        setup_workspace_command_fixture_with_dialog_response(prefix, hooks, None)
    }

    fn setup_workspace_command_fixture_with_dialog_response(
        prefix: &str,
        hooks: HookSet,
        dialog_response: Option<bool>,
    ) -> WorkspaceCommandFixture {
        let root = unique_test_dir(prefix);
        let repo = root.join("repo");
        fs::create_dir_all(repo.join(".git")).expect("fake git workspace should exist");
        let repo_path = repo.to_string_lossy().to_string();

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        config_store
            .add_workspace(repo_path.as_str())
            .expect("workspace should be allowlisted");
        config_store
            .update_repo_hooks(repo_path.as_str(), hooks)
            .expect("hooks should be persisted");

        let task_store: Arc<dyn TaskStore> = Arc::new(BeadsTaskStore::with_metadata_namespace(
            TASK_METADATA_NAMESPACE,
        ));
        let service = Arc::new(AppService::with_git_port(
            task_store,
            config_store,
            Arc::new(GitCliPort::new()),
        ));

        let app = mock_builder()
            .manage(AppState {
                service: service.clone(),
                hook_trust_challenges: Mutex::new(HashMap::new()),
                hook_trust_dialog_test_response: Mutex::new(dialog_response),
            })
            .invoke_handler(tauri::generate_handler![
                workspace_set_trusted_hooks,
                workspace_save_settings_snapshot
            ])
            .build(mock_context(noop_assets()))
            .expect("test app should build");

        WorkspaceCommandFixture {
            app,
            service,
            repo_path,
            root,
        }
    }

    fn run_workspace_set_trusted_hooks(
        fixture: &WorkspaceCommandFixture,
        trusted: bool,
        challenge_nonce: Option<String>,
        challenge_fingerprint: Option<String>,
    ) -> Result<WorkspaceRecord, String> {
        let state = fixture.app.state::<AppState>();
        let app_handle = fixture.app.handle().clone();
        tauri::async_runtime::block_on(workspace_set_trusted_hooks(
            state,
            app_handle,
            fixture.repo_path.clone(),
            trusted,
            challenge_nonce,
            challenge_fingerprint,
        ))
    }

    fn run_workspace_save_settings_snapshot(
        fixture: &WorkspaceCommandFixture,
        snapshot: SettingsSnapshotPayload,
    ) -> Result<Vec<WorkspaceRecord>, String> {
        let state = fixture.app.state::<AppState>();
        let app_handle = fixture.app.handle().clone();
        tauri::async_runtime::block_on(workspace_save_settings_snapshot(
            state, app_handle, snapshot,
        ))
    }

    fn insert_challenge(
        fixture: &WorkspaceCommandFixture,
        nonce: &str,
        challenge: HookTrustChallenge,
    ) -> Result<(), String> {
        let state = fixture.app.state::<AppState>();
        let mut map = state
            .hook_trust_challenges
            .lock()
            .map_err(|_| "challenge lock poisoned".to_string())?;
        map.insert(nonce.to_string(), challenge);
        Ok(())
    }

    fn invoke_workspace_set_trusted_hooks_ipc(
        fixture: &WorkspaceCommandFixture,
        payload: Value,
    ) -> Result<Value, Value> {
        let label = format!(
            "main-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        );
        let webview = tauri::WebviewWindowBuilder::new(&fixture.app, label, Default::default())
            .build()
            .expect("test webview should build");

        tauri::test::get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: "workspace_set_trusted_hooks".to_string(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "http://tauri.localhost"
                    .parse()
                    .expect("invoke URL should parse"),
                body: InvokeBody::Json(payload),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .map(|body| {
            body.deserialize::<Value>()
                .expect("IPC response should deserialize")
        })
    }

    fn invoke_workspace_save_settings_snapshot_ipc(
        fixture: &WorkspaceCommandFixture,
        payload: Value,
    ) -> Result<Value, Value> {
        let label = format!(
            "snapshot-main-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        );
        let webview = tauri::WebviewWindowBuilder::new(&fixture.app, label, Default::default())
            .build()
            .expect("test webview should build");

        tauri::test::get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: "workspace_save_settings_snapshot".to_string(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "http://tauri.localhost"
                    .parse()
                    .expect("invoke URL should parse"),
                body: InvokeBody::Json(payload),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .map(|body| {
            body.deserialize::<Value>()
                .expect("IPC response should deserialize")
        })
    }

    #[test]
    fn workspace_set_trusted_hooks_requires_nonce_and_fingerprint_when_enabling() {
        let fixture =
            setup_workspace_command_fixture("missing-challenge-fields", HookSet::default());

        let missing_nonce =
            run_workspace_set_trusted_hooks(&fixture, true, None, Some("abc".to_string()))
                .expect_err("missing nonce should fail");
        assert!(
            missing_nonce.contains("requires challenge nonce"),
            "unexpected nonce error: {missing_nonce}"
        );

        let missing_fingerprint =
            run_workspace_set_trusted_hooks(&fixture, true, Some("nonce-1".to_string()), None)
                .expect_err("missing fingerprint should fail");
        assert!(
            missing_fingerprint.contains("requires challenge fingerprint"),
            "unexpected fingerprint error: {missing_fingerprint}"
        );
    }

    #[test]
    fn workspace_set_trusted_hooks_ipc_rejects_missing_nonce() {
        let fixture = setup_workspace_command_fixture("ipc-missing-nonce", HookSet::default());
        let error = invoke_workspace_set_trusted_hooks_ipc(
            &fixture,
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "trusted": true,
                "challengeFingerprint": "abc",
            }),
        )
        .expect_err("missing nonce should fail over IPC");
        assert!(
            error.to_string().contains("requires challenge nonce"),
            "unexpected IPC error: {error}"
        );
    }

    #[test]
    fn workspace_set_trusted_hooks_rejects_expired_challenge_entries() -> Result<(), String> {
        let fixture = setup_workspace_command_fixture("expired-challenge", HookSet::default());
        let nonce = "expired-nonce".to_string();
        let fingerprint = hook_set_fingerprint(&HookSet::default());
        insert_challenge(
            &fixture,
            nonce.as_str(),
            HookTrustChallenge {
                repo_path: canonical_repo_key(fixture.repo_path.as_str()),
                fingerprint: fingerprint.clone(),
                expires_at: SystemTime::now()
                    .checked_sub(Duration::from_secs(1))
                    .ok_or_else(|| "expired time should be valid".to_string())?,
            },
        )?;

        let error = run_workspace_set_trusted_hooks(&fixture, true, Some(nonce), Some(fingerprint))
            .expect_err("expired challenge should fail");
        assert!(
            error.contains("missing or expired"),
            "unexpected error: {error}"
        );
        Ok(())
    }

    #[test]
    fn workspace_set_trusted_hooks_rejects_fingerprint_mismatch() -> Result<(), String> {
        let hooks = HookSet {
            pre_start: vec!["echo pre".to_string()],
            post_complete: Vec::new(),
        };
        let fixture = setup_workspace_command_fixture("fingerprint-mismatch", hooks.clone());
        let nonce = "nonce-fp-mismatch".to_string();
        let expected_fingerprint = hook_set_fingerprint(&hooks);
        insert_challenge(
            &fixture,
            nonce.as_str(),
            HookTrustChallenge {
                repo_path: canonical_repo_key(fixture.repo_path.as_str()),
                fingerprint: expected_fingerprint,
                expires_at: SystemTime::now()
                    .checked_add(Duration::from_secs(60))
                    .ok_or_else(|| "future time should be valid".to_string())?,
            },
        )?;

        let error = run_workspace_set_trusted_hooks(
            &fixture,
            true,
            Some(nonce),
            Some("different-fingerprint".to_string()),
        )
        .expect_err("fingerprint mismatch should fail");
        assert!(
            error.contains("fingerprint mismatch"),
            "unexpected error: {error}"
        );
        Ok(())
    }

    #[test]
    fn workspace_set_trusted_hooks_rejects_repository_mismatch_and_consumes_nonce(
    ) -> Result<(), String> {
        let fixture = setup_workspace_command_fixture("repo-mismatch", HookSet::default());
        let nonce = "nonce-repo-mismatch".to_string();
        let fingerprint = hook_set_fingerprint(&HookSet::default());
        insert_challenge(
            &fixture,
            nonce.as_str(),
            HookTrustChallenge {
                repo_path: "/tmp/not-the-same-repo".to_string(),
                fingerprint: fingerprint.clone(),
                expires_at: SystemTime::now()
                    .checked_add(Duration::from_secs(60))
                    .ok_or_else(|| "future time should be valid".to_string())?,
            },
        )?;

        let mismatch_error = run_workspace_set_trusted_hooks(
            &fixture,
            true,
            Some(nonce.clone()),
            Some(fingerprint.clone()),
        )
        .expect_err("repository mismatch should fail");
        assert!(
            mismatch_error.contains("repository mismatch"),
            "unexpected mismatch error: {mismatch_error}"
        );

        let replay_error =
            run_workspace_set_trusted_hooks(&fixture, true, Some(nonce), Some(fingerprint))
                .expect_err("challenge nonce should be consumed after mismatch");
        assert!(
            replay_error.contains("missing or expired"),
            "unexpected replay error: {replay_error}"
        );
        Ok(())
    }

    #[test]
    fn workspace_set_trusted_hooks_accepts_valid_challenge_and_persists_trust() -> Result<(), String>
    {
        let hooks = HookSet {
            pre_start: vec!["echo pre".to_string()],
            post_complete: vec!["echo post".to_string()],
        };
        let fixture = setup_workspace_command_fixture_with_dialog_response(
            "trusted-hooks-happy-path",
            hooks.clone(),
            Some(true),
        );
        let nonce = "nonce-trust-success".to_string();
        let fingerprint = hook_set_fingerprint(&hooks);
        insert_challenge(
            &fixture,
            nonce.as_str(),
            HookTrustChallenge {
                repo_path: canonical_repo_key(fixture.repo_path.as_str()),
                fingerprint: fingerprint.clone(),
                expires_at: SystemTime::now()
                    .checked_add(Duration::from_secs(60))
                    .ok_or_else(|| "future time should be valid".to_string())?,
            },
        )?;

        let updated =
            run_workspace_set_trusted_hooks(&fixture, true, Some(nonce), Some(fingerprint.clone()))
                .expect("valid challenge should trust hooks");
        assert_eq!(updated.path, canonical_repo_key(fixture.repo_path.as_str()));

        let repo_config = fixture
            .service
            .workspace_get_repo_config(fixture.repo_path.as_str())
            .map_err(|error| error.to_string())?;
        assert!(repo_config.trusted_hooks);
        assert_eq!(
            repo_config.trusted_hooks_fingerprint.as_deref(),
            Some(fingerprint.as_str())
        );
        Ok(())
    }

    #[test]
    fn workspace_set_trusted_hooks_consumes_nonce_and_rejects_replay_after_hook_changes(
    ) -> Result<(), String> {
        let original_hooks = HookSet {
            pre_start: vec!["echo pre".to_string()],
            post_complete: Vec::new(),
        };
        let fixture = setup_workspace_command_fixture("replay-and-stale", original_hooks.clone());
        let nonce = "nonce-replay".to_string();
        let challenge_fingerprint = hook_set_fingerprint(&original_hooks);
        insert_challenge(
            &fixture,
            nonce.as_str(),
            HookTrustChallenge {
                repo_path: canonical_repo_key(fixture.repo_path.as_str()),
                fingerprint: challenge_fingerprint.clone(),
                expires_at: SystemTime::now()
                    .checked_add(Duration::from_secs(60))
                    .ok_or_else(|| "future time should be valid".to_string())?,
            },
        )?;

        fixture
            .service
            .workspace_update_repo_hooks(
                fixture.repo_path.as_str(),
                HookSet {
                    pre_start: vec!["echo changed".to_string()],
                    post_complete: Vec::new(),
                },
            )
            .map_err(|error| error.to_string())?;

        let stale_error = run_workspace_set_trusted_hooks(
            &fixture,
            true,
            Some(nonce.clone()),
            Some(challenge_fingerprint),
        )
        .expect_err("stale hook challenge should fail");
        assert!(
            stale_error.contains("Hook commands changed after challenge generation"),
            "unexpected stale challenge error: {stale_error}"
        );

        let replay_error = run_workspace_set_trusted_hooks(
            &fixture,
            true,
            Some(nonce),
            Some("ignored".to_string()),
        )
        .expect_err("replay should fail after nonce consumption");
        assert!(
            replay_error.contains("missing or expired"),
            "unexpected replay error: {replay_error}"
        );
        Ok(())
    }

    #[test]
    fn workspace_set_trusted_hooks_disables_without_challenge() -> Result<(), String> {
        let hooks = HookSet {
            pre_start: vec!["echo pre".to_string()],
            post_complete: Vec::new(),
        };
        let fixture = setup_workspace_command_fixture("disable-without-challenge", hooks.clone());
        let fingerprint = hook_set_fingerprint(&hooks);
        fixture
            .service
            .workspace_set_trusted_hooks(
                fixture.repo_path.as_str(),
                true,
                Some(fingerprint.as_str()),
            )
            .map_err(|error| error.to_string())?;

        let updated = run_workspace_set_trusted_hooks(&fixture, false, None, None)
            .expect("disabling trust should succeed");
        assert_eq!(updated.path, canonical_repo_key(fixture.repo_path.as_str()));

        let repo_config = fixture
            .service
            .workspace_get_repo_config(fixture.repo_path.as_str())
            .map_err(|error| error.to_string())?;
        assert!(!repo_config.trusted_hooks);
        assert!(repo_config.trusted_hooks_fingerprint.is_none());
        Ok(())
    }

    #[test]
    fn workspace_save_settings_snapshot_requires_trust_confirmation_when_enabling_hooks(
    ) -> Result<(), String> {
        let hooks = HookSet {
            pre_start: vec!["echo pre".to_string()],
            post_complete: vec!["echo post".to_string()],
        };
        let fixture = setup_workspace_command_fixture_with_dialog_response(
            "snapshot-trust-cancelled",
            hooks,
            Some(false),
        );

        let (repos, global_prompt_overrides) = fixture
            .service
            .workspace_get_settings_snapshot()
            .map_err(|error| error.to_string())?;
        let mut snapshot = SettingsSnapshotPayload {
            repos,
            global_prompt_overrides,
        };
        let repo_key = canonical_repo_key(fixture.repo_path.as_str());
        let repo_config = snapshot
            .repos
            .get_mut(repo_key.as_str())
            .ok_or_else(|| "repo config missing from snapshot".to_string())?;
        repo_config.trusted_hooks = true;

        let error = run_workspace_save_settings_snapshot(&fixture, snapshot)
            .expect_err("enabling trust should require confirmation");
        assert!(
            error.contains("cancelled"),
            "unexpected trust confirmation error: {error}"
        );

        let persisted = fixture
            .service
            .workspace_get_repo_config(fixture.repo_path.as_str())
            .map_err(|error| error.to_string())?;
        assert!(
            !persisted.trusted_hooks,
            "snapshot save should not bypass trust confirmation"
        );
        assert!(persisted.trusted_hooks_fingerprint.is_none());
        Ok(())
    }

    #[test]
    fn workspace_save_settings_snapshot_persists_trusted_fingerprint_after_confirmation(
    ) -> Result<(), String> {
        let hooks = HookSet {
            pre_start: vec![" echo pre ".to_string()],
            post_complete: vec!["echo post".to_string()],
        };
        let fixture = setup_workspace_command_fixture_with_dialog_response(
            "snapshot-trust-confirmed",
            hooks.clone(),
            Some(true),
        );

        let (repos, global_prompt_overrides) = fixture
            .service
            .workspace_get_settings_snapshot()
            .map_err(|error| error.to_string())?;
        let mut snapshot = SettingsSnapshotPayload {
            repos,
            global_prompt_overrides,
        };
        let repo_key = canonical_repo_key(fixture.repo_path.as_str());
        let repo_config = snapshot
            .repos
            .get_mut(repo_key.as_str())
            .ok_or_else(|| "repo config missing from snapshot".to_string())?;
        repo_config.trusted_hooks = true;
        repo_config.hooks = HookSet {
            pre_start: vec!["  echo pre  ".to_string()],
            post_complete: vec!["echo post".to_string()],
        };
        repo_config.trusted_hooks_fingerprint = None;

        run_workspace_save_settings_snapshot(&fixture, snapshot)
            .expect("snapshot save should persist trusted hooks");

        let persisted = fixture
            .service
            .workspace_get_repo_config(fixture.repo_path.as_str())
            .map_err(|error| error.to_string())?;
        let normalized_hooks = HookSet {
            pre_start: vec!["echo pre".to_string()],
            post_complete: vec!["echo post".to_string()],
        };
        let expected_fingerprint = hook_set_fingerprint(&normalized_hooks);
        assert!(persisted.trusted_hooks);
        assert_eq!(persisted.hooks, normalized_hooks);
        assert_eq!(
            persisted.trusted_hooks_fingerprint.as_deref(),
            Some(expected_fingerprint.as_str())
        );
        Ok(())
    }

    #[test]
    fn workspace_save_settings_snapshot_ipc_preserves_shared_prompt_override_keys(
    ) -> Result<(), String> {
        let fixture =
            setup_workspace_command_fixture("snapshot-ipc-shared-prompts", HookSet::default());

        let (repos, global_prompt_overrides) = fixture
            .service
            .workspace_get_settings_snapshot()
            .map_err(|error| error.to_string())?;
        let mut snapshot = SettingsSnapshotPayload {
            repos,
            global_prompt_overrides,
        };

        snapshot.global_prompt_overrides.insert(
            "system.shared.workflow_guards".to_string(),
            PromptOverride {
                template: "global workflow guards".to_string(),
                base_version: 1,
                enabled: true,
            },
        );
        snapshot.global_prompt_overrides.insert(
            "system.shared.tool_protocol".to_string(),
            PromptOverride {
                template: "global tool protocol".to_string(),
                base_version: 1,
                enabled: true,
            },
        );

        let repo_key = canonical_repo_key(fixture.repo_path.as_str());
        let repo_config = snapshot
            .repos
            .get_mut(repo_key.as_str())
            .ok_or_else(|| "repo config missing from snapshot".to_string())?;
        repo_config.prompt_overrides.insert(
            "system.shared.workflow_guards".to_string(),
            PromptOverride {
                template: "repo workflow guards".to_string(),
                base_version: 1,
                enabled: true,
            },
        );
        repo_config.prompt_overrides.insert(
            "system.shared.tool_protocol".to_string(),
            PromptOverride {
                template: "repo tool protocol".to_string(),
                base_version: 1,
                enabled: false,
            },
        );

        let payload = json!({
            "snapshot": {
                "repos": snapshot.repos,
                "globalPromptOverrides": snapshot.global_prompt_overrides,
            }
        });

        let ipc_response = invoke_workspace_save_settings_snapshot_ipc(&fixture, payload)
            .expect("IPC snapshot save should succeed");
        let records = ipc_response
            .as_array()
            .ok_or_else(|| "IPC response should be an array".to_string())?;
        assert!(
            !records.is_empty(),
            "snapshot save response should include workspace records"
        );

        let (persisted_repos, persisted_global) = fixture
            .service
            .workspace_get_settings_snapshot()
            .map_err(|error| error.to_string())?;
        let persisted_repo = persisted_repos
            .get(repo_key.as_str())
            .ok_or_else(|| "persisted repo config missing".to_string())?;

        assert_eq!(
            persisted_global
                .get("system.shared.workflow_guards")
                .map(|entry| entry.template.as_str()),
            Some("global workflow guards")
        );
        assert_eq!(
            persisted_global
                .get("system.shared.tool_protocol")
                .map(|entry| entry.template.as_str()),
            Some("global tool protocol")
        );
        assert_eq!(
            persisted_repo
                .prompt_overrides
                .get("system.shared.workflow_guards")
                .map(|entry| entry.template.as_str()),
            Some("repo workflow guards")
        );
        assert_eq!(
            persisted_repo
                .prompt_overrides
                .get("system.shared.tool_protocol")
                .map(|entry| entry.enabled),
            Some(false)
        );

        Ok(())
    }

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
