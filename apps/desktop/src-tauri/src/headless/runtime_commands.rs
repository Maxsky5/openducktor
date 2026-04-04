use super::command_registry::CommandRegistry;
use super::command_support::{
    deserialize_args, handle_repo_task_operation, run_headless_blocking, serialize_value,
    service_error, CommandResult, HeadlessState, RepoTaskArgs,
};
use super::events::{make_dev_server_emitter, make_emitter};
use crate::runtime_ensure_failure_kind;
use host_application::{BuildResponseAction, CleanupMode};
use host_domain::AgentRuntimeKind;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptionalRepoPathArgs {
    repo_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeListArgs {
    runtime_kind: AgentRuntimeKind,
    repo_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeEnsureArgs {
    runtime_kind: AgentRuntimeKind,
    repo_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStopArgs {
    runtime_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildStartArgs {
    repo_path: String,
    task_id: String,
    runtime_kind: AgentRuntimeKind,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildRespondArgs {
    run_id: String,
    action: BuildResponseAction,
    payload: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildStopArgs {
    run_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildCleanupArgs {
    run_id: String,
    mode: CleanupMode,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentSessionUpsertArgs {
    repo_path: String,
    task_id: String,
    session: host_domain::AgentSessionDocument,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentSessionsListBulkArgs {
    repo_path: String,
    task_ids: Vec<String>,
}

pub(super) fn register_commands(registry: &mut CommandRegistry) -> Result<(), String> {
    registry.register("build_start", |state, args| {
        Box::pin(handle_build_start(state, args))
    })?;
    registry.register("dev_server_get_state", |state, args| {
        Box::pin(handle_dev_server_get_state(state, args))
    })?;
    registry.register("dev_server_start", |state, args| {
        Box::pin(handle_dev_server_start(state, args))
    })?;
    registry.register("dev_server_stop", |state, args| {
        Box::pin(handle_dev_server_stop(state, args))
    })?;
    registry.register("dev_server_restart", |state, args| {
        Box::pin(handle_dev_server_restart(state, args))
    })?;
    registry.register("build_respond", |state, args| {
        Box::pin(async move { handle_build_respond(state, args) })
    })?;
    registry.register("build_stop", |state, args| {
        Box::pin(handle_build_stop(state, args))
    })?;
    registry.register("build_cleanup", |state, args| {
        Box::pin(handle_build_cleanup(state, args))
    })?;
    registry.register("runs_list", |state, args| {
        Box::pin(handle_runs_list(state, args))
    })?;
    registry.register("runtime_definitions_list", |state, _| {
        Box::pin(handle_runtime_definitions_list(state))
    })?;
    registry.register("runtime_list", |state, args| {
        Box::pin(handle_runtime_list(state, args))
    })?;
    registry.register("build_continuation_target_get", |state, args| {
        Box::pin(handle_build_continuation_target_get(state, args))
    })?;
    registry.register("runtime_stop", |state, args| {
        Box::pin(handle_runtime_stop(state, args))
    })?;
    registry.register("runtime_ensure", |state, args| {
        Box::pin(handle_runtime_ensure(state, args))
    })?;
    registry.register("runtime_startup_status", |state, args| {
        Box::pin(handle_runtime_startup_status(state, args))
    })?;
    registry.register("agent_sessions_list", |state, args| {
        Box::pin(async move { handle_agent_sessions_list(state, args) })
    })?;
    registry.register("agent_sessions_list_bulk", |state, args| {
        Box::pin(async move { handle_agent_sessions_list_bulk(state, args) })
    })?;
    registry.register("agent_session_upsert", |state, args| {
        Box::pin(async move { handle_agent_session_upsert(state, args) })
    })?;
    Ok(())
}

async fn handle_build_start(state: &HeadlessState, args: Value) -> CommandResult {
    let BuildStartArgs {
        repo_path,
        task_id,
        runtime_kind,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    let emitter = make_emitter(state.events.clone());
    serialize_value(
        crate::run_service_blocking_tokio("build_start", move || {
            service.build_start(&repo_path, &task_id, runtime_kind.as_str(), emitter)
        })
        .await
        .map_err(service_error)?,
    )
}

async fn handle_dev_server_get_state(state: &HeadlessState, args: Value) -> CommandResult {
    let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        crate::run_service_blocking_tokio("dev_server_get_state", move || {
            service.dev_server_get_state(&repo_path, &task_id)
        })
        .await
        .map_err(service_error)?,
    )
}

async fn handle_dev_server_start(state: &HeadlessState, args: Value) -> CommandResult {
    let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
    let service = state.service.clone();
    let emitter = make_dev_server_emitter(state.dev_server_events.clone());
    serialize_value(
        crate::run_service_blocking_tokio("dev_server_start", move || {
            service.dev_server_start(&repo_path, &task_id, emitter)
        })
        .await
        .map_err(service_error)?,
    )
}

async fn handle_dev_server_stop(state: &HeadlessState, args: Value) -> CommandResult {
    let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        crate::run_service_blocking_tokio("dev_server_stop", move || {
            service.dev_server_stop(&repo_path, &task_id)
        })
        .await
        .map_err(service_error)?,
    )
}

async fn handle_dev_server_restart(state: &HeadlessState, args: Value) -> CommandResult {
    let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
    let service = state.service.clone();
    let emitter = make_dev_server_emitter(state.dev_server_events.clone());
    serialize_value(
        crate::run_service_blocking_tokio("dev_server_restart", move || {
            service.dev_server_restart(&repo_path, &task_id, emitter)
        })
        .await
        .map_err(service_error)?,
    )
}

fn handle_build_respond(state: &HeadlessState, args: Value) -> CommandResult {
    let BuildRespondArgs {
        run_id,
        action,
        payload,
    } = deserialize_args(args)?;
    Ok(json!({
        "ok": state
            .service
            .build_respond(
                &run_id,
                action,
                payload.as_deref(),
                make_emitter(state.events.clone()),
            )
            .map_err(service_error)?
    }))
}

async fn handle_build_stop(state: &HeadlessState, args: Value) -> CommandResult {
    let BuildStopArgs { run_id } = deserialize_args(args)?;
    let service = state.service.clone();
    let emitter = make_emitter(state.events.clone());
    Ok(json!({
        "ok": crate::run_service_blocking_tokio("build_stop", move || {
            service.build_stop(&run_id, emitter)
        })
        .await
        .map_err(service_error)?
    }))
}

async fn handle_build_cleanup(state: &HeadlessState, args: Value) -> CommandResult {
    let BuildCleanupArgs { run_id, mode } = deserialize_args(args)?;
    let service = state.service.clone();
    let emitter = make_emitter(state.events.clone());
    Ok(json!({
        "ok": crate::run_service_blocking_tokio("build_cleanup", move || {
            service.build_cleanup(&run_id, mode, emitter)
        })
        .await
        .map_err(service_error)?
    }))
}

async fn handle_runs_list(state: &HeadlessState, args: Value) -> CommandResult {
    let OptionalRepoPathArgs { repo_path } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        crate::run_service_blocking_tokio("runs_list", move || {
            service.runs_list(repo_path.as_deref())
        })
        .await
        .map_err(service_error)?,
    )
}

async fn handle_runtime_definitions_list(state: &HeadlessState) -> CommandResult {
    serialize_value(
        state
            .service
            .runtime_definitions_list()
            .map_err(service_error)?,
    )
}

async fn handle_runtime_list(state: &HeadlessState, args: Value) -> CommandResult {
    let RuntimeListArgs {
        runtime_kind,
        repo_path,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_headless_blocking("runtime_list", move || {
            service.runtime_list(runtime_kind.as_str(), repo_path.as_deref())
        })
        .await?,
    )
}

async fn handle_build_continuation_target_get(state: &HeadlessState, args: Value) -> CommandResult {
    let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        crate::run_service_blocking_tokio("build_continuation_target_get", move || {
            service.build_continuation_target_get(&repo_path, &task_id)
        })
        .await
        .map_err(service_error)?,
    )
}

async fn handle_runtime_stop(state: &HeadlessState, args: Value) -> CommandResult {
    let RuntimeStopArgs { runtime_id } = deserialize_args(args)?;
    let service = state.service.clone();
    Ok(json!({
        "ok": run_headless_blocking("runtime_stop", move || service.runtime_stop(&runtime_id)).await?
    }))
}

async fn handle_runtime_ensure(state: &HeadlessState, args: Value) -> CommandResult {
    let RuntimeEnsureArgs {
        runtime_kind,
        repo_path,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        crate::run_service_blocking_tokio("runtime_ensure", move || {
            service.runtime_ensure(runtime_kind.as_str(), &repo_path)
        })
        .await
        .map_err(|error| {
            let failure_kind = runtime_ensure_failure_kind(&error).map(str::to_string);
            let mut command_error = service_error(error);
            command_error.failure_kind = failure_kind;
            command_error
        })?,
    )
}

async fn handle_runtime_startup_status(state: &HeadlessState, args: Value) -> CommandResult {
    let RuntimeEnsureArgs {
        runtime_kind,
        repo_path,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        crate::run_service_blocking_tokio("runtime_startup_status", move || {
            service.runtime_startup_status(runtime_kind.as_str(), &repo_path)
        })
        .await
        .map_err(service_error)?,
    )
}

fn handle_agent_sessions_list(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_operation(args, |repo_path, task_id| {
        state.service.agent_sessions_list(&repo_path, &task_id)
    })
}

fn handle_agent_sessions_list_bulk(state: &HeadlessState, args: Value) -> CommandResult {
    let AgentSessionsListBulkArgs {
        repo_path,
        task_ids,
    } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .agent_sessions_list_bulk(&repo_path, &task_ids)
            .map_err(service_error)?,
    )
}

fn handle_agent_session_upsert(state: &HeadlessState, args: Value) -> CommandResult {
    let AgentSessionUpsertArgs {
        repo_path,
        task_id,
        session,
    } = deserialize_args(args)?;
    Ok(json!({
        "ok": state
            .service
            .agent_session_upsert(&repo_path, &task_id, session)
            .map_err(service_error)?
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn runtime_list_args_reject_invalid_runtime_kind() {
        let error = deserialize_args::<RuntimeListArgs>(json!({
            "runtimeKind": "invalid",
            "repoPath": "/repo"
        }))
        .expect_err("invalid runtime kind should fail at transport boundary");

        assert_eq!(error.status, axum::http::StatusCode::BAD_REQUEST);
        assert!(error.message.contains("Invalid arguments:"));
        assert!(error.message.contains("invalid"));
    }

    #[test]
    fn runtime_ensure_args_reject_invalid_runtime_kind() {
        let error = deserialize_args::<RuntimeEnsureArgs>(json!({
            "runtimeKind": "invalid",
            "repoPath": "/repo"
        }))
        .expect_err("invalid runtime kind should fail at transport boundary");

        assert_eq!(error.status, axum::http::StatusCode::BAD_REQUEST);
        assert!(error.message.contains("Invalid arguments:"));
        assert!(error.message.contains("invalid"));
    }
}
