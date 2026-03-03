use super::*;

const STARTUP_DURATION_WARN_MS: u64 = 5_000;
const STARTUP_ATTEMPTS_WARN: u32 = 20;
const STARTUP_FAILURE_RATE_WARN_MIN_SAMPLES: u64 = 10;
const STARTUP_FAILURE_RATE_WARN_PCT: u64 = 30;
const STARTUP_MS_BUCKETS: [&str; 7] = [
    "<=100", "<=250", "<=500", "<=1000", "<=2000", "<=5000", ">5000",
];
const STARTUP_ATTEMPTS_BUCKETS: [&str; 6] = ["<=1", "<=3", "<=5", "<=10", "<=20", ">20"];
pub(crate) const STARTUP_CONFIG_INVALID_REASON: &str = "startup_config_invalid";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpencodeStartupPolicyPayload {
    timeout_ms: u64,
    connect_timeout_ms: u64,
    initial_retry_delay_ms: u64,
    max_retry_delay_ms: u64,
    child_check_interval_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpencodeStartupReportPayload {
    startup_ms: u64,
    attempts: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpencodeStartupMetricsSnapshot {
    pub(crate) total: u64,
    pub(crate) ready: u64,
    pub(crate) failed: u64,
    pub(crate) failed_by_reason: BTreeMap<String, u64>,
    pub(crate) startup_ms_histogram: BTreeMap<String, u64>,
    pub(crate) attempts_histogram: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpencodeStartupEventPayload {
    event: String,
    scope: String,
    repo_path: String,
    task_id: Option<String>,
    role: String,
    port: u16,
    correlation_type: Option<String>,
    correlation_id: Option<String>,
    policy: Option<OpencodeStartupPolicyPayload>,
    report: Option<OpencodeStartupReportPayload>,
    reason: Option<String>,
    metrics: Option<OpencodeStartupMetricsSnapshot>,
    #[serde(default)]
    alerts: Vec<String>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct StartupEventCorrelation<'a> {
    correlation_type: &'a str,
    correlation_id: &'a str,
}

impl<'a> StartupEventCorrelation<'a> {
    pub(crate) const fn new(correlation_type: &'a str, correlation_id: &'a str) -> Self {
        Self {
            correlation_type,
            correlation_id,
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum StartupEventKind {
    WaitBegin,
    Ready(OpencodeStartupWaitReport),
    Failed {
        report: OpencodeStartupWaitReport,
        failure_reason: &'static str,
    },
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct StartupEventPayload<'a> {
    runtime_type: &'a str,
    repo_path: &'a str,
    task_id: Option<&'a str>,
    role: &'a str,
    port: u16,
    correlation: Option<StartupEventCorrelation<'a>>,
    policy: Option<OpencodeStartupReadinessPolicy>,
    kind: StartupEventKind,
}

impl<'a> StartupEventPayload<'a> {
    pub(crate) fn wait_begin(
        runtime_type: &'a str,
        repo_path: &'a str,
        task_id: Option<&'a str>,
        role: &'a str,
        port: u16,
        correlation: Option<StartupEventCorrelation<'a>>,
        policy: Option<OpencodeStartupReadinessPolicy>,
    ) -> Self {
        Self {
            runtime_type,
            repo_path,
            task_id,
            role,
            port,
            correlation,
            policy,
            kind: StartupEventKind::WaitBegin,
        }
    }

    pub(crate) fn ready(
        runtime_type: &'a str,
        repo_path: &'a str,
        task_id: Option<&'a str>,
        role: &'a str,
        port: u16,
        correlation: Option<StartupEventCorrelation<'a>>,
        policy: Option<OpencodeStartupReadinessPolicy>,
        report: OpencodeStartupWaitReport,
    ) -> Self {
        Self {
            runtime_type,
            repo_path,
            task_id,
            role,
            port,
            correlation,
            policy,
            kind: StartupEventKind::Ready(report),
        }
    }

    pub(crate) fn failed(
        runtime_type: &'a str,
        repo_path: &'a str,
        task_id: Option<&'a str>,
        role: &'a str,
        port: u16,
        correlation: Option<StartupEventCorrelation<'a>>,
        policy: Option<OpencodeStartupReadinessPolicy>,
        report: OpencodeStartupWaitReport,
        failure_reason: &'static str,
    ) -> Self {
        Self {
            runtime_type,
            repo_path,
            task_id,
            role,
            port,
            correlation,
            policy,
            kind: StartupEventKind::Failed {
                report,
                failure_reason,
            },
        }
    }

    fn event_name(&self) -> &'static str {
        match self.kind {
            StartupEventKind::WaitBegin => "startup_wait_begin",
            StartupEventKind::Ready(_) => "startup_ready",
            StartupEventKind::Failed { .. } => "startup_failed",
        }
    }

    fn report(&self) -> Option<OpencodeStartupWaitReport> {
        match self.kind {
            StartupEventKind::WaitBegin => None,
            StartupEventKind::Ready(report) => Some(report),
            StartupEventKind::Failed { report, .. } => Some(report),
        }
    }

    fn failure_reason(&self) -> Option<&'static str> {
        match self.kind {
            StartupEventKind::WaitBegin | StartupEventKind::Ready(_) => None,
            StartupEventKind::Failed { failure_reason, .. } => Some(failure_reason),
        }
    }

    fn correlation_parts(&self) -> (Option<&'a str>, Option<&'a str>) {
        self.correlation.map_or((None, None), |correlation| {
            (
                Some(correlation.correlation_type),
                Some(correlation.correlation_id),
            )
        })
    }
}

#[derive(Debug, Clone)]
pub(super) struct OpencodeStartupMetrics {
    total: u64,
    ready: u64,
    failed: u64,
    failed_by_reason: BTreeMap<String, u64>,
    startup_ms_histogram: BTreeMap<String, u64>,
    attempts_histogram: BTreeMap<String, u64>,
}

impl OpencodeStartupMetrics {
    fn default_histogram(buckets: &[&str]) -> BTreeMap<String, u64> {
        buckets
            .iter()
            .map(|bucket| ((*bucket).to_string(), 0))
            .collect()
    }

    fn startup_ms_bucket(startup_ms: u64) -> &'static str {
        if startup_ms <= 100 {
            "<=100"
        } else if startup_ms <= 250 {
            "<=250"
        } else if startup_ms <= 500 {
            "<=500"
        } else if startup_ms <= 1_000 {
            "<=1000"
        } else if startup_ms <= 2_000 {
            "<=2000"
        } else if startup_ms <= 5_000 {
            "<=5000"
        } else {
            ">5000"
        }
    }

    fn attempts_bucket(attempts: u32) -> &'static str {
        if attempts <= 1 {
            "<=1"
        } else if attempts <= 3 {
            "<=3"
        } else if attempts <= 5 {
            "<=5"
        } else if attempts <= 10 {
            "<=10"
        } else if attempts <= 20 {
            "<=20"
        } else {
            ">20"
        }
    }

    fn snapshot(&self) -> OpencodeStartupMetricsSnapshot {
        OpencodeStartupMetricsSnapshot {
            total: self.total,
            ready: self.ready,
            failed: self.failed,
            failed_by_reason: self.failed_by_reason.clone(),
            startup_ms_histogram: self.startup_ms_histogram.clone(),
            attempts_histogram: self.attempts_histogram.clone(),
        }
    }

    fn failure_rate_percent(&self) -> u64 {
        if self.total == 0 {
            return 0;
        }
        ((self.failed * 100) / self.total).min(100)
    }

    fn ensure_histograms_initialized(&mut self) {
        if self.startup_ms_histogram.is_empty() {
            self.startup_ms_histogram = Self::default_histogram(&STARTUP_MS_BUCKETS);
        }
        if self.attempts_histogram.is_empty() {
            self.attempts_histogram = Self::default_histogram(&STARTUP_ATTEMPTS_BUCKETS);
        }
    }

    fn record_terminal(
        &mut self,
        event: &str,
        report: OpencodeStartupWaitReport,
        reason: Option<&str>,
    ) -> (OpencodeStartupMetricsSnapshot, Vec<String>) {
        self.ensure_histograms_initialized();
        self.total += 1;
        if event == "startup_ready" {
            self.ready += 1;
        } else if event == "startup_failed" {
            self.failed += 1;
            let reason_key = reason.unwrap_or("unknown").to_string();
            *self.failed_by_reason.entry(reason_key).or_insert(0) += 1;
        }

        let startup_bucket = Self::startup_ms_bucket(report.startup_ms());
        if let Some(entry) = self.startup_ms_histogram.get_mut(startup_bucket) {
            *entry += 1;
        }
        let attempts_bucket = Self::attempts_bucket(report.attempts());
        if let Some(entry) = self.attempts_histogram.get_mut(attempts_bucket) {
            *entry += 1;
        }

        let mut alerts = Vec::new();
        if report.startup_ms() >= STARTUP_DURATION_WARN_MS {
            alerts.push(format!("startup_duration_high:{}", report.startup_ms()));
        }
        if report.attempts() >= STARTUP_ATTEMPTS_WARN {
            alerts.push(format!("startup_attempts_high:{}", report.attempts()));
        }
        let failure_rate_pct = self.failure_rate_percent();
        if self.total >= STARTUP_FAILURE_RATE_WARN_MIN_SAMPLES
            && failure_rate_pct >= STARTUP_FAILURE_RATE_WARN_PCT
        {
            alerts.push(format!("startup_failure_rate_high:{failure_rate_pct}"));
        }

        (self.snapshot(), alerts)
    }
}

impl Default for OpencodeStartupMetricsSnapshot {
    fn default() -> Self {
        Self {
            total: 0,
            ready: 0,
            failed: 0,
            failed_by_reason: BTreeMap::new(),
            startup_ms_histogram: OpencodeStartupMetrics::default_histogram(&STARTUP_MS_BUCKETS),
            attempts_histogram: OpencodeStartupMetrics::default_histogram(
                &STARTUP_ATTEMPTS_BUCKETS,
            ),
        }
    }
}

impl Default for OpencodeStartupMetrics {
    fn default() -> Self {
        Self {
            total: 0,
            ready: 0,
            failed: 0,
            failed_by_reason: BTreeMap::new(),
            startup_ms_histogram: OpencodeStartupMetrics::default_histogram(&STARTUP_MS_BUCKETS),
            attempts_histogram: OpencodeStartupMetrics::default_histogram(
                &STARTUP_ATTEMPTS_BUCKETS,
            ),
        }
    }
}

pub(crate) fn build_opencode_startup_event_payload(
    event: &str,
    scope: &str,
    repo_path: &str,
    task_id: Option<&str>,
    role: &str,
    port: u16,
    correlation_type: Option<&str>,
    correlation_id: Option<&str>,
    policy: Option<OpencodeStartupReadinessPolicy>,
    report: Option<OpencodeStartupWaitReport>,
    reason: Option<&str>,
    metrics: Option<OpencodeStartupMetricsSnapshot>,
    alerts: Vec<String>,
) -> OpencodeStartupEventPayload {
    let policy_payload = policy.map(|entry| OpencodeStartupPolicyPayload {
        timeout_ms: entry.timeout_ms(),
        connect_timeout_ms: entry.connect_timeout_ms(),
        initial_retry_delay_ms: entry.initial_retry_delay_ms(),
        max_retry_delay_ms: entry.max_retry_delay_ms(),
        child_check_interval_ms: entry.child_state_check_interval_ms(),
    });
    let report_payload = report.map(|entry| OpencodeStartupReportPayload {
        startup_ms: entry.startup_ms(),
        attempts: entry.attempts(),
    });

    OpencodeStartupEventPayload {
        event: event.to_string(),
        scope: scope.to_string(),
        repo_path: repo_path.to_string(),
        task_id: task_id.map(str::to_string),
        role: role.to_string(),
        port,
        correlation_type: correlation_type.map(str::to_string),
        correlation_id: correlation_id.map(str::to_string),
        policy: policy_payload,
        report: report_payload,
        reason: reason.map(str::to_string),
        metrics,
        alerts,
    }
}

impl AppService {
    pub(crate) fn opencode_startup_readiness_policy(
        &self,
    ) -> Result<OpencodeStartupReadinessPolicy> {
        let config = self.config_store.opencode_startup_readiness().with_context(|| {
            format!(
                "Failed loading OpenCode startup readiness config from {}. Fix invalid JSON in this file or delete it so OpenDucktor can recreate defaults.",
                self.config_store.path().display()
            )
        })?;
        Ok(OpencodeStartupReadinessPolicy::from_config(config))
    }

    pub(crate) fn startup_cancel_epoch(&self) -> StartupCancelEpoch {
        Arc::clone(&self.startup_cancel_epoch)
    }

    pub(crate) fn startup_cancel_snapshot(&self) -> u64 {
        self.startup_cancel_epoch.load(Ordering::SeqCst)
    }

    #[cfg(test)]
    pub(crate) fn startup_metrics_snapshot(&self) -> Result<OpencodeStartupMetricsSnapshot> {
        let metrics = self
            .startup_metrics
            .lock()
            .map_err(|_| anyhow!("OpenCode startup metrics lock poisoned"))?;
        Ok(metrics.snapshot())
    }

    pub(crate) fn emit_opencode_startup_event(&self, event: StartupEventPayload<'_>) {
        let event_name = event.event_name();
        let runtime_type = event.runtime_type;
        let repo_path = event.repo_path;
        let task_id = event.task_id;
        let role = event.role;
        let port = event.port;
        let policy = event.policy;
        let report = event.report();
        let failure_reason = event.failure_reason();
        let (correlation_type, correlation_id) = event.correlation_parts();

        let (metrics, alerts) = match report {
            Some(report) if matches!(event_name, "startup_ready" | "startup_failed") => {
                match self.startup_metrics.lock() {
                    Ok(mut metrics) => metrics.record_terminal(event_name, report, failure_reason),
                    Err(_) => {
                        tracing::warn!(
                            target: "openducktor.opencode.startup",
                            event = event_name,
                            scope = runtime_type,
                            repo_path,
                            "OpenCode startup metrics lock poisoned; continuing without metrics"
                        );
                        (OpencodeStartupMetricsSnapshot::default(), Vec::new())
                    }
                }
            }
            _ => (OpencodeStartupMetricsSnapshot::default(), Vec::new()),
        };
        let include_metrics = matches!(event_name, "startup_ready" | "startup_failed");
        let payload = build_opencode_startup_event_payload(
            event_name,
            runtime_type,
            repo_path,
            task_id,
            role,
            port,
            correlation_type,
            correlation_id,
            policy,
            report,
            failure_reason,
            include_metrics.then_some(metrics),
            alerts.clone(),
        );
        let payload_json = serde_json::to_string(&payload)
            .unwrap_or_else(|_| "{\"serializationError\":\"startup-event\"}".to_string());
        let startup_ms = report.map(|entry| entry.startup_ms()).unwrap_or_default();
        let attempts = report.map(|entry| entry.attempts()).unwrap_or_default();
        tracing::info!(
            target: "openducktor.opencode.startup",
            event = event_name,
            scope = runtime_type,
            repo_path,
            task_id = task_id.unwrap_or(""),
            role,
            port,
            correlation_type = correlation_type.unwrap_or(""),
            correlation_id = correlation_id.unwrap_or(""),
            reason = failure_reason.unwrap_or(""),
            startup_ms,
            attempts,
            payload = %payload_json,
        );
        for alert in alerts {
            tracing::warn!(
                target: "openducktor.opencode.startup.alert",
                alert = %alert,
                event = event_name,
                scope = runtime_type,
                repo_path,
                task_id = task_id.unwrap_or(""),
                role,
                port,
                correlation_type = correlation_type.unwrap_or(""),
                correlation_id = correlation_id.unwrap_or(""),
                reason = failure_reason.unwrap_or(""),
                startup_ms,
                attempts,
                "OpenCode startup threshold exceeded"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn test_startup_policy() -> OpencodeStartupReadinessPolicy {
        OpencodeStartupReadinessPolicy {
            timeout: Duration::from_millis(8_000),
            connect_timeout: Duration::from_millis(250),
            initial_retry_delay: Duration::from_millis(25),
            max_retry_delay: Duration::from_millis(250),
            child_state_check_interval: Duration::from_millis(100),
        }
    }

    fn test_startup_report() -> OpencodeStartupWaitReport {
        OpencodeStartupWaitReport::from_parts(5, Duration::from_millis(420))
    }

    #[test]
    fn startup_event_payload_wait_begin_has_no_terminal_fields() {
        let event = StartupEventPayload::wait_begin(
            "agent_runtime",
            "/tmp/repo",
            Some("task-42"),
            "qa",
            4242,
            Some(StartupEventCorrelation::new("runtime_id", "runtime-abc")),
            Some(test_startup_policy()),
        );

        assert_eq!(event.event_name(), "startup_wait_begin");
        assert!(event.report().is_none());
        assert_eq!(event.failure_reason(), None);
        assert_eq!(
            event.correlation_parts(),
            (Some("runtime_id"), Some("runtime-abc"))
        );
    }

    #[test]
    fn startup_event_payload_failed_requires_reason_with_report() {
        let report = test_startup_report();
        let event = StartupEventPayload::failed(
            "agent_runtime",
            "/tmp/repo",
            Some("task-42"),
            "qa",
            4242,
            Some(StartupEventCorrelation::new("runtime_id", "runtime-abc")),
            Some(test_startup_policy()),
            report,
            "timeout",
        );

        assert_eq!(event.event_name(), "startup_failed");
        let emitted_report = event.report().expect("failed event should carry report");
        assert_eq!(emitted_report.startup_ms(), report.startup_ms());
        assert_eq!(emitted_report.attempts(), report.attempts());
        assert_eq!(event.failure_reason(), Some("timeout"));
        assert_eq!(
            event.correlation_parts(),
            (Some("runtime_id"), Some("runtime-abc"))
        );
    }
}
