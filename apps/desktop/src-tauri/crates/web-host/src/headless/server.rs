use super::command_registry::{build_registry, dispatch_command};
use super::command_support::{HeadlessCommandError, HeadlessState};
use super::events::{build_sse_response, parse_last_event_id, HeadlessEventBus};
use crate::commands::workspace::is_staged_local_attachment_path;
use crate::external_task_sync::ExternalTaskSyncEvent;
use crate::pull_request_sync::start_pull_request_sync_loop;
use crate::shutdown::startup_phase_shutdown_hooks_with_gate;
use crate::startup::{startup_phase_service_bootstrap, startup_phase_tracing};
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
use url::Url;

const DEFAULT_BROWSER_BACKEND_HOST: &str = "127.0.0.1";
const LAST_EVENT_ID_HEADER: &str = "last-event-id";
const CONTROL_TOKEN_HEADER: &str = "x-openducktor-control-token";
const APP_TOKEN_HEADER: &str = "x-openducktor-app-token";
const APP_SESSION_COOKIE_NAME: &str = "openducktor_web_session";
pub(super) const EVENT_BUFFER_CAPACITY: usize = 256;

#[derive(Debug, Clone)]
pub struct BrowserBackendOptions {
    pub port: u16,
    pub frontend_origin: String,
    pub control_token: String,
    pub app_token: String,
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

pub async fn run_browser_backend_with_options(
    options: BrowserBackendOptions,
) -> anyhow::Result<()> {
    startup_phase_tracing();
    let service = startup_phase_service_bootstrap()?;
    let registry =
        Arc::new(build_registry().context("failed to build browser backend command registry")?);
    let events = HeadlessEventBus::new(EVENT_BUFFER_CAPACITY);
    let dev_server_events = HeadlessEventBus::new(EVENT_BUFFER_CAPACITY);
    let task_events = HeadlessEventBus::new(EVENT_BUFFER_CAPACITY);
    let shutdown_signal = Arc::new(Notify::new());
    let shutdown_started = Arc::new(AtomicBool::new(false));
    startup_phase_shutdown_hooks_with_gate(
        service.clone(),
        shutdown_started.clone(),
        Some(shutdown_signal.clone()),
    );
    let frontend_origin = validate_web_frontend_origin(&options.frontend_origin)?;
    let cors_layer = browser_backend_cors_layer(&frontend_origin)?;
    let listener = TcpListener::bind((DEFAULT_BROWSER_BACKEND_HOST, options.port))
        .await
        .with_context(|| {
            format!(
                "failed to bind browser backend on {DEFAULT_BROWSER_BACKEND_HOST}:{}",
                options.port
            )
        })?;
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
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/session", post(session_handler))
        .route("/shutdown", post(shutdown_handler))
        .route("/events", get(events_handler))
        .route("/dev-server-events", get(dev_server_events_handler))
        .route("/task-events", get(task_events_handler))
        .route(
            "/local-attachment-preview",
            get(local_attachment_preview_handler),
        )
        .route("/invoke/{command}", post(invoke_handler))
        .layer(cors_layer)
        .with_state(HeadlessState {
            service,
            events,
            dev_server_events,
            task_events,
            pull_request_sync_stop_requested: pull_request_sync_stop_requested.clone(),
            registry,
            shutdown_signal: shutdown_signal.clone(),
            shutdown_started: shutdown_started.clone(),
            control_token: Some(options.control_token.clone()),
            app_token: Some(options.app_token.clone()),
        });

    tracing::info!(
        target: "openducktor.browser-backend",
        "OpenDucktor Rust host is listening at http://{DEFAULT_BROWSER_BACKEND_HOST}:{}",
        options.port
    );

    serve_browser_backend(
        listener,
        app,
        shutdown_signal,
        pull_request_sync_stop_requested,
    )
    .await
}

async fn serve_browser_backend(
    listener: TcpListener,
    app: Router,
    shutdown_signal: Arc<Notify>,
    pull_request_sync_stop_requested: Arc<AtomicBool>,
) -> anyhow::Result<()> {
    let result = axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            shutdown_signal.notified().await;
        })
        .await
        .context("browser backend server terminated unexpectedly");

    pull_request_sync_stop_requested.store(true, Ordering::SeqCst);
    result
}

async fn health_handler() -> impl IntoResponse {
    Json(json!({ "ok": true }))
}

