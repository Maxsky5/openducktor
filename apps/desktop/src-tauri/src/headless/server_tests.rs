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
    RepoStoreSharedServerOwnershipState, SpecDocument, TaskCard, TaskDocumentSummary, TaskMetadata,
    TaskStatus, TaskStore, UpdateTaskPatch,
};
use host_infra_beads::BeadsTaskStore;
use host_infra_system::{AppConfigStore, RepoConfig};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Default)]
struct TestTaskStoreState {
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
        let _ = repo_path;
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
        let _ = repo_path;
        Err(anyhow!(
            "list_pull_request_sync_candidates not implemented in headless test store"
        ))
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

    fn clear_workflow_documents(&self, _repo_path: &std::path::Path, _task_id: &str) -> Result<()> {
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

#[tokio::test]
async fn serve_browser_backend_stops_pull_request_sync_loop_when_server_returns() {
    let listener = TcpListener::bind((DEFAULT_BROWSER_BACKEND_HOST, 0))
        .await
        .expect("listener should bind");
    let shutdown_signal = Arc::new(Notify::new());
    let stop_requested = Arc::new(AtomicBool::new(false));
    let notify_shutdown = shutdown_signal.clone();

    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        notify_shutdown.notify_one();
    });

    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        serve_browser_backend(
            listener,
            Router::new(),
            shutdown_signal,
            stop_requested.clone(),
        ),
    )
    .await
    .expect("server should stop before the test timeout")
    .expect("server should shut down cleanly");

    assert!(stop_requested.load(Ordering::SeqCst));
}

#[tokio::test]
async fn shutdown_handler_returns_accepted_when_shutdown_already_started() {
    let fixture = test_state_fixture();
    fixture.state.shutdown_started.store(true, Ordering::SeqCst);

    let response = shutdown_handler(State(fixture.state.clone()), HeaderMap::new())
        .await
        .into_response();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body should collect");
    let payload: Value = serde_json::from_slice(&bytes).expect("response body should deserialize");

    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(payload, json!({ "ok": true }));
}

#[tokio::test]
async fn shutdown_handler_requires_matching_control_token_when_configured() {
    let fixture = test_state_fixture();
    let state = HeadlessState {
        control_token: Some("expected-token".to_string()),
        ..fixture.state.clone()
    };

    let missing_response = shutdown_handler(State(state.clone()), HeaderMap::new())
        .await
        .into_response();
    let missing_status = missing_response.status();
    let missing_body = to_bytes(missing_response.into_body(), usize::MAX)
        .await
        .expect("missing token response body should collect");
    let missing_payload: Value = serde_json::from_slice(&missing_body)
        .expect("missing token response body should deserialize");

    assert_eq!(missing_status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        missing_payload,
        json!({ "error": "Missing OpenDucktor web host control token." })
    );

    let mut headers = HeaderMap::new();
    headers.insert(
        CONTROL_TOKEN_HEADER,
        HeaderValue::from_static("expected-token"),
    );
    let accepted_response = shutdown_handler(State(state), headers)
        .await
        .into_response();

    assert_eq!(accepted_response.status(), StatusCode::ACCEPTED);
}

