use super::*;
use anyhow::Context;
use std::io::ErrorKind;
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

pub(crate) const MCP_BRIDGE_DISCOVERY_RELATIVE_PATH: &str = "runtime/mcp-bridge.json";
const MCP_BRIDGE_HEALTH_PATH: &str = "/health";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpBridgeDiscoveryFile {
    host_url: String,
    host_token: String,
    pid: u32,
}

pub(super) fn bridge_base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

pub(super) fn health_check(port: u16) -> Result<bool> {
    let address: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .context("Invalid localhost MCP bridge address")?;
    let mut stream = match TcpStream::connect_timeout(&address, Duration::from_millis(200)) {
        Ok(stream) => stream,
        Err(_) => return Ok(false),
    };
    if stream
        .set_read_timeout(Some(Duration::from_millis(200)))
        .is_err()
    {
        return Ok(false);
    }
    if stream
        .set_write_timeout(Some(Duration::from_millis(200)))
        .is_err()
    {
        return Ok(false);
    }
    if stream
        .write_all(
            format!(
                "GET {MCP_BRIDGE_HEALTH_PATH} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
            )
            .as_bytes(),
        )
        .is_err()
    {
        return Ok(false);
    }

    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return Ok(false);
    }

    Ok(response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200"))
}

fn discovery_temp_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("mcp-bridge.json");
    path.with_file_name(format!(".{file_name}.{}.tmp", std::process::id()))
}

fn write_discovery_payload_atomically(path: &Path, payload: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "Failed creating MCP bridge discovery directory {}",
                parent.display()
            )
        })?;
    }

    let temp_path = discovery_temp_path(path);
    let mut temp_file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temp_path)
        .with_context(|| {
            format!(
                "Failed opening temporary MCP bridge discovery file {}",
                temp_path.display()
            )
        })?;
    temp_file.write_all(payload.as_bytes()).with_context(|| {
        format!(
            "Failed writing temporary MCP bridge discovery file {}",
            temp_path.display()
        )
    })?;
    temp_file.flush().with_context(|| {
        format!(
            "Failed flushing temporary MCP bridge discovery file {}",
            temp_path.display()
        )
    })?;
    temp_file.sync_all().with_context(|| {
        format!(
            "Failed syncing temporary MCP bridge discovery file {}",
            temp_path.display()
        )
    })?;
    drop(temp_file);

    fs::rename(&temp_path, path).with_context(|| {
        format!(
            "Failed replacing MCP bridge discovery file {} with {}",
            path.display(),
            temp_path.display()
        )
    })?;

    Ok(())
}

fn read_mcp_bridge_discovery(path: &Path) -> Result<Option<McpBridgeDiscoveryFile>> {
    let data = match fs::read_to_string(path) {
        Ok(data) => data,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(error).with_context(|| {
                format!("Failed reading MCP bridge discovery {}", path.display())
            });
        }
    };

    serde_json::from_str::<McpBridgeDiscoveryFile>(&data)
        .with_context(|| {
            format!(
                "Failed parsing MCP bridge discovery payload {}",
                path.display()
            )
        })
        .map(Some)
}

impl AppService {
    pub(super) fn mcp_bridge_discovery_path(config_store: &AppConfigStore) -> PathBuf {
        let base = config_store
            .path()
            .parent()
            .map(|entry| entry.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));
        base.join(MCP_BRIDGE_DISCOVERY_RELATIVE_PATH)
    }

    pub(super) fn publish_mcp_bridge_discovery(
        &self,
        host_url: &str,
        host_token: &str,
    ) -> Result<()> {
        let discovery = McpBridgeDiscoveryFile {
            host_url: host_url.to_string(),
            host_token: host_token.to_string(),
            pid: self.instance_pid,
        };
        let payload = serde_json::to_string_pretty(&discovery)
            .context("Failed serializing MCP bridge discovery payload")?;
        write_discovery_payload_atomically(self.mcp_bridge_discovery_path.as_path(), &payload)
    }

    pub(super) fn remove_mcp_bridge_discovery(
        &self,
        host_url: &str,
        host_token: &str,
    ) -> Result<()> {
        let current = read_mcp_bridge_discovery(self.mcp_bridge_discovery_path.as_path())?;
        if current
            == Some(McpBridgeDiscoveryFile {
                host_url: host_url.to_string(),
                host_token: host_token.to_string(),
                pid: self.instance_pid,
            })
        {
            fs::remove_file(self.mcp_bridge_discovery_path.as_path()).with_context(|| {
                format!(
                    "Failed removing MCP bridge discovery file {}",
                    self.mcp_bridge_discovery_path.display()
                )
            })?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use host_infra_system::AppConfigStore;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_path(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after UNIX_EPOCH")
            .as_nanos();
        std::env::temp_dir().join(format!("openducktor-mcp-bridge-discovery-{prefix}-{nanos}"))
    }

    #[test]
    fn mcp_bridge_discovery_path_uses_config_store_parent_directory() {
        let root = unique_temp_path("path");
        let config_store = AppConfigStore::from_path(root.join("config.json"));

        let path = AppService::mcp_bridge_discovery_path(&config_store);

        assert_eq!(path, root.join(MCP_BRIDGE_DISCOVERY_RELATIVE_PATH));
    }

    #[test]
    fn writes_current_bridge_discovery_file() {
        let path = unique_temp_path("write").join("runtime/mcp-bridge.json");

        write_discovery_payload_atomically(
            path.as_path(),
            r#"{"hostUrl":"http://127.0.0.1:4200","hostToken":"token","pid":123}"#,
        )
        .expect("discovery write should succeed");

        assert_eq!(
            read_mcp_bridge_discovery(path.as_path()).expect("discovery read should succeed"),
            Some(McpBridgeDiscoveryFile {
                host_url: "http://127.0.0.1:4200".to_string(),
                host_token: "token".to_string(),
                pid: 123,
            })
        );
        let _ = fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }
}
