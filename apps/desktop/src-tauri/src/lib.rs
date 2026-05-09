mod app_state;
mod command_helpers;
mod command_payloads;
mod command_services;
mod commands;
mod external_task_sync;
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

pub use openducktor_web_host::{run_web_host, validate_web_frontend_origin};
