use host_domain::RuntimeStartupReadinessConfig;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeStartupFailureReason {
    InvalidAddress,
    ChildStateCheckFailed,
    ChildExited,
    Timeout,
    Cancelled,
    ProbeDisconnected,
    StartupConfigInvalid,
}

impl RuntimeStartupFailureReason {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidAddress => "invalid_address",
            Self::ChildStateCheckFailed => "child_state_check_failed",
            Self::ChildExited => "child_exited",
            Self::Timeout => "timeout",
            Self::Cancelled => "cancelled",
            Self::ProbeDisconnected => "probe_disconnected",
            Self::StartupConfigInvalid => "startup_config_invalid",
        }
    }

    pub const fn is_timeout(self) -> bool {
        matches!(self, Self::Timeout)
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct RuntimeStartupReadinessPolicy {
    pub timeout: Duration,
    pub connect_timeout: Duration,
    pub initial_retry_delay: Duration,
    pub max_retry_delay: Duration,
    pub child_state_check_interval: Duration,
}

impl RuntimeStartupReadinessPolicy {
    fn duration_ms(duration: Duration) -> u64 {
        duration.as_millis().min(u64::MAX as u128) as u64
    }

    pub(crate) fn from_config(config: RuntimeStartupReadinessConfig) -> Self {
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

impl Default for RuntimeStartupReadinessPolicy {
    fn default() -> Self {
        Self::from_config(RuntimeStartupReadinessConfig::default())
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct RuntimeStartupWaitReport {
    attempts: u32,
    elapsed: Duration,
}

impl RuntimeStartupWaitReport {
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
pub struct RuntimeStartupWaitFailure {
    port: u16,
    reason: RuntimeStartupFailureReason,
    details: String,
    report: RuntimeStartupWaitReport,
}

impl RuntimeStartupWaitFailure {
    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn reason(&self) -> RuntimeStartupFailureReason {
        self.reason
    }

    pub fn details(&self) -> &str {
        self.details.as_str()
    }

    pub(crate) fn report(&self) -> RuntimeStartupWaitReport {
        self.report
    }
}

impl std::fmt::Display for RuntimeStartupWaitFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Runtime startup probe failed reason={} port={} startupMs={} attempts={} details={}",
            self.reason.as_str(),
            self.port,
            self.report.startup_ms(),
            self.report.attempts(),
            self.details.replace('\n', "\\n")
        )
    }
}

impl std::error::Error for RuntimeStartupWaitFailure {}

pub(crate) fn startup_wait_report(started_at: Instant, attempts: u32) -> RuntimeStartupWaitReport {
    RuntimeStartupWaitReport {
        attempts,
        elapsed: started_at.elapsed(),
    }
}

pub(crate) fn startup_wait_failure(
    reason: RuntimeStartupFailureReason,
    port: u16,
    details: String,
    report: RuntimeStartupWaitReport,
) -> RuntimeStartupWaitFailure {
    RuntimeStartupWaitFailure {
        port,
        reason,
        details,
        report,
    }
}