#[tokio::test]
async fn invoke_handler_requires_matching_app_token_when_configured() {
    let fixture = test_state_fixture();
    let state = HeadlessState {
        app_token: Some("expected-app-token".to_string()),
        ..fixture.state.clone()
    };

    let missing_response = invoke_handler(
        Path("workspace_list".to_string()),
        State(state.clone()),
        HeaderMap::new(),
        Ok(Json(json!({}))),
    )
    .await
    .into_response();
    let missing_status = missing_response.status();
    let missing_body = to_bytes(missing_response.into_body(), usize::MAX)
        .await
        .expect("missing app token response body should collect");
    let missing_payload: Value = serde_json::from_slice(&missing_body)
        .expect("missing app token response body should deserialize");

    assert_eq!(missing_status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        missing_payload,
        json!({ "error": "Missing OpenDucktor web host app token." })
    );

    let mut invalid_headers = HeaderMap::new();
    invalid_headers.insert(APP_TOKEN_HEADER, HeaderValue::from_static("wrong-token"));
    let invalid_response = invoke_handler(
        Path("workspace_list".to_string()),
        State(state),
        invalid_headers,
        Ok(Json(json!({}))),
    )
    .await
    .into_response();

    assert_eq!(invalid_response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn session_handler_sets_http_only_app_session_cookie() {
    let fixture = test_state_fixture();
    let state = HeadlessState {
        app_token: Some("expected-app-token".to_string()),
        ..fixture.state.clone()
    };
    let mut headers = HeaderMap::new();
    headers.insert(
        APP_TOKEN_HEADER,
        HeaderValue::from_static("expected-app-token"),
    );

    let response = session_handler(State(state), headers)
        .await
        .expect("session should be accepted");

    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .expect("session response should set cookie")
        .to_str()
        .expect("cookie should be a string");
    assert_eq!(
        cookie,
        "openducktor_web_session=expected-app-token; HttpOnly; SameSite=Strict; Path=/"
    );
}

#[tokio::test]
async fn event_stream_handlers_require_matching_app_session_cookie_or_header_when_configured() {
    let fixture = test_state_fixture();
    let state = HeadlessState {
        app_token: Some("expected-app-token".to_string()),
        ..fixture.state.clone()
    };

    let missing_response = events_handler(State(state.clone()), HeaderMap::new())
        .await
        .into_response();

    assert_eq!(missing_response.status(), StatusCode::UNAUTHORIZED);

    let mut headers = HeaderMap::new();
    headers.insert(
        header::COOKIE,
        HeaderValue::from_static("openducktor_web_session=expected-app-token"),
    );
    let accepted_response = events_handler(State(state), headers).await.into_response();

    assert_eq!(accepted_response.status(), StatusCode::OK);

    let fixture = test_state_fixture();
    let state = HeadlessState {
        app_token: Some("expected-app-token".to_string()),
        ..fixture.state.clone()
    };
    let mut headers = HeaderMap::new();
    headers.insert(
        APP_TOKEN_HEADER,
        HeaderValue::from_static("expected-app-token"),
    );
    let accepted_response = task_events_handler(State(state), headers)
        .await
        .into_response();

    assert_eq!(accepted_response.status(), StatusCode::OK);
}

#[tokio::test]
async fn invoke_handler_rejects_new_work_when_shutdown_started() {
    let fixture = test_state_fixture();
    fixture.state.shutdown_started.store(true, Ordering::SeqCst);

    let response = invoke_handler(
        Path("workspace_list".to_string()),
        State(fixture.state.clone()),
        HeaderMap::new(),
        Ok(Json(json!({}))),
    )
    .await
    .into_response();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body should collect");
    let payload: Value = serde_json::from_slice(&bytes).expect("response body should deserialize");

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

static TEST_TEMP_PATH_COUNTER: AtomicU64 = AtomicU64::new(0);

fn unique_temp_path(prefix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after UNIX_EPOCH")
        .as_nanos();
    let sequence = TEST_TEMP_PATH_COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "openducktor-headless-tests-{prefix}-{nanos}-{sequence}"
    ))
}

fn test_state_fixture() -> TestStateFixture {
    let root = unique_temp_path("server");
    fs::create_dir_all(&root).expect("test root should exist");
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let task_store: Arc<dyn TaskStore> = Arc::new(
        BeadsTaskStore::with_metadata_namespace_and_config("openducktor", config_store.clone()),
    );

    TestStateFixture {
        state: headless_state(task_store, config_store),
        root,
    }
}

fn headless_state(task_store: Arc<dyn TaskStore>, config_store: AppConfigStore) -> HeadlessState {
    HeadlessState {
        service: Arc::new(AppService::new(task_store, config_store)),
        events: HeadlessEventBus::new(EVENT_BUFFER_CAPACITY),
        dev_server_events: HeadlessEventBus::new(EVENT_BUFFER_CAPACITY),
        task_events: HeadlessEventBus::new(EVENT_BUFFER_CAPACITY),
        pull_request_sync_stop_requested: Arc::new(AtomicBool::new(false)),
        registry: Arc::new(build_registry().expect("registry should build")),
        shutdown_signal: Arc::new(Notify::new()),
        shutdown_started: Arc::new(AtomicBool::new(false)),
        control_token: None,
        app_token: None,
    }
}

fn test_state_fixture_with_task_store(
    tasks: Vec<TaskCard>,
) -> (
    TestStateFixture,
    Arc<Mutex<TestTaskStoreState>>,
    PathBuf,
    String,
) {
    let root = unique_temp_path("server-task-store");
    fs::create_dir_all(&root).expect("test root should exist");
    let repo_path = root.join("repo");
    fs::create_dir_all(repo_path.join(".git")).expect("test repo should exist");
    let workspace_id = "repo".to_string();

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    config_store
        .add_workspace(
            workspace_id.as_str(),
            "repo",
            repo_path.to_string_lossy().as_ref(),
        )
        .expect("workspace should be registered");
    config_store
        .update_repo_config(
            workspace_id.as_str(),
            RepoConfig {
                workspace_id: workspace_id.clone(),
                workspace_name: "repo".to_string(),
                repo_path: repo_path.to_string_lossy().to_string(),
                ..RepoConfig::default()
            },
        )
        .expect("repo config should be saved");

    let task_state = Arc::new(Mutex::new(TestTaskStoreState {
        created_inputs: Vec::new(),
        tasks,
    }));
    let task_store: Arc<dyn TaskStore> = Arc::new(TestTaskStore::new(task_state.clone()));

    (
        TestStateFixture {
            state: headless_state(task_store, config_store),
            root,
        },
        task_state,
        repo_path,
        workspace_id,
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
        HeaderMap::new(),
        args,
    )
    .await
    .into_response();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body should collect");
    let payload: Value = serde_json::from_slice(&bytes).expect("response body should deserialize");

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        payload,
        json!({ "error": "Failed to parse the request body as JSON: key must be a string at line 1 column 2" })
    );
}

