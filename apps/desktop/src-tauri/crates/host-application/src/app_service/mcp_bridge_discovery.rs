use super::*;
use anyhow::Context;
use std::io::ErrorKind;
use std::net::{SocketAddr, TcpStream};
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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
    path.with_file_name(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        unique_temp_suffix()
    ))
}

fn discovery_claim_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("mcp-bridge.json");
    path.with_file_name(format!(
        ".{file_name}.{}.{}.remove",
        std::process::id(),
        unique_temp_suffix()
    ))
}

fn unique_temp_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .expect("system clock should be after the Unix epoch")
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
    let mut open_options = OpenOptions::new();
    open_options.create_new(true).write(true);
    #[cfg(unix)]
    open_options.mode(0o600);
    let mut temp_file = open_options.open(&temp_path).with_context(|| {
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

fn restore_claimed_discovery_unless_replaced(path: &Path, claimed_path: &Path) -> Result<()> {
    match fs::hard_link(claimed_path, path) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
        Err(error) => {
            return Err(error).with_context(|| {
                format!(
                    "Failed restoring MCP bridge discovery file {} from {}",
                    path.display(),
                    claimed_path.display()
                )
            });
        }
    }
    match fs::remove_file(claimed_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| {
            format!(
                "Failed removing temporary MCP bridge discovery file {}",
                claimed_path.display()
            )
        }),
    }
}

fn claim_discovery_for_removal(path: &Path) -> Result<Option<PathBuf>> {
    let claimed_path = discovery_claim_path(path);
    match fs::rename(path, &claimed_path) {
        Ok(()) => Ok(Some(claimed_path)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error).with_context(|| {
            format!(
                "Failed claiming MCP bridge discovery file {} for removal",
                path.display()
            )
        }),
    }
}

fn remove_claimed_discovery(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| {
            format!(
                "Failed removing MCP bridge discovery file {}",
                path.display()
            )
        }),
    }
}

fn remove_discovery_payload_if_current(
    path: &Path,
    expected: &McpBridgeDiscoveryFile,
) -> Result<()> {
    let Some(claimed_path) = claim_discovery_for_removal(path)? else {
        return Ok(());
    };

    let current = read_mcp_bridge_discovery(claimed_path.as_path());
    match current {
        Ok(Some(current)) if current == *expected => remove_claimed_discovery(&claimed_path),
        Ok(_) => restore_claimed_discovery_unless_replaced(path, claimed_path.as_path()),
        Err(error) => {
            restore_claimed_discovery_unless_replaced(path, claimed_path.as_path())?;
            Err(error)
        }
    }
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
        let expected = McpBridgeDiscoveryFile {
            host_url: host_url.to_string(),
            host_token: host_token.to_string(),
            pid: self.instance_pid,
        };
        remove_discovery_payload_if_current(self.mcp_bridge_discovery_path.as_path(), &expected)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use host_infra_system::AppConfigStore;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    fn unique_temp_path(prefix: &str) -> PathBuf {
        let nanos = unique_temp_suffix();
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

    #[cfg(unix)]
    #[test]
    fn writes_discovery_file_with_owner_only_permissions() {
        let path = unique_temp_path("permissions").join("runtime/mcp-bridge.json");

        write_discovery_payload_atomically(
            path.as_path(),
            r#"{"hostUrl":"http://127.0.0.1:4200","hostToken":"token","pid":123}"#,
        )
        .expect("discovery write should succeed");

        let mode = fs::metadata(path.as_path())
            .expect("discovery metadata should be readable")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
        let _ = fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn removes_only_matching_bridge_discovery_file() {
        let path = unique_temp_path("remove-current").join("runtime/mcp-bridge.json");
        let current = McpBridgeDiscoveryFile {
            host_url: "http://127.0.0.1:4200".to_string(),
            host_token: "token".to_string(),
            pid: 123,
        };
        let payload = serde_json::to_string(&current).expect("payload should serialize");
        write_discovery_payload_atomically(path.as_path(), payload.as_str())
            .expect("discovery write should succeed");

        remove_discovery_payload_if_current(path.as_path(), &current)
            .expect("matching discovery removal should succeed");

        assert!(read_mcp_bridge_discovery(path.as_path())
            .expect("discovery read should succeed")
            .is_none());
        let _ = fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn keeps_non_matching_bridge_discovery_file() {
        let path = unique_temp_path("keep-newer").join("runtime/mcp-bridge.json");
        let expected = McpBridgeDiscoveryFile {
            host_url: "http://127.0.0.1:4200".to_string(),
            host_token: "old-token".to_string(),
            pid: 123,
        };
        let newer = McpBridgeDiscoveryFile {
            host_url: "http://127.0.0.1:4300".to_string(),
            host_token: "new-token".to_string(),
            pid: 456,
        };
        let payload = serde_json::to_string(&newer).expect("payload should serialize");
        write_discovery_payload_atomically(path.as_path(), payload.as_str())
            .expect("discovery write should succeed");

        remove_discovery_payload_if_current(path.as_path(), &expected)
            .expect("non-matching discovery removal should preserve file");

        assert_eq!(
            read_mcp_bridge_discovery(path.as_path()).expect("discovery read should succeed"),
            Some(newer)
        );
        let _ = fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }
}
