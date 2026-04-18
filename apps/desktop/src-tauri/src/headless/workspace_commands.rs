use super::command_registry::CommandRegistry;
use super::command_support::{
    deserialize_args, handle_repo_path_operation, handle_repo_path_operation_blocking,
    run_headless_blocking, serialize_value, service_error, CommandResult,
    HeadlessHookTrustConfirmationPort, HeadlessState,
};
use crate::commands::workspace::{
    resolve_staged_local_attachment_path, stage_local_attachment_to_temp,
    ResolvedLocalAttachmentPayload, StagedLocalAttachmentPayload,
};
use crate::run_service_blocking_tokio;
use crate::{
    RepoConfigPayload, RepoSettingsPayload, SettingsSnapshotPayload,
    SettingsSnapshotResponsePayload,
};
use anyhow::anyhow;
use host_application::{RepoConfigUpdate, RepoSettingsUpdate, WorkspaceSettingsSnapshotUpdate};
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeCheckArgs {
    force: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceUpdateRepoConfigArgs {
    workspace_id: String,
    config: RepoConfigPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSaveRepoSettingsArgs {
    workspace_id: String,
    settings: RepoSettingsPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceUpdateRepoHooksArgs {
    workspace_id: String,
    hooks: host_infra_system::HookSet,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceIdArgs {
    workspace_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceAddArgs {
    workspace_id: String,
    workspace_name: String,
    repo_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceReorderArgs {
    workspace_order: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSaveSettingsSnapshotArgs {
    snapshot: SettingsSnapshotPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceUpdateGlobalGitConfigArgs {
    git: host_infra_system::GlobalGitConfig,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSetTrustedHooksArgs {
    workspace_id: String,
    trusted: bool,
    challenge_nonce: Option<String>,
    challenge_fingerprint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceStageLocalAttachmentArgs {
    name: String,
    #[allow(dead_code)]
    mime: Option<String>,
    base64_data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceResolveLocalAttachmentPathArgs {
    path: String,
}

pub(super) fn register_commands(registry: &mut CommandRegistry) -> Result<(), String> {
    registry.register("system_check", |state, args| {
        Box::pin(async move {
            handle_repo_path_operation_blocking(
                state,
                args,
                "system_check",
                |service, repo_path| service.system_check(&repo_path),
            )
            .await
        })
    })?;
    registry.register("runtime_check", |state, args| {
        Box::pin(handle_runtime_check(state, args))
    })?;
    registry.register("beads_check", |state, args| {
        Box::pin(async move {
            handle_repo_path_operation_blocking(state, args, "beads_check", |service, repo_path| {
                service.beads_check(&repo_path)
            })
            .await
        })
    })?;
    registry.register("workspace_list", |state, _| {
        Box::pin(async move { handle_workspace_list(state) })
    })?;
    registry.register("workspace_add", |state, args| {
        Box::pin(async move { handle_workspace_add(state, args) })
    })?;
    registry.register("workspace_select", |state, args| {
        Box::pin(handle_workspace_select(state, args))
    })?;
    registry.register("workspace_reorder", |state, args| {
        Box::pin(async move { handle_workspace_reorder(state, args) })
    })?;
    registry.register("workspace_update_repo_config", |state, args| {
        Box::pin(async move { handle_workspace_update_repo_config(state, args) })
    })?;
    registry.register("workspace_save_repo_settings", |state, args| {
        Box::pin(handle_workspace_save_repo_settings(state, args))
    })?;
    registry.register("workspace_update_repo_hooks", |state, args| {
        Box::pin(async move { handle_workspace_update_repo_hooks(state, args) })
    })?;
    registry.register(
        "workspace_prepare_trusted_hooks_challenge",
        |state, args| {
            Box::pin(handle_workspace_prepare_trusted_hooks_challenge(
                state, args,
            ))
        },
    )?;
    registry.register("workspace_get_repo_config", |state, args| {
        Box::pin(handle_workspace_get_repo_config(state, args))
    })?;
    registry.register("workspace_detect_github_repository", |state, args| {
        Box::pin(async move {
            handle_repo_path_operation(args, |repo_path| {
                state.service.workspace_detect_github_repository(&repo_path)
            })
        })
    })?;
    registry.register("workspace_get_settings_snapshot", |state, _| {
        Box::pin(async move { handle_workspace_get_settings_snapshot(state) })
    })?;
    registry.register("workspace_update_global_git_config", |state, args| {
        Box::pin(handle_workspace_update_global_git_config(state, args))
    })?;
    registry.register("workspace_save_settings_snapshot", |state, args| {
        Box::pin(handle_workspace_save_settings_snapshot(state, args))
    })?;
    registry.register("workspace_set_trusted_hooks", |state, args| {
        Box::pin(handle_workspace_set_trusted_hooks(state, args))
    })?;
    registry.register("workspace_stage_local_attachment", |_state, args| {
        Box::pin(async move { handle_workspace_stage_local_attachment(args).await })
    })?;
    registry.register("workspace_resolve_local_attachment_path", |_state, args| {
        Box::pin(async move { handle_workspace_resolve_local_attachment_path(args).await })
    })?;
    registry.register("set_theme", |state, args| {
        Box::pin(async move { handle_set_theme(state, args) })
    })?;
    Ok(())
}

async fn handle_runtime_check(state: &HeadlessState, args: Value) -> CommandResult {
    let RuntimeCheckArgs { force } = deserialize_args(args)?;
    let service = state.service.clone();
    let force = force.unwrap_or(false);
    serialize_value(
        super::command_support::run_headless_blocking("runtime_check", move || {
            service.runtime_check_with_refresh(force)
        })
        .await?,
    )
}

fn handle_workspace_list(state: &HeadlessState) -> CommandResult {
    serialize_value(state.service.workspace_list().map_err(service_error)?)
}

fn handle_workspace_add(state: &HeadlessState, args: Value) -> CommandResult {
    let WorkspaceAddArgs {
        workspace_id,
        workspace_name,
        repo_path,
    } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .workspace_create(&workspace_id, &workspace_name, &repo_path)
            .map_err(service_error)?,
    )
}

async fn handle_workspace_select(state: &HeadlessState, args: Value) -> CommandResult {
    let WorkspaceIdArgs { workspace_id } = deserialize_args(args)?;
    let selected = state
        .service
        .workspace_select(&workspace_id)
        .map_err(service_error)?;
    super::command_support::invalidate_repo_worktree_cache(&selected.repo_path)?;
    serialize_value(selected)
}

fn handle_workspace_reorder(state: &HeadlessState, args: Value) -> CommandResult {
    let WorkspaceReorderArgs { workspace_order } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .workspace_reorder(workspace_order)
            .map_err(service_error)?,
    )
}

fn handle_workspace_update_repo_config(state: &HeadlessState, args: Value) -> CommandResult {
    let WorkspaceUpdateRepoConfigArgs {
        workspace_id,
        config,
    } = deserialize_args(args)?;
    let updated = state
        .service
        .workspace_merge_repo_config(
            &workspace_id,
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
        )
        .map_err(service_error)?;
    super::command_support::invalidate_repo_worktree_cache(&updated.repo_path)?;
    serialize_value(updated)
}

async fn handle_workspace_save_repo_settings(state: &HeadlessState, args: Value) -> CommandResult {
    let WorkspaceSaveRepoSettingsArgs {
        workspace_id,
        settings,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    let workspace_id_for_worker = workspace_id.clone();
    let confirmation_port = HeadlessHookTrustConfirmationPort;
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
    let updated = run_service_blocking_tokio("workspace_save_repo_settings", move || {
        service.workspace_save_repo_settings(&workspace_id_for_worker, update, &confirmation_port)
    })
    .await
    .map_err(service_error)?;
    super::command_support::invalidate_repo_worktree_cache(&updated.repo_path)?;
    serialize_value(updated)
}

fn handle_workspace_update_repo_hooks(state: &HeadlessState, args: Value) -> CommandResult {
    let WorkspaceUpdateRepoHooksArgs {
        workspace_id,
        hooks,
    } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .workspace_update_repo_hooks(&workspace_id, hooks)
            .map_err(service_error)?,
    )
}

async fn handle_workspace_prepare_trusted_hooks_challenge(
    state: &HeadlessState,
    args: Value,
) -> CommandResult {
    let WorkspaceIdArgs { workspace_id } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .workspace_prepare_trusted_hooks_challenge(&workspace_id)
            .map_err(service_error)?,
    )
}

async fn handle_workspace_get_repo_config(state: &HeadlessState, args: Value) -> CommandResult {
    let WorkspaceIdArgs { workspace_id } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .workspace_get_repo_config(&workspace_id)
            .map_err(service_error)?,
    )
}

fn handle_workspace_get_settings_snapshot(state: &HeadlessState) -> CommandResult {
    let (theme, git, chat, kanban, autopilot, workspaces, global_prompt_overrides) = state
        .service
        .workspace_get_settings_snapshot()
        .map_err(service_error)?;
    serialize_value(SettingsSnapshotResponsePayload {
        theme,
        git,
        chat,
        kanban,
        autopilot,
        workspaces,
        global_prompt_overrides,
    })
}

async fn handle_workspace_update_global_git_config(
    state: &HeadlessState,
    args: Value,
) -> CommandResult {
    let WorkspaceUpdateGlobalGitConfigArgs { git } = deserialize_args(args)?;
    let service = state.service.clone();
    run_service_blocking_tokio("workspace_update_global_git_config", move || {
        service.workspace_update_global_git_config(git)
    })
    .await
    .map_err(service_error)?;
    Ok(Value::Null)
}

async fn handle_workspace_stage_local_attachment(args: Value) -> CommandResult {
    let WorkspaceStageLocalAttachmentArgs {
        name,
        mime: _mime,
        base64_data,
    } = deserialize_args(args)?;
    if name.trim().is_empty() {
        return Err(service_error(anyhow!("Attachment name is required.")));
    }
    if base64_data.trim().is_empty() {
        return Err(service_error(anyhow!("Attachment payload is required.")));
    }

    let path = run_headless_blocking("workspace_stage_local_attachment", move || {
        stage_local_attachment_to_temp(&name, &base64_data).map_err(anyhow::Error::msg)
    })
    .await?;
    serialize_value(StagedLocalAttachmentPayload {
        path: path.to_string_lossy().into_owned(),
    })
}

async fn handle_workspace_resolve_local_attachment_path(args: Value) -> CommandResult {
    let WorkspaceResolveLocalAttachmentPathArgs { path } = deserialize_args(args)?;
    let resolved = run_headless_blocking("workspace_resolve_local_attachment_path", move || {
        resolve_staged_local_attachment_path(&path).map_err(anyhow::Error::msg)
    })
    .await?;
    serialize_value(ResolvedLocalAttachmentPayload {
        path: resolved.to_string_lossy().into_owned(),
    })
}

async fn handle_workspace_save_settings_snapshot(
    state: &HeadlessState,
    args: Value,
) -> CommandResult {
    let WorkspaceSaveSettingsSnapshotArgs { snapshot } = deserialize_args(args)?;
    let service = state.service.clone();
    let confirmation_port = HeadlessHookTrustConfirmationPort;
    let crate::SettingsSnapshotPayload {
        theme,
        git,
        chat,
        kanban,
        autopilot,
        workspaces,
        global_prompt_overrides,
    } = snapshot;
    let repo_paths_to_invalidate = workspaces
        .values()
        .map(|workspace| workspace.repo_path.clone())
        .collect::<Vec<_>>();
    let updated = run_service_blocking_tokio("workspace_save_settings_snapshot", move || {
        service.workspace_save_settings_snapshot(
            WorkspaceSettingsSnapshotUpdate {
                theme,
                git,
                chat,
                kanban,
                autopilot,
                workspaces,
                global_prompt_overrides,
            },
            &confirmation_port,
        )
    })
    .await
    .map_err(service_error)?;
    for repo_path in &repo_paths_to_invalidate {
        super::command_support::invalidate_repo_worktree_cache(repo_path)?;
    }
    serialize_value(updated)
}

async fn handle_workspace_set_trusted_hooks(state: &HeadlessState, args: Value) -> CommandResult {
    let WorkspaceSetTrustedHooksArgs {
        workspace_id,
        trusted,
        challenge_nonce,
        challenge_fingerprint,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    let confirmation_port = HeadlessHookTrustConfirmationPort;
    serialize_value(
        run_service_blocking_tokio("workspace_set_trusted_hooks", move || {
            service.workspace_set_trusted_hooks(
                &workspace_id,
                trusted,
                challenge_nonce.as_deref(),
                challenge_fingerprint.as_deref(),
                &confirmation_port,
            )
        })
        .await
        .map_err(service_error)?,
    )
}

fn handle_set_theme(state: &HeadlessState, args: Value) -> CommandResult {
    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ThemeArgs {
        theme: String,
    }

    let ThemeArgs { theme } = deserialize_args(args)?;
    state.service.set_theme(&theme).map_err(service_error)?;
    Ok(Value::Null)
}