#[test]
fn browser_backend_allowed_headers_include_last_event_id_for_sse_replay() {
    let headers = browser_backend_allowed_headers();

    assert_eq!(headers.len(), 4);
    assert!(headers.contains(&header::CONTENT_TYPE));
    assert!(headers.contains(&header::HeaderName::from_static(LAST_EVENT_ID_HEADER)));
    assert!(headers.contains(&header::HeaderName::from_static(CONTROL_TOKEN_HEADER)));
    assert!(headers.contains(&header::HeaderName::from_static(APP_TOKEN_HEADER)));
}

#[test]
fn loopback_frontend_origin_headers_allow_equivalent_loopback_hosts_on_same_port() {
    let expected = vec![
        HeaderValue::from_static("http://127.0.0.1:1420"),
        HeaderValue::from_static("http://localhost:1420"),
        HeaderValue::from_static("http://[::1]:1420"),
    ];

    assert_eq!(
        loopback_frontend_origin_headers("http://127.0.0.1:1420")
            .expect("127.0.0.1 origin should produce equivalent loopback origins"),
        expected
    );
    assert_eq!(
        loopback_frontend_origin_headers("http://localhost:1420")
            .expect("localhost origin should produce equivalent loopback origins"),
        expected
    );
    assert_eq!(
        loopback_frontend_origin_headers("http://[::1]:1420")
            .expect("IPv6 loopback origin should produce equivalent loopback origins"),
        expected
    );
}

#[test]
fn loopback_frontend_origin_headers_reject_remote_origins() {
    let error = loopback_frontend_origin_headers("http://192.168.1.10:1420")
        .expect_err("remote frontend origins must not be allowed")
        .to_string();

    assert!(
        error.contains("must target"),
        "expected loopback validation error, got `{error}`"
    );
}

#[derive(serde::Deserialize)]
struct OriginValidationCase {
    name: String,
    input: String,
    expected: Option<String>,
    #[serde(rename = "errorIncludes")]
    error_includes: Option<String>,
}

#[test]
fn validate_web_frontend_origin_matches_shared_cases() {
    let cases: Vec<OriginValidationCase> = serde_json::from_str(include_str!(
        "../../../../../packages/openducktor-web/src/browser-origin-validation-cases.json"
    ))
    .expect("shared web origin validation cases should parse");

    for test_case in cases {
        let result = validate_web_frontend_origin(&test_case.input);
        match (test_case.expected, test_case.error_includes) {
            (Some(expected), None) => {
                assert_eq!(
                    result.expect(&test_case.name),
                    expected,
                    "{}",
                    test_case.name
                );
            }
            (None, Some(error_includes)) => {
                let error = result.expect_err(&test_case.name).to_string();
                assert!(
                    error.contains(&error_includes),
                    "{}: expected `{error}` to contain `{error_includes}`",
                    test_case.name
                );
            }
            _ => panic!(
                "{} must specify exactly one of expected or errorIncludes",
                test_case.name
            ),
        }
    }
}

