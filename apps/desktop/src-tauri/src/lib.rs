mod app_state;
mod command_helpers;
mod command_payloads;
mod command_registry;
mod command_services;
mod commands;
mod external_task_sync;
mod headless;
mod logging;
#[cfg(all(feature = "cef", target_os = "macos"))]
mod macos_cef_quit;
mod pull_request_sync;
mod shutdown;
mod sse_relay;
mod startup;

#[cfg(feature = "cef")]
type TauriRuntime = tauri::Cef;
#[cfg(not(feature = "cef"))]
type TauriRuntime = tauri::Wry;

pub fn run() -> anyhow::Result<()> {
    startup::run_desktop()
}

pub async fn run_web_host(
    port: u16,
    frontend_origin: String,
    control_token: String,
    app_token: String,
) -> anyhow::Result<()> {
    headless::run_web_host(port, frontend_origin, control_token, app_token).await
}

pub fn validate_web_frontend_origin(origin: &str) -> anyhow::Result<String> {
    headless::validate_web_frontend_origin(origin)
}
