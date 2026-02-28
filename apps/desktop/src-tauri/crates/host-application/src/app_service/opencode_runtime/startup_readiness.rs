#[cfg(test)]
use anyhow::{anyhow, Context, Result};
use host_infra_system::OpencodeStartupReadinessConfig;
use std::io::Read;
use std::net::SocketAddr;
use std::process::Child;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, OnceLock};
use std::time::{Duration, Instant};

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
        let connected =
            tokio::time::timeout(connect_timeout, tokio::net::TcpStream::connect(address))
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
