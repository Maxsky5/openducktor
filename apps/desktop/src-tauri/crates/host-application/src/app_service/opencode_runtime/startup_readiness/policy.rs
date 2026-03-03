use host_infra_system::OpencodeStartupReadinessConfig;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
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

    pub(crate) fn zero() -> Self {
        Self {
            attempts: 0,
            elapsed: Duration::ZERO,
        }
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

pub(super) fn startup_wait_report(started_at: Instant, attempts: u32) -> OpencodeStartupWaitReport {
    OpencodeStartupWaitReport {
        attempts,
        elapsed: started_at.elapsed(),
    }
}

pub(super) fn startup_wait_failure(
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
