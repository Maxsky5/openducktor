use super::*;
use anyhow::Context;
use std::io::ErrorKind;
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

pub(crate) const MCP_BRIDGE_REGISTRY_RELATIVE_PATH: &str = "runtime/mcp-bridge-ports.json";
const MCP_BRIDGE_HEALTH_PATH: &str = "/health";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct McpBridgeRegistryFile {
    #[serde(default)]
    ports: Vec<u16>,
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

fn registry_lock_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("mcp-bridge-ports.json");
    path.with_file_name(format!(".{file_name}.lock"))
}

fn registry_temp_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("mcp-bridge-ports.json");
    path.with_file_name(format!(".{file_name}.{}.tmp", std::process::id()))
}

fn write_registry_payload_atomically(path: &Path, payload: &str) -> Result<()> {
    let temp_path = registry_temp_path(path);
    let mut temp_file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temp_path)
        .with_context(|| {
            format!(
                "Failed opening temporary MCP bridge registry {}",
                temp_path.display()
            )
        })?;
    temp_file.write_all(payload.as_bytes()).with_context(|| {
        format!(
            "Failed writing temporary MCP bridge registry {}",
            temp_path.display()
        )
    })?;
    temp_file.flush().with_context(|| {
        format!(
            "Failed flushing temporary MCP bridge registry {}",
            temp_path.display()
        )
    })?;
    temp_file.sync_all().with_context(|| {
        format!(
            "Failed syncing temporary MCP bridge registry {}",
            temp_path.display()
        )
    })?;
    drop(temp_file);

    fs::rename(&temp_path, path).with_context(|| {
        format!(
            "Failed replacing MCP bridge registry {} with {}",
            path.display(),
            temp_path.display()
        )
    })?;

    Ok(())
}

fn normalize_bridge_ports(ports: &mut Vec<u16>) {
    let mut seen = HashSet::new();
    ports.retain(|port| seen.insert(*port));
}

fn with_locked_mcp_bridge_registry<T>(
    path: &Path,
    mutator: impl FnOnce(&mut Vec<u16>) -> Result<T>,
) -> Result<T> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "Failed creating MCP bridge registry directory {}",
                parent.display()
            )
        })?;
    }

    let lock_path = registry_lock_path(path);
    let lock_file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&lock_path)
        .with_context(|| {
            format!(
                "Failed opening MCP bridge registry lock {}",
                lock_path.display()
            )
        })?;
    lock_file.lock_exclusive().with_context(|| {
        format!(
            "Failed acquiring lock for MCP bridge registry {}",
            lock_path.display()
        )
    })?;

    let data = match fs::read_to_string(path) {
        Ok(data) => data,
        Err(error) if error.kind() == ErrorKind::NotFound => String::new(),
        Err(error) => {
            return Err(error)
                .with_context(|| format!("Failed reading MCP bridge registry {}", path.display()));
        }
    };

    let mut parsed = if data.trim().is_empty() {
        McpBridgeRegistryFile::default()
    } else {
        serde_json::from_str::<McpBridgeRegistryFile>(&data).with_context(|| {
            format!(
                "Failed parsing MCP bridge registry payload {}",
                path.display()
            )
        })?
    };
    normalize_bridge_ports(&mut parsed.ports);

    let output = mutator(&mut parsed.ports)?;
    normalize_bridge_ports(&mut parsed.ports);

    let payload = serde_json::to_string_pretty(&parsed)
        .context("Failed serializing MCP bridge registry payload")?;
    write_registry_payload_atomically(path, &payload)?;

    Ok(output)
}

fn reconcile_mcp_bridge_registry_with_health_check<F>(
    path: &Path,
    register_port: Option<u16>,
    remove_port: Option<u16>,
    mut is_healthy: F,
) -> Result<Vec<u16>>
where
    F: FnMut(u16) -> Result<bool>,
{
    with_locked_mcp_bridge_registry(path, |ports| {
        let mut retained = Vec::with_capacity(ports.len() + usize::from(register_port.is_some()));

        for port in ports.drain(..) {
            if Some(port) == remove_port {
                continue;
            }
            if Some(port) == register_port {
                continue;
            }
            if is_healthy(port)? {
                retained.push(port);
            }
        }

        if let Some(port) = register_port {
            retained.insert(0, port);
        }

        *ports = retained;
        normalize_bridge_ports(ports);
        Ok(ports.clone())
    })
}

