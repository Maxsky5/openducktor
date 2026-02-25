use anyhow::{anyhow, Context, Result};
use host_infra_system::{
    command_exists, command_path, resolve_central_beads_dir, OpencodeStartupReadinessConfig,
};
use serde_json::json;
use std::io::Read;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, OnceLock};
use std::time::{Duration, Instant};

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

pub(crate) fn default_mcp_workspace_root() -> Result<String> {
    let from_env = std::env::var("OPENDUCKTOR_WORKSPACE_ROOT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(root) = from_env {
        return Ok(root);
    }

    let compiled_path = Path::new(env!("CARGO_MANIFEST_DIR"));
    let root = compiled_path.ancestors().nth(5).ok_or_else(|| {
        anyhow!("Unable to resolve OpenDucktor workspace root from manifest path")
    })?;
    Ok(root.to_string_lossy().to_string())
}

pub(crate) fn resolve_mcp_command() -> Result<Vec<String>> {
    if let Ok(raw) = std::env::var("OPENDUCKTOR_MCP_COMMAND_JSON") {
        return parse_mcp_command_json(raw.as_str());
    }

    if command_exists("openducktor-mcp") {
        return Ok(vec!["openducktor-mcp".to_string()]);
    }

    if !command_exists("bun") {
        return Err(anyhow!(
            "Missing MCP runner. Install `openducktor-mcp` on PATH or install bun for workspace fallback."
        ));
    }

    let workspace_root = default_mcp_workspace_root()?;
    let direct_entrypoint = Path::new(&workspace_root)
        .join("packages")
        .join("openducktor-mcp")
        .join("src")
        .join("index.ts");

    if direct_entrypoint.exists() {
        return Ok(vec![
            "bun".to_string(),
            direct_entrypoint.to_string_lossy().to_string(),
        ]);
    }

    Ok(vec![
        "bun".to_string(),
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

pub(crate) fn read_opencode_version(binary: &str) -> Option<String> {
    let mut command = Command::new(binary);
    command
        .arg("--version")
        .env("OPENCODE_CONFIG_CONTENT", r#"{"logLevel":"INFO"}"#)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    configure_process_group(&mut command);

    let mut child = command.spawn().ok()?;
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match child.try_wait().ok()? {
            Some(status) => {
                if !status.success() {
                    return None;
                }
                let output = child.wait_with_output().ok()?;
                let stdout = String::from_utf8_lossy(&output.stdout);
                return stdout
                    .lines()
                    .find(|line| !line.trim().is_empty())
                    .map(|line| line.trim().to_string());
            }
            None => {
                if Instant::now() >= deadline {
                    terminate_child_process(&mut child);
                    return None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

pub(crate) fn resolve_opencode_binary_path() -> Option<String> {
    if let Ok(override_binary) = std::env::var("OPENDUCKTOR_OPENCODE_BINARY") {
        let trimmed = override_binary.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    if let Some(resolved) = command_path("opencode") {
        return Some(resolved);
    }

    let home = std::env::var_os("HOME")?;
    let candidate = PathBuf::from(home)
        .join(".opencode")
        .join("bin")
        .join("opencode");
    if candidate.is_file() {
        return candidate.to_str().map(|value| value.to_string());
    }

    None
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_process_group(_command: &mut Command) {}

#[cfg(unix)]
fn terminate_process_group_if_owned(child: &Child) {
    terminate_process_group_if_owned_pid(child.id());
}

#[cfg(unix)]
fn terminate_process_group_if_owned_pid(pid: u32) {
    let pid = pid as i32;
    if pid <= 0 {
        return;
    }
    let pgid = unsafe { libc::getpgid(pid) };
    if pgid == pid {
        unsafe {
            libc::killpg(pid, libc::SIGTERM);
        }
    }
}

#[cfg(not(unix))]
fn terminate_process_group_if_owned(_child: &Child) {}

#[cfg(not(unix))]
fn terminate_process_group_if_owned_pid(_pid: u32) {}

pub(crate) fn terminate_child_process(child: &mut Child) {
    terminate_process_group_if_owned(child);
    let _ = child.kill();
    let _ = child.wait();
}

pub(crate) fn terminate_process_by_pid(pid: u32) {
    terminate_process_group_if_owned_pid(pid);
    #[cfg(unix)]
    {
        let pid = pid as i32;
        if pid > 0 {
            unsafe {
                libc::kill(pid, libc::SIGKILL);
            }
        }
    }
}

fn read_process_snapshot(pid: u32) -> Option<(u32, String)> {
    let output = Command::new("ps")
        .arg("-o")
        .arg("ppid=")
        .arg("-o")
        .arg("command=")
        .arg("-p")
        .arg(pid.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .find(|entry| !entry.trim().is_empty())?
        .trim()
        .to_string();
    let split_index = line.find(char::is_whitespace)?;
    let ppid = line[..split_index].trim().parse::<u32>().ok()?;
    let command = line[split_index..].trim_start().to_string();
    Some((ppid, command))
}

pub(crate) fn process_exists(pid: u32) -> bool {
    read_process_snapshot(pid).is_some()
}

fn is_opencode_server_command(command: &str) -> bool {
    let normalized = command.to_ascii_lowercase();
    normalized.contains("opencode")
        && normalized.contains(" serve")
        && normalized.contains("--hostname")
        && normalized.contains("127.0.0.1")
}

pub(crate) fn opencode_server_parent_pid(pid: u32) -> Option<u32> {
    let (ppid, command) = read_process_snapshot(pid)?;
    if is_opencode_server_command(command.as_str()) {
        Some(ppid)
    } else {
        None
    }
}

#[cfg(test)]
pub(crate) fn is_orphaned_opencode_server_process(pid: u32) -> bool {
    matches!(opencode_server_parent_pid(pid), Some(1))
}

#[cfg(unix)]
fn spawn_parent_death_watcher(parent_pid: u32, child_pid: u32) -> Result<()> {
    let watcher_script = format!(
        r#"P={parent_pid}; C={child_pid}; while kill -0 "$P" 2>/dev/null && kill -0 "$C" 2>/dev/null; do sleep 1; done; if ! kill -0 "$P" 2>/dev/null && kill -0 "$C" 2>/dev/null; then kill -TERM -"$C" 2>/dev/null || true; sleep 1; kill -KILL -"$C" 2>/dev/null || true; kill -KILL "$C" 2>/dev/null || true; fi"#
    );
    Command::new("/bin/sh")
        .arg("-lc")
        .arg(watcher_script)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .context("Failed to spawn OpenCode parent-death watcher")?;
    Ok(())
}

#[cfg(not(unix))]
fn spawn_parent_death_watcher(_parent_pid: u32, _child_pid: u32) -> Result<()> {
    Ok(())
}

pub(crate) fn spawn_opencode_server(
    working_directory: &Path,
    repo_path_for_mcp: &Path,
    metadata_namespace: &str,
    port: u16,
) -> Result<Child> {
    let config_content = build_opencode_config_content(repo_path_for_mcp, metadata_namespace)?;
    let opencode_binary = resolve_opencode_binary_path()
        .ok_or_else(|| anyhow!("opencode binary not found in PATH or ~/.opencode/bin"))?;
    let mut command = Command::new(&opencode_binary);
    command
        .arg("serve")
        .arg("--hostname")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .env("OPENCODE_CONFIG_CONTENT", config_content)
        .current_dir(working_directory)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);
    let child = command.spawn().with_context(|| {
        format!(
            "Failed to spawn opencode serve with binary {}",
            opencode_binary
        )
    })?;
    if let Err(error) = spawn_parent_death_watcher(std::process::id(), child.id()) {
        eprintln!(
            "OpenDucktor warning: failed to attach OpenCode parent-death watcher for pid {}: {error:#}",
            child.id()
        );
    }
    Ok(child)
}

pub(crate) type StartupCancelEpoch = Arc<AtomicU64>;

#[derive(Debug, Clone, Copy)]
pub(crate) struct OpencodeStartupReadinessPolicy {
    pub timeout: Duration,
    pub connect_timeout: Duration,
    pub initial_retry_delay: Duration,
    pub max_retry_delay: Duration,
    pub child_state_check_interval: Duration,
}

impl OpencodeStartupReadinessPolicy {
    fn duration_ms(duration: Duration) -> u64 {
        duration.as_millis().min(u64::MAX as u128) as u64
    }

    pub(crate) fn from_config(config: OpencodeStartupReadinessConfig) -> Self {
        Self {
            timeout: Duration::from_millis(config.timeout_ms),
            connect_timeout: Duration::from_millis(config.connect_timeout_ms),
            initial_retry_delay: Duration::from_millis(config.initial_retry_delay_ms),
            max_retry_delay: Duration::from_millis(config.max_retry_delay_ms),
            child_state_check_interval: Duration::from_millis(config.child_check_interval_ms),
        }
    }

    pub(crate) fn timeout_ms(self) -> u64 {
        Self::duration_ms(self.timeout)
    }

    pub(crate) fn connect_timeout_ms(self) -> u64 {
        Self::duration_ms(self.connect_timeout)
    }

    pub(crate) fn initial_retry_delay_ms(self) -> u64 {
        Self::duration_ms(self.initial_retry_delay)
    }

    pub(crate) fn max_retry_delay_ms(self) -> u64 {
        Self::duration_ms(self.max_retry_delay)
    }

    pub(crate) fn child_state_check_interval_ms(self) -> u64 {
        Self::duration_ms(self.child_state_check_interval)
    }
}

impl Default for OpencodeStartupReadinessPolicy {
    fn default() -> Self {
        Self::from_config(OpencodeStartupReadinessConfig::default())
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct OpencodeStartupWaitReport {
    attempts: u32,
    elapsed: Duration,
}

impl OpencodeStartupWaitReport {
    pub(crate) fn attempts(self) -> u32 {
        self.attempts
    }

    pub(crate) fn startup_ms(self) -> u64 {
        self.elapsed.as_millis().min(u64::MAX as u128) as u64
    }

    #[cfg(test)]
    pub(crate) fn from_parts(attempts: u32, elapsed: Duration) -> Self {
        Self { attempts, elapsed }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct OpencodeStartupWaitFailure {
    pub port: u16,
    pub reason: &'static str,
    pub details: String,
    pub report: OpencodeStartupWaitReport,
}

impl std::fmt::Display for OpencodeStartupWaitFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "OpenCode startup probe failed reason={} port={} startupMs={} attempts={} details={}",
            self.reason,
            self.port,
            self.report.startup_ms(),
            self.report.attempts(),
            self.details.replace('\n', "\\n")
        )
    }
}

impl std::error::Error for OpencodeStartupWaitFailure {}

#[derive(Debug, Clone, Copy)]
enum LocalServerProbeState {
    Ready,
    TimedOut,
    Cancelled,
}

#[derive(Debug, Clone, Copy)]
struct LocalServerProbeEvent {
    state: LocalServerProbeState,
    report: OpencodeStartupWaitReport,
}

struct LocalServerProbe {
    receiver: mpsc::Receiver<LocalServerProbeEvent>,
    attempts: Arc<AtomicU32>,
    cancelled: Arc<AtomicBool>,
    task: tokio::task::JoinHandle<()>,
}

impl LocalServerProbe {
    fn spawn(
        address: SocketAddr,
        policy: OpencodeStartupReadinessPolicy,
        cancel_epoch: StartupCancelEpoch,
        cancel_snapshot: u64,
    ) -> Self {
        let (sender, receiver) = mpsc::channel();
        let attempts = Arc::new(AtomicU32::new(0));
        let attempts_for_probe = Arc::clone(&attempts);
        let cancelled = Arc::new(AtomicBool::new(false));
        let cancelled_for_probe = Arc::clone(&cancelled);
        let task = startup_probe_runtime().spawn(async move {
            let event = probe_local_server_async(
                address,
                policy,
                cancel_epoch,
                cancel_snapshot,
                attempts_for_probe,
                cancelled_for_probe,
            )
            .await;
            let _ = sender.send(event);
        });
        Self {
            receiver,
            attempts,
            cancelled,
            task,
        }
    }

    fn recv_timeout(
        &self,
        timeout: Duration,
    ) -> std::result::Result<LocalServerProbeEvent, mpsc::RecvTimeoutError> {
        self.receiver.recv_timeout(timeout)
    }

    fn attempts(&self) -> u32 {
        self.attempts.load(Ordering::Relaxed)
    }
}

impl Drop for LocalServerProbe {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Release);
        self.task.abort();
    }
}

static STARTUP_PROBE_RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();

fn startup_probe_runtime() -> &'static tokio::runtime::Runtime {
    STARTUP_PROBE_RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .thread_name("odt-opencode-startup")
            .enable_io()
            .enable_time()
            .build()
            .expect("failed to build OpenCode startup probe runtime")
    })
}

fn startup_wait_report(started_at: Instant, attempts: u32) -> OpencodeStartupWaitReport {
    OpencodeStartupWaitReport {
        attempts,
        elapsed: started_at.elapsed(),
    }
}

fn startup_wait_failure(
    reason: &'static str,
    port: u16,
    details: String,
    report: OpencodeStartupWaitReport,
) -> OpencodeStartupWaitFailure {
    OpencodeStartupWaitFailure {
        port,
        reason,
        details,
        report,
    }
}

fn current_attempts(attempts: &Arc<AtomicU32>) -> u32 {
    attempts.load(Ordering::Relaxed)
}

async fn probe_local_server_async(
    address: SocketAddr,
    policy: OpencodeStartupReadinessPolicy,
    cancel_epoch: StartupCancelEpoch,
    cancel_snapshot: u64,
    attempts: Arc<AtomicU32>,
    cancelled: Arc<AtomicBool>,
) -> LocalServerProbeEvent {
    let started_at = Instant::now();
    let deadline = started_at + policy.timeout;
    let mut retry_delay = policy.initial_retry_delay;

    loop {
        if cancelled.load(Ordering::Acquire) {
            return LocalServerProbeEvent {
                state: LocalServerProbeState::Cancelled,
                report: startup_wait_report(started_at, current_attempts(&attempts)),
            };
        }

        if cancel_epoch.load(Ordering::SeqCst) != cancel_snapshot {
            return LocalServerProbeEvent {
                state: LocalServerProbeState::Cancelled,
                report: startup_wait_report(started_at, current_attempts(&attempts)),
            };
        }

        let now = Instant::now();
        if now >= deadline {
            return LocalServerProbeEvent {
                state: LocalServerProbeState::TimedOut,
                report: startup_wait_report(started_at, current_attempts(&attempts)),
            };
        }

        let remaining_budget = deadline.saturating_duration_since(now);
        let connect_timeout = policy.connect_timeout.min(remaining_budget);
        if connect_timeout.is_zero() {
            return LocalServerProbeEvent {
                state: LocalServerProbeState::TimedOut,
                report: startup_wait_report(started_at, current_attempts(&attempts)),
            };
        }

        attempts.fetch_add(1, Ordering::Relaxed);
        let connected = tokio::time::timeout(
            connect_timeout,
            tokio::net::TcpStream::connect(address),
        )
        .await
        .ok()
        .and_then(|result| result.ok())
        .is_some();
        if connected {
            return LocalServerProbeEvent {
                state: LocalServerProbeState::Ready,
                report: startup_wait_report(started_at, current_attempts(&attempts)),
            };
        }

        let now_after_connect = Instant::now();
        if now_after_connect >= deadline {
            return LocalServerProbeEvent {
                state: LocalServerProbeState::TimedOut,
                report: startup_wait_report(started_at, current_attempts(&attempts)),
            };
        }

        let sleep_for = deadline
            .saturating_duration_since(now_after_connect)
            .min(retry_delay);
        tokio::time::sleep(sleep_for).await;
        retry_delay = retry_delay
            .checked_mul(2)
            .unwrap_or(policy.max_retry_delay)
            .min(policy.max_retry_delay);
    }
}

fn read_child_pipe(pipe: &mut Option<impl Read>) -> String {
    let Some(mut reader) = pipe.take() else {
        return String::new();
    };
    let mut output = String::new();
    let _ = reader.read_to_string(&mut output);
    output.trim().to_string()
}

#[cfg(test)]
pub(crate) fn wait_for_local_server(port: u16, timeout: Duration) -> Result<()> {
    let policy = OpencodeStartupReadinessPolicy {
        timeout,
        ..OpencodeStartupReadinessPolicy::default()
    };
    let address: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .context("Invalid localhost address")?;
    let cancel_epoch = Arc::new(AtomicU64::new(0));
    let probe = LocalServerProbe::spawn(address, policy, cancel_epoch, 0);
    let wait_budget = timeout
        .saturating_add(policy.connect_timeout)
        .saturating_add(policy.max_retry_delay)
        .saturating_add(policy.child_state_check_interval);

    match probe.recv_timeout(wait_budget) {
        Ok(LocalServerProbeEvent {
            state: LocalServerProbeState::Ready,
            ..
        }) => Ok(()),
        Ok(LocalServerProbeEvent { state, report }) => Err(anyhow!(
            "{}",
            startup_wait_failure(
                match state {
                    LocalServerProbeState::TimedOut => "timeout",
                    LocalServerProbeState::Cancelled => "cancelled",
                    LocalServerProbeState::Ready => "ready",
                },
                port,
                format!("OpenCode runtime did not become reachable on 127.0.0.1:{port}"),
                report,
            )
        )),
        Err(mpsc::RecvTimeoutError::Timeout) | Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err(anyhow!(
                "OpenCode startup probe failed reason=probe_disconnected port={} startupMs={} attempts={} details={}",
                port,
                timeout.as_millis(),
                probe.attempts(),
                "Probe channel disconnected before startup completion"
            ))
        }
    }
}

pub(crate) fn wait_for_local_server_with_process(
    child: &mut Child,
    port: u16,
    policy: OpencodeStartupReadinessPolicy,
    cancel_epoch: &StartupCancelEpoch,
    cancel_snapshot: u64,
) -> std::result::Result<OpencodeStartupWaitReport, OpencodeStartupWaitFailure> {
    let started_at = Instant::now();
    let address: SocketAddr = format!("127.0.0.1:{port}").parse().map_err(|error| {
        startup_wait_failure(
            "invalid_address",
            port,
            format!("Invalid localhost address: {error}"),
            startup_wait_report(started_at, 0),
        )
    })?;
    let probe = LocalServerProbe::spawn(address, policy, Arc::clone(cancel_epoch), cancel_snapshot);

    loop {
        if let Some(status) = child.try_wait().map_err(|error| {
            startup_wait_failure(
                "child_state_check_failed",
                port,
                format!("Failed checking OpenCode process state: {error}"),
                startup_wait_report(started_at, probe.attempts()),
            )
        })? {
            let stderr = read_child_pipe(&mut child.stderr);
            let stdout = read_child_pipe(&mut child.stdout);
            let details = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                format!("process exited with status {status}")
            };
            return Err(startup_wait_failure(
                "child_exited",
                port,
                format!("OpenCode process exited before runtime became reachable: {details}"),
                startup_wait_report(started_at, probe.attempts()),
            ));
        }

        match probe.recv_timeout(policy.child_state_check_interval) {
            Ok(LocalServerProbeEvent {
                state: LocalServerProbeState::Ready,
                report,
            }) => return Ok(report),
            Ok(LocalServerProbeEvent {
                state: LocalServerProbeState::TimedOut,
                report,
            }) => {
                return Err(startup_wait_failure(
                    "timeout",
                    port,
                    format!("Timed out waiting for OpenCode runtime on 127.0.0.1:{port}"),
                    report,
                ))
            }
            Ok(LocalServerProbeEvent {
                state: LocalServerProbeState::Cancelled,
                report,
            }) => {
                return Err(startup_wait_failure(
                    "cancelled",
                    port,
                    "Startup cancelled while waiting for OpenCode runtime readiness".to_string(),
                    report,
                ))
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(startup_wait_failure(
                    "probe_disconnected",
                    port,
                    "Startup probe channel disconnected before readiness result".to_string(),
                    startup_wait_report(started_at, probe.attempts()),
                ))
            }
        }
    }
}
