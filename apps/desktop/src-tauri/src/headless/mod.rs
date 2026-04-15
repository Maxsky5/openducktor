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

pub async fn run_browser_backend(port: u16) -> anyhow::Result<()> {
    server::run_browser_backend(port).await
}
