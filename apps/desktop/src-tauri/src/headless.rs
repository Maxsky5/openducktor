use crate::commands::documents::map_plan_subtasks;
use crate::commands::git::{
    build_worktree_status_summary_with_snapshot, build_worktree_status_with_snapshot,
    hash_worktree_diff_payload, hash_worktree_diff_summary_payload, hash_worktree_status_payload,
    invalidate_worktree_resolution_cache_for_repo, parse_diff_scope, require_target_branch,
    resolve_working_dir, WorktreeSnapshotMetadata, GIT_WORKTREE_HASH_VERSION,
};
use crate::commands::tasks::{map_task_create_payload, map_task_update_payload};
use crate::{
    run_service_blocking_tokio, startup_phase_service_bootstrap, startup_phase_shutdown_hooks,
    startup_phase_tracing, BuildCompletePayload, MarkdownPayload, PlanPayload,
    PullRequestContentPayload, RepoConfigPayload, RepoSettingsPayload, SettingsSnapshotPayload,
    SettingsSnapshotResponsePayload, TaskCreatePayload, TaskUpdatePayload,
};
use anyhow::{anyhow, Context};
use axum::extract::{Path, State};
use axum::http::header;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use host_application::{
    AppService, BuildResponseAction, CleanupMode, HookTrustConfirmationPort,
    HookTrustConfirmationRequest, RepoConfigUpdate, RepoSettingsUpdate, RunEmitter,
};
use host_domain::{AgentRuntimeKind, GitMergeMethod};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::convert::Infallible;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio_stream::wrappers::errors::BroadcastStreamRecvError;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tower_http::cors::CorsLayer;

const DEFAULT_BROWSER_BACKEND_HOST: &str = "127.0.0.1";
const DEFAULT_BROWSER_FRONTEND_ORIGINS: [&str; 2] =
    ["http://localhost:1420", "http://127.0.0.1:1420"];
const BROWSER_FRONTEND_ORIGIN_ENV: &str = "ODT_BROWSER_FRONTEND_ORIGIN";
const EVENT_BUFFER_CAPACITY: usize = 256;

#[derive(Clone)]
struct HeadlessState {
    service: Arc<AppService>,
    events: HeadlessEventBus,
}

#[derive(Clone, Debug)]
struct HeadlessEvent {
    id: u64,
    payload: String,
}

#[derive(Clone)]
struct HeadlessEventBus {
    capacity: usize,
    next_id: Arc<AtomicU64>,
    recent: Arc<Mutex<VecDeque<HeadlessEvent>>>,
    sender: broadcast::Sender<HeadlessEvent>,
}

impl HeadlessEventBus {
    fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self {
            capacity,
            next_id: Arc::new(AtomicU64::new(0)),
            recent: Arc::new(Mutex::new(VecDeque::with_capacity(capacity))),
            sender,
        }
    }

    fn emit(&self, payload: String) {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let event = HeadlessEvent { id, payload };
        {
            let mut recent = self
                .recent
                .lock()
                .expect("browser event buffer should lock");
            recent.push_back(event.clone());
            if recent.len() > self.capacity {
                recent.pop_front();
            }
        }
        let _ = self.sender.send(event);
    }

    fn replay_since(&self, last_seen_id: Option<u64>) -> Vec<HeadlessEvent> {
        let Some(last_seen_id) = last_seen_id else {
            return Vec::new();
        };

        self.recent
            .lock()
            .expect("browser event buffer should lock")
            .iter()
            .filter(|event| event.id > last_seen_id)
            .cloned()
            .collect()
    }

    fn subscribe(&self) -> broadcast::Receiver<HeadlessEvent> {
        self.sender.subscribe()
    }
}

#[derive(Debug)]
struct HeadlessCommandError {
    message: String,
    status: StatusCode,
}

