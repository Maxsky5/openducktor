use super::policy::StartupCancelEpoch;
use crate::app_service::{
    startup_wait_report, RuntimeStartupReadinessPolicy, RuntimeStartupWaitReport,
};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Arc, OnceLock};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy)]
pub(super) enum LocalServerProbeState {
    Ready,
    TimedOut,
    Cancelled,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct LocalServerProbeEvent {
    pub(super) state: LocalServerProbeState,
    pub(super) report: RuntimeStartupWaitReport,
}

pub(super) struct LocalServerProbe {
    receiver: mpsc::Receiver<LocalServerProbeEvent>,
    attempts: Arc<AtomicU32>,
    cancelled: Arc<AtomicBool>,
    task: tokio::task::JoinHandle<()>,
}

impl LocalServerProbe {
    pub(super) fn spawn(
        address: SocketAddr,
        policy: RuntimeStartupReadinessPolicy,
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

    pub(super) fn recv_timeout(
        &self,
        timeout: Duration,
    ) -> std::result::Result<LocalServerProbeEvent, mpsc::RecvTimeoutError> {
        self.receiver.recv_timeout(timeout)
    }

    pub(super) fn attempts(&self) -> u32 {
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

fn current_attempts(attempts: &Arc<AtomicU32>) -> u32 {
    attempts.load(Ordering::Relaxed)
}

async fn probe_local_server_async(
    address: SocketAddr,
    policy: RuntimeStartupReadinessPolicy,
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

#[cfg(test)]
mod tests {
    use super::{LocalServerProbe, LocalServerProbeState};
    use crate::app_service::OpencodeStartupReadinessPolicy;
    use crate::app_service::StartupCancelEpoch;
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    fn policy(timeout: Duration) -> OpencodeStartupReadinessPolicy {
        OpencodeStartupReadinessPolicy {
            timeout,
            connect_timeout: Duration::from_millis(150),
            initial_retry_delay: Duration::from_millis(20),
            max_retry_delay: Duration::from_millis(40),
            child_state_check_interval: Duration::from_millis(20),
        }
    }

    #[test]
    fn probe_reports_ready_when_server_is_reachable() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test listener");
        let address = listener.local_addr().expect("listener address");
        let cancel_epoch: StartupCancelEpoch = Arc::new(AtomicU64::new(0));
        let probe =
            LocalServerProbe::spawn(address, policy(Duration::from_secs(1)), cancel_epoch, 0);

        let event = probe
            .recv_timeout(Duration::from_secs(2))
            .expect("probe should complete");
        assert!(matches!(event.state, LocalServerProbeState::Ready));
        assert!(event.report.attempts() >= 1);
    }

    #[test]
    fn probe_reports_cancelled_when_epoch_changes() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind throwaway listener");
        let address = listener.local_addr().expect("listener address");
        drop(listener);

        let cancel_epoch: StartupCancelEpoch = Arc::new(AtomicU64::new(0));
        let probe = LocalServerProbe::spawn(
            address,
            policy(Duration::from_secs(2)),
            Arc::clone(&cancel_epoch),
            0,
        );
        cancel_epoch.store(1, Ordering::SeqCst);

        let event = probe
            .recv_timeout(Duration::from_secs(3))
            .expect("probe should complete after cancellation");
        assert!(matches!(event.state, LocalServerProbeState::Cancelled));
        assert!(event.report.startup_ms() < 2_000);
    }
}
