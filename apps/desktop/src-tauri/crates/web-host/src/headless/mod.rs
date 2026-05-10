mod command_registry;
mod command_support;
mod events;
mod filesystem_commands;
mod git_commands;
mod odt_mcp_commands;
mod runtime_commands;
mod server;
mod system_commands;
mod task_commands;
mod workspace_commands;

pub async fn run_web_host(
    port: u16,
    frontend_origin: String,
    control_token: String,
    app_token: String,
) -> anyhow::Result<()> {
    server::run_browser_backend_with_options(server::BrowserBackendOptions {
        port,
        frontend_origin,
        control_token,
        app_token,
    })
    .await
}

pub fn validate_web_frontend_origin(origin: &str) -> anyhow::Result<String> {
    server::validate_web_frontend_origin(origin)
}
