use super::command_registry::CommandRegistry;
use super::events::HeadlessEventBus;
use crate::commands::git::invalidate_worktree_resolution_cache_for_repo;
use crate::run_service_blocking_tokio;
use anyhow::anyhow;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use host_application::{AppService, HookTrustConfirmationPort, HookTrustConfirmationRequest};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::sync::Notify;

#[derive(Clone)]
pub(super) struct HeadlessState {
    pub(super) service: Arc<AppService>,
    pub(super) events: HeadlessEventBus,
    pub(super) dev_server_events: HeadlessEventBus,
    pub(super) registry: Arc<CommandRegistry>,
    pub(super) shutdown_signal: Arc<Notify>,
    pub(super) shutdown_started: Arc<AtomicBool>,
}

#[derive(Debug)]
pub(super) struct HeadlessCommandError {
    pub(super) message: String,
    pub(super) status: StatusCode,
    pub(super) failure_kind: Option<String>,
}

impl HeadlessCommandError {
    pub(super) fn bad_request(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            status: StatusCode::BAD_REQUEST,
            failure_kind: None,
        }
    }

    pub(super) fn internal(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            status: StatusCode::INTERNAL_SERVER_ERROR,
            failure_kind: None,
        }
    }

    pub(super) fn not_found(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            status: StatusCode::NOT_FOUND,
            failure_kind: None,
        }
    }
}

impl IntoResponse for HeadlessCommandError {
    fn into_response(self) -> axum::response::Response {
        let payload = match self.failure_kind {
            Some(failure_kind) => json!({
                "error": self.message,
                "failureKind": failure_kind,
            }),
            None => json!({
                "error": self.message,
            }),
        };

        (self.status, Json(payload)).into_response()
    }
}

pub(super) type CommandResult = Result<Value, HeadlessCommandError>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RepoPathArgs {
    pub(super) repo_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RepoTaskArgs {
    pub(super) repo_path: String,
    pub(super) task_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RepoTaskReasonArgs {
    pub(super) repo_path: String,
    pub(super) task_id: String,
    pub(super) reason: Option<String>,
}

pub(super) struct HeadlessHookTrustConfirmationPort;

impl HookTrustConfirmationPort for HeadlessHookTrustConfirmationPort {
    fn confirm_trusted_hooks(&self, request: &HookTrustConfirmationRequest) -> anyhow::Result<()> {
        Err(anyhow!(
            "Trusted hook confirmation for '{}' requires the desktop shell. Browser mode cannot open the native confirmation dialog.",
            request.repo_path
        ))
    }
}

pub(super) fn deserialize_args<T: DeserializeOwned>(
    args: Value,
) -> Result<T, HeadlessCommandError> {
    serde_json::from_value(args)
        .map_err(|error| HeadlessCommandError::bad_request(format!("Invalid arguments: {error}")))
}

pub(super) fn serialize_value<T: serde::Serialize>(
    value: T,
) -> Result<Value, HeadlessCommandError> {
    serde_json::to_value(value).map_err(|error| {
        HeadlessCommandError::internal(format!("Failed to serialize response: {error}"))
    })
}

pub(super) fn service_error(error: anyhow::Error) -> HeadlessCommandError {
    HeadlessCommandError::internal(format!("{error:#}"))
}

pub(super) fn request_error(error: impl std::fmt::Display) -> HeadlessCommandError {
    HeadlessCommandError::bad_request(error.to_string())
}

pub(super) async fn run_headless_blocking<T, F>(
    operation_name: &'static str,
    operation: F,
) -> Result<T, HeadlessCommandError>
where
    T: Send + 'static,
    F: FnOnce() -> anyhow::Result<T> + Send + 'static,
{
    run_service_blocking_tokio(operation_name, operation)
        .await
        .map_err(service_error)
}

pub(super) fn handle_repo_path_operation<T, F>(args: Value, operation: F) -> CommandResult
where
    T: serde::Serialize,
    F: FnOnce(String) -> anyhow::Result<T>,
{
    let RepoPathArgs { repo_path } = deserialize_args(args)?;
    serialize_value(operation(repo_path).map_err(service_error)?)
}

pub(super) async fn handle_repo_path_operation_blocking<T, F>(
    state: &HeadlessState,
    args: Value,
    operation_name: &'static str,
    operation: F,
) -> CommandResult
where
    T: serde::Serialize + Send + 'static,
    F: FnOnce(Arc<AppService>, String) -> anyhow::Result<T> + Send + 'static,
{
    let RepoPathArgs { repo_path } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_headless_blocking(operation_name, move || operation(service, repo_path)).await?,
    )
}

pub(super) fn handle_repo_task_operation<T, F>(args: Value, operation: F) -> CommandResult
where
    T: serde::Serialize,
    F: FnOnce(String, String) -> anyhow::Result<T>,
{
    let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
    serialize_value(operation(repo_path, task_id).map_err(service_error)?)
}

pub(super) async fn handle_repo_task_operation_blocking<T, F>(
    state: &HeadlessState,
    args: Value,
    operation_name: &'static str,
    operation: F,
) -> CommandResult
where
    T: serde::Serialize + Send + 'static,
    F: FnOnce(Arc<AppService>, String, String) -> anyhow::Result<T> + Send + 'static,
{
    let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_headless_blocking(operation_name, move || {
            operation(service, repo_path, task_id)
        })
        .await?,
    )
}

pub(super) fn handle_repo_task_reason_operation<T, F>(args: Value, operation: F) -> CommandResult
where
    T: serde::Serialize,
    F: FnOnce(String, String, Option<String>) -> anyhow::Result<T>,
{
    let RepoTaskReasonArgs {
        repo_path,
        task_id,
        reason,
    } = deserialize_args(args)?;
    serialize_value(operation(repo_path, task_id, reason).map_err(service_error)?)
}

pub(super) async fn handle_repo_task_reason_operation_blocking<T, F>(
    state: &HeadlessState,
    args: Value,
    operation_name: &'static str,
    operation: F,
) -> CommandResult
where
    T: serde::Serialize + Send + 'static,
    F: FnOnce(Arc<AppService>, String, String, Option<String>) -> anyhow::Result<T>
        + Send
        + 'static,
{
    let RepoTaskReasonArgs {
        repo_path,
        task_id,
        reason,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_headless_blocking(operation_name, move || {
            operation(service, repo_path, task_id, reason)
        })
        .await?,
    )
}

pub(super) fn invalidate_repo_worktree_cache(repo_path: &str) -> Result<(), HeadlessCommandError> {
    invalidate_worktree_resolution_cache_for_repo(repo_path)
        .map_err(|error| HeadlessCommandError::internal(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::anyhow;

    #[tokio::test]
    async fn run_headless_blocking_propagates_operation_error() {
        let error = run_headless_blocking("headless-test-op", || -> anyhow::Result<()> {
            Err(anyhow!("service failure"))
        })
        .await
        .expect_err("service error should propagate");

        assert_eq!(error.status, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(error.message.contains("service failure"));
    }

    #[tokio::test]
    async fn run_headless_blocking_maps_join_failures() {
        let error = run_headless_blocking("headless-test-join", || -> anyhow::Result<()> {
            panic!("simulated join panic")
        })
        .await
        .expect_err("panic in worker should map to join failure");

        assert_eq!(error.status, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(error
            .message
            .contains("headless-test-join worker join failure"));
    }
}
