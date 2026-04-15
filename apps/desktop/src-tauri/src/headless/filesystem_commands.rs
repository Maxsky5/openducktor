use super::command_registry::CommandRegistry;
use super::command_support::{
    deserialize_args, serialize_value, CommandResult, HeadlessCommandError, HeadlessState,
};
use host_infra_system::FilesystemListDirectoryError;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FilesystemListDirectoryArgs {
    path: Option<String>,
}

pub(super) fn register_commands(registry: &mut CommandRegistry) -> Result<(), String> {
    registry.register("filesystem_list_directory", |state, args| {
        Box::pin(async move { handle_filesystem_list_directory(state, args).await })
    })?;
    Ok(())
}

async fn handle_filesystem_list_directory(state: &HeadlessState, args: Value) -> CommandResult {
    let FilesystemListDirectoryArgs { path } = deserialize_args(args)?;
    let service = state.service.clone();
    let listing = tokio::task::spawn_blocking(move || service.filesystem_list_directory(path.as_deref()))
        .await
        .map_err(|error| {
            HeadlessCommandError::internal(format!(
                "filesystem_list_directory worker join failure: {error}"
            ))
        })?
        .map_err(map_filesystem_list_directory_error)?;

    serialize_value(listing)
}

fn map_filesystem_list_directory_error(
    error: FilesystemListDirectoryError,
) -> HeadlessCommandError {
    match error {
        FilesystemListDirectoryError::DirectoryDoesNotExist { .. } => {
            HeadlessCommandError::not_found(error.to_string())
        }
        FilesystemListDirectoryError::InvalidPath { .. }
        | FilesystemListDirectoryError::PathIsNotDirectory { .. } => {
            HeadlessCommandError::bad_request(error.to_string())
        }
        FilesystemListDirectoryError::HomeDirectoryUnavailable
        | FilesystemListDirectoryError::ReadFailed { .. } => {
            HeadlessCommandError::internal(error.to_string())
        }
    }
}
