use super::events::HeadlessEventBus;
use crate::commands::git::{
    invalidate_worktree_resolution_cache_for_repo, resolve_working_dir, WorktreeSnapshotMetadata,
    GIT_WORKTREE_HASH_VERSION,
};
use crate::{
    run_service_blocking_tokio, BuildCompletePayload, MarkdownPayload, PlanPayload,
    PullRequestContentPayload, RepoConfigPayload, RepoSettingsPayload, SettingsSnapshotPayload,
    TaskCreatePayload, TaskDirectMergePayload, TaskUpdatePayload,
};
use anyhow::anyhow;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use host_application::{
    AppService, BuildResponseAction, CleanupMode, HookTrustConfirmationPort,
    HookTrustConfirmationRequest,
};
use host_domain::AgentRuntimeKind;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone)]
pub(super) struct HeadlessState {
    pub(super) service: Arc<AppService>,
    pub(super) events: HeadlessEventBus,
    pub(super) dev_server_events: HeadlessEventBus,
}

#[derive(Debug)]
pub(super) struct HeadlessCommandError {
    pub(super) message: String,
    pub(super) status: StatusCode,
}

impl HeadlessCommandError {
    pub(super) fn bad_request(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            status: StatusCode::BAD_REQUEST,
        }
    }

    pub(super) fn internal(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            status: StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    pub(super) fn not_found(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            status: StatusCode::NOT_FOUND,
        }
    }
}

