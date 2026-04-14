use crate::{as_error, run_service_blocking, AppState};
use anyhow::{anyhow, Result};
use host_domain::{SystemOpenInToolId, SystemOpenInToolInfo};
use serde_json::json;
use std::process::{Command, Stdio};
use tauri::State;

#[tauri::command]
pub async fn system_list_open_in_tools(
    state: State<'_, AppState>,
    force_refresh: Option<bool>,
) -> Result<Vec<SystemOpenInToolInfo>, String> {
    let service = state.service.clone();
    let result = run_service_blocking("system_list_open_in_tools", move || {
        service.list_open_in_tools(force_refresh.unwrap_or(false))
    })
    .await;

    as_error(result)
}

#[tauri::command]
pub async fn system_open_directory_in_tool(
    state: State<'_, AppState>,
    directory_path: String,
    tool_id: SystemOpenInToolId,
) -> Result<serde_json::Value, String> {
    let service = state.service.clone();
    let result = run_service_blocking("system_open_directory_in_tool", move || {
        service
            .open_directory_in_tool(&directory_path, tool_id)
            .map(|_| json!({ "ok": true }))
    })
    .await;

    as_error(result)
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<serde_json::Value, String> {
    let result = run_service_blocking("open_external_url", move || {
        open_external_url_impl(url.as_str())?;
        Ok(json!({ "ok": true }))
    })
    .await;

    as_error(result)
}

fn open_external_url_impl(url: &str) -> Result<()> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("Cannot open an empty URL."));
    }
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err(anyhow!(
            "Only http and https URLs can be opened from OpenDucktor."
        ));
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(trimmed);
        command
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(trimmed);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", trimmed]);
        command
    };

    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| anyhow!("Failed to open URL in the system browser: {error}"))?;

    Ok(())
}
