use anyhow::{anyhow, Context, Result};
use host_infra_system::{parse_user_path, resolve_command_path};
use serde_json::json;
use std::path::{Path, PathBuf};

pub(crate) fn parse_mcp_command_json(raw: &str) -> Result<Vec<String>> {
    let parsed: serde_json::Value =
        serde_json::from_str(raw).context("Invalid OPENDUCKTOR_MCP_COMMAND_JSON format")?;
    let values = parsed
        .as_array()
        .ok_or_else(|| anyhow!("OPENDUCKTOR_MCP_COMMAND_JSON must be a JSON string array"))?;

    let command = values
        .iter()
        .map(|entry| {
            entry
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .ok_or_else(|| {
                    anyhow!("OPENDUCKTOR_MCP_COMMAND_JSON must contain only non-empty strings")
                })
        })
        .collect::<Result<Vec<_>>>()?;

    if command.is_empty() {
        return Err(anyhow!("OPENDUCKTOR_MCP_COMMAND_JSON cannot be empty"));
    }
    Ok(command)
}

fn is_workspace_root_candidate(path: &Path) -> bool {
    path.join("bun.lock").is_file()
        && path.join("package.json").is_file()
        && path.join("apps").is_dir()
        && path.join("packages").is_dir()
}

pub(crate) fn find_openducktor_workspace_root(start: &Path) -> Result<PathBuf> {
    start
        .ancestors()
        .find(|candidate| is_workspace_root_candidate(candidate))
        .map(Path::to_path_buf)
        .ok_or_else(|| anyhow!("Unable to resolve OpenDucktor workspace root from manifest path"))
}

pub(crate) fn default_mcp_workspace_root() -> Result<String> {
    if let Ok(value) = std::env::var("OPENDUCKTOR_WORKSPACE_ROOT") {
        if !value.trim().is_empty() {
            let root = parse_user_path(value.as_str())
                .with_context(|| format!("Invalid OPENDUCKTOR_WORKSPACE_ROOT: {:?}", value))?;
            return Ok(root.to_string_lossy().to_string());
        }
    }

    let compiled_path = Path::new(env!("CARGO_MANIFEST_DIR"));
    let root = find_openducktor_workspace_root(compiled_path)?;
    Ok(root.to_string_lossy().to_string())
}

fn has_explicit_workspace_root_override() -> bool {
    matches!(
        std::env::var("OPENDUCKTOR_WORKSPACE_ROOT"),
        Ok(value) if !value.trim().is_empty()
    )
}

fn resolve_sidecar_mcp_command() -> Result<Option<Vec<String>>> {
    Ok(resolve_command_path("openducktor-mcp")?.map(|mcp_binary| vec![mcp_binary]))
}

pub(crate) fn resolve_mcp_command() -> Result<Vec<String>> {
    if let Ok(raw) = std::env::var("OPENDUCKTOR_MCP_COMMAND_JSON") {
        return parse_mcp_command_json(raw.as_str());
    }

    let Some(bun_binary) = resolve_command_path("bun")? else {
        if let Some(mcp_command) = resolve_sidecar_mcp_command()? {
            return Ok(mcp_command);
        }

        return Err(anyhow!(
            "Missing MCP runner. Install bun for workspace MCP execution or package the openducktor-mcp sidecar."
        ));
    };

    let workspace_root = match default_mcp_workspace_root() {
        Ok(root) => Some(root),
        Err(error) => {
            if has_explicit_workspace_root_override() {
                return Err(error);
            }
            None
        }
    };

    if let Some(workspace_root) = workspace_root {
        let direct_entrypoint = Path::new(&workspace_root)
            .join("packages")
            .join("openducktor-mcp")
            .join("src")
            .join("index.ts");

        if direct_entrypoint.exists() {
            return Ok(vec![
                bun_binary.clone(),
                direct_entrypoint.to_string_lossy().to_string(),
            ]);
        }

        if let Some(mcp_command) = resolve_sidecar_mcp_command()? {
            return Ok(mcp_command);
        }

        return Ok(vec![
            bun_binary,
            "run".to_string(),
            "--silent".to_string(),
            "--cwd".to_string(),
            workspace_root,
            "--filter".to_string(),
            "@openducktor/mcp".to_string(),
            "start".to_string(),
        ]);
    }

    if let Some(mcp_command) = resolve_sidecar_mcp_command()? {
        return Ok(mcp_command);
    }

    Err(anyhow!(
        "Missing MCP runner. Unable to resolve an OpenDucktor workspace root for bun-based MCP execution and no openducktor-mcp sidecar was found."
    ))
}

pub(crate) fn build_opencode_config_content(workspace_id: &str, host_url: &str) -> Result<String> {
    let mcp_command = resolve_mcp_command()?;
    let config = json!({
        "logLevel": "INFO",
        "mcp": {
            "openducktor": {
                "type": "local",
                "enabled": true,
                "command": mcp_command,
                "environment": {
                    "ODT_WORKSPACE_ID": workspace_id,
                    "ODT_HOST_URL": host_url,
                    "ODT_FORBID_WORKSPACE_ID_INPUT": "true",
                }
            }
        }
    });
    serde_json::to_string(&config).context("Failed to serialize OpenCode MCP config")
}
