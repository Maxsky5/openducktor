use super::command_registry::{build_registry, dispatch_command};
use super::command_support::{HeadlessCommandError, HeadlessState};
use super::events::{build_sse_response, parse_last_event_id, HeadlessEventBus};
use crate::commands::workspace::is_staged_local_attachment_path;
use crate::external_task_sync::ExternalTaskSyncEvent;
use crate::pull_request_sync::start_pull_request_sync_loop;
use crate::{
    startup_phase_service_bootstrap, startup_phase_shutdown_hooks_with_gate, startup_phase_tracing,
};
use anyhow::Context;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Path, Query, State};
use axum::http::header;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::Notify;
use tokio_util::io::ReaderStream;
use tower_http::cors::CorsLayer;

const DEFAULT_BROWSER_BACKEND_HOST: &str = "127.0.0.1";
const DEFAULT_BROWSER_FRONTEND_ORIGINS: [&str; 3] = [
    "http://localhost:1420",
    "http://127.0.0.1:1420",
    "http://[::1]:1420",
];
const BROWSER_FRONTEND_ORIGIN_ENV: &str = "ODT_BROWSER_FRONTEND_ORIGIN";
const LAST_EVENT_ID_HEADER: &str = "last-event-id";
pub(super) const EVENT_BUFFER_CAPACITY: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShutdownRequestAction {
    Start,
    AlreadyStarted,
}

fn classify_shutdown_request(already_started: bool) -> ShutdownRequestAction {
    if already_started {
        ShutdownRequestAction::AlreadyStarted
    } else {
        ShutdownRequestAction::Start
    }
}

fn shutdown_exit_code(success: bool) -> i32 {
    if success {
        0
    } else {
        1
    }
}

fn reject_when_shutting_down(state: &HeadlessState) -> Result<(), HeadlessCommandError> {
    if state.shutdown_started.load(Ordering::SeqCst) {
        Err(HeadlessCommandError {
            message: "Browser backend is shutting down and is no longer accepting new work."
                .to_string(),
            status: StatusCode::SERVICE_UNAVAILABLE,
            failure_kind: None,
        })
    } else {
        Ok(())
    }
}

pub(super) async fn run_browser_backend(port: u16) -> anyhow::Result<()> {
    startup_phase_tracing();
    let service = startup_phase_service_bootstrap()?;
    let registry =
        Arc::new(build_registry().context("failed to build browser backend command registry")?);
    let events = HeadlessEventBus::new(EVENT_BUFFER_CAPACITY);
    let dev_server_events = HeadlessEventBus::new(EVENT_BUFFER_CAPACITY);
    let task_events = HeadlessEventBus::new(EVENT_BUFFER_CAPACITY);
    let pull_request_sync_stop_requested = start_pull_request_sync_loop(service.clone(), {
        let task_events = task_events.clone();
        move |event: ExternalTaskSyncEvent| match serde_json::to_string(&event) {
            Ok(payload) => task_events.emit(payload),
            Err(error) => {
                tracing::error!(
                    target: "openducktor.task-sync",
                    error = %error,
                    "Pull request sync loop failed to serialize a browser task event"
                );
            }
        }
    });
    let shutdown_signal = Arc::new(Notify::new());
    let shutdown_started = Arc::new(AtomicBool::new(false));
    startup_phase_shutdown_hooks_with_gate(
        service.clone(),
        shutdown_started.clone(),
        Some(shutdown_signal.clone()),
    );
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/shutdown", post(shutdown_handler))
        .route("/events", get(events_handler))
        .route("/dev-server-events", get(dev_server_events_handler))
        .route("/task-events", get(task_events_handler))
        .route(
            "/local-attachment-preview",
            get(local_attachment_preview_handler),
        )
        .route("/invoke/{command}", post(invoke_handler))
        .layer(browser_backend_cors_layer()?)
        .with_state(HeadlessState {
            service,
            events,
            dev_server_events,
            task_events,
            pull_request_sync_stop_requested,
            registry,
            shutdown_signal: shutdown_signal.clone(),
            shutdown_started: shutdown_started.clone(),
        });

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
        .with_graceful_shutdown(async move {
            shutdown_signal.notified().await;
        })
        .await
        .context("browser backend server terminated unexpectedly")
}

