use crate::{
    as_error, run_service_blocking, AppState, RepoConfigPayload, RepoSettingsPayload,
    SettingsSnapshotPayload, SettingsSnapshotResponsePayload,
};
use base64::Engine;
use host_application::{
    HookTrustConfirmationPort, HookTrustConfirmationRequest, PreparedHookTrustChallenge,
    RepoConfigUpdate, RepoSettingsUpdate, WorkspaceSettingsSnapshotUpdate,
};
use host_infra_system::HookSet;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
#[cfg(test)]
use tauri::Manager;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use uuid::Uuid;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedLocalAttachmentPayload {
    pub path: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedLocalAttachmentPayload {
    pub path: String,
}

const LOCAL_ATTACHMENT_STAGE_DIR_NAME: &str = "openducktor-local-attachments";
const MAX_ATTACHMENT_LOOKUP_DISPLAY_LEN: usize = 128;

pub(crate) fn local_attachment_stage_dir() -> PathBuf {
    std::env::temp_dir().join(LOCAL_ATTACHMENT_STAGE_DIR_NAME)
}

pub(crate) fn is_staged_local_attachment_path(path: &Path) -> Result<bool, String> {
    let allowed_dir = local_attachment_stage_dir();
    if !allowed_dir.exists() {
        return Ok(false);
    }

    let canonical_allowed_dir = std::fs::canonicalize(&allowed_dir)
        .map_err(|error| format!("Failed to resolve staged attachment directory: {error}"))?;
    let canonical_path = std::fs::canonicalize(path)
        .map_err(|error| format!("Failed to resolve staged attachment path: {error}"))?;
    Ok(canonical_path.starts_with(canonical_allowed_dir))
}

fn sanitize_attachment_filename(name: &str) -> String {
    let sanitized = name
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '\0' | '*' | '?' | '"' | '<' | '>' | '|' | '%' => '_',
            character if character.is_control() => '_',
            _ => character,
        })
        .collect::<String>();
    let trimmed = sanitized.trim().trim_matches('.');
    if trimmed.is_empty() {
        "attachment.bin".to_string()
    } else {
        trimmed.to_string()
    }
}

fn sanitize_attachment_lookup_token(path_or_name: &str) -> Result<String, String> {
    let trimmed = path_or_name.trim();
    if trimmed.is_empty() {
        return Err("Attachment path is required.".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed == "." || trimmed == ".." {
        return Err("Attachment path must be a staged attachment filename token.".to_string());
    }
    Ok(trimmed.to_string())
}

fn format_attachment_lookup_display_name(token: &str) -> String {
    let sanitized = token
        .chars()
        .map(|character| if character.is_control() { '_' } else { character })
        .collect::<String>();
    if sanitized.len() <= MAX_ATTACHMENT_LOOKUP_DISPLAY_LEN {
        return sanitized;
    }

    let end = MAX_ATTACHMENT_LOOKUP_DISPLAY_LEN.saturating_sub(3);
    format!("{}...", &sanitized[..end])
}

fn read_staged_attachment_original_name(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    if name.len() <= 37 {
        return Some(name.to_string());
    }

    let separator_index = name.char_indices().nth(36)?.0;
    let (uuid_prefix, rest) = name.split_at(separator_index);
    if !rest.starts_with('-') || Uuid::parse_str(uuid_prefix).is_err() {
        return Some(name.to_string());
    }

    Some(rest[1..].to_string())
}

pub(crate) fn stage_local_attachment_to_temp(name: &str, base64_data: &str) -> Result<PathBuf, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|error| format!("Failed to decode attachment payload: {error}"))?;
    let attachment_dir = local_attachment_stage_dir();
    std::fs::create_dir_all(&attachment_dir)
        .map_err(|error| format!("Failed to prepare attachment staging directory: {error}"))?;
    let file_name = format!(
        "{}-{}",
        Uuid::new_v4(),
        sanitize_attachment_filename(name)
    );
    let path = attachment_dir.join(file_name);
    std::fs::write(&path, bytes)
        .map_err(|error| format!("Failed to stage local attachment: {error}"))?;
    Ok(path)
}

