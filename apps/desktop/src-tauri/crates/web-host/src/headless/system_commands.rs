use super::command_registry::CommandRegistry;
use super::command_support::{
    deserialize_args, run_headless_blocking, serialize_value, CommandResult, HeadlessState,
};
use host_domain::SystemOpenInToolId;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenDirectoryInToolArgs {
    directory_path: String,
    tool_id: SystemOpenInToolId,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SystemListOpenInToolsArgs {
    #[serde(default)]
    force_refresh: bool,
}

pub(super) fn register_commands(registry: &mut CommandRegistry) -> Result<(), String> {
    registry.register("system_list_open_in_tools", |state, args| {
        Box::pin(async move { handle_system_list_open_in_tools(state, args).await })
    })?;
    registry.register("system_open_directory_in_tool", |state, args| {
        Box::pin(async move { handle_system_open_directory_in_tool(state, args).await })
    })?;
    Ok(())
}

async fn handle_system_list_open_in_tools(state: &HeadlessState, args: Value) -> CommandResult {
    let SystemListOpenInToolsArgs { force_refresh } = deserialize_args(args)?;
    let service = state.service.clone();
    serialize_value(
        run_headless_blocking("system_list_open_in_tools", move || {
            service.list_open_in_tools(force_refresh)
        })
        .await?,
    )
}

async fn handle_system_open_directory_in_tool(state: &HeadlessState, args: Value) -> CommandResult {
    let OpenDirectoryInToolArgs {
        directory_path,
        tool_id,
    } = deserialize_args(args)?;
    let service = state.service.clone();
    run_headless_blocking("system_open_directory_in_tool", move || {
        service.open_directory_in_tool(&directory_path, tool_id)
    })
    .await?;
    Ok(json!({ "ok": true }))
}
