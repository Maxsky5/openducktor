mod command_helpers;
#[path = "../../../src/command_payloads.rs"]
mod command_payloads;
#[allow(dead_code, unused_imports)]
#[path = "../../../src/command_services/mod.rs"]
mod command_services;
mod commands;
mod external_task_sync;
#[path = "../../../src/headless/mod.rs"]
mod headless;
#[path = "../../../src/logging.rs"]
mod logging;
#[path = "../../../src/pull_request_sync.rs"]
mod pull_request_sync;
mod shutdown;
mod startup;

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