async fn health_handler() -> impl IntoResponse {
    Json(json!({ "ok": true }))
}

async fn shutdown_handler(State(state): State<HeadlessState>) -> impl IntoResponse {
    if classify_shutdown_request(state.shutdown_started.swap(true, Ordering::SeqCst))
        == ShutdownRequestAction::AlreadyStarted
    {
        return (StatusCode::ACCEPTED, Json(json!({ "ok": true })));
    }

    let service = state.service.clone();
    let shutdown_signal = state.shutdown_signal.clone();
    state
        .pull_request_sync_stop_requested
        .store(true, Ordering::SeqCst);
    tokio::spawn(async move {
        shutdown_signal.notify_waiters();
        let exit_code = match tokio::task::spawn_blocking(move || service.shutdown()).await {
            Ok(Ok(())) => shutdown_exit_code(true),
            Ok(Err(error)) => {
                tracing::error!(
                    target: "openducktor.browser-backend",
                    error = %error,
                    "Browser backend shutdown failed"
                );
                shutdown_exit_code(false)
            }
            Err(error) => {
                tracing::error!(
                    target: "openducktor.browser-backend",
                    error = %error,
                    "Browser backend shutdown task failed"
                );
                shutdown_exit_code(false)
            }
        };
        tokio::task::yield_now().await;
        std::process::exit(exit_code);
    });

    (StatusCode::ACCEPTED, Json(json!({ "ok": true })))
}