fn validate_expected_token(
    received_token: Option<&str>,
    expected_token: Option<&str>,
    missing_message: &'static str,
    invalid_message: &'static str,
) -> Result<(), HeadlessCommandError> {
    let Some(expected_token) = expected_token else {
        return Ok(());
    };

    let Some(received_token) = received_token else {
        return Err(HeadlessCommandError {
            message: missing_message.to_string(),
            status: StatusCode::UNAUTHORIZED,
            failure_kind: None,
        });
    };

    if received_token != expected_token {
        return Err(HeadlessCommandError {
            message: invalid_message.to_string(),
            status: StatusCode::FORBIDDEN,
            failure_kind: None,
        });
    }

    Ok(())
}

fn validate_control_token(
    headers: &HeaderMap,
    expected_token: Option<&str>,
) -> Result<(), HeadlessCommandError> {
    validate_expected_token(
        headers
            .get(CONTROL_TOKEN_HEADER)
            .and_then(|value| value.to_str().ok()),
        expected_token,
        "Missing OpenDucktor web host control token.",
        "Invalid OpenDucktor web host control token.",
    )
}

fn validate_app_token(
    received_token: Option<&str>,
    expected_token: Option<&str>,
) -> Result<(), HeadlessCommandError> {
    validate_expected_token(
        received_token,
        expected_token,
        "Missing OpenDucktor web host app token.",
        "Invalid OpenDucktor web host app token.",
    )
}

fn validate_app_token_header(
    headers: &HeaderMap,
    expected_token: Option<&str>,
) -> Result<(), HeadlessCommandError> {
    validate_app_token(
        headers
            .get(APP_TOKEN_HEADER)
            .and_then(|value| value.to_str().ok()),
        expected_token,
    )
}

