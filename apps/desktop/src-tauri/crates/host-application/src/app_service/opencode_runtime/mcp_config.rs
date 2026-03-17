use anyhow::{anyhow, Context, Result};
use host_infra_system::{resolve_central_beads_dir, resolve_command_path};
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
    let from_env = std::env::var("OPENDUCKTOR_WORKSPACE_ROOT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(root) = from_env {
        return Ok(root);
    }

    let compiled_path = Path::new(env!("CARGO_MANIFEST_DIR"));
    let root = find_openducktor_workspace_root(compiled_path)?;
    Ok(root.to_string_lossy().to_string())
}

pub(crate) fn resolve_mcp_command() -> Result<Vec<String>> {
    if let Ok(raw) = std::env::var("OPENDUCKTOR_MCP_COMMAND_JSON") {
        return parse_mcp_command_json(raw.as_str());
    }

    if let Some(mcp_binary) = resolve_command_path("openducktor-mcp")? {
        return Ok(vec![mcp_binary]);
    }

    let Some(bun_binary) = resolve_command_path("bun")? else {
        return Err(anyhow!(
            "Missing MCP runner. Package the openducktor-mcp sidecar or install bun for the workspace fallback."
        ));
    };

    let workspace_root = default_mcp_workspace_root()?;
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

    Ok(vec![
        bun_binary,
        "run".to_string(),
        "--silent".to_string(),
        "--cwd".to_string(),
        workspace_root,
        "--filter".to_string(),
        "@openducktor/openducktor-mcp".to_string(),
        "start".to_string(),
    ])
}

pub(crate) fn build_opencode_config_content(
    repo_path_for_mcp: &Path,
    metadata_namespace: &str,
) -> Result<String> {
    let mcp_command = resolve_mcp_command()?;
    let beads_dir = resolve_central_beads_dir(repo_path_for_mcp)?;
    let config = json!({
        "logLevel": "INFO",
        "mcp": {
            "openducktor": {
                "type": "local",
                "enabled": true,
                "command": mcp_command,
                "environment": {
                    "ODT_REPO_PATH": repo_path_for_mcp.to_string_lossy().to_string(),
                    "ODT_BEADS_DIR": beads_dir.to_string_lossy().to_string(),
                    "ODT_METADATA_NAMESPACE": metadata_namespace,
                }
            }
        }
    });
    serde_json::to_string(&config).context("Failed to serialize OpenCode MCP config")
}