async fn events_handler(
    State(state): State<HeadlessState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, HeadlessCommandError> {
    reject_when_shutting_down(&state)?;
    let last_event_id = parse_last_event_id(&headers)?;
    Ok(build_sse_response(
        state.events,
        last_event_id,
        "Browser event stream",
    ))
}

async fn dev_server_events_handler(
    State(state): State<HeadlessState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, HeadlessCommandError> {
    reject_when_shutting_down(&state)?;
    let last_event_id = parse_last_event_id(&headers)?;
    Ok(build_sse_response(
        state.dev_server_events,
        last_event_id,
        "Browser dev server event stream",
    ))
}

async fn task_events_handler(
    State(state): State<HeadlessState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, HeadlessCommandError> {
    reject_when_shutting_down(&state)?;
    let last_event_id = parse_last_event_id(&headers)?;
    Ok(build_sse_response(
        state.task_events,
        last_event_id,
        "Browser task event stream",
    ))
}

async fn invoke_handler(
    Path(command): Path<String>,
    State(state): State<HeadlessState>,
    args: Result<Json<Value>, JsonRejection>,
) -> impl IntoResponse {
    if let Err(error) = reject_when_shutting_down(&state) {
        return error.into_response();
    }

    let args = match args {
        Ok(Json(args)) => args,
        Err(error) => return json_rejection_error(error).into_response(),
    };

    match dispatch_command(&state, &command, args).await {
        Ok(payload) => (StatusCode::OK, Json(payload)).into_response(),
        Err(error) => error.into_response(),
    }
}

#[derive(Deserialize)]
struct LocalAttachmentPreviewQuery {
    path: String,
}

async fn local_attachment_preview_handler(
    Query(query): Query<LocalAttachmentPreviewQuery>,
) -> Result<Response, HeadlessCommandError> {
    let path = PathBuf::from(&query.path);
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|error| HeadlessCommandError {
            message: format!("Failed to stat local attachment preview: {error}"),
            status: StatusCode::NOT_FOUND,
            failure_kind: None,
        })?;
    if !metadata.is_file() {
        return Err(HeadlessCommandError {
            message: "Local attachment preview path must reference a file".to_string(),
            status: StatusCode::BAD_REQUEST,
            failure_kind: None,
        });
    }
    let allowed = is_staged_local_attachment_path(&path).map_err(|error| HeadlessCommandError {
        message: error,
        status: StatusCode::INTERNAL_SERVER_ERROR,
        failure_kind: None,
    })?;
    if !allowed {
        return Err(HeadlessCommandError {
            message: "Local attachment preview is only available for staged attachment files."
                .to_string(),
            status: StatusCode::FORBIDDEN,
            failure_kind: None,
        });
    }

    let file = tokio::fs::File::open(&path)
        .await
        .map_err(|error| HeadlessCommandError {
            message: format!("Failed to read local attachment preview: {error}"),
            status: StatusCode::INTERNAL_SERVER_ERROR,
            failure_kind: None,
        })?;
    let mime = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .to_string();
    let stream = ReaderStream::new(file);

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, "no-store, private")
        .body(axum::body::Body::from_stream(stream))
        .map_err(|error| HeadlessCommandError {
            message: format!("Failed to build local attachment preview response: {error}"),
            status: StatusCode::INTERNAL_SERVER_ERROR,
            failure_kind: None,
        })
}

fn json_rejection_error(error: JsonRejection) -> HeadlessCommandError {
    HeadlessCommandError {
        message: error.body_text(),
        status: error.status(),
        failure_kind: None,
    }
}

fn browser_backend_cors_layer() -> anyhow::Result<CorsLayer> {
    let layer = if let Ok(origin) = std::env::var(BROWSER_FRONTEND_ORIGIN_ENV) {
        let origin = origin.trim();
        if origin.is_empty() {
            CorsLayer::new()
                .allow_origin(parse_default_frontend_origins()?)
                .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
                .allow_headers(browser_backend_allowed_headers())
        } else {
            CorsLayer::new()
                .allow_origin(parse_origin_header(origin)?)
                .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
                .allow_headers(browser_backend_allowed_headers())
        }
    } else {
        CorsLayer::new()
            .allow_origin(parse_default_frontend_origins()?)
            .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
            .allow_headers(browser_backend_allowed_headers())
    };

    Ok(layer)
}

fn browser_backend_allowed_headers() -> [header::HeaderName; 2] {
    [
        header::CONTENT_TYPE,
        header::HeaderName::from_static(LAST_EVENT_ID_HEADER),
    ]
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::workspace::stage_local_attachment_to_temp;
    use anyhow::{anyhow, Result};
    use axum::body::{to_bytes, Body};
    use axum::extract::FromRequest;
    use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
    use axum::http::Request;
    use host_application::AppService;
    use host_domain::{
        AgentSessionDocument, AgentWorkflows, CreateTaskInput, DirectMergeRecord, IssueType,
        PullRequestRecord, QaReportDocument, QaVerdict, RepoStoreAttachmentHealth, RepoStoreHealth,
        RepoStoreHealthCategory, RepoStoreHealthStatus, RepoStoreSharedServerHealth,
        RepoStoreSharedServerOwnershipState, SpecDocument, TaskCard, TaskDocumentSummary,
        TaskMetadata, TaskStatus, TaskStore, UpdateTaskPatch,
    };
    use host_infra_beads::BeadsTaskStore;
    use host_infra_system::{AppConfigStore, RepoConfig};
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[derive(Debug, Default)]
    struct TestTaskStoreState {
        ensure_calls: Vec<String>,
        created_inputs: Vec<CreateTaskInput>,
        tasks: Vec<TaskCard>,
    }

    #[derive(Clone)]
    struct TestTaskStore {
        state: Arc<Mutex<TestTaskStoreState>>,
    }

    impl TestTaskStore {
        fn new(state: Arc<Mutex<TestTaskStoreState>>) -> Self {
            Self { state }
        }
    }

    impl TaskStore for TestTaskStore {
        fn diagnose_repo_store(&self, repo_path: &std::path::Path) -> Result<RepoStoreHealth> {
            Ok(RepoStoreHealth {
                category: RepoStoreHealthCategory::Healthy,
                status: RepoStoreHealthStatus::Ready,
                is_ready: true,
                detail: Some("Beads attachment and shared Dolt server are healthy.".to_string()),
                attachment: RepoStoreAttachmentHealth {
                    path: Some(repo_path.join(".beads").to_string_lossy().to_string()),
                    database_name: Some("headless-test".to_string()),
                },
                shared_server: RepoStoreSharedServerHealth {
                    host: Some("127.0.0.1".to_string()),
                    port: Some(3307),
                    ownership_state: RepoStoreSharedServerOwnershipState::OwnedByCurrentProcess,
                },
            })
        }

        fn ensure_repo_initialized(&self, repo_path: &std::path::Path) -> Result<()> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            state
                .ensure_calls
                .push(repo_path.to_string_lossy().to_string());
            Ok(())
        }

        fn list_tasks(&self, _repo_path: &std::path::Path) -> Result<Vec<TaskCard>> {
            let state = self.state.lock().expect("task store lock poisoned");
            Ok(state.tasks.clone())
        }

        fn list_pull_request_sync_candidates(
            &self,
            repo_path: &std::path::Path,
        ) -> Result<Vec<TaskCard>> {
            self.list_tasks(repo_path)
        }

        fn get_task(&self, _repo_path: &std::path::Path, task_id: &str) -> Result<TaskCard> {
            let state = self.state.lock().expect("task store lock poisoned");
            state
                .tasks
                .iter()
                .find(|task| task.id == task_id)
                .cloned()
                .ok_or_else(|| anyhow!("Task not found: {task_id}"))
        }

        fn create_task(
            &self,
            _repo_path: &std::path::Path,
            input: CreateTaskInput,
        ) -> Result<TaskCard> {
            let mut state = self.state.lock().expect("task store lock poisoned");
            state.created_inputs.push(input.clone());
            let task = TaskCard {
                id: format!("generated-{}", state.tasks.len() + 1),
                title: input.title,
                description: input.description.unwrap_or_default(),
                notes: String::new(),
                status: TaskStatus::Open,
                priority: input.priority,
                issue_type: input.issue_type,
                ai_review_enabled: input.ai_review_enabled.unwrap_or(true),
                available_actions: Vec::new(),
                labels: input.labels.unwrap_or_default(),
                assignee: None,
                parent_id: input.parent_id,
                subtask_ids: Vec::new(),
                agent_sessions: Vec::new(),
                target_branch: None,
                target_branch_error: None,
                pull_request: None,
                document_summary: TaskDocumentSummary::default(),
                agent_workflows: AgentWorkflows::default(),
                updated_at: "2026-04-09T00:00:00Z".to_string(),
                created_at: "2026-04-09T00:00:00Z".to_string(),
            };
            state.tasks.push(task.clone());
            Ok(task)
        }

        fn update_task(
            &self,
            _repo_path: &std::path::Path,
            _task_id: &str,
            _patch: UpdateTaskPatch,
        ) -> Result<TaskCard> {
            Err(anyhow!(
                "update_task not implemented in headless test store"
            ))
        }

        fn delete_task(
            &self,
            _repo_path: &std::path::Path,
            _task_id: &str,
            _delete_subtasks: bool,
        ) -> Result<bool> {
            Err(anyhow!(
                "delete_task not implemented in headless test store"
            ))
        }

        fn get_spec(&self, _repo_path: &std::path::Path, _task_id: &str) -> Result<SpecDocument> {
            Err(anyhow!("get_spec not implemented in headless test store"))
        }

        fn set_spec(
            &self,
            _repo_path: &std::path::Path,
            _task_id: &str,
            _markdown: &str,
        ) -> Result<SpecDocument> {
            Err(anyhow!("set_spec not implemented in headless test store"))
        }

        fn get_plan(&self, _repo_path: &std::path::Path, _task_id: &str) -> Result<SpecDocument> {
            Err(anyhow!("get_plan not implemented in headless test store"))
        }

        fn set_plan(
            &self,
            _repo_path: &std::path::Path,
            _task_id: &str,
            _markdown: &str,
        ) -> Result<SpecDocument> {
            Err(anyhow!("set_plan not implemented in headless test store"))
        }

        fn clear_workflow_documents(
            &self,
            _repo_path: &std::path::Path,
            _task_id: &str,
        ) -> Result<()> {
            Err(anyhow!(
                "clear_workflow_documents not implemented in headless test store"
            ))
        }

        fn get_latest_qa_report(
            &self,
            _repo_path: &std::path::Path,
            _task_id: &str,
        ) -> Result<Option<QaReportDocument>> {
            Err(anyhow!(
                "get_latest_qa_report not implemented in headless test store"
            ))
        }

        fn append_qa_report(
            &self,
            _repo_path: &std::path::Path,
            _task_id: &str,
            _markdown: &str,
            _verdict: QaVerdict,
        ) -> Result<QaReportDocument> {
            Err(anyhow!(
                "append_qa_report not implemented in headless test store"
            ))
        }

        fn record_qa_outcome(
            &self,
            _repo_path: &std::path::Path,
            _task_id: &str,
            _target_status: TaskStatus,
            _markdown: &str,
            _verdict: QaVerdict,
        ) -> Result<TaskCard> {
            Err(anyhow!(
                "record_qa_outcome not implemented in headless test store"
            ))
        }

        fn list_agent_sessions(
            &self,
            _repo_path: &std::path::Path,
            _task_id: &str,
        ) -> Result<Vec<AgentSessionDocument>> {
            Err(anyhow!(
                "list_agent_sessions not implemented in headless test store"
            ))
        }

        fn upsert_agent_session(
            &self,
            _repo_path: &std::path::Path,
            _task_id: &str,
            _session: AgentSessionDocument,
        ) -> Result<()> {
            Err(anyhow!(
                "upsert_agent_session not implemented in headless test store"
            ))
        }

        fn clear_agent_sessions_by_roles(
            &self,
            _repo_path: &std::path::Path,
            _task_id: &str,
            _roles: &[&str],
        ) -> Result<()> {
            Err(anyhow!(
                "clear_agent_sessions_by_roles not implemented in headless test store"
            ))
        }

        fn clear_qa_reports(&self, _repo_path: &std::path::Path, _task_id: &str) -> Result<()> {
            Err(anyhow!(
                "clear_qa_reports not implemented in headless test store"
            ))
        }

        fn set_delivery_metadata(
            &self,
            _repo_path: &std::path::Path,
            _task_id: &str,
            _pull_request: Option<PullRequestRecord>,
            _direct_merge: Option<DirectMergeRecord>,
        ) -> Result<()> {
            Err(anyhow!(
                "set_delivery_metadata not implemented in headless test store"
            ))
        }

        fn set_pull_request(
            &self,
            _repo_path: &std::path::Path,
            _task_id: &str,
            _pull_request: Option<PullRequestRecord>,
        ) -> Result<()> {
            Err(anyhow!(
                "set_pull_request not implemented in headless test store"
            ))
        }

        fn set_direct_merge_record(
            &self,
            _repo_path: &std::path::Path,
            _task_id: &str,
            _direct_merge: Option<DirectMergeRecord>,
        ) -> Result<()> {
            Err(anyhow!(
                "set_direct_merge_record not implemented in headless test store"
            ))
        }

        fn get_task_metadata(
            &self,
            _repo_path: &std::path::Path,
            _task_id: &str,
        ) -> Result<TaskMetadata> {
            Err(anyhow!(
                "get_task_metadata not implemented in headless test store"
            ))
        }
    }

    fn make_task(id: &str, title: &str, status: TaskStatus, labels: Vec<&str>) -> TaskCard {
        TaskCard {
            id: id.to_string(),
            title: title.to_string(),
            description: String::new(),
            notes: String::new(),
            status,
            priority: 2,
            issue_type: IssueType::Task,
            ai_review_enabled: true,
            available_actions: Vec::new(),
            labels: labels.into_iter().map(str::to_string).collect(),
            assignee: None,
            parent_id: None,
            subtask_ids: Vec::new(),
            agent_sessions: Vec::new(),
            target_branch: None,
            target_branch_error: None,
            pull_request: None,
            document_summary: TaskDocumentSummary::default(),
            agent_workflows: AgentWorkflows::default(),
            updated_at: "2026-04-09T00:00:00Z".to_string(),
            created_at: "2026-04-09T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn classify_shutdown_request_starts_only_once() {
        assert_eq!(
            classify_shutdown_request(false),
            ShutdownRequestAction::Start
        );
        assert_eq!(
            classify_shutdown_request(true),
            ShutdownRequestAction::AlreadyStarted
        );
    }

    #[test]
    fn shutdown_exit_code_maps_success_and_failure() {
        assert_eq!(shutdown_exit_code(true), 0);
        assert_eq!(shutdown_exit_code(false), 1);
    }

    #[tokio::test]
    async fn shutdown_handler_returns_accepted_when_shutdown_already_started() {
        let fixture = test_state_fixture();
        fixture.state.shutdown_started.store(true, Ordering::SeqCst);

        let response = shutdown_handler(State(fixture.state.clone()))
            .await
            .into_response();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body should collect");
        let payload: Value =
            serde_json::from_slice(&bytes).expect("response body should deserialize");

        assert_eq!(status, StatusCode::ACCEPTED);
        assert_eq!(payload, json!({ "ok": true }));
    }

    #[tokio::test]
    async fn invoke_handler_rejects_new_work_when_shutdown_started() {
        let fixture = test_state_fixture();
        fixture.state.shutdown_started.store(true, Ordering::SeqCst);

        let response = invoke_handler(
            Path("workspace_list".to_string()),
            State(fixture.state.clone()),
            Ok(Json(json!({}))),
        )
        .await
        .into_response();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body should collect");
        let payload: Value =
            serde_json::from_slice(&bytes).expect("response body should deserialize");

        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            payload,
            json!({
                "error": "Browser backend is shutting down and is no longer accepting new work."
            })
        );
    }

    struct TestStateFixture {
        state: HeadlessState,
        root: PathBuf,
    }

    impl Drop for TestStateFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn unique_temp_path(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after UNIX_EPOCH")
            .as_nanos();
        std::env::temp_dir().join(format!("openducktor-headless-tests-{prefix}-{nanos}"))
    }

    fn test_state_fixture() -> TestStateFixture {
        let root = unique_temp_path("server");
        fs::create_dir_all(&root).expect("test root should exist");
        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let task_store: Arc<dyn TaskStore> =
            Arc::new(BeadsTaskStore::with_metadata_namespace("openducktor"));
        let service = Arc::new(AppService::new(task_store, config_store));
        let registry = Arc::new(build_registry().expect("registry should build"));

        TestStateFixture {
            state: HeadlessState {
                service,
                events: HeadlessEventBus::new(EVENT_BUFFER_CAPACITY),
                dev_server_events: HeadlessEventBus::new(EVENT_BUFFER_CAPACITY),
                task_events: HeadlessEventBus::new(EVENT_BUFFER_CAPACITY),
                pull_request_sync_stop_requested: Arc::new(AtomicBool::new(false)),
                registry,
                shutdown_signal: Arc::new(Notify::new()),
                shutdown_started: Arc::new(AtomicBool::new(false)),
            },
            root,
        }
    }

    fn test_state_fixture_with_task_store(
        tasks: Vec<TaskCard>,
    ) -> (TestStateFixture, Arc<Mutex<TestTaskStoreState>>, PathBuf) {
        let root = unique_temp_path("server-task-store");
        fs::create_dir_all(&root).expect("test root should exist");
        let repo_path = root.join("repo");
        fs::create_dir_all(repo_path.join(".git")).expect("test repo should exist");

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        config_store
            .add_workspace(repo_path.to_string_lossy().as_ref())
            .expect("workspace should be registered");
        config_store
            .update_repo_config(repo_path.to_string_lossy().as_ref(), RepoConfig::default())
            .expect("repo config should be saved");

        let task_state = Arc::new(Mutex::new(TestTaskStoreState {
            ensure_calls: Vec::new(),
            created_inputs: Vec::new(),
            tasks,
        }));
        let task_store: Arc<dyn TaskStore> = Arc::new(TestTaskStore::new(task_state.clone()));
        let service = Arc::new(AppService::new(task_store, config_store));
        let registry = Arc::new(build_registry().expect("registry should build"));

        (
            TestStateFixture {
                state: HeadlessState {
                    service,
                    events: HeadlessEventBus::new(EVENT_BUFFER_CAPACITY),
                    dev_server_events: HeadlessEventBus::new(EVENT_BUFFER_CAPACITY),
                    task_events: HeadlessEventBus::new(EVENT_BUFFER_CAPACITY),
                    pull_request_sync_stop_requested: Arc::new(AtomicBool::new(false)),
                    registry,
                    shutdown_signal: Arc::new(Notify::new()),
                    shutdown_started: Arc::new(AtomicBool::new(false)),
                },
                root,
            },
            task_state,
            repo_path,
        )
    }

    #[tokio::test]
    async fn invoke_handler_returns_error_envelope_for_malformed_json_body() {
        let fixture = test_state_fixture();
        let request = Request::builder()
            .header(CONTENT_TYPE, "application/json")
            .body(Body::from("{not-json"))
            .expect("request should build");
        let args = Json::<Value>::from_request(request, &()).await;

        let response = invoke_handler(
            Path("workspace_list".to_string()),
            State(fixture.state.clone()),
            args,
        )
        .await
        .into_response();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body should collect");
        let payload: Value =
            serde_json::from_slice(&bytes).expect("response body should deserialize");

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(
            payload,
            json!({ "error": "Failed to parse the request body as JSON: key must be a string at line 1 column 2" })
        );
    }

    #[test]
    fn browser_backend_allowed_headers_include_last_event_id_for_sse_replay() {
        let headers = browser_backend_allowed_headers();

        assert_eq!(headers.len(), 2);
        assert!(headers.contains(&header::CONTENT_TYPE));
        assert!(headers.contains(&header::HeaderName::from_static(LAST_EVENT_ID_HEADER)));
    }

    #[tokio::test]
    async fn invoke_handler_creates_task_through_flat_odt_mcp_bridge_payload() {
        let (fixture, task_state, repo_path) = test_state_fixture_with_task_store(Vec::new());

        let response = invoke_handler(
            Path("odt_create_task".to_string()),
            State(fixture.state.clone()),
            Ok(Json(json!({
                "repoPath": repo_path,
                "title": "Bridge task",
                "issueType": "task",
                "priority": 2,
                "description": "Created through invoke handler",
                "labels": ["mcp"],
                "aiReviewEnabled": true,
            }))),
        )
        .await
        .into_response();

        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body should collect");
        let payload: Value =
            serde_json::from_slice(&bytes).expect("response body should deserialize");

        assert_eq!(status, StatusCode::OK);
        assert_eq!(payload["task"]["title"], json!("Bridge task"));
        assert_eq!(payload["task"]["qaVerdict"], json!("not_reviewed"));

        let state = task_state.lock().expect("task store lock poisoned");
        assert_eq!(state.created_inputs.len(), 1);
        assert_eq!(state.created_inputs[0].title, "Bridge task");

        let (_receiver, replayed) = fixture.state.task_events.subscribe_with_replay(Some(0));
        assert_eq!(replayed.len(), 1);

        let task_event: Value =
            serde_json::from_str(&replayed[0].payload).expect("task event should deserialize");
        let expected_repo_path = std::fs::canonicalize(&repo_path)
            .unwrap_or(repo_path.clone())
            .to_string_lossy()
            .to_string();
        assert_eq!(task_event["kind"], json!("external_task_created"));
        assert_eq!(task_event["repoPath"], json!(expected_repo_path));
        assert_eq!(task_event["taskId"], json!("generated-1"));
    }

    #[tokio::test]
    async fn invoke_handler_searches_tasks_through_flat_odt_mcp_bridge_payload() {
        let tasks = vec![
            make_task("task-1", "Bridge task", TaskStatus::Open, vec!["mcp"]),
            make_task("task-2", "Closed task", TaskStatus::Closed, vec!["mcp"]),
        ];
        let (fixture, _task_state, repo_path) = test_state_fixture_with_task_store(tasks);

        let response = invoke_handler(
            Path("odt_search_tasks".to_string()),
            State(fixture.state.clone()),
            Ok(Json(json!({
                "repoPath": repo_path,
                "status": "open",
                "title": "Bridge",
                "tags": ["mcp"],
                "limit": 10,
            }))),
        )
        .await
        .into_response();

        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body should collect");
        let payload: Value =
            serde_json::from_slice(&bytes).expect("response body should deserialize");

        assert_eq!(status, StatusCode::OK);
        assert_eq!(payload["totalCount"], json!(1));
        assert_eq!(payload["results"][0]["task"]["id"], json!("task-1"));
    }

    #[tokio::test]
    async fn invoke_handler_rejects_read_task_documents_without_include_flags() {
        let tasks = vec![make_task(
            "task-1",
            "Bridge task",
            TaskStatus::Open,
            vec!["mcp"],
        )];
        let (fixture, _task_state, repo_path) = test_state_fixture_with_task_store(tasks);

        let response = invoke_handler(
            Path("odt_read_task_documents".to_string()),
            State(fixture.state.clone()),
            Ok(Json(json!({
                "repoPath": repo_path,
                "taskId": "task-1",
            }))),
        )
        .await
        .into_response();

        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body should collect");
        let payload: Value =
            serde_json::from_slice(&bytes).expect("response body should deserialize");

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(
            payload["error"],
            json!(
                "At least one document include flag must be true. Set includeSpec, includePlan, or includeQaReport."
            )
        );
    }

    #[tokio::test]
    async fn local_attachment_preview_handler_returns_file_bytes() {
        let _fixture = test_state_fixture();
        let preview_path = stage_local_attachment_to_temp("preview.png", "cHJldmlldy1ieXRlcw==")
            .expect("preview fixture should stage");

        let response = local_attachment_preview_handler(Query(LocalAttachmentPreviewQuery {
            path: preview_path.to_string_lossy().into_owned(),
        }))
        .await
        .expect("preview request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(CONTENT_TYPE),
            Some(&HeaderValue::from_static("image/png"))
        );
        assert_eq!(
            response.headers().get(CACHE_CONTROL),
            Some(&HeaderValue::from_static("no-store, private"))
        );
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body should read");
        assert_eq!(body.as_ref(), b"preview-bytes");
    }

    #[tokio::test]
    async fn local_attachment_preview_handler_returns_not_found_for_missing_files() {
        let _fixture = test_state_fixture();
        let preview_path = std::env::temp_dir()
            .join("openducktor-local-attachments")
            .join("missing.png");

        let error = local_attachment_preview_handler(Query(LocalAttachmentPreviewQuery {
            path: preview_path.to_string_lossy().into_owned(),
        }))
        .await
        .expect_err("missing preview path should fail");

        assert_eq!(error.status, StatusCode::NOT_FOUND);
        assert!(error
            .message
            .contains("Failed to stat local attachment preview"));
    }

    #[tokio::test]
    async fn local_attachment_preview_handler_rejects_nonstaged_paths() {
        let fixture = test_state_fixture();
        let preview_path = fixture.root.join("outside-staging.png");
        fs::write(&preview_path, b"preview-bytes").expect("preview fixture should write");

        let error = local_attachment_preview_handler(Query(LocalAttachmentPreviewQuery {
            path: preview_path.to_string_lossy().into_owned(),
        }))
        .await
        .expect_err("non-staged preview path should fail");

        assert_eq!(error.status, StatusCode::FORBIDDEN);
        assert_eq!(
            error.message,
            "Local attachment preview is only available for staged attachment files."
        );
    }
}