impl IntoResponse for HeadlessCommandError {
    fn into_response(self) -> axum::response::Response {
        (
            self.status,
            Json(json!({
                "error": self.message,
            })),
        )
            .into_response()
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
pub(super) struct OptionalRepoPathArgs {
    pub(super) repo_path: Option<String>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RuntimeCheckArgs {
    pub(super) force: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RuntimeListArgs {
    pub(super) runtime_kind: String,
    pub(super) repo_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RuntimeEnsureArgs {
    pub(super) runtime_kind: String,
    pub(super) repo_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RuntimeStopArgs {
    pub(super) runtime_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkspaceUpdateRepoConfigArgs {
    pub(super) repo_path: String,
    pub(super) config: RepoConfigPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkspaceSaveRepoSettingsArgs {
    pub(super) repo_path: String,
    pub(super) settings: RepoSettingsPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkspaceUpdateRepoHooksArgs {
    pub(super) repo_path: String,
    pub(super) hooks: host_infra_system::HookSet,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkspaceSaveSettingsSnapshotArgs {
    pub(super) snapshot: SettingsSnapshotPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkspaceUpdateGlobalGitConfigArgs {
    pub(super) git: host_infra_system::GlobalGitConfig,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkspaceSetTrustedHooksArgs {
    pub(super) repo_path: String,
    pub(super) trusted: bool,
    pub(super) challenge_nonce: Option<String>,
    pub(super) challenge_fingerprint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitCurrentBranchArgs {
    pub(super) repo_path: String,
    pub(super) working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitSwitchBranchArgs {
    pub(super) repo_path: String,
    pub(super) branch: String,
    pub(super) create: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitCreateWorktreeArgs {
    pub(super) repo_path: String,
    pub(super) worktree_path: String,
    pub(super) branch: String,
    pub(super) create_branch: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitRemoveWorktreeArgs {
    pub(super) repo_path: String,
    pub(super) worktree_path: String,
    pub(super) force: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitPushBranchArgs {
    pub(super) repo_path: String,
    pub(super) branch: String,
    pub(super) working_dir: Option<String>,
    pub(super) remote: Option<String>,
    pub(super) set_upstream: Option<bool>,
    pub(super) force_with_lease: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitStatusArgs {
    pub(super) repo_path: String,
    pub(super) working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitDiffArgs {
    pub(super) repo_path: String,
    pub(super) target_branch: Option<String>,
    pub(super) working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitAheadBehindArgs {
    pub(super) repo_path: String,
    pub(super) target_branch: String,
    pub(super) working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitPullBranchArgs {
    pub(super) repo_path: String,
    pub(super) working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitResetWorktreeSelectionArgs {
    pub(super) repo_path: String,
    pub(super) target_branch: String,
    pub(super) snapshot: host_domain::GitResetSnapshot,
    pub(super) selection: host_domain::GitResetWorktreeSelection,
    pub(super) working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitRebaseAbortArgs {
    pub(super) repo_path: String,
    pub(super) working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitConflictAbortArgs {
    pub(super) repo_path: String,
    pub(super) operation: host_domain::GitConflictOperation,
    pub(super) working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitWorktreeStatusArgs {
    pub(super) repo_path: String,
    pub(super) target_branch: String,
    pub(super) diff_scope: Option<String>,
    pub(super) working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TaskCreateArgs {
    pub(super) repo_path: String,
    pub(super) input: TaskCreatePayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TaskListArgs {
    pub(super) repo_path: String,
    pub(super) done_visible_days: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TaskUpdateArgs {
    pub(super) repo_path: String,
    pub(super) task_id: String,
    pub(super) patch: TaskUpdatePayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TaskDeleteArgs {
    pub(super) repo_path: String,
    pub(super) task_id: String,
    pub(super) delete_subtasks: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TaskResetImplementationArgs {
    pub(super) repo_path: String,
    pub(super) task_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TaskTransitionArgs {
    pub(super) repo_path: String,
    pub(super) task_id: String,
    pub(super) status: host_domain::TaskStatus,
    pub(super) reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SetSpecArgs {
    pub(super) repo_path: String,
    pub(super) task_id: String,
    pub(super) markdown: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SetPlanArgs {
    pub(super) repo_path: String,
    pub(super) task_id: String,
    pub(super) input: PlanPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MarkdownInputArgs {
    pub(super) repo_path: String,
    pub(super) task_id: String,
    pub(super) input: MarkdownPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BuildStartArgs {
    pub(super) repo_path: String,
    pub(super) task_id: String,
    pub(super) runtime_kind: AgentRuntimeKind,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BuildRespondArgs {
    pub(super) run_id: String,
    pub(super) action: BuildResponseAction,
    pub(super) payload: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BuildStopArgs {
    pub(super) run_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BuildCleanupArgs {
    pub(super) run_id: String,
    pub(super) mode: CleanupMode,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BuildCompletedArgs {
    pub(super) repo_path: String,
    pub(super) task_id: String,
    pub(super) input: Option<BuildCompletePayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TaskDirectMergeArgs {
    pub(super) repo_path: String,
    pub(super) task_id: String,
    pub(super) input: TaskDirectMergePayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TaskPullRequestUpsertArgs {
    pub(super) repo_path: String,
    pub(super) task_id: String,
    pub(super) input: PullRequestContentPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct HumanRequestChangesArgs {
    pub(super) repo_path: String,
    pub(super) task_id: String,
    pub(super) note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AgentSessionUpsertArgs {
    pub(super) repo_path: String,
    pub(super) task_id: String,
    pub(super) session: host_domain::AgentSessionDocument,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AgentSessionsListBulkArgs {
    pub(super) repo_path: String,
    pub(super) task_ids: Vec<String>,
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

pub(super) fn deserialize_args<T: DeserializeOwned>(args: Value) -> Result<T, HeadlessCommandError> {
    serde_json::from_value(args)
        .map_err(|error| HeadlessCommandError::bad_request(format!("Invalid arguments: {error}")))
}

pub(super) fn serialize_value<T: serde::Serialize>(value: T) -> Result<Value, HeadlessCommandError> {
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

pub(super) fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub(super) fn resolve_authorized_working_dir(
    state: &HeadlessState,
    repo_path: &str,
    working_dir: Option<&str>,
) -> Result<String, HeadlessCommandError> {
    state
        .service
        .resolve_authorized_repo_path(repo_path)
        .map_err(request_error)?;
    resolve_working_dir(repo_path, working_dir).map_err(request_error)
}

pub(super) fn require_git_commit_message(
    message: &str,
) -> Result<String, HeadlessCommandError> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err(HeadlessCommandError::bad_request("message is required"));
    }
    Ok(trimmed.to_string())
}

pub(super) fn require_git_rebase_target_branch(
    target_branch: &str,
) -> Result<String, HeadlessCommandError> {
    let trimmed = target_branch.trim();
    if trimmed.is_empty() {
        return Err(HeadlessCommandError::bad_request(
            "targetBranch is required",
        ));
    }
    Ok(trimmed.to_string())
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

pub(super) fn build_worktree_snapshot_metadata(
    effective_working_dir: String,
    target_branch: &str,
    diff_scope: host_domain::GitDiffScope,
    status_hash: String,
    diff_hash: String,
) -> WorktreeSnapshotMetadata {
    WorktreeSnapshotMetadata {
        effective_working_dir,
        target_branch: target_branch.to_string(),
        diff_scope,
        observed_at_ms: current_timestamp_ms(),
        hash_version: GIT_WORKTREE_HASH_VERSION,
        status_hash,
        diff_hash,
    }
}

pub(super) fn invalidate_repo_worktree_cache(
    repo_path: &str,
) -> Result<(), HeadlessCommandError> {
    invalidate_worktree_resolution_cache_for_repo(repo_path)
        .map_err(|error| HeadlessCommandError::internal(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::anyhow;

    #[test]
    fn require_git_commit_message_rejects_blank_values() {
        let error =
            require_git_commit_message("   ").expect_err("blank commit message should fail");

        assert_eq!(error.status, StatusCode::BAD_REQUEST);
        assert_eq!(error.message, "message is required");
    }

    #[test]
    fn require_git_rebase_target_branch_rejects_blank_values() {
        let error = require_git_rebase_target_branch("   ")
            .expect_err("blank target branch should fail");

        assert_eq!(error.status, StatusCode::BAD_REQUEST);
        assert_eq!(error.message, "targetBranch is required");
    }

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
