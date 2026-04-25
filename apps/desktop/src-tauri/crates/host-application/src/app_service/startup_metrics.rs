use super::*;

const STARTUP_DURATION_WARN_MS: u64 = 5_000;
const STARTUP_ATTEMPTS_WARN: u32 = 20;
const STARTUP_FAILURE_RATE_WARN_MIN_SAMPLES: u64 = 10;
const STARTUP_FAILURE_RATE_WARN_PCT: u64 = 30;
const STARTUP_MS_BUCKETS: [&str; 7] = [
    "<=100", "<=250", "<=500", "<=1000", "<=2000", "<=5000", ">5000",
];
const STARTUP_ATTEMPTS_BUCKETS: [&str; 6] = ["<=1", "<=3", "<=5", "<=10", "<=20", ">20"];
pub(crate) const STARTUP_CONFIG_INVALID_REASON: RuntimeStartupFailureReason =
    RuntimeStartupFailureReason::StartupConfigInvalid;

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
    port: Option<u16>,
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
pub(crate) struct StartupEventContext<'a> {
    runtime_type: &'a str,
    repo_path: &'a str,
    task_id: Option<&'a str>,
    role: &'a str,
    port: Option<u16>,
    correlation: Option<StartupEventCorrelation<'a>>,
    policy: Option<RuntimeStartupReadinessPolicy>,
}

