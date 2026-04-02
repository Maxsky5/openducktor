use super::command_registry::{build_registry, dispatch_command};
use super::command_support::{HeadlessCommandError, HeadlessState};
use super::events::{build_sse_response, parse_last_event_id, HeadlessEventBus};
use crate::commands::workspace::is_staged_local_attachment_path;
use crate::{
    startup_phase_service_bootstrap, startup_phase_shutdown_hooks, startup_phase_tracing,
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
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio_util::io::ReaderStream;
use tower_http::cors::CorsLayer;

const DEFAULT_BROWSER_BACKEND_HOST: &str = "127.0.0.1";
const DEFAULT_BROWSER_FRONTEND_ORIGINS: [&str; 3] = [
    "http://localhost:1420",
    "http://127.0.0.1:1420",
    "http://[::1]:1420",
];
const BROWSER_FRONTEND_ORIGIN_ENV: &str = "ODT_BROWSER_FRONTEND_ORIGIN";
pub(super) const EVENT_BUFFER_CAPACITY: usize = 256;

pub(super) async fn run_browser_backend(port: u16) -> anyhow::Result<()> {
    startup_phase_tracing();
    let service = startup_phase_service_bootstrap()?;
    startup_phase_shutdown_hooks(service.clone());
    let registry = Arc::new(
        build_registry().context("failed to build browser backend command registry")?,
    );
    let events = HeadlessEventBus::new(EVENT_BUFFER_CAPACITY);
    let dev_server_events = HeadlessEventBus::new(EVENT_BUFFER_CAPACITY);
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/events", get(events_handler))
        .route("/dev-server-events", get(dev_server_events_handler))
        .route("/local-attachment-preview", get(local_attachment_preview_handler))
        .route("/invoke/{command}", post(invoke_handler))
        .layer(browser_backend_cors_layer()?)
        .with_state(HeadlessState {
            service,
            events,
            dev_server_events,
            registry,
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
        .await
        .context("browser backend server terminated unexpectedly")
}

async fn health_handler() -> impl IntoResponse {
    Json(json!({ "ok": true }))
}

async fn events_handler(
    State(state): State<HeadlessState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, HeadlessCommandError> {
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
    let last_event_id = parse_last_event_id(&headers)?;
    Ok(build_sse_response(
        state.dev_server_events,
        last_event_id,
        "Browser dev server event stream",
    ))
}

async fn invoke_handler(
    Path(command): Path<String>,
    State(state): State<HeadlessState>,
    args: Result<Json<Value>, JsonRejection>,
) -> impl IntoResponse {
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
    let metadata = tokio::fs::metadata(&path).await.map_err(|error| HeadlessCommandError {
        message: format!("Failed to stat local attachment preview: {error}"),
        status: StatusCode::NOT_FOUND,
    })?;
    if !metadata.is_file() {
        return Err(HeadlessCommandError {
            message: "Local attachment preview path must reference a file".to_string(),
            status: StatusCode::BAD_REQUEST,
        });
    }
    let allowed = is_staged_local_attachment_path(&path).map_err(|error| HeadlessCommandError {
        message: error,
        status: StatusCode::INTERNAL_SERVER_ERROR,
    })?;
    if !allowed {
        return Err(HeadlessCommandError {
            message:
                "Local attachment preview is only available for staged attachment files."
                    .to_string(),
            status: StatusCode::FORBIDDEN,
        });
    }

    let file = tokio::fs::File::open(&path).await.map_err(|error| HeadlessCommandError {
        message: format!("Failed to read local attachment preview: {error}"),
        status: StatusCode::INTERNAL_SERVER_ERROR,
    })?;
    let mime = mime_guess::from_path(&path).first_or_octet_stream().to_string();
    let stream = ReaderStream::new(file);

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, "no-store, private")
        .body(axum::body::Body::from_stream(stream))
        .map_err(|error| HeadlessCommandError {
            message: format!("Failed to build local attachment preview response: {error}"),
            status: StatusCode::INTERNAL_SERVER_ERROR,
        })
}

fn json_rejection_error(error: JsonRejection) -> HeadlessCommandError {
    HeadlessCommandError {
        message: error.body_text(),
        status: error.status(),
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::workspace::stage_local_attachment_to_temp;
    use axum::body::{to_bytes, Body};
    use axum::extract::FromRequest;
    use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
    use axum::http::Request;
    use host_application::AppService;
    use host_domain::TaskStore;
    use host_infra_beads::BeadsTaskStore;
    use host_infra_system::AppConfigStore;
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

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
        let task_store: Arc<dyn TaskStore> = Arc::new(BeadsTaskStore::with_metadata_namespace(
            "openducktor",
        ));
        let service = Arc::new(AppService::new(task_store, config_store));
        let registry = Arc::new(build_registry().expect("registry should build"));

        TestStateFixture {
            state: HeadlessState {
                service,
                events: HeadlessEventBus::new(EVENT_BUFFER_CAPACITY),
                dev_server_events: HeadlessEventBus::new(EVENT_BUFFER_CAPACITY),
                registry,
            },
            root,
        }
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
        assert!(error.message.contains("Failed to stat local attachment preview"));
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
