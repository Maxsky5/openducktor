use crate::{as_error, run_service_blocking};
use anyhow::{anyhow, Result};
use serde_json::json;
use std::process::{Command, Stdio};

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