pub(crate) fn resolve_staged_local_attachment_path(path_or_name: &str) -> Result<PathBuf, String> {
    let trimmed = path_or_name.trim();
    if trimmed.is_empty() {
        return Err("Attachment path is required.".to_string());
    }

    let candidate_path = PathBuf::from(trimmed);
    if candidate_path.is_absolute() {
        if is_staged_local_attachment_path(&candidate_path)? {
            return Ok(candidate_path);
        }
        return Err("Attachment path is not a staged local attachment.".to_string());
    }

    let lookup_token = sanitize_attachment_lookup_token(trimmed)?;
    let display_name = format_attachment_lookup_display_name(&lookup_token);

    let attachment_dir = local_attachment_stage_dir();
    let entries = match std::fs::read_dir(&attachment_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Err(format!("No staged local attachment matches '{display_name}'."))
        }
        Err(error) => {
            return Err(format!("Failed to read attachment staging directory: {error}"))
        }
    };
    let mut matches = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| format!("Failed to read staged attachment entry: {error}"))?;
        let path = entry.path();
        let Some(name) = read_staged_attachment_original_name(&path) else {
            continue;
        };
        if name == lookup_token {
            matches.push(path);
        }
    }

    match matches.len() {
        0 => Err(format!("No staged local attachment matches '{display_name}'.")),
        1 => Ok(matches.remove(0)),
        _ => {
            let mut ranked_matches = matches
                .into_iter()
                .map(|path| {
                    let modified = std::fs::metadata(&path)
                        .and_then(|metadata| metadata.modified())
                        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                    (modified, path)
                })
                .collect::<Vec<_>>();
            ranked_matches.sort_by(|left, right| right.0.cmp(&left.0));
            ranked_matches
                .into_iter()
                .map(|(_, path)| path)
                .next()
                .ok_or_else(|| format!("No staged local attachment matches '{display_name}'."))
        }
    }
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
    super::git::invalidate_worktree_resolution_cache_for_repo(&repo_path)?;
    Ok(selected)
}