fn reconcile_mcp_bridge_registry(
    path: &Path,
    register_port: Option<u16>,
    remove_port: Option<u16>,
) -> Result<Vec<u16>> {
    reconcile_mcp_bridge_registry_with_health_check(path, register_port, remove_port, health_check)
}

impl AppService {
    pub(super) fn mcp_bridge_registry_path(config_store: &AppConfigStore) -> PathBuf {
        let base = config_store
            .path()
            .parent()
            .map(|entry| entry.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));
        base.join(MCP_BRIDGE_REGISTRY_RELATIVE_PATH)
    }

    pub(super) fn reconcile_mcp_bridge_registry_on_startup(&self) -> Result<()> {
        reconcile_mcp_bridge_registry(self.mcp_bridge_registry_path.as_path(), None, None)
            .map(|_| ())
    }

    pub(super) fn register_mcp_bridge_port(&self, port: u16) -> Result<()> {
        reconcile_mcp_bridge_registry(self.mcp_bridge_registry_path.as_path(), Some(port), None)
            .map(|_| ())
    }

    pub(super) fn unregister_mcp_bridge_port(&self, port: u16) -> Result<()> {
        reconcile_mcp_bridge_registry(self.mcp_bridge_registry_path.as_path(), None, Some(port))
            .map(|_| ())
    }
}

#[cfg(test)]
pub(crate) fn read_mcp_bridge_registry(path: &Path) -> Result<Vec<u16>> {
    with_locked_mcp_bridge_registry(path, |ports| Ok(ports.clone()))
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
        std::env::temp_dir().join(format!("openducktor-mcp-bridge-registry-{prefix}-{nanos}"))
    }

    #[test]
    fn mcp_bridge_registry_path_uses_config_store_parent_directory() {
        let root = unique_temp_path("path");
        let config_store = AppConfigStore::from_path(root.join("config.json"));

        let path = AppService::mcp_bridge_registry_path(&config_store);

        assert_eq!(path, root.join(MCP_BRIDGE_REGISTRY_RELATIVE_PATH));
    }

    #[test]
    fn reconcile_registry_adds_registered_port_and_prunes_unhealthy_entries() {
        let path = unique_temp_path("register").join("runtime/mcp-bridge-ports.json");
        with_locked_mcp_bridge_registry(path.as_path(), |ports| {
            *ports = vec![4200, 4100, 4200, 4300];
            Ok(())
        })
        .expect("seed registry should succeed");

        let ports = reconcile_mcp_bridge_registry_with_health_check(
            path.as_path(),
            Some(4400),
            None,
            |port| Ok(port == 4200),
        )
        .expect("registry reconcile should succeed");

        assert_eq!(ports, vec![4400, 4200]);
        assert_eq!(
            read_mcp_bridge_registry(path.as_path()).expect("registry read should succeed"),
            vec![4400, 4200]
        );
    }

    #[test]
    fn reconcile_registry_moves_re_registered_port_to_front() {
        let path = unique_temp_path("reregister").join("runtime/mcp-bridge-ports.json");
        with_locked_mcp_bridge_registry(path.as_path(), |ports| {
            *ports = vec![4200, 4300, 4400];
            Ok(())
        })
        .expect("seed registry should succeed");

        let ports = reconcile_mcp_bridge_registry_with_health_check(
            path.as_path(),
            Some(4300),
            None,
            |_port| Ok(true),
        )
        .expect("registry reconcile should succeed");

        assert_eq!(ports, vec![4300, 4200, 4400]);
        assert_eq!(
            read_mcp_bridge_registry(path.as_path()).expect("registry read should succeed"),
            vec![4300, 4200, 4400]
        );
    }

    #[test]
    fn reconcile_registry_removes_stopped_port() {
        let path = unique_temp_path("remove").join("runtime/mcp-bridge-ports.json");
        with_locked_mcp_bridge_registry(path.as_path(), |ports| {
            *ports = vec![4200, 4300];
            Ok(())
        })
        .expect("seed registry should succeed");

        let ports = reconcile_mcp_bridge_registry_with_health_check(
            path.as_path(),
            None,
            Some(4300),
            |_port| Ok(true),
        )
        .expect("registry reconcile should succeed");

        assert_eq!(ports, vec![4200]);
        assert_eq!(
            read_mcp_bridge_registry(path.as_path()).expect("registry read should succeed"),
            vec![4200]
        );
    }
}