#[tokio::test]
async fn invoke_handler_lists_workspaces_through_odt_get_workspaces() {
    let (fixture, _task_state, repo_path, workspace_id) =
        test_state_fixture_with_task_store(Vec::new());

    let response = invoke_handler(
        Path("odt_get_workspaces".to_string()),
        State(fixture.state.clone()),
        HeaderMap::new(),
        Ok(Json(json!({}))),
    )
    .await
    .into_response();

    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body should collect");
    let payload: Value = serde_json::from_slice(&bytes).expect("response body should deserialize");
    let expected_repo_path = std::fs::canonicalize(&repo_path)
        .unwrap_or(repo_path.clone())
        .to_string_lossy()
        .to_string();

    assert_eq!(status, StatusCode::OK);
    assert_eq!(payload["workspaces"].as_array().map(Vec::len), Some(1));
    assert_eq!(payload["workspaces"][0]["workspaceId"], json!(workspace_id));
    assert_eq!(
        payload["workspaces"][0]["repoPath"],
        json!(expected_repo_path)
    );
}

#[tokio::test]
async fn invoke_handler_creates_task_through_flat_odt_mcp_bridge_payload() {
    let (fixture, task_state, repo_path, workspace_id) =
        test_state_fixture_with_task_store(Vec::new());

    let response = invoke_handler(
        Path("odt_create_task".to_string()),
        State(fixture.state.clone()),
        HeaderMap::new(),
        Ok(Json(json!({
            "workspaceId": workspace_id,
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
    let payload: Value = serde_json::from_slice(&bytes).expect("response body should deserialize");

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
    let (fixture, _task_state, _repo_path, workspace_id) =
        test_state_fixture_with_task_store(tasks);

    let response = invoke_handler(
        Path("odt_search_tasks".to_string()),
        State(fixture.state.clone()),
        HeaderMap::new(),
        Ok(Json(json!({
            "workspaceId": workspace_id,
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
    let payload: Value = serde_json::from_slice(&bytes).expect("response body should deserialize");

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
    let (fixture, _task_state, _repo_path, workspace_id) =
        test_state_fixture_with_task_store(tasks);

    let response = invoke_handler(
        Path("odt_read_task_documents".to_string()),
        State(fixture.state.clone()),
        HeaderMap::new(),
        Ok(Json(json!({
            "workspaceId": workspace_id,
            "taskId": "task-1",
        }))),
    )
    .await
    .into_response();

    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body should collect");
    let payload: Value = serde_json::from_slice(&bytes).expect("response body should deserialize");

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
    let fixture = test_state_fixture();
    let preview_path = stage_local_attachment_to_temp("preview.png", "cHJldmlldy1ieXRlcw==")
        .expect("preview fixture should stage");

    let response = local_attachment_preview_handler(
        State(fixture.state.clone()),
        HeaderMap::new(),
        Query(LocalAttachmentPreviewQuery {
            path: preview_path.to_string_lossy().into_owned(),
        }),
    )
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
    let fixture = test_state_fixture();
    let preview_path = std::env::temp_dir()
        .join("openducktor-local-attachments")
        .join("missing.png");

    let error = local_attachment_preview_handler(
        State(fixture.state.clone()),
        HeaderMap::new(),
        Query(LocalAttachmentPreviewQuery {
            path: preview_path.to_string_lossy().into_owned(),
        }),
    )
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

    let error = local_attachment_preview_handler(
        State(fixture.state.clone()),
        HeaderMap::new(),
        Query(LocalAttachmentPreviewQuery {
            path: preview_path.to_string_lossy().into_owned(),
        }),
    )
    .await
    .expect_err("non-staged preview path should fail");

    assert_eq!(error.status, StatusCode::FORBIDDEN);
    assert_eq!(
        error.message,
        "Local attachment preview is only available for staged attachment files."
    );
}