#[tauri::command]
pub async fn workspace_stage_local_attachment(
    name: String,
    _mime: Option<String>,
    base64_data: String,
) -> Result<StagedLocalAttachmentPayload, String> {
    if name.trim().is_empty() {
        return Err("Attachment name is required.".to_string());
    }
    if base64_data.trim().is_empty() {
        return Err("Attachment payload is required.".to_string());
    }

    let path = as_error(
        run_service_blocking("workspace_stage_local_attachment", move || {
            stage_local_attachment_to_temp(&name, &base64_data).map_err(anyhow::Error::msg)
        })
        .await,
    )?;
    Ok(StagedLocalAttachmentPayload {
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn workspace_resolve_local_attachment_path(
    path: String,
) -> Result<ResolvedLocalAttachmentPayload, String> {
    let resolved = as_error(
        run_service_blocking("workspace_resolve_local_attachment_path", move || {
            resolve_staged_local_attachment_path(&path).map_err(anyhow::Error::msg)
        })
        .await,
    )?;
    Ok(ResolvedLocalAttachmentPayload {
        path: resolved.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn workspace_update_repo_config(
    state: State<'_, AppState>,
    repo_path: String,
    config: RepoConfigPayload,
) -> Result<host_domain::WorkspaceRecord, String> {
    let updated = as_error(state.service.workspace_merge_repo_config(
        &repo_path,
        RepoConfigUpdate {
            default_runtime_kind: config.default_runtime_kind,
            worktree_base_path: config.worktree_base_path,
            branch_prefix: config.branch_prefix,
            default_target_branch: config.default_target_branch,
            git: config.git,
            dev_servers: config.dev_servers,
            worktree_file_copies: config.worktree_file_copies,
            prompt_overrides: config.prompt_overrides,
            agent_defaults: config.agent_defaults,
        },
    ))?;
    super::git::invalidate_worktree_resolution_cache_for_repo(&repo_path)?;
    Ok(updated)
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
    let service = state.service.clone();
    let repo_path_for_worker = repo_path.clone();
    let confirmation_port = TauriHookTrustConfirmationPort::new(app);
    let update = RepoSettingsUpdate {
        default_runtime_kind: settings.default_runtime_kind,
        worktree_base_path: settings.worktree_base_path,
        branch_prefix: settings.branch_prefix,
        default_target_branch: settings.default_target_branch,
        git: settings.git,
        trusted_hooks: settings.trusted_hooks,
        hooks: settings.hooks,
        dev_servers: settings.dev_servers,
        worktree_file_copies: settings.worktree_file_copies,
        prompt_overrides: settings.prompt_overrides,
        agent_defaults: settings.agent_defaults,
    };

    let updated = as_error(
        run_service_blocking("workspace_save_repo_settings", move || {
            service.workspace_save_repo_settings(&repo_path_for_worker, update, &confirmation_port)
        })
        .await,
    )?;
    super::git::invalidate_worktree_resolution_cache_for_repo(&repo_path)?;
    Ok(updated)
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
) -> Result<PreparedHookTrustChallenge, String> {
    as_error(
        state
            .service
            .workspace_prepare_trusted_hooks_challenge(&repo_path),
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
pub async fn workspace_detect_github_repository(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<Option<host_infra_system::GitProviderRepository>, String> {
    as_error(state.service.workspace_detect_github_repository(&repo_path))
}

#[tauri::command]
pub async fn workspace_get_settings_snapshot(
    state: State<'_, AppState>,
) -> Result<SettingsSnapshotResponsePayload, String> {
    let (theme, git, chat, kanban, autopilot, repos, global_prompt_overrides) =
        as_error(state.service.workspace_get_settings_snapshot())?;
    Ok(SettingsSnapshotResponsePayload {
        theme,
        git,
        chat,
        kanban,
        autopilot,
        repos,
        global_prompt_overrides,
    })
}

#[tauri::command]
pub async fn workspace_update_global_git_config<R: tauri::Runtime>(
    state: State<'_, AppState>,
    _app: AppHandle<R>,
    git: host_infra_system::GlobalGitConfig,
) -> Result<(), String> {
    let service = state.service.clone();
    as_error(
        run_service_blocking("workspace_update_global_git_config", move || {
            service.workspace_update_global_git_config(git)
        })
        .await,
    )
}

#[tauri::command]
pub async fn workspace_save_settings_snapshot<R: tauri::Runtime>(
    state: State<'_, AppState>,
    app: AppHandle<R>,
    snapshot: SettingsSnapshotPayload,
) -> Result<Vec<host_domain::WorkspaceRecord>, String> {
    let SettingsSnapshotPayload {
        theme,
        git,
        chat,
        kanban,
        autopilot,
        repos,
        global_prompt_overrides,
    } = snapshot;
    let service = state.service.clone();
    let confirmation_port = TauriHookTrustConfirmationPort::new(app);
    let repo_paths_to_invalidate = repos.keys().cloned().collect::<Vec<_>>();

    let updated = as_error(
        run_service_blocking("workspace_save_settings_snapshot", move || {
            service.workspace_save_settings_snapshot(
                WorkspaceSettingsSnapshotUpdate {
                    theme,
                    git,
                    chat,
                    kanban,
                    autopilot,
                    repos,
                    global_prompt_overrides,
                },
                &confirmation_port,
            )
        })
        .await,
    )?;
    for repo_path in &repo_paths_to_invalidate {
        super::git::invalidate_worktree_resolution_cache_for_repo(repo_path)?;
    }
    Ok(updated)
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
    let service = state.service.clone();
    let confirmation_port = TauriHookTrustConfirmationPort::new(app);

    as_error(
        run_service_blocking("workspace_set_trusted_hooks", move || {
            service.workspace_set_trusted_hooks(
                &repo_path,
                trusted,
                challenge_nonce.as_deref(),
                challenge_fingerprint.as_deref(),
                &confirmation_port,
            )
        })
        .await,
    )
}

#[tauri::command]
pub async fn set_theme(state: State<'_, AppState>, theme: String) -> Result<(), String> {
    as_error(state.service.set_theme(&theme))
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

fn format_dev_server_list(dev_servers: &[host_infra_system::RepoDevServerScript]) -> String {
    if dev_servers.is_empty() {
        return "(none)".to_string();
    }

    let preview_limit = 5;
    let mut lines = dev_servers
        .iter()
        .take(preview_limit)
        .map(|dev_server| {
            format!(
                "- {}: {}",
                sanitize_hook_preview(&dev_server.name),
                sanitize_hook_preview(&dev_server.command)
            )
        })
        .collect::<Vec<_>>();
    if dev_servers.len() > preview_limit {
        lines.push(format!(
            "- ... and {} more",
            dev_servers.len() - preview_limit
        ));
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
        if escaped.chars().count() > PREVIEW_LIMIT {
            escaped = escaped.chars().take(PREVIEW_LIMIT).collect();
            escaped.push_str("...");
            return escaped;
        }
    }
    escaped
}

struct TauriHookTrustConfirmationPort<R: tauri::Runtime> {
    app: AppHandle<R>,
}

impl<R: tauri::Runtime> TauriHookTrustConfirmationPort<R> {
    fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: tauri::Runtime> HookTrustConfirmationPort for TauriHookTrustConfirmationPort<R> {
    fn confirm_trusted_hooks(&self, request: &HookTrustConfirmationRequest) -> anyhow::Result<()> {
        #[cfg(test)]
        {
            let test_response = {
                let state = self.app.state::<AppState>();
                let response = state.hook_trust_dialog_test_response.lock().map_err(|_| {
                    anyhow::anyhow!("Hook trust dialog test response lock poisoned")
                })?;
                *response
            };
            if let Some(confirmed) = test_response {
                if !confirmed {
                    return Err(anyhow::anyhow!(
                        "Hook trust confirmation was cancelled by the user."
                    ));
                }
                return Ok(());
            }
        }

        let dialog_message = format!(
            "Approve trusted scripts for this workspace?\n\nRepository:\n{repo}\n\nWorktree setup script commands:\n{pre}\n\nWorktree cleanup script commands:\n{post}\n\nBuilder dev server commands:\n{dev_servers}\n\nTrusted scripts can execute shell commands on this machine.",
            repo = request.repo_path,
            pre = format_hook_list(&request.hooks.pre_start),
            post = format_hook_list(&request.hooks.post_complete),
            dev_servers = format_dev_server_list(&request.dev_servers),
        );

        let confirmed = self
            .app
            .dialog()
            .message(dialog_message)
            .title("Trust Workspace Scripts")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Trust scripts".to_string(),
                "Cancel".to_string(),
            ))
            .blocking_show();

        if !confirmed {
            return Err(anyhow::anyhow!(
                "Hook trust confirmation was cancelled by the user."
            ));
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        format_hook_list, resolve_staged_local_attachment_path, sanitize_hook_preview,
        stage_local_attachment_to_temp, workspace_detect_github_repository,
        workspace_prepare_trusted_hooks_challenge, workspace_save_repo_settings,
        workspace_save_settings_snapshot, workspace_set_trusted_hooks,
        workspace_update_repo_config,
        workspace_update_global_git_config, HookSet,
    };
    use crate::commands::git::{
        authorized_worktree_cache, cache_key, read_worktree_state_token,
    };
    use crate::commands::git::resolve_working_dir;
    use crate::{AppState, RepoConfigPayload, RepoSettingsPayload, SettingsSnapshotPayload};
    use host_application::{AppService, PreparedHookTrustChallenge};
    use host_domain::{TaskStore, WorkspaceRecord, TASK_METADATA_NAMESPACE};
    use host_infra_beads::BeadsTaskStore;
    use host_infra_system::{
        hook_set_fingerprint, AppConfigStore, ChatSettings, GitCliPort, GlobalGitConfig,
        PromptOverride,
    };
    use serde_json::{json, Value};
    use std::{
        collections::HashSet,
        fs,
        path::{Path, PathBuf},
        process::Command,
        sync::{Arc, Mutex},
        time::Instant,
        time::{SystemTime, UNIX_EPOCH},
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

    #[test]
    fn resolve_staged_local_attachment_path_matches_filename_tokens() {
        let unique_name = format!(
            "Screenshot-2026-03-16-at-23.48.30-{}.png",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        );
        let path = stage_local_attachment_to_temp(
            &unique_name,
            "cHJldmlldy1ieXRlcw==",
        )
        .expect("attachment should stage");

        let resolved = resolve_staged_local_attachment_path(&unique_name)
            .expect("filename token should resolve to staged path");

        assert_eq!(resolved, path);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn resolve_staged_local_attachment_path_prefers_newest_filename_match() {
        let duplicate_name = format!(
            "Screenshot-2026-03-16-at-23.48.30-dup-{}.png",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        );
        let older = stage_local_attachment_to_temp(&duplicate_name, "b2xkZXI=")
            .expect("older attachment should stage");
        std::thread::sleep(std::time::Duration::from_millis(5));
        let newer = stage_local_attachment_to_temp(&duplicate_name, "bmV3ZXI=")
            .expect("newer attachment should stage");

        let resolved = resolve_staged_local_attachment_path(&duplicate_name)
            .expect("duplicate filename token should resolve");

        assert_eq!(resolved, newer);
        let _ = fs::remove_file(older);
        let _ = fs::remove_file(newer);
    }

    #[test]
    fn resolve_staged_local_attachment_path_does_not_match_broader_suffixes() {
        let target_name = format!(
            "notes-{}.pdf",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        );
        let broader_name = format!("meeting-{target_name}");
        let broader = stage_local_attachment_to_temp(&broader_name, "YnJvYWRlcg==")
            .expect("broader attachment should stage");

        let error = resolve_staged_local_attachment_path(&target_name)
            .expect_err("suffix-only match should not resolve");

        assert_eq!(
            error,
            format!("No staged local attachment matches '{target_name}'.")
        );
        let _ = fs::remove_file(broader);
    }

    fn run_git(args: &[&str], cwd: &Path) {
        let status = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .status()
            .expect("failed to run git command");
        assert!(status.success(), "git command failed: {:?}", args);
    }

    fn seed_authorized_worktree_cache_with_subset(repo: &Path, allowed_worktrees: &[&Path]) {
        let canonical_repo = fs::canonicalize(repo).expect("repo should canonicalize for cache seed");
        let worktree_state_token = read_worktree_state_token(canonical_repo.as_path())
            .expect("worktree state token should be readable for cache seed");
        let seeded_worktrees = allowed_worktrees
            .iter()
            .map(|path| fs::canonicalize(path).expect("worktree should canonicalize for cache seed"))
            .collect::<HashSet<_>>();
        let mut cache = authorized_worktree_cache()
            .lock()
            .expect("authorized worktree cache lock should not be poisoned");
        cache.insert(
            cache_key(canonical_repo.as_path()),
            crate::commands::git::AuthorizedWorktreeCacheEntry {
                cached_at: Instant::now(),
                worktree_state_token,
                worktrees: seeded_worktrees,
            },
        );
    }

    fn clear_authorized_worktree_cache_for_repo(repo: &Path) {
        super::super::git::invalidate_worktree_resolution_cache_for_repo(
            repo.to_string_lossy().as_ref(),
        )
        .expect("worktree cache should clear for repository");
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
        fs::create_dir_all(&repo).expect("git workspace should exist");
        Command::new("git")
            .arg("init")
            .arg(&repo)
            .status()
            .expect("git init should succeed");
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
                hook_trust_dialog_test_response: Mutex::new(dialog_response),
            })
            .invoke_handler(tauri::generate_handler![
                workspace_prepare_trusted_hooks_challenge,
                workspace_set_trusted_hooks,
                workspace_detect_github_repository,
                workspace_update_global_git_config,
                workspace_save_settings_snapshot,
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

    fn canonical_repo_path(fixture: &WorkspaceCommandFixture) -> String {
        fs::canonicalize(&fixture.repo_path)
            .expect("repo path should canonicalize")
            .to_string_lossy()
            .to_string()
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

    fn run_workspace_update_global_git_config(
        fixture: &WorkspaceCommandFixture,
        git: GlobalGitConfig,
    ) -> Result<(), String> {
        let state = fixture.app.state::<AppState>();
        let app_handle = fixture.app.handle().clone();
        tauri::async_runtime::block_on(workspace_update_global_git_config(state, app_handle, git))
    }

    fn run_workspace_save_repo_settings(
        fixture: &WorkspaceCommandFixture,
        settings: RepoSettingsPayload,
    ) -> Result<WorkspaceRecord, String> {
        let state = fixture.app.state::<AppState>();
        let app_handle = fixture.app.handle().clone();
        tauri::async_runtime::block_on(workspace_save_repo_settings(
            state,
            app_handle,
            fixture.repo_path.clone(),
            settings,
        ))
    }

    fn run_workspace_update_repo_config(
        fixture: &WorkspaceCommandFixture,
        config: RepoConfigPayload,
    ) -> Result<WorkspaceRecord, String> {
        let state = fixture.app.state::<AppState>();
        tauri::async_runtime::block_on(workspace_update_repo_config(
            state,
            fixture.repo_path.clone(),
            config,
        ))
    }

    fn run_workspace_prepare_trusted_hooks_challenge(
        fixture: &WorkspaceCommandFixture,
    ) -> Result<PreparedHookTrustChallenge, String> {
        let state = fixture.app.state::<AppState>();
        tauri::async_runtime::block_on(workspace_prepare_trusted_hooks_challenge(
            state,
            fixture.repo_path.clone(),
        ))
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
    fn workspace_set_trusted_hooks_rejects_fingerprint_mismatch_from_prepared_challenge(
    ) -> Result<(), String> {
        let hooks = HookSet {
            pre_start: vec!["echo pre".to_string()],
            post_complete: Vec::new(),
        };
        let fixture = setup_workspace_command_fixture("fingerprint-mismatch", hooks);
        let challenge = run_workspace_prepare_trusted_hooks_challenge(&fixture)?;

        let error = run_workspace_set_trusted_hooks(
            &fixture,
            true,
            Some(challenge.nonce),
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
    fn workspace_set_trusted_hooks_accepts_prepared_challenge_and_persists_trust(
    ) -> Result<(), String> {
        let hooks = HookSet {
            pre_start: vec!["echo pre".to_string()],
            post_complete: vec!["echo post".to_string()],
        };
        let fixture = setup_workspace_command_fixture_with_dialog_response(
            "trusted-hooks-happy-path",
            hooks.clone(),
            Some(true),
        );
        let challenge = run_workspace_prepare_trusted_hooks_challenge(&fixture)?;

        let updated = run_workspace_set_trusted_hooks(
            &fixture,
            true,
            Some(challenge.nonce.clone()),
            Some(challenge.fingerprint.clone()),
        )
        .expect("valid challenge should trust hooks");
        assert_eq!(updated.path, canonical_repo_path(&fixture));

        let repo_config = fixture
            .service
            .workspace_get_repo_config(fixture.repo_path.as_str())
            .map_err(|error| error.to_string())?;
        assert!(repo_config.trusted_hooks);
        assert_eq!(
            repo_config.trusted_hooks_fingerprint.as_deref(),
            Some(challenge.fingerprint.as_str())
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
        let mut repo_config = fixture
            .service
            .workspace_get_repo_config(fixture.repo_path.as_str())
            .map_err(|error| error.to_string())?;
        repo_config.trusted_hooks = true;
        repo_config.trusted_hooks_fingerprint = Some(fingerprint);
        fixture
            .service
            .workspace_update_repo_config(fixture.repo_path.as_str(), repo_config)
            .map_err(|error| error.to_string())?;

        let updated = run_workspace_set_trusted_hooks(&fixture, false, None, None)
            .expect("disabling trust should succeed");
        assert_eq!(updated.path, canonical_repo_path(&fixture));

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

        let (theme, git, chat, kanban, autopilot, repos, global_prompt_overrides) = fixture
            .service
            .workspace_get_settings_snapshot()
            .map_err(|error| error.to_string())?;
        let mut snapshot = SettingsSnapshotPayload {
            theme,
            git,
            chat,
            kanban,
            autopilot,
            repos,
            global_prompt_overrides,
        };
        let repo_key = canonical_repo_path(&fixture);
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

        let (theme, git, chat, kanban, autopilot, repos, global_prompt_overrides) = fixture
            .service
            .workspace_get_settings_snapshot()
            .map_err(|error| error.to_string())?;
        let mut snapshot = SettingsSnapshotPayload {
            theme,
            git,
            chat,
            kanban,
            autopilot,
            repos,
            global_prompt_overrides,
        };
        let repo_key = canonical_repo_path(&fixture);
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
    fn workspace_update_global_git_config_persists_without_snapshot_roundtrip() -> Result<(), String>
    {
        let fixture = setup_workspace_command_fixture("update-global-git", HookSet::default());

        run_workspace_update_global_git_config(
            &fixture,
            GlobalGitConfig {
                default_merge_method: host_infra_system::GitMergeMethod::Squash,
            },
        )?;

        let config = fixture
            .service
            .workspace_get_settings_snapshot()
            .map_err(|error| error.to_string())?;
        assert_eq!(
            config.1.default_merge_method,
            host_infra_system::GitMergeMethod::Squash
        );
        Ok(())
    }

    #[test]
    fn workspace_save_repo_settings_rejects_blank_default_runtime_kind() {
        let fixture =
            setup_workspace_command_fixture("save-repo-settings-blank-runtime", HookSet::default());

        let error = run_workspace_save_repo_settings(
            &fixture,
            RepoSettingsPayload {
                default_runtime_kind: Some("   ".to_string()),
                worktree_base_path: None,
                branch_prefix: None,
                default_target_branch: None,
                git: None,
                trusted_hooks: false,
                hooks: None,
                dev_servers: None,
                worktree_file_copies: None,
                prompt_overrides: None,
                agent_defaults: None,
            },
        )
        .expect_err("blank runtime kind should be rejected");

        assert!(
            error.contains("defaultRuntimeKind cannot be blank"),
            "unexpected validation error: {error}"
        );
    }

    #[test]
    fn workspace_save_repo_settings_trims_default_runtime_kind() -> Result<(), String> {
        let fixture =
            setup_workspace_command_fixture("save-repo-settings-runtime-trim", HookSet::default());

        run_workspace_save_repo_settings(
            &fixture,
            RepoSettingsPayload {
                default_runtime_kind: Some("  claude-code  ".to_string()),
                worktree_base_path: None,
                branch_prefix: None,
                default_target_branch: None,
                git: None,
                trusted_hooks: false,
                hooks: None,
                dev_servers: None,
                worktree_file_copies: None,
                prompt_overrides: None,
                agent_defaults: None,
            },
        )?;

        let persisted = fixture
            .service
            .workspace_get_repo_config(fixture.repo_path.as_str())
            .map_err(|error| error.to_string())?;
        assert_eq!(persisted.default_runtime_kind, "claude-code");
        Ok(())
    }

    #[test]
    fn workspace_update_repo_config_invalidates_authorized_worktree_cache() -> Result<(), String> {
        let fixture = setup_workspace_command_fixture("update-repo-config-cache", HookSet::default());
        let repo_path = PathBuf::from(&fixture.repo_path);
        clear_authorized_worktree_cache_for_repo(repo_path.as_path());
        let worktree_one = fixture.root.join("repo-wt-config-one");
        let worktree_two = fixture.root.join("repo-wt-config-two");
        run_git(
            &[
                "-C",
                fixture.repo_path.as_str(),
                "worktree",
                "add",
                "-b",
                "feature/config-cache-one",
                worktree_one.to_string_lossy().as_ref(),
            ],
            repo_path.as_path(),
        );
        run_git(
            &[
                "-C",
                fixture.repo_path.as_str(),
                "worktree",
                "add",
                "-b",
                "feature/config-cache-two",
                worktree_two.to_string_lossy().as_ref(),
            ],
            repo_path.as_path(),
        );

        seed_authorized_worktree_cache_with_subset(repo_path.as_path(), &[worktree_one.as_path()]);

        let worktree_two_str = worktree_two.to_string_lossy().to_string();
        let stale_error = resolve_working_dir(fixture.repo_path.as_str(), Some(worktree_two_str.as_str()))
            .expect_err("seeded cache should reject worktree omitted from subset");
        assert!(stale_error.contains("not within authorized repository or linked worktrees"));

        run_workspace_update_repo_config(
            &fixture,
            RepoConfigPayload {
                default_runtime_kind: None,
                worktree_base_path: Some(fixture.root.join("updated-base").to_string_lossy().to_string()),
                branch_prefix: None,
                default_target_branch: None,
                git: None,
                dev_servers: None,
                worktree_file_copies: None,
                prompt_overrides: None,
                agent_defaults: None,
            },
        )?;

        let resolved = resolve_working_dir(fixture.repo_path.as_str(), Some(worktree_two_str.as_str()))
            .expect("worktree cache should refresh after repo config update invalidation");
        let expected = fs::canonicalize(&worktree_two)
            .expect("worktree should canonicalize")
            .to_string_lossy()
            .to_string();
        assert_eq!(resolved, expected);

        clear_authorized_worktree_cache_for_repo(repo_path.as_path());
        Ok(())
    }

    #[test]
    fn workspace_save_repo_settings_invalidates_authorized_worktree_cache() -> Result<(), String> {
        let fixture = setup_workspace_command_fixture("save-repo-settings-cache", HookSet::default());
        let repo_path = PathBuf::from(&fixture.repo_path);
        clear_authorized_worktree_cache_for_repo(repo_path.as_path());
        let worktree_one = fixture.root.join("repo-wt-settings-one");
        let worktree_two = fixture.root.join("repo-wt-settings-two");
        run_git(
            &[
                "-C",
                fixture.repo_path.as_str(),
                "worktree",
                "add",
                "-b",
                "feature/settings-cache-one",
                worktree_one.to_string_lossy().as_ref(),
            ],
            repo_path.as_path(),
        );
        run_git(
            &[
                "-C",
                fixture.repo_path.as_str(),
                "worktree",
                "add",
                "-b",
                "feature/settings-cache-two",
                worktree_two.to_string_lossy().as_ref(),
            ],
            repo_path.as_path(),
        );

        seed_authorized_worktree_cache_with_subset(repo_path.as_path(), &[worktree_one.as_path()]);

        let worktree_two_str = worktree_two.to_string_lossy().to_string();
        let stale_error = resolve_working_dir(fixture.repo_path.as_str(), Some(worktree_two_str.as_str()))
            .expect_err("seeded cache should reject worktree omitted from subset");
        assert!(stale_error.contains("not within authorized repository or linked worktrees"));

        run_workspace_save_repo_settings(
            &fixture,
            RepoSettingsPayload {
                default_runtime_kind: None,
                worktree_base_path: Some(fixture.root.join("updated-settings-base").to_string_lossy().to_string()),
                branch_prefix: None,
                default_target_branch: None,
                git: None,
                trusted_hooks: false,
                hooks: None,
                dev_servers: None,
                worktree_file_copies: None,
                prompt_overrides: None,
                agent_defaults: None,
            },
        )?;

        let resolved = resolve_working_dir(fixture.repo_path.as_str(), Some(worktree_two_str.as_str()))
            .expect("worktree cache should refresh after repo settings save invalidation");
        let expected = fs::canonicalize(&worktree_two)
            .expect("worktree should canonicalize")
            .to_string_lossy()
            .to_string();
        assert_eq!(resolved, expected);

        clear_authorized_worktree_cache_for_repo(repo_path.as_path());
        Ok(())
    }

    #[test]
    fn workspace_save_settings_snapshot_invalidates_authorized_worktree_cache() -> Result<(), String> {
        let fixture = setup_workspace_command_fixture("save-settings-snapshot-cache", HookSet::default());
        let repo_path = PathBuf::from(&fixture.repo_path);
        clear_authorized_worktree_cache_for_repo(repo_path.as_path());
        let worktree_one = fixture.root.join("repo-wt-snapshot-one");
        let worktree_two = fixture.root.join("repo-wt-snapshot-two");
        run_git(
            &[
                "-C",
                fixture.repo_path.as_str(),
                "worktree",
                "add",
                "-b",
                "feature/snapshot-cache-one",
                worktree_one.to_string_lossy().as_ref(),
            ],
            repo_path.as_path(),
        );
        run_git(
            &[
                "-C",
                fixture.repo_path.as_str(),
                "worktree",
                "add",
                "-b",
                "feature/snapshot-cache-two",
                worktree_two.to_string_lossy().as_ref(),
            ],
            repo_path.as_path(),
        );

        seed_authorized_worktree_cache_with_subset(repo_path.as_path(), &[worktree_one.as_path()]);

        let worktree_two_str = worktree_two.to_string_lossy().to_string();
        let stale_error = resolve_working_dir(fixture.repo_path.as_str(), Some(worktree_two_str.as_str()))
            .expect_err("seeded cache should reject worktree omitted from subset");
        assert!(stale_error.contains("not within authorized repository or linked worktrees"));

        let (theme, git, chat, kanban, autopilot, repos, global_prompt_overrides) = fixture
            .service
            .workspace_get_settings_snapshot()
            .map_err(|error| error.to_string())?;
        run_workspace_save_settings_snapshot(
            &fixture,
            SettingsSnapshotPayload {
                theme,
                git,
                chat,
                kanban,
                autopilot,
                repos,
                global_prompt_overrides,
            },
        )?;

        let resolved = resolve_working_dir(fixture.repo_path.as_str(), Some(worktree_two_str.as_str()))
            .expect("worktree cache should refresh after snapshot save invalidation");
        let expected = fs::canonicalize(&worktree_two)
            .expect("worktree should canonicalize")
            .to_string_lossy()
            .to_string();
        assert_eq!(resolved, expected);

        clear_authorized_worktree_cache_for_repo(repo_path.as_path());
        Ok(())
    }

    #[test]
    fn workspace_save_settings_snapshot_ipc_preserves_shared_prompt_override_keys(
    ) -> Result<(), String> {
        let fixture =
            setup_workspace_command_fixture("snapshot-ipc-shared-prompts", HookSet::default());

        let (theme, git, chat, kanban, autopilot, repos, global_prompt_overrides) = fixture
            .service
            .workspace_get_settings_snapshot()
            .map_err(|error| error.to_string())?;
        let mut snapshot = SettingsSnapshotPayload {
            theme,
            git,
            chat,
            kanban,
            autopilot,
            repos,
            global_prompt_overrides,
        };

        snapshot.chat.show_thinking_messages = true;
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

        let repo_key = canonical_repo_path(&fixture);
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
                "theme": snapshot.theme,
                "git": snapshot.git,
                "chat": snapshot.chat,
                "kanban": snapshot.kanban,
                "autopilot": snapshot.autopilot,
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

        let (
            _persisted_theme,
            _persisted_git,
            persisted_chat,
            _persisted_kanban,
            _persisted_autopilot,
            persisted_repos,
            persisted_global,
        ) = fixture
            .service
            .workspace_get_settings_snapshot()
            .map_err(|error| error.to_string())?;
        let persisted_repo = persisted_repos
            .get(repo_key.as_str())
            .ok_or_else(|| "persisted repo config missing".to_string())?;

        assert!(persisted_chat.show_thinking_messages);
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
    fn workspace_get_settings_snapshot_returns_defaulted_chat_settings() -> Result<(), String> {
        let fixture = setup_workspace_command_fixture("snapshot-default-chat", HookSet::default());

        let (_theme, _git, chat, kanban, _autopilot, _repos, _global_prompt_overrides) = fixture
            .service
            .workspace_get_settings_snapshot()
            .map_err(|error| error.to_string())?;

        assert_eq!(chat, ChatSettings::default());
        assert!(!chat.show_thinking_messages);
        assert_eq!(kanban.done_visible_days, 1);
        Ok(())
    }

    #[test]
    fn workspace_save_settings_snapshot_ipc_rejects_missing_chat() -> Result<(), String> {
        let fixture =
            setup_workspace_command_fixture("snapshot-chat-roundtrip", HookSet::default());

        let (theme, git, _chat, kanban, autopilot, repos, global_prompt_overrides) = fixture
            .service
            .workspace_get_settings_snapshot()
            .map_err(|error| error.to_string())?;

        let payload_without_chat = json!({
            "snapshot": {
                "theme": theme.clone(),
                "git": git.clone(),
                "kanban": kanban.clone(),
                "autopilot": autopilot.clone(),
                "repos": repos.clone(),
                "globalPromptOverrides": global_prompt_overrides.clone(),
            }
        });
        let error = invoke_workspace_save_settings_snapshot_ipc(&fixture, payload_without_chat)
            .expect_err("IPC snapshot save should reject missing chat settings");
        assert!(
            error.to_string().contains("missing field `chat`"),
            "unexpected IPC error: {error}"
        );

        let payload_with_chat = json!({
            "snapshot": {
                "theme": theme,
                "git": git,
                "chat": {
                    "showThinkingMessages": true
                },
                "kanban": kanban,
                "autopilot": autopilot,
                "repos": repos,
                "globalPromptOverrides": global_prompt_overrides,
            }
        });
        invoke_workspace_save_settings_snapshot_ipc(&fixture, payload_with_chat)
            .expect("IPC snapshot save should persist chat settings");

        let (
            _reloaded_theme,
            _reloaded_git,
            reloaded_chat,
            _reloaded_kanban,
            _reloaded_autopilot,
            _reloaded_repos,
            _reloaded_global,
        ) = fixture
            .service
            .workspace_get_settings_snapshot()
            .map_err(|error| error.to_string())?;
        assert!(reloaded_chat.show_thinking_messages);
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

        let unicode = "é".repeat(300);
        let preview = sanitize_hook_preview(unicode.as_str());
        assert!(preview.ends_with("..."));
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
}
