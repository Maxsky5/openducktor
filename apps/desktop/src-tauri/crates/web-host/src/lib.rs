mod command_helpers;
mod commands;
mod external_task_sync;
mod headless;
mod logging;
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
