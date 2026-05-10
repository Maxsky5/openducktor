use super::command_registry::CommandRegistry;
use super::command_support::{
    deserialize_args, run_command_service_blocking, serialize_value, CommandResult, HeadlessState,
};
use host_command_services::command_services::git::{self as git_service, requests as git_requests};
use serde_json::{json, Value};

pub(super) fn register_commands(registry: &mut CommandRegistry) -> Result<(), String> {
    registry.register("git_get_branches", |state, args| {
        Box::pin(handle_git_get_branches(state, args))
    })?;
    registry.register("git_get_current_branch", |state, args| {
        Box::pin(handle_git_get_current_branch(state, args))
    })?;
    registry.register("git_switch_branch", |state, args| {
        Box::pin(handle_git_switch_branch(state, args))
    })?;
    registry.register("git_create_worktree", |state, args| {
        Box::pin(handle_git_create_worktree(state, args))
    })?;
    registry.register("git_remove_worktree", |state, args| {
        Box::pin(handle_git_remove_worktree(state, args))
    })?;
    registry.register("git_push_branch", |state, args| {
        Box::pin(handle_git_push_branch(state, args))
    })?;
    registry.register("git_get_status", |state, args| {
        Box::pin(handle_git_get_status(state, args))
    })?;
    registry.register("git_get_diff", |state, args| {
        Box::pin(handle_git_get_diff(state, args))
    })?;
    registry.register("git_commits_ahead_behind", |state, args| {
        Box::pin(handle_git_commits_ahead_behind(state, args))
    })?;
    registry.register("git_get_worktree_status", |state, args| {
        Box::pin(handle_git_get_worktree_status(state, args))
    })?;
    registry.register("git_get_worktree_status_summary", |state, args| {
        Box::pin(handle_git_get_worktree_status_summary(state, args))
    })?;
    registry.register("git_commit_all", |state, args| {
        Box::pin(handle_git_commit_all(state, args))
    })?;
    registry.register("git_reset_worktree_selection", |state, args| {
        Box::pin(handle_git_reset_worktree_selection(state, args))
    })?;
    registry.register("git_fetch_remote", |state, args| {
        Box::pin(handle_git_fetch_remote(state, args))
    })?;
    registry.register("git_pull_branch", |state, args| {
        Box::pin(handle_git_pull_branch(state, args))
    })?;
    registry.register("git_rebase_branch", |state, args| {
        Box::pin(handle_git_rebase_branch(state, args))
    })?;
    registry.register("git_rebase_abort", |state, args| {
        Box::pin(handle_git_rebase_abort(state, args))
    })?;
    registry.register("git_abort_conflict", |state, args| {
        Box::pin(handle_git_abort_conflict(state, args))
    })?;
    Ok(())
}

async fn handle_git_get_branches(state: &HeadlessState, args: Value) -> CommandResult {
    let request: git_requests::GitRepoRequest = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_command_service_blocking("git_get_branches", move || {
            git_service::get_branches(service, request)
        })
        .await?,
    )
}

async fn handle_git_get_current_branch(state: &HeadlessState, args: Value) -> CommandResult {
    let request: git_requests::GitCurrentBranchRequest = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_command_service_blocking("git_get_current_branch", move || {
            git_service::get_current_branch(service, request)
        })
        .await?,
    )
}

async fn handle_git_switch_branch(state: &HeadlessState, args: Value) -> CommandResult {
    let request: git_requests::GitSwitchBranchRequest = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_command_service_blocking("git_switch_branch", move || {
            git_service::switch_branch(service, request)
        })
        .await?,
    )
}

async fn handle_git_create_worktree(state: &HeadlessState, args: Value) -> CommandResult {
    let request: git_requests::GitCreateWorktreeRequest = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_command_service_blocking("git_create_worktree", move || {
            git_service::create_worktree(service, request)
        })
        .await?,
    )
}

