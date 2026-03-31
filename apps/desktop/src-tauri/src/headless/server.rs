use super::command_registry::{build_registry, dispatch_command};
use super::command_support::{HeadlessCommandError, HeadlessState};
use super::events::{build_sse_response, parse_last_event_id, HeadlessEventBus};
use crate::{
    startup_phase_service_bootstrap, startup_phase_shutdown_hooks, startup_phase_tracing,
};
use anyhow::Context;
use axum::extract::{Path, State};
use axum::http::header;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::net::TcpListener;
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
    Json(args): Json<Value>,
) -> impl IntoResponse {
    match dispatch_command(&state, &command, args).await {
        Ok(payload) => (StatusCode::OK, Json(payload)).into_response(),
        Err(error) => error.into_response(),
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