fn read_app_session_cookie(headers: &HeaderMap) -> Option<String> {
    let cookie_header = headers.get(header::COOKIE)?.to_str().ok()?;
    for part in cookie_header.split(';') {
        let trimmed = part.trim();
        if let Some((name, value)) = trimmed.split_once('=') {
            if name == APP_SESSION_COOKIE_NAME && !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn validate_app_token_cookie(
    headers: &HeaderMap,
    expected_token: Option<&str>,
) -> Result<(), HeadlessCommandError> {
    let received_token = read_app_session_cookie(headers);
    validate_app_token(received_token.as_deref(), expected_token)
}

fn validate_app_token_cookie_or_header(
    headers: &HeaderMap,
    expected_token: Option<&str>,
) -> Result<(), HeadlessCommandError> {
    let received_token = read_app_session_cookie(headers).or_else(|| {
        headers
            .get(APP_TOKEN_HEADER)
            .and_then(|value| value.to_str().ok())
            .map(ToOwned::to_owned)
    });
    validate_app_token(received_token.as_deref(), expected_token)
}

async fn session_handler(
    State(state): State<HeadlessState>,
    headers: HeaderMap,
) -> Result<Response, HeadlessCommandError> {
    validate_app_token_header(&headers, state.app_token.as_deref())?;

    let mut response = Json(json!({ "ok": true })).into_response();
    if let Some(app_token) = state.app_token.as_deref() {
        let cookie =
            format!("{APP_SESSION_COOKIE_NAME}={app_token}; HttpOnly; SameSite=Strict; Path=/");
        let cookie_value =
            HeaderValue::from_str(&cookie).map_err(|error| HeadlessCommandError {
                message: format!("Failed to build OpenDucktor web session cookie: {error}"),
                status: StatusCode::INTERNAL_SERVER_ERROR,
                failure_kind: None,
            })?;
        response
            .headers_mut()
            .append(header::SET_COOKIE, cookie_value);
    }
    Ok(response)
}

async fn shutdown_handler(
    State(state): State<HeadlessState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, HeadlessCommandError> {
    validate_control_token(&headers, state.control_token.as_deref())?;

    if state.shutdown_started.swap(true, Ordering::SeqCst) {
        tracing::info!(
            target: "openducktor.browser-backend",
            "OpenDucktor web host shutdown is already in progress"
        );
        return Ok((StatusCode::ACCEPTED, Json(json!({ "ok": true }))));
    }

    tracing::info!(
        target: "openducktor.browser-backend",
        "OpenDucktor web host shutdown requested"
    );

    let service = state.service.clone();
    let shutdown_signal = state.shutdown_signal.clone();
    state
        .pull_request_sync_stop_requested
        .store(true, Ordering::SeqCst);
    tokio::spawn(async move {
        shutdown_signal.notify_waiters();
        let exit_code = match tokio::task::spawn_blocking(move || service.shutdown()).await {
            Ok(Ok(())) => {
                tracing::info!(
                    target: "openducktor.browser-backend",
                    "OpenDucktor web host shutdown complete"
                );
                0
            }
            Ok(Err(error)) => {
                tracing::error!(
                    target: "openducktor.browser-backend",
                    error = %error,
                    "Browser backend shutdown failed"
                );
                1
            }
            Err(error) => {
                tracing::error!(
                    target: "openducktor.browser-backend",
                    error = %error,
                    "Browser backend shutdown task failed"
                );
                1
            }
        };
        tokio::task::yield_now().await;
        std::process::exit(exit_code);
    });

    Ok((StatusCode::ACCEPTED, Json(json!({ "ok": true }))))
}

async fn events_handler(
    State(state): State<HeadlessState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, HeadlessCommandError> {
    validate_app_token_cookie_or_header(&headers, state.app_token.as_deref())?;
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
    validate_app_token_cookie_or_header(&headers, state.app_token.as_deref())?;
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
    validate_app_token_cookie_or_header(&headers, state.app_token.as_deref())?;
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
    headers: HeaderMap,
    args: Result<Json<Value>, JsonRejection>,
) -> impl IntoResponse {
    if let Err(error) = validate_app_token_header(&headers, state.app_token.as_deref()) {
        return error.into_response();
    }
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
    State(state): State<HeadlessState>,
    headers: HeaderMap,
    Query(query): Query<LocalAttachmentPreviewQuery>,
) -> Result<Response, HeadlessCommandError> {
    validate_app_token_cookie(&headers, state.app_token.as_deref())?;
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

fn browser_backend_cors_layer(frontend_origin: &str) -> anyhow::Result<CorsLayer> {
    Ok(CorsLayer::new()
        .allow_origin(loopback_frontend_origin_headers(frontend_origin)?)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(browser_backend_allowed_headers())
        .allow_credentials(true))
}

fn loopback_frontend_origin_headers(frontend_origin: &str) -> anyhow::Result<Vec<HeaderValue>> {
    let origin = validate_web_frontend_origin(frontend_origin)?;
    let url = Url::parse(&origin)
        .with_context(|| format!("invalid browser frontend origin configured: {origin}"))?;
    let port = url
        .port()
        .ok_or_else(|| anyhow::anyhow!("browser frontend origin must include an explicit port"))?;

    [
        format!("http://127.0.0.1:{port}"),
        format!("http://localhost:{port}"),
        format!("http://[::1]:{port}"),
    ]
    .into_iter()
    .map(|candidate| parse_origin_header(&candidate))
    .collect()
}

fn browser_backend_allowed_headers() -> [header::HeaderName; 4] {
    [
        header::CONTENT_TYPE,
        header::HeaderName::from_static(LAST_EVENT_ID_HEADER),
        header::HeaderName::from_static(CONTROL_TOKEN_HEADER),
        header::HeaderName::from_static(APP_TOKEN_HEADER),
    ]
}

pub fn validate_web_frontend_origin(origin: &str) -> anyhow::Result<String> {
    let trimmed = origin.trim();
    if trimmed.is_empty() {
        anyhow::bail!("browser frontend origin cannot be empty");
    }

    let url = Url::parse(trimmed)
        .with_context(|| format!("invalid browser frontend origin configured: {trimmed}"))?;
    if url.scheme() != "http" {
        anyhow::bail!("browser frontend origin must use http");
    }
    if !url.username().is_empty() || url.password().is_some() {
        anyhow::bail!("browser frontend origin must not include credentials");
    }
    if url.port().is_none() {
        anyhow::bail!("browser frontend origin must include an explicit port");
    }
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        anyhow::bail!("browser frontend origin must not include a path, query string, or fragment");
    }

    let host = url
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("browser frontend origin must include a host"))?;
    if !matches!(host, "127.0.0.1" | "localhost" | "::1" | "[::1]") {
        anyhow::bail!("browser frontend origin must target 127.0.0.1, localhost, or [::1]");
    }

    Ok(url.origin().ascii_serialization())
}

fn parse_origin_header(origin: &str) -> anyhow::Result<HeaderValue> {
    origin
        .parse::<HeaderValue>()
        .with_context(|| format!("invalid browser frontend origin configured: {origin}"))
}

#[cfg(test)]
#[path = "server_tests.rs"]
mod tests;