impl HeadlessCommandError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            status: StatusCode::BAD_REQUEST,
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            status: StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoPathArgs {
    repo_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptionalRepoPathArgs {
    repo_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoTaskArgs {
    repo_path: String,
    task_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoTaskReasonArgs {
    repo_path: String,
    task_id: String,
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeCheckArgs {
    force: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeListArgs {
    runtime_kind: String,
    repo_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeEnsureArgs {
    runtime_kind: String,
    repo_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStopArgs {
    runtime_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceUpdateRepoConfigArgs {
    repo_path: String,
    config: RepoConfigPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSaveRepoSettingsArgs {
    repo_path: String,
    settings: RepoSettingsPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceUpdateRepoHooksArgs {
    repo_path: String,
    hooks: host_infra_system::HookSet,
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
    repo_path: String,
    trusted: bool,
    challenge_nonce: Option<String>,
    challenge_fingerprint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitCurrentBranchArgs {
    repo_path: String,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitSwitchBranchArgs {
    repo_path: String,
    branch: String,
    create: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitCreateWorktreeArgs {
    repo_path: String,
    worktree_path: String,
    branch: String,
    create_branch: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitRemoveWorktreeArgs {
    repo_path: String,
    worktree_path: String,
    force: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitPushBranchArgs {
    repo_path: String,
    branch: String,
    working_dir: Option<String>,
    remote: Option<String>,
    set_upstream: Option<bool>,
    force_with_lease: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitStatusArgs {
    repo_path: String,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitDiffArgs {
    repo_path: String,
    target_branch: Option<String>,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitAheadBehindArgs {
    repo_path: String,
    target_branch: String,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitPullBranchArgs {
    repo_path: String,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitRebaseAbortArgs {
    repo_path: String,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitWorktreeStatusArgs {
    repo_path: String,
    target_branch: String,
    diff_scope: Option<String>,
    working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskCreateArgs {
    repo_path: String,
    input: TaskCreatePayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskUpdateArgs {
    repo_path: String,
    task_id: String,
    patch: TaskUpdatePayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskDeleteArgs {
    repo_path: String,
    task_id: String,
    delete_subtasks: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskTransitionArgs {
    repo_path: String,
    task_id: String,
    status: host_domain::TaskStatus,
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetSpecArgs {
    repo_path: String,
    task_id: String,
    markdown: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetPlanArgs {
    repo_path: String,
    task_id: String,
    input: PlanPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownInputArgs {
    repo_path: String,
    task_id: String,
    input: MarkdownPayload,
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
struct BuildCompletedArgs {
    repo_path: String,
    task_id: String,
    input: Option<BuildCompletePayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskDirectMergeArgs {
    repo_path: String,
    task_id: String,
    merge_method: GitMergeMethod,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskPullRequestUpsertArgs {
    repo_path: String,
    task_id: String,
    input: PullRequestContentPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HumanRequestChangesArgs {
    repo_path: String,
    task_id: String,
    note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentSessionUpsertArgs {
    repo_path: String,
    task_id: String,
    session: host_domain::AgentSessionDocument,
}

struct HeadlessHookTrustConfirmationPort;

impl HookTrustConfirmationPort for HeadlessHookTrustConfirmationPort {
    fn confirm_trusted_hooks(&self, request: &HookTrustConfirmationRequest) -> anyhow::Result<()> {
        Err(anyhow!(
            "Trusted hook confirmation for '{}' requires the desktop shell. Browser mode cannot open the native confirmation dialog.",
            request.repo_path
        ))
    }
}

pub async fn run_browser_backend(port: u16) -> anyhow::Result<()> {
    startup_phase_tracing();
    let service = startup_phase_service_bootstrap()?;
    startup_phase_shutdown_hooks(service.clone());
    let events = HeadlessEventBus::new(EVENT_BUFFER_CAPACITY);
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/events", get(events_handler))
        .route("/invoke/{command}", post(invoke_handler))
        .layer(browser_backend_cors_layer()?)
        .with_state(HeadlessState { service, events });

    let listener = TcpListener::bind((DEFAULT_BROWSER_BACKEND_HOST, port))
        .await
        .with_context(|| {
            format!("failed to bind browser backend on {DEFAULT_BROWSER_BACKEND_HOST}:{port}")
        })?;

    tracing::info!(
        target: "openducktor.browser-backend",
        host = DEFAULT_BROWSER_BACKEND_HOST,
        port,
        "OpenDucktor browser backend listening"
    );

    axum::serve(listener, app)
        .await
        .context("browser backend server terminated unexpectedly")
}

async fn health_handler() -> impl IntoResponse {
    Json(json!({ "ok": true }))
}

async fn events_handler(
    State(state): State<HeadlessState>,
    headers: HeaderMap,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, HeadlessCommandError>
{
    let last_event_id = parse_last_event_id(&headers)?;
    let replay_stream = tokio_stream::iter(
        state
            .events
            .replay_since(last_event_id)
            .into_iter()
            .map(|event| to_sse_event(&event)),
    );
    let live_stream =
        BroadcastStream::new(state.events.subscribe()).map(|message| match message {
            Ok(event) => to_sse_event(&event),
            Err(BroadcastStreamRecvError::Lagged(skipped)) => Ok(
                Event::default()
                    .event("stream-warning")
                    .data(format!(
                        "Browser event stream skipped {skipped} events; reconnect will replay buffered events."
                    )),
            ),
        });

    Ok(Sse::new(replay_stream.chain(live_stream)).keep_alive(KeepAlive::default()))
}

async fn invoke_handler(
    Path(command): Path<String>,
    State(state): State<HeadlessState>,
    Json(args): Json<Value>,
) -> impl IntoResponse {
    match dispatch_command(&state, &command, args).await {
        Ok(payload) => (StatusCode::OK, Json(payload)).into_response(),
        Err(error) => error.into_response(),
    }
}

fn deserialize_args<T: DeserializeOwned>(args: Value) -> Result<T, HeadlessCommandError> {
    serde_json::from_value(args)
        .map_err(|error| HeadlessCommandError::bad_request(format!("Invalid arguments: {error}")))
}

fn serialize_value<T: serde::Serialize>(value: T) -> Result<Value, HeadlessCommandError> {
    serde_json::to_value(value).map_err(|error| {
        HeadlessCommandError::internal(format!("Failed to serialize response: {error}"))
    })
}

fn make_emitter(events: HeadlessEventBus) -> RunEmitter {
    Arc::new(move |event| match serde_json::to_string(&event) {
        Ok(payload) => {
            events.emit(payload);
        }
        Err(error) => {
            tracing::warn!(
                target: "openducktor.browser-backend",
                error = %error,
                "Failed to serialize run event for browser SSE"
            );
        }
    })
}

fn browser_backend_cors_layer() -> anyhow::Result<CorsLayer> {
    let layer = if let Ok(origin) = std::env::var(BROWSER_FRONTEND_ORIGIN_ENV) {
        let origin = origin.trim();
        if origin.is_empty() {
            CorsLayer::new()
                .allow_origin(parse_default_frontend_origins()?)
                .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
                .allow_headers([header::CONTENT_TYPE])
        } else {
            CorsLayer::new()
                .allow_origin(parse_origin_header(origin)?)
                .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
                .allow_headers([header::CONTENT_TYPE])
        }
    } else {
        CorsLayer::new()
            .allow_origin(parse_default_frontend_origins()?)
            .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
            .allow_headers([header::CONTENT_TYPE])
    };

    Ok(layer)
}

fn parse_default_frontend_origins() -> anyhow::Result<Vec<HeaderValue>> {
    DEFAULT_BROWSER_FRONTEND_ORIGINS
        .iter()
        .map(|origin| parse_origin_header(origin))
        .collect()
}

fn parse_origin_header(origin: &str) -> anyhow::Result<HeaderValue> {
    origin
        .parse::<HeaderValue>()
        .with_context(|| format!("invalid browser frontend origin configured: {origin}"))
}

fn parse_last_event_id(headers: &HeaderMap) -> Result<Option<u64>, HeadlessCommandError> {
    let Some(last_event_id) = headers.get("last-event-id") else {
        return Ok(None);
    };
    let value = last_event_id.to_str().map_err(|error| {
        HeadlessCommandError::bad_request(format!("Invalid Last-Event-ID header: {error}"))
    })?;
    value.parse::<u64>().map(Some).map_err(|error| {
        HeadlessCommandError::bad_request(format!("Invalid Last-Event-ID header: {error}"))
    })
}

fn to_sse_event(event: &HeadlessEvent) -> Result<Event, Infallible> {
    Ok(Event::default()
        .id(event.id.to_string())
        .data(event.payload.clone()))
}

fn service_error(error: anyhow::Error) -> HeadlessCommandError {
    HeadlessCommandError::internal(format!("{error:#}"))
}

fn request_error(error: impl std::fmt::Display) -> HeadlessCommandError {
    HeadlessCommandError::bad_request(error.to_string())
}

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn resolve_authorized_working_dir(
    state: &HeadlessState,
    repo_path: &str,
    working_dir: Option<&str>,
) -> Result<String, HeadlessCommandError> {
    state
        .service
        .ensure_repo_authorized(repo_path)
        .map_err(request_error)?;
    resolve_working_dir(repo_path, working_dir).map_err(request_error)
}

async fn dispatch_command(
    state: &HeadlessState,
    command: &str,
    args: Value,
) -> Result<Value, HeadlessCommandError> {
    if let Some(result) = dispatch_workspace_command(state, command, args.clone()).await {
        return result;
    }
    if let Some(result) = dispatch_git_command(state, command, args.clone()).await {
        return result;
    }
    if let Some(result) = dispatch_task_command(state, command, args.clone()).await {
        return result;
    }
    if let Some(result) = dispatch_runtime_command(state, command, args).await {
        return result;
    }

    Err(HeadlessCommandError::not_found(format!(
        "Unsupported browser backend command: {command}"
    )))
}

type CommandResult = Result<Value, HeadlessCommandError>;

async fn dispatch_workspace_command(
    state: &HeadlessState,
    command: &str,
    args: Value,
) -> Option<CommandResult> {
    match command {
        "system_check" => Some(handle_repo_path_operation(args, |repo_path| {
            state.service.system_check(&repo_path)
        })),
        "runtime_check" => Some(handle_runtime_check(state, args)),
        "beads_check" => Some(handle_repo_path_operation(args, |repo_path| {
            state.service.beads_check(&repo_path)
        })),
        "workspace_list" => Some(handle_workspace_list(state)),
        "workspace_add" => Some(handle_repo_path_operation(args, |repo_path| {
            state.service.workspace_add(&repo_path)
        })),
        "workspace_select" => Some(handle_workspace_select(state, args).await),
        "workspace_update_repo_config" => Some(handle_workspace_update_repo_config(state, args)),
        "workspace_save_repo_settings" => {
            Some(handle_workspace_save_repo_settings(state, args).await)
        }
        "workspace_update_repo_hooks" => Some(handle_workspace_update_repo_hooks(state, args)),
        "workspace_prepare_trusted_hooks_challenge" => {
            Some(handle_repo_path_operation(args, |repo_path| {
                state
                    .service
                    .workspace_prepare_trusted_hooks_challenge(&repo_path)
            }))
        }
        "workspace_get_repo_config" => Some(handle_repo_path_operation(args, |repo_path| {
            state.service.workspace_get_repo_config(&repo_path)
        })),
        "workspace_detect_github_repository" => {
            Some(handle_repo_path_operation(args, |repo_path| {
                state.service.workspace_detect_github_repository(&repo_path)
            }))
        }
        "workspace_get_settings_snapshot" => Some(handle_workspace_get_settings_snapshot(state)),
        "workspace_update_global_git_config" => {
            Some(handle_workspace_update_global_git_config(state, args).await)
        }
        "workspace_save_settings_snapshot" => {
            Some(handle_workspace_save_settings_snapshot(state, args).await)
        }
        "workspace_set_trusted_hooks" => {
            Some(handle_workspace_set_trusted_hooks(state, args).await)
        }
        "set_theme" => Some(handle_set_theme(state, args)),
        _ => None,
    }
}

async fn dispatch_git_command(
    state: &HeadlessState,
    command: &str,
    args: Value,
) -> Option<CommandResult> {
    match command {
        "git_get_branches" => Some(handle_repo_path_operation(args, |repo_path| {
            state.service.git_get_branches(&repo_path)
        })),
        "git_get_current_branch" => Some(handle_git_get_current_branch(state, args)),
        "git_switch_branch" => Some(handle_git_switch_branch(state, args)),
        "git_create_worktree" => Some(handle_git_create_worktree(state, args)),
        "git_remove_worktree" => Some(handle_git_remove_worktree(state, args)),
        "git_push_branch" => Some(handle_git_push_branch(state, args)),
        "git_get_status" => Some(handle_git_get_status(state, args)),
        "git_get_diff" => Some(handle_git_get_diff(state, args)),
        "git_commits_ahead_behind" => Some(handle_git_commits_ahead_behind(state, args)),
        "git_get_worktree_status" => Some(handle_git_get_worktree_status(state, args)),
        "git_get_worktree_status_summary" => {
            Some(handle_git_get_worktree_status_summary(state, args))
        }
        "git_commit_all" => Some(handle_git_commit_all(state, args)),
        "git_pull_branch" => Some(handle_git_pull_branch(state, args)),
        "git_rebase_branch" => Some(handle_git_rebase_branch(state, args)),
        "git_rebase_abort" => Some(handle_git_rebase_abort(state, args)),
        _ => None,
    }
}

async fn dispatch_task_command(
    state: &HeadlessState,
    command: &str,
    args: Value,
) -> Option<CommandResult> {
    match command {
        "tasks_list" => Some(handle_repo_path_operation(args, |repo_path| {
            state.service.tasks_list(&repo_path)
        })),
        "task_create" => Some(handle_task_create(state, args)),
        "task_update" => Some(handle_task_update(state, args)),
        "task_delete" => Some(handle_task_delete(state, args)),
        "task_transition" => Some(handle_task_transition(state, args)),
        "task_defer" => Some(handle_task_defer(state, args)),
        "task_resume_deferred" => Some(handle_task_resume_deferred(state, args)),
        "spec_get" => Some(handle_spec_get(state, args)),
        "task_metadata_get" => Some(handle_task_metadata_get(state, args)),
        "set_spec" => Some(handle_set_spec(state, args)),
        "spec_save_document" => Some(handle_spec_save_document(state, args)),
        "plan_get" => Some(handle_plan_get(state, args)),
        "set_plan" => Some(handle_set_plan(state, args)),
        "plan_save_document" => Some(handle_plan_save_document(state, args)),
        "qa_get_report" => Some(handle_qa_get_report(state, args)),
        "qa_approved" => Some(handle_qa_approved(state, args)),
        "qa_rejected" => Some(handle_qa_rejected(state, args)),
        "build_blocked" => Some(handle_build_blocked(state, args)),
        "build_resumed" => Some(handle_build_resumed(state, args)),
        "build_completed" => Some(handle_build_completed(state, args)),
        "task_approval_context_get" => Some(handle_task_approval_context_get(state, args)),
        "task_direct_merge" => Some(handle_task_direct_merge(state, args)),
        "task_pull_request_upsert" => Some(handle_task_pull_request_upsert(state, args)),
        "task_pull_request_unlink" => Some(handle_task_pull_request_unlink(state, args)),
        "task_pull_request_detect" => Some(handle_task_pull_request_detect(state, args)),
        "repo_pull_request_sync" => Some(handle_repo_pull_request_sync(state, args)),
        "human_request_changes" => Some(handle_human_request_changes(state, args)),
        "human_approve" => Some(handle_human_approve(state, args)),
        _ => None,
    }
}

async fn dispatch_runtime_command(
    state: &HeadlessState,
    command: &str,
    args: Value,
) -> Option<CommandResult> {
    match command {
        "build_start" => Some(handle_build_start(state, args).await),
        "build_respond" => Some(handle_build_respond(state, args)),
        "build_stop" => Some(handle_build_stop(state, args)),
        "build_cleanup" => Some(handle_build_cleanup(state, args)),
        "runs_list" => Some(handle_runs_list(state, args)),
        "runtime_definitions_list" => Some(handle_runtime_definitions_list(state)),
        "runtime_list" => Some(handle_runtime_list(state, args)),
        "qa_review_target_get" => Some(handle_qa_review_target_get(state, args).await),
        "runtime_stop" => Some(handle_runtime_stop(state, args)),
        "runtime_ensure" => Some(handle_runtime_ensure(state, args).await),
        "agent_sessions_list" => Some(handle_agent_sessions_list(state, args)),
        "agent_session_upsert" => Some(handle_agent_session_upsert(state, args)),
        _ => None,
    }
}

fn handle_repo_path_operation<T, F>(args: Value, operation: F) -> CommandResult
where
    T: serde::Serialize,
    F: FnOnce(String) -> anyhow::Result<T>,
{
    let RepoPathArgs { repo_path } = deserialize_args(args)?;
    serialize_value(operation(repo_path).map_err(service_error)?)
}

fn handle_repo_task_operation<T, F>(args: Value, operation: F) -> CommandResult
where
    T: serde::Serialize,
    F: FnOnce(String, String) -> anyhow::Result<T>,
{
    let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
    serialize_value(operation(repo_path, task_id).map_err(service_error)?)
}

fn handle_repo_task_reason_operation<T, F>(args: Value, operation: F) -> CommandResult
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

fn build_worktree_snapshot_metadata(
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

fn invalidate_repo_worktree_cache(repo_path: &str) -> Result<(), HeadlessCommandError> {
    invalidate_worktree_resolution_cache_for_repo(repo_path)
        .map_err(|error| HeadlessCommandError::internal(error.to_string()))
}

fn handle_runtime_check(state: &HeadlessState, args: Value) -> CommandResult {
    let RuntimeCheckArgs { force } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .runtime_check_with_refresh(force.unwrap_or(false))
            .map_err(service_error)?,
    )
}

fn handle_workspace_list(state: &HeadlessState) -> CommandResult {
    serialize_value(state.service.workspace_list().map_err(service_error)?)
}

async fn handle_workspace_select(state: &HeadlessState, args: Value) -> CommandResult {
    let RepoPathArgs { repo_path } = deserialize_args(args)?;
    let selected = state
        .service
        .workspace_select(&repo_path)
        .map_err(service_error)?;
    invalidate_repo_worktree_cache(&repo_path)?;
    serialize_value(selected)
}

fn handle_workspace_update_repo_config(state: &HeadlessState, args: Value) -> CommandResult {
    let WorkspaceUpdateRepoConfigArgs { repo_path, config } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .workspace_merge_repo_config(
                &repo_path,
                RepoConfigUpdate {
                    default_runtime_kind: config.default_runtime_kind,
                    worktree_base_path: config.worktree_base_path,
                    branch_prefix: config.branch_prefix,
                    default_target_branch: config.default_target_branch,
                    git: config.git,
                    worktree_file_copies: config.worktree_file_copies,
                    prompt_overrides: config.prompt_overrides,
                    agent_defaults: config.agent_defaults,
                },
            )
            .map_err(service_error)?,
    )
}

async fn handle_workspace_save_repo_settings(state: &HeadlessState, args: Value) -> CommandResult {
    let WorkspaceSaveRepoSettingsArgs {
        repo_path,
        settings,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    let confirmation_port = HeadlessHookTrustConfirmationPort;
    let update = RepoSettingsUpdate {
        default_runtime_kind: settings.default_runtime_kind,
        worktree_base_path: settings.worktree_base_path,
        branch_prefix: settings.branch_prefix,
        default_target_branch: settings.default_target_branch,
        git: settings.git,
        trusted_hooks: settings.trusted_hooks,
        hooks: settings.hooks,
        worktree_file_copies: settings.worktree_file_copies,
        prompt_overrides: settings.prompt_overrides,
        agent_defaults: settings.agent_defaults,
    };
    serialize_value(
        run_service_blocking_tokio("workspace_save_repo_settings", move || {
            service.workspace_save_repo_settings(&repo_path, update, &confirmation_port)
        })
        .await
        .map_err(service_error)?,
    )
}

fn handle_workspace_update_repo_hooks(state: &HeadlessState, args: Value) -> CommandResult {
    let WorkspaceUpdateRepoHooksArgs { repo_path, hooks } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .workspace_update_repo_hooks(&repo_path, hooks)
            .map_err(service_error)?,
    )
}

fn handle_workspace_get_settings_snapshot(state: &HeadlessState) -> CommandResult {
    let (theme, git, chat, repos, global_prompt_overrides) = state
        .service
        .workspace_get_settings_snapshot()
        .map_err(service_error)?;
    serialize_value(SettingsSnapshotResponsePayload {
        theme,
        git,
        chat,
        repos,
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

async fn handle_workspace_save_settings_snapshot(
    state: &HeadlessState,
    args: Value,
) -> CommandResult {
    let WorkspaceSaveSettingsSnapshotArgs { snapshot } = deserialize_args(args)?;
    let service = state.service.clone();
    let confirmation_port = HeadlessHookTrustConfirmationPort;
    let SettingsSnapshotPayload {
        theme,
        git,
        chat,
        repos,
        global_prompt_overrides,
    } = snapshot;
    serialize_value(
        run_service_blocking_tokio("workspace_save_settings_snapshot", move || {
            service.workspace_save_settings_snapshot(
                theme,
                git,
                chat,
                repos,
                global_prompt_overrides,
                &confirmation_port,
            )
        })
        .await
        .map_err(service_error)?,
    )
}

async fn handle_workspace_set_trusted_hooks(state: &HeadlessState, args: Value) -> CommandResult {
    let WorkspaceSetTrustedHooksArgs {
        repo_path,
        trusted,
        challenge_nonce,
        challenge_fingerprint,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    let confirmation_port = HeadlessHookTrustConfirmationPort;
    serialize_value(
        run_service_blocking_tokio("workspace_set_trusted_hooks", move || {
            service.workspace_set_trusted_hooks(
                &repo_path,
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

fn handle_git_get_current_branch(state: &HeadlessState, args: Value) -> CommandResult {
    let GitCurrentBranchArgs {
        repo_path,
        working_dir,
    } = deserialize_args(args)?;
    let effective = resolve_authorized_working_dir(state, &repo_path, working_dir.as_deref())?;
    serialize_value(
        state
            .service
            .git_port()
            .get_current_branch(std::path::Path::new(&effective))
            .map_err(service_error)?,
    )
}

fn handle_git_switch_branch(state: &HeadlessState, args: Value) -> CommandResult {
    let GitSwitchBranchArgs {
        repo_path,
        branch,
        create,
    } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .git_switch_branch(&repo_path, &branch, create.unwrap_or(false))
            .map_err(service_error)?,
    )
}

fn handle_git_create_worktree(state: &HeadlessState, args: Value) -> CommandResult {
    let GitCreateWorktreeArgs {
        repo_path,
        worktree_path,
        branch,
        create_branch,
    } = deserialize_args(args)?;
    let summary = state
        .service
        .git_create_worktree(
            &repo_path,
            &worktree_path,
            &branch,
            create_branch.unwrap_or(false),
        )
        .map_err(service_error)?;
    invalidate_repo_worktree_cache(&repo_path)?;
    serialize_value(summary)
}

fn handle_git_remove_worktree(state: &HeadlessState, args: Value) -> CommandResult {
    let GitRemoveWorktreeArgs {
        repo_path,
        worktree_path,
        force,
    } = deserialize_args(args)?;
    let removed = state
        .service
        .git_remove_worktree(&repo_path, &worktree_path, force.unwrap_or(false))
        .map_err(service_error)?;
    invalidate_repo_worktree_cache(&repo_path)?;
    Ok(json!({ "ok": removed }))
}

fn handle_git_push_branch(state: &HeadlessState, args: Value) -> CommandResult {
    let GitPushBranchArgs {
        repo_path,
        branch,
        working_dir,
        remote,
        set_upstream,
        force_with_lease,
    } = deserialize_args(args)?;
    let effective = resolve_authorized_working_dir(state, &repo_path, working_dir.as_deref())?;
    serialize_value(
        state
            .service
            .git_push_branch(
                &repo_path,
                Some(effective.as_str()),
                remote.as_deref(),
                &branch,
                set_upstream.unwrap_or(false),
                force_with_lease.unwrap_or(false),
            )
            .map_err(service_error)?,
    )
}

fn handle_git_get_status(state: &HeadlessState, args: Value) -> CommandResult {
    let GitStatusArgs {
        repo_path,
        working_dir,
    } = deserialize_args(args)?;
    let effective = resolve_authorized_working_dir(state, &repo_path, working_dir.as_deref())?;
    serialize_value(
        state
            .service
            .git_port()
            .get_status(std::path::Path::new(&effective))
            .map_err(service_error)?,
    )
}

fn handle_git_get_diff(state: &HeadlessState, args: Value) -> CommandResult {
    let GitDiffArgs {
        repo_path,
        target_branch,
        working_dir,
    } = deserialize_args(args)?;
    let effective = resolve_authorized_working_dir(state, &repo_path, working_dir.as_deref())?;
    serialize_value(
        state
            .service
            .git_port()
            .get_diff(std::path::Path::new(&effective), target_branch.as_deref())
            .map_err(service_error)?,
    )
}

fn handle_git_commits_ahead_behind(state: &HeadlessState, args: Value) -> CommandResult {
    let GitAheadBehindArgs {
        repo_path,
        target_branch,
        working_dir,
    } = deserialize_args(args)?;
    let effective = resolve_authorized_working_dir(state, &repo_path, working_dir.as_deref())?;
    serialize_value(
        state
            .service
            .git_port()
            .commits_ahead_behind(std::path::Path::new(&effective), &target_branch)
            .map_err(service_error)?,
    )
}

fn handle_git_get_worktree_status(state: &HeadlessState, args: Value) -> CommandResult {
    let GitWorktreeStatusArgs {
        repo_path,
        target_branch,
        diff_scope,
        working_dir,
    } = deserialize_args(args)?;
    let trimmed_target = require_target_branch(&target_branch).map_err(request_error)?;
    let scope = parse_diff_scope(diff_scope.as_deref()).map_err(request_error)?;
    let effective = resolve_authorized_working_dir(state, &repo_path, working_dir.as_deref())?;
    let repo = std::path::Path::new(&effective);
    let worktree_status = state
        .service
        .git_port()
        .get_worktree_status(repo, trimmed_target, scope.clone())
        .map_err(service_error)?;
    let status_hash = hash_worktree_status_payload(
        &worktree_status.current_branch,
        worktree_status.file_statuses.as_slice(),
        &worktree_status.target_ahead_behind,
        &worktree_status.upstream_ahead_behind,
    );
    let diff_hash = hash_worktree_diff_payload(worktree_status.file_diffs.as_slice());
    serialize_value(build_worktree_status_with_snapshot(
        worktree_status,
        build_worktree_snapshot_metadata(effective, trimmed_target, scope, status_hash, diff_hash),
    ))
}

fn handle_git_get_worktree_status_summary(state: &HeadlessState, args: Value) -> CommandResult {
    let GitWorktreeStatusArgs {
        repo_path,
        target_branch,
        diff_scope,
        working_dir,
    } = deserialize_args(args)?;
    let trimmed_target = require_target_branch(&target_branch).map_err(request_error)?;
    let scope = parse_diff_scope(diff_scope.as_deref()).map_err(request_error)?;
    let effective = resolve_authorized_working_dir(state, &repo_path, working_dir.as_deref())?;
    let repo = std::path::Path::new(&effective);
    let summary = state
        .service
        .git_port()
        .get_worktree_status_summary(repo, trimmed_target, scope.clone())
        .map_err(service_error)?;
    let status_hash = hash_worktree_status_payload(
        &summary.current_branch,
        summary.file_statuses.as_slice(),
        &summary.target_ahead_behind,
        &summary.upstream_ahead_behind,
    );
    let diff_hash = hash_worktree_diff_summary_payload(
        &scope,
        &summary.target_ahead_behind,
        &summary.file_status_counts,
    );
    serialize_value(build_worktree_status_summary_with_snapshot(
        summary.current_branch,
        summary.file_status_counts,
        summary.target_ahead_behind,
        summary.upstream_ahead_behind,
        build_worktree_snapshot_metadata(effective, trimmed_target, scope, status_hash, diff_hash),
    ))
}

fn handle_git_commit_all(state: &HeadlessState, args: Value) -> CommandResult {
    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GitCommitAllArgs {
        repo_path: String,
        working_dir: Option<String>,
        message: String,
    }

    let request: GitCommitAllArgs = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .git_commit_all(
                &request.repo_path,
                host_domain::GitCommitAllRequest {
                    working_dir: request.working_dir,
                    message: request.message,
                },
            )
            .map_err(service_error)?,
    )
}

fn handle_git_pull_branch(state: &HeadlessState, args: Value) -> CommandResult {
    let request: GitPullBranchArgs = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .git_pull_branch(
                &request.repo_path,
                host_domain::GitPullRequest {
                    working_dir: request.working_dir,
                },
            )
            .map_err(service_error)?,
    )
}

fn handle_git_rebase_branch(state: &HeadlessState, args: Value) -> CommandResult {
    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GitRebaseBranchArgs {
        repo_path: String,
        target_branch: String,
        working_dir: Option<String>,
    }

    let request: GitRebaseBranchArgs = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .git_rebase_branch(
                &request.repo_path,
                host_domain::GitRebaseBranchRequest {
                    working_dir: request.working_dir,
                    target_branch: request.target_branch,
                },
            )
            .map_err(service_error)?,
    )
}

fn handle_git_rebase_abort(state: &HeadlessState, args: Value) -> CommandResult {
    let request: GitRebaseAbortArgs = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .git_rebase_abort(
                &request.repo_path,
                host_domain::GitRebaseAbortRequest {
                    working_dir: request.working_dir,
                },
            )
            .map_err(service_error)?,
    )
}

fn handle_task_create(state: &HeadlessState, args: Value) -> CommandResult {
    let TaskCreateArgs { repo_path, input } = deserialize_args(args)?;
    let create = map_task_create_payload(input).map_err(request_error)?;
    serialize_value(
        state
            .service
            .task_create(&repo_path, create)
            .map_err(service_error)?,
    )
}

fn handle_task_update(state: &HeadlessState, args: Value) -> CommandResult {
    let TaskUpdateArgs {
        repo_path,
        task_id,
        patch,
    } = deserialize_args(args)?;
    let mapped = map_task_update_payload(patch).map_err(request_error)?;
    serialize_value(
        state
            .service
            .task_update(&repo_path, &task_id, mapped)
            .map_err(service_error)?,
    )
}

fn handle_task_delete(state: &HeadlessState, args: Value) -> CommandResult {
    let TaskDeleteArgs {
        repo_path,
        task_id,
        delete_subtasks,
    } = deserialize_args(args)?;
    let ok = state
        .service
        .task_delete(&repo_path, &task_id, delete_subtasks.unwrap_or(false))
        .map(|()| true)
        .map_err(service_error)?;
    Ok(json!({ "ok": ok }))
}

fn handle_task_transition(state: &HeadlessState, args: Value) -> CommandResult {
    let TaskTransitionArgs {
        repo_path,
        task_id,
        status,
        reason,
    } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .task_transition(&repo_path, &task_id, status, reason.as_deref())
            .map_err(service_error)?,
    )
}

fn handle_task_defer(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_reason_operation(args, |repo_path, task_id, reason| {
        state
            .service
            .task_defer(&repo_path, &task_id, reason.as_deref())
    })
}

fn handle_task_resume_deferred(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_operation(args, |repo_path, task_id| {
        state.service.task_resume_deferred(&repo_path, &task_id)
    })
}

fn handle_spec_get(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_operation(args, |repo_path, task_id| {
        state.service.spec_get(&repo_path, &task_id)
    })
}

fn handle_task_metadata_get(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_operation(args, |repo_path, task_id| {
        state.service.task_metadata_get(&repo_path, &task_id)
    })
}

fn handle_set_spec(state: &HeadlessState, args: Value) -> CommandResult {
    let SetSpecArgs {
        repo_path,
        task_id,
        markdown,
    } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .set_spec(&repo_path, &task_id, &markdown)
            .map_err(service_error)?,
    )
}

fn handle_spec_save_document(state: &HeadlessState, args: Value) -> CommandResult {
    let SetSpecArgs {
        repo_path,
        task_id,
        markdown,
    } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .save_spec_document(&repo_path, &task_id, &markdown)
            .map_err(service_error)?,
    )
}

fn handle_plan_get(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_operation(args, |repo_path, task_id| {
        state.service.plan_get(&repo_path, &task_id)
    })
}

fn handle_set_plan(state: &HeadlessState, args: Value) -> CommandResult {
    let SetPlanArgs {
        repo_path,
        task_id,
        input,
    } = deserialize_args(args)?;
    let mapped_subtasks = map_plan_subtasks(input.subtasks).map_err(request_error)?;
    serialize_value(
        state
            .service
            .set_plan(&repo_path, &task_id, &input.markdown, mapped_subtasks)
            .map_err(service_error)?,
    )
}

fn handle_plan_save_document(state: &HeadlessState, args: Value) -> CommandResult {
    let SetSpecArgs {
        repo_path,
        task_id,
        markdown,
    } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .save_plan_document(&repo_path, &task_id, &markdown)
            .map_err(service_error)?,
    )
}

fn handle_qa_get_report(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_operation(args, |repo_path, task_id| {
        state.service.qa_get_report(&repo_path, &task_id)
    })
}

fn handle_qa_approved(state: &HeadlessState, args: Value) -> CommandResult {
    let MarkdownInputArgs {
        repo_path,
        task_id,
        input,
    } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .qa_approved(&repo_path, &task_id, &input.markdown)
            .map_err(service_error)?,
    )
}

fn handle_qa_rejected(state: &HeadlessState, args: Value) -> CommandResult {
    let MarkdownInputArgs {
        repo_path,
        task_id,
        input,
    } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .qa_rejected(&repo_path, &task_id, &input.markdown)
            .map_err(service_error)?,
    )
}

fn handle_build_blocked(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_reason_operation(args, |repo_path, task_id, reason| {
        state
            .service
            .build_blocked(&repo_path, &task_id, reason.as_deref())
    })
}

fn handle_build_resumed(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_operation(args, |repo_path, task_id| {
        state.service.build_resumed(&repo_path, &task_id)
    })
}

fn handle_build_completed(state: &HeadlessState, args: Value) -> CommandResult {
    let BuildCompletedArgs {
        repo_path,
        task_id,
        input,
    } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .build_completed(
                &repo_path,
                &task_id,
                input.as_ref().and_then(|entry| entry.summary.as_deref()),
            )
            .map_err(service_error)?,
    )
}

fn handle_task_approval_context_get(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_operation(args, |repo_path, task_id| {
        state
            .service
            .task_approval_context_get(&repo_path, &task_id)
    })
}

fn handle_task_direct_merge(state: &HeadlessState, args: Value) -> CommandResult {
    let TaskDirectMergeArgs {
        repo_path,
        task_id,
        merge_method,
    } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .task_direct_merge(&repo_path, &task_id, merge_method)
            .map_err(service_error)?,
    )
}

fn handle_task_pull_request_upsert(state: &HeadlessState, args: Value) -> CommandResult {
    let TaskPullRequestUpsertArgs {
        repo_path,
        task_id,
        input,
    } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .task_pull_request_upsert(&repo_path, &task_id, &input.title, &input.body)
            .map_err(service_error)?,
    )
}

fn handle_task_pull_request_unlink(state: &HeadlessState, args: Value) -> CommandResult {
    let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
    Ok(json!({
        "ok": state
            .service
            .task_pull_request_unlink(&repo_path, &task_id)
            .map_err(service_error)?
    }))
}

fn handle_task_pull_request_detect(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_operation(args, |repo_path, task_id| {
        state.service.task_pull_request_detect(&repo_path, &task_id)
    })
}

fn handle_repo_pull_request_sync(state: &HeadlessState, args: Value) -> CommandResult {
    let RepoPathArgs { repo_path } = deserialize_args(args)?;
    Ok(json!({
        "ok": state
            .service
            .repo_pull_request_sync(&repo_path)
            .map_err(service_error)?
    }))
}

fn handle_human_request_changes(state: &HeadlessState, args: Value) -> CommandResult {
    let HumanRequestChangesArgs {
        repo_path,
        task_id,
        note,
    } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .human_request_changes(&repo_path, &task_id, note.as_deref())
            .map_err(service_error)?,
    )
}

fn handle_human_approve(state: &HeadlessState, args: Value) -> CommandResult {
    handle_repo_task_operation(args, |repo_path, task_id| {
        state.service.human_approve(&repo_path, &task_id)
    })
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
        run_service_blocking_tokio("build_start", move || {
            service.build_start(&repo_path, &task_id, runtime_kind.as_str(), emitter)
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

fn handle_build_stop(state: &HeadlessState, args: Value) -> CommandResult {
    let BuildStopArgs { run_id } = deserialize_args(args)?;
    Ok(json!({
        "ok": state
            .service
            .build_stop(&run_id, make_emitter(state.events.clone()))
            .map_err(service_error)?
    }))
}

fn handle_build_cleanup(state: &HeadlessState, args: Value) -> CommandResult {
    let BuildCleanupArgs { run_id, mode } = deserialize_args(args)?;
    Ok(json!({
        "ok": state
            .service
            .build_cleanup(&run_id, mode, make_emitter(state.events.clone()))
            .map_err(service_error)?
    }))
}

fn handle_runs_list(state: &HeadlessState, args: Value) -> CommandResult {
    let OptionalRepoPathArgs { repo_path } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .runs_list(repo_path.as_deref())
            .map_err(service_error)?,
    )
}

fn handle_runtime_definitions_list(state: &HeadlessState) -> CommandResult {
    serialize_value(
        state
            .service
            .runtime_definitions_list()
            .map_err(service_error)?,
    )
}

fn handle_runtime_list(state: &HeadlessState, args: Value) -> CommandResult {
    let RuntimeListArgs {
        runtime_kind,
        repo_path,
    } = deserialize_args(args)?;
    serialize_value(
        state
            .service
            .runtime_list(&runtime_kind, repo_path.as_deref())
            .map_err(service_error)?,
    )
}

async fn handle_qa_review_target_get(state: &HeadlessState, args: Value) -> CommandResult {
    let RepoTaskArgs { repo_path, task_id } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_service_blocking_tokio("qa_review_target_get", move || {
            service.qa_review_target_get(&repo_path, &task_id)
        })
        .await
        .map_err(service_error)?,
    )
}

fn handle_runtime_stop(state: &HeadlessState, args: Value) -> CommandResult {
    let RuntimeStopArgs { runtime_id } = deserialize_args(args)?;
    Ok(json!({
        "ok": state
            .service
            .runtime_stop(&runtime_id)
            .map_err(service_error)?
    }))
}

async fn handle_runtime_ensure(state: &HeadlessState, args: Value) -> CommandResult {
    let RuntimeEnsureArgs {
        runtime_kind,
        repo_path,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_service_blocking_tokio("runtime_ensure", move || {
            service.runtime_ensure(&runtime_kind, &repo_path)
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

    #[test]
    fn parse_last_event_id_accepts_valid_header() {
        let mut headers = HeaderMap::new();
        headers.insert("last-event-id", HeaderValue::from_static("42"));

        let parsed = parse_last_event_id(&headers).expect("header should parse");

        assert_eq!(parsed, Some(42));
    }

    #[test]
    fn parse_last_event_id_rejects_invalid_header() {
        let mut headers = HeaderMap::new();
        headers.insert("last-event-id", HeaderValue::from_static("abc"));

        let error = parse_last_event_id(&headers).expect_err("invalid header should fail");

        assert_eq!(error.status, StatusCode::BAD_REQUEST);
        assert!(error.message.contains("Invalid Last-Event-ID header"));
    }

    #[test]
    fn headless_event_bus_replays_buffered_events_after_last_seen_id() {
        let bus = HeadlessEventBus::new(2);
        bus.emit("first".to_string());
        bus.emit("second".to_string());
        bus.emit("third".to_string());

        let replayed = bus.replay_since(Some(1));

        assert_eq!(replayed.len(), 2);
        assert_eq!(replayed[0].id, 2);
        assert_eq!(replayed[0].payload, "second");
        assert_eq!(replayed[1].id, 3);
        assert_eq!(replayed[1].payload, "third");
    }

    #[test]
    fn to_sse_event_sets_event_id() {
        let event = HeadlessEvent {
            id: 7,
            payload: "{\"ok\":true}".to_string(),
        };

        let sse = to_sse_event(&event).expect("event should serialize");

        let debug = format!("{sse:?}");
        assert!(
            debug.contains("id"),
            "expected event debug output to mention id: {debug}"
        );
        assert!(
            debug.contains("7"),
            "expected event debug output to contain id value: {debug}"
        );
    }
}