async fn handle_git_remove_worktree(state: &HeadlessState, args: Value) -> CommandResult {
    let request: git_requests::GitRemoveWorktreeRequest = deserialize_args(args)?;
    let service = state.service.clone();
    let removed = run_command_service_blocking("git_remove_worktree", move || {
        git_service::remove_worktree(service, request)
    })
    .await?;
    Ok(json!({ "ok": removed }))
}

async fn handle_git_push_branch(state: &HeadlessState, args: Value) -> CommandResult {
    let request: git_requests::GitPushBranchRequest = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_command_service_blocking("git_push_branch", move || {
            git_service::push_branch(service, request)
        })
        .await?,
    )
}

async fn handle_git_get_status(state: &HeadlessState, args: Value) -> CommandResult {
    let request: git_requests::GitStatusRequest = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_command_service_blocking("git_get_status", move || {
            git_service::get_status(service, request)
        })
        .await?,
    )
}

async fn handle_git_get_diff(state: &HeadlessState, args: Value) -> CommandResult {
    let request: git_requests::GitDiffRequest = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_command_service_blocking("git_get_diff", move || {
            git_service::get_diff(service, request)
        })
        .await?,
    )
}

async fn handle_git_commits_ahead_behind(state: &HeadlessState, args: Value) -> CommandResult {
    let request: git_requests::GitAheadBehindRequest = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_command_service_blocking("git_commits_ahead_behind", move || {
            git_service::commits_ahead_behind(service, request)
        })
        .await?,
    )
}

async fn handle_git_get_worktree_status(state: &HeadlessState, args: Value) -> CommandResult {
    let request: git_requests::GitWorktreeStatusRequest = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_command_service_blocking("git_get_worktree_status", move || {
            git_service::get_worktree_status(service, request)
        })
        .await?,
    )
}

async fn handle_git_get_worktree_status_summary(
    state: &HeadlessState,
    args: Value,
) -> CommandResult {
    let request: git_requests::GitWorktreeStatusRequest = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_command_service_blocking("git_get_worktree_status_summary", move || {
            git_service::get_worktree_status_summary(service, request)
        })
        .await?,
    )
}

async fn handle_git_commit_all(state: &HeadlessState, args: Value) -> CommandResult {
    let request: git_requests::GitCommitAllCommandRequest = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_command_service_blocking("git_commit_all", move || {
            git_service::commit_all(service, request)
        })
        .await?,
    )
}

async fn handle_git_reset_worktree_selection(state: &HeadlessState, args: Value) -> CommandResult {
    let request: git_requests::GitResetWorktreeSelectionCommandRequest = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_command_service_blocking("git_reset_worktree_selection", move || {
            git_service::reset_worktree_selection(service, request)
        })
        .await?,
    )
}

async fn handle_git_fetch_remote(state: &HeadlessState, args: Value) -> CommandResult {
    let request: git_requests::GitFetchRemoteRequest = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_command_service_blocking("git_fetch_remote", move || {
            git_service::fetch_remote(service, request)
        })
        .await?,
    )
}

async fn handle_git_pull_branch(state: &HeadlessState, args: Value) -> CommandResult {
    let request: git_requests::GitPullBranchRequest = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_command_service_blocking("git_pull_branch", move || {
            git_service::pull_branch(service, request)
        })
        .await?,
    )
}

async fn handle_git_rebase_branch(state: &HeadlessState, args: Value) -> CommandResult {
    let request: git_requests::GitRebaseBranchCommandRequest = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_command_service_blocking("git_rebase_branch", move || {
            git_service::rebase_branch(service, request)
        })
        .await?,
    )
}

async fn handle_git_rebase_abort(state: &HeadlessState, args: Value) -> CommandResult {
    let request: git_requests::GitRebaseAbortCommandRequest = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_command_service_blocking("git_rebase_abort", move || {
            git_service::rebase_abort(service, request)
        })
        .await?,
    )
}

async fn handle_git_abort_conflict(state: &HeadlessState, args: Value) -> CommandResult {
    let request: git_requests::GitConflictAbortCommandRequest = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_command_service_blocking("git_abort_conflict", move || {
            git_service::abort_conflict(service, request)
        })
        .await?,
    )
}
