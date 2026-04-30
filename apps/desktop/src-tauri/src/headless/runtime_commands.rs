use super::command_registry::CommandRegistry;
use super::command_support::{
    deserialize_args, handle_repo_task_operation_blocking, run_headless_blocking, serialize_value,
    service_error, CommandResult, HeadlessState, RepoTaskArgs,
};
use super::events::make_dev_server_emitter;
use crate::runtime_ensure_failure_kind;
use host_domain::{AgentRuntimeKind, AgentSessionStopRequest};
use serde::Deserialize;
use serde_json::{json, Value};

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
struct AgentSessionStopArgs {
    request: AgentSessionStopRequest,
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
    registry.register("agent_session_stop", |state, args| {
        Box::pin(handle_agent_session_stop(state, args))
    })?;
    registry.register("runtime_definitions_list", |state, _| {
        Box::pin(handle_runtime_definitions_list(state))
    })?;
    registry.register("runtime_list", |state, args| {
        Box::pin(handle_runtime_list(state, args))
    })?;
    registry.register("task_worktree_get", |state, args| {
        Box::pin(handle_task_worktree_get(state, args))
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
    registry.register("repo_runtime_health", |state, args| {
        Box::pin(handle_repo_runtime_health(state, args))
    })?;
    registry.register("repo_runtime_health_status", |state, args| {
        Box::pin(handle_repo_runtime_health_status(state, args))
    })?;
    registry.register("agent_sessions_list", |state, args| {
        Box::pin(handle_agent_sessions_list(state, args))
    })?;
    registry.register("agent_sessions_list_bulk", |state, args| {
        Box::pin(handle_agent_sessions_list_bulk(state, args))
    })?;
    registry.register("agent_session_upsert", |state, args| {
        Box::pin(handle_agent_session_upsert(state, args))
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
    serialize_value(
        crate::run_service_blocking_tokio("build_start", move || {
            service.build_start(&repo_path, &task_id, runtime_kind.as_str())
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

async fn handle_agent_session_stop(state: &HeadlessState, args: Value) -> CommandResult {
    let AgentSessionStopArgs { request } = deserialize_args(args)?;
    let service = state.service.clone();
    Ok(json!({
        "ok": crate::run_service_blocking_tokio("agent_session_stop", move || {
            service.agent_session_stop(request)
        })
        .await
        .map_err(service_error)?
    }))
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

async fn handle_task_worktree_get(state: &HeadlessState, args: Value) -> CommandResult {
    let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        crate::run_service_blocking_tokio("task_worktree_get", move || {
            service.task_worktree_get(&repo_path, &task_id)
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

async fn handle_repo_runtime_health(state: &HeadlessState, args: Value) -> CommandResult {
    let RuntimeEnsureArgs {
        runtime_kind,
        repo_path,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        crate::run_service_blocking_tokio("repo_runtime_health", move || {
            service.repo_runtime_health(runtime_kind.as_str(), &repo_path)
        })
        .await
        .map_err(service_error)?,
    )
}

async fn handle_repo_runtime_health_status(state: &HeadlessState, args: Value) -> CommandResult {
    let RuntimeEnsureArgs {
        runtime_kind,
        repo_path,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        crate::run_service_blocking_tokio("repo_runtime_health_status", move || {
            service.repo_runtime_health_status(runtime_kind.as_str(), &repo_path)
        })
        .await
        .map_err(service_error)?,
    )
}

async fn handle_agent_sessions_list(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_operation_blocking(
        state,
        args,
        "agent_sessions_list",
        |service, repo_path, task_id| service.agent_sessions_list(&repo_path, &task_id),
    )
    .await
}

async fn handle_agent_sessions_list_bulk(state: &HeadlessState, args: Value) -> CommandResult {
    let AgentSessionsListBulkArgs {
        repo_path,
        task_ids,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_headless_blocking("agent_sessions_list_bulk", move || {
            service.agent_sessions_list_bulk(&repo_path, &task_ids)
        })
        .await?,
    )
}

async fn handle_agent_session_upsert(state: &HeadlessState, args: Value) -> CommandResult {
    let AgentSessionUpsertArgs {
        repo_path,
        task_id,
        session,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    Ok(json!({
        "ok": run_headless_blocking("agent_session_upsert", move || {
            service.agent_session_upsert(&repo_path, &task_id, session)
        })
        .await?
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn agent_sessions_list_args_accept_task_identifier() {
        let parsed = deserialize_args::<RepoTaskArgs>(json!({
            "repoPath": "/repo",
            "taskId": "task-1"
        }))
        .expect("payload should deserialize");

        assert_eq!(parsed.repo_path, "/repo");
        assert_eq!(parsed.task_id, "task-1");
    }

    #[test]
    fn agent_sessions_list_args_reject_missing_task_id() {
        let error = deserialize_args::<RepoTaskArgs>(json!({
            "repoPath": "/repo"
        }))
        .expect_err("task id should be required at headless transport boundary");

        assert_eq!(error.status, axum::http::StatusCode::BAD_REQUEST);
        assert!(error.message.contains("taskId"));
    }

    #[test]
    fn agent_sessions_list_bulk_args_accept_task_ids() {
        let parsed = deserialize_args::<AgentSessionsListBulkArgs>(json!({
            "repoPath": "/repo",
            "taskIds": ["task-1", "task-2"]
        }))
        .expect("payload should deserialize");

        assert_eq!(parsed.repo_path, "/repo");
        assert_eq!(parsed.task_ids, vec!["task-1", "task-2"]);
    }

    #[test]
    fn agent_sessions_list_bulk_args_reject_missing_task_ids() {
        let error = deserialize_args::<AgentSessionsListBulkArgs>(json!({
            "repoPath": "/repo"
        }))
        .expect_err("task ids should be required at headless transport boundary");

        assert_eq!(error.status, axum::http::StatusCode::BAD_REQUEST);
        assert!(error.message.contains("taskIds"));
    }

    #[test]
    fn agent_session_upsert_args_accept_session_document() {
        let parsed = deserialize_args::<AgentSessionUpsertArgs>(json!({
            "repoPath": "/repo",
            "taskId": "task-1",
            "session": {
                "externalSessionId": "external-session-1",
                "role": "build",
                "scenario": "build_default",
                "startedAt": "2026-02-20T12:00:00Z",
                "runtimeKind": "opencode",
                "workingDirectory": "/repo/worktree/task-1"
            }
        }))
        .expect("payload should deserialize");

        assert_eq!(parsed.repo_path, "/repo");
        assert_eq!(parsed.task_id, "task-1");
        assert_eq!(parsed.session.external_session_id, "external-session-1");
        assert_eq!(parsed.session.working_directory, "/repo/worktree/task-1");
    }

    #[test]
    fn agent_session_upsert_args_ignores_unknown_legacy_session_id() {
        let parsed = deserialize_args::<AgentSessionUpsertArgs>(json!({
            "repoPath": "/repo",
            "taskId": "task-1",
            "session": {
                "sessionId": "local-session-1",
                "externalSessionId": "external-session-1",
                "role": "build",
                "scenario": "build_default",
                "startedAt": "2026-02-20T12:00:00Z",
                "runtimeKind": "opencode",
                "workingDirectory": "/repo/worktree/task-1"
            }
        }))
        .expect("unknown legacy session id should be ignored when externalSessionId is present");

        assert_eq!(parsed.session.external_session_id, "external-session-1");
    }

    #[test]
    fn agent_session_upsert_args_reject_missing_session() {
        let error = deserialize_args::<AgentSessionUpsertArgs>(json!({
            "repoPath": "/repo",
            "taskId": "task-1"
        }))
        .expect_err("session should be required at headless transport boundary");

        assert_eq!(error.status, axum::http::StatusCode::BAD_REQUEST);
        assert!(error.message.contains("session"));
    }

    #[test]
    fn agent_session_upsert_response_keeps_ok_envelope() {
        let response = serde_json::from_value::<serde_json::Map<String, Value>>(json!({
            "ok": true
        }))
        .expect("response should deserialize");

        assert_eq!(response.get("ok"), Some(&json!(true)));
    }

    #[test]
    fn agent_session_stop_args_accept_durable_session_target() {
        let parsed = deserialize_args::<AgentSessionStopArgs>(json!({
            "request": {
                "repoPath": "/repo",
                "taskId": "task-1",
                "runtimeKind": "opencode",
                "workingDirectory": "/repo/worktrees/task-1",
                "externalSessionId": "external-session-1"
            }
        }))
        .expect("payload should deserialize");

        assert_eq!(parsed.request.repo_path, "/repo");
        assert_eq!(parsed.request.task_id, "task-1");
        assert_eq!(parsed.request.external_session_id, "external-session-1");
        assert_eq!(parsed.request.runtime_kind, AgentRuntimeKind::opencode());
        assert_eq!(parsed.request.working_directory, "/repo/worktrees/task-1");
    }

    #[test]
    fn agent_session_stop_args_reject_missing_runtime_kind() {
        let error = deserialize_args::<AgentSessionStopArgs>(json!({
            "request": {
                "repoPath": "/repo",
                "taskId": "task-1",
                "externalSessionId": "external-session-1",
                "workingDirectory": "/repo/worktrees/task-1"
            }
        }))
        .expect_err("runtime kind should be required at headless transport boundary");

        assert_eq!(error.status, axum::http::StatusCode::BAD_REQUEST);
        assert!(error.message.contains("runtimeKind"));
    }

    #[test]
    fn runtime_list_args_accept_invalid_runtime_kind_for_service_validation() {
        let parsed = deserialize_args::<RuntimeListArgs>(json!({
            "runtimeKind": "invalid",
            "repoPath": "/repo"
        }))
        .expect("runtime kind validation should happen in AppService");

        assert_eq!(parsed.runtime_kind.as_str(), "invalid");
        assert_eq!(parsed.repo_path.as_deref(), Some("/repo"));
    }

    #[test]
    fn runtime_ensure_args_accept_invalid_runtime_kind_for_service_validation() {
        let parsed = deserialize_args::<RuntimeEnsureArgs>(json!({
            "runtimeKind": "invalid",
            "repoPath": "/repo"
        }))
        .expect("runtime kind validation should happen in AppService");

        assert_eq!(parsed.runtime_kind.as_str(), "invalid");
        assert_eq!(parsed.repo_path, "/repo");
    }
}