impl<'a> StartupEventContext<'a> {
    pub(crate) const fn new(
        runtime_type: &'a str,
        repo_path: &'a str,
        task_id: Option<&'a str>,
        role: &'a str,
        port: Option<u16>,
        correlation: Option<StartupEventCorrelation<'a>>,
        policy: Option<RuntimeStartupReadinessPolicy>,
    ) -> Self {
        Self {
            runtime_type,
            repo_path,
            task_id,
            role,
            port,
            correlation,
            policy,
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum StartupEventKind {
    WaitBegin,
    Ready(RuntimeStartupWaitReport),
    Failed {
        report: RuntimeStartupWaitReport,
        failure_reason: RuntimeStartupFailureReason,
    },
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct StartupEventPayload<'a> {
    context: StartupEventContext<'a>,
    kind: StartupEventKind,
}

impl<'a> StartupEventPayload<'a> {
    pub(crate) fn wait_begin(context: StartupEventContext<'a>) -> Self {
        Self {
            context,
            kind: StartupEventKind::WaitBegin,
        }
    }

    pub(crate) fn ready(
        context: StartupEventContext<'a>,
        report: RuntimeStartupWaitReport,
    ) -> Self {
        Self {
            context,
            kind: StartupEventKind::Ready(report),
        }
    }

    pub(crate) fn failed(
        context: StartupEventContext<'a>,
        report: RuntimeStartupWaitReport,
        failure_reason: RuntimeStartupFailureReason,
    ) -> Self {
        Self {
            context,
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

    fn report(&self) -> Option<RuntimeStartupWaitReport> {
        match self.kind {
            StartupEventKind::WaitBegin => None,
            StartupEventKind::Ready(report) => Some(report),
            StartupEventKind::Failed { report, .. } => Some(report),
        }
    }

    fn failure_reason(&self) -> Option<RuntimeStartupFailureReason> {
        match self.kind {
            StartupEventKind::WaitBegin | StartupEventKind::Ready(_) => None,
            StartupEventKind::Failed { failure_reason, .. } => Some(failure_reason),
        }
    }

    fn correlation_parts(&self) -> (Option<&'a str>, Option<&'a str>) {
        self.context
            .correlation
            .map_or((None, None), |correlation| {
                (
                    Some(correlation.correlation_type),
                    Some(correlation.correlation_id),
                )
            })
    }

    fn human_log_message(&self) -> &'static str {
        match self.kind {
            StartupEventKind::WaitBegin => "OpenCode runtime startup: waiting for readiness",
            StartupEventKind::Ready(_) => "OpenCode runtime startup: ready",
            StartupEventKind::Failed { .. } => "OpenCode runtime startup: failed",
        }
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
        report: RuntimeStartupWaitReport,
        reason: Option<RuntimeStartupFailureReason>,
    ) -> (OpencodeStartupMetricsSnapshot, Vec<String>) {
        self.ensure_histograms_initialized();
        self.total += 1;
        if event == "startup_ready" {
            self.ready += 1;
        } else if event == "startup_failed" {
            self.failed += 1;
            let reason_key = reason
                .map(|entry| entry.as_str().to_string())
                .unwrap_or_else(|| "unknown".to_string());
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
    event: &StartupEventPayload<'_>,
    metrics: Option<OpencodeStartupMetricsSnapshot>,
    alerts: Vec<String>,
) -> OpencodeStartupEventPayload {
    let event_name = event.event_name();
    let report = event.report();
    let reason = event.failure_reason();
    let (correlation_type, correlation_id) = event.correlation_parts();
    let policy_payload = event
        .context
        .policy
        .map(|entry| OpencodeStartupPolicyPayload {
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
        event: event_name.to_string(),
        scope: event.context.runtime_type.to_string(),
        repo_path: event.context.repo_path.to_string(),
        task_id: event.context.task_id.map(str::to_string),
        role: event.context.role.to_string(),
        port: event.context.port,
        correlation_type: correlation_type.map(str::to_string),
        correlation_id: correlation_id.map(str::to_string),
        policy: policy_payload,
        report: report_payload,
        reason: reason.map(|entry| entry.as_str().to_string()),
        metrics,
        alerts,
    }
}

impl AppService {
    #[cfg(test)]
    pub(crate) fn opencode_startup_readiness_policy(
        &self,
    ) -> Result<RuntimeStartupReadinessPolicy> {
        self.runtime_registry
            .runtime(&host_domain::AgentRuntimeKind::opencode())?
            .startup_policy(self)
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
        let runtime_type = event.context.runtime_type;
        let repo_path = event.context.repo_path;
        let task_id = event.context.task_id;
        let role = event.context.role;
        let port = event.context.port;
        let report = event.report();
        let failure_reason = event.failure_reason();
        let (_correlation_type, _correlation_id) = event.correlation_parts();

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
        let startup_ms = report.map(|entry| entry.startup_ms()).unwrap_or_default();
        let attempts = report.map(|entry| entry.attempts()).unwrap_or_default();
        let include_metrics = matches!(event_name, "startup_ready" | "startup_failed");
        let _payload = build_opencode_startup_event_payload(
            &event,
            include_metrics.then_some(metrics),
            alerts.clone(),
        );
        let task_label = task_id.unwrap_or("workspace");
        let port_label = port
            .map(|port| port.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        match event_name {
            "startup_wait_begin" => tracing::info!(
                target: "openducktor.opencode.startup",
                "{} for task {task_label} ({role}) at http://127.0.0.1:{port_label} in {repo_path}",
                event.human_log_message()
            ),
            "startup_ready" => tracing::info!(
                target: "openducktor.opencode.startup",
                "{} for task {task_label} ({role}) after {startup_ms}ms and {attempts} checks at http://127.0.0.1:{port_label}",
                event.human_log_message()
            ),
            "startup_failed" => tracing::error!(
                target: "openducktor.opencode.startup",
                "{} for task {task_label} ({role}) after {startup_ms}ms and {attempts} checks: {}",
                event.human_log_message(),
                failure_reason
                    .map(|entry| entry.as_str())
                    .unwrap_or("unknown reason")
            ),
            _ => tracing::info!(
                target: "openducktor.opencode.startup",
                "OpenCode runtime startup event {event_name} for task {task_label} ({role})"
            ),
        }
        for alert in alerts {
            tracing::warn!(
                target: "openducktor.opencode.startup.alert",
                "OpenCode startup threshold exceeded for task {task_label} ({role}): {alert}"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn test_startup_policy() -> RuntimeStartupReadinessPolicy {
        RuntimeStartupReadinessPolicy {
            timeout: Duration::from_millis(8_000),
            connect_timeout: Duration::from_millis(250),
            initial_retry_delay: Duration::from_millis(25),
            max_retry_delay: Duration::from_millis(250),
            child_state_check_interval: Duration::from_millis(100),
        }
    }

    fn test_startup_report() -> RuntimeStartupWaitReport {
        RuntimeStartupWaitReport::from_parts(5, Duration::from_millis(420))
    }

    #[test]
    fn startup_event_payload_wait_begin_has_no_terminal_fields() {
        let event = StartupEventPayload::wait_begin(StartupEventContext::new(
            "agent_runtime",
            "/tmp/repo",
            Some("task-42"),
            "qa",
            Some(4242),
            Some(StartupEventCorrelation::new("runtime_id", "runtime-abc")),
            Some(test_startup_policy()),
        ));

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
            StartupEventContext::new(
                "agent_runtime",
                "/tmp/repo",
                Some("task-42"),
                "qa",
                Some(4242),
                Some(StartupEventCorrelation::new("runtime_id", "runtime-abc")),
                Some(test_startup_policy()),
            ),
            report,
            RuntimeStartupFailureReason::Timeout,
        );

        assert_eq!(event.event_name(), "startup_failed");
        let emitted_report = event.report().expect("failed event should carry report");
        assert_eq!(emitted_report.startup_ms(), report.startup_ms());
        assert_eq!(emitted_report.attempts(), report.attempts());
        assert_eq!(
            event.failure_reason(),
            Some(RuntimeStartupFailureReason::Timeout)
        );
        assert_eq!(
            event.correlation_parts(),
            (Some("runtime_id"), Some("runtime-abc"))
        );
    }
}
