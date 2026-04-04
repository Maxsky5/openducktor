use super::policy::{
    startup_wait_failure, startup_wait_report, OpencodeStartupReadinessPolicy,
    OpencodeStartupWaitFailure, OpencodeStartupWaitReport, StartupCancelEpoch,
};
use super::probe_runtime::{LocalServerProbe, LocalServerProbeEvent, LocalServerProbeState};
#[cfg(test)]
use anyhow::{anyhow, Context, Result};
use std::io::Read;
use std::net::SocketAddr;
use std::process::Child;
use std::sync::{mpsc, Arc};
use std::time::Instant;

#[cfg(test)]
use std::time::Duration;

fn read_child_pipe(pipe: &mut Option<impl Read>) -> String {
    let Some(mut reader) = pipe.take() else {
        return String::new();
    };
    let mut output = String::new();
    let _ = reader.read_to_string(&mut output);
    output.trim().to_string()
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct StartupWaitProgress {
    pub(crate) report: OpencodeStartupWaitReport,
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
    let cancel_epoch = Arc::new(std::sync::atomic::AtomicU64::new(0));
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
    mut on_progress: impl FnMut(StartupWaitProgress),
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
    on_progress(StartupWaitProgress {
        report: startup_wait_report(started_at, 0),
    });

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
            Err(mpsc::RecvTimeoutError::Timeout) => {
                on_progress(StartupWaitProgress {
                    report: startup_wait_report(started_at, probe.attempts()),
                });
            }
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
