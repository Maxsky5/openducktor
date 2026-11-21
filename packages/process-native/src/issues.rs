//! Turns system errors into the issue and outcome texts that the host shows. Every platform reports
//! its failures as `io::Error`, so the texts carry the system message, such as "Access is denied."

use crate::model::{NativeStopOutcome, StopOutcomeKind};
use std::io;

/// True when the system refused the read or the signal for lack of permission.
pub(crate) fn is_denied(error: &io::Error) -> bool {
  error.kind() == io::ErrorKind::PermissionDenied
}

/// The issue of a failed read of the directory, executable, or arguments of a process.
pub(crate) fn read_issue(error: &io::Error) -> String {
  if is_denied(error) {
    "The system denied access to the process details.".to_string()
  } else {
    format!("The process details could not be read: {error}")
  }
}

/// The issue of a failed read of the ports of a process.
pub(crate) fn listener_issue(error: &io::Error) -> String {
  if is_denied(error) {
    "The system denied access to the process ports.".to_string()
  } else {
    format!("The process ports could not be read: {error}")
  }
}

/// The issue when the system did not list the listening ports of all processes.
#[cfg(any(target_os = "linux", windows))]
pub(crate) fn port_list_issue(error: &io::Error) -> String {
  format!("The system did not list listening ports: {error}")
}

/// The outcome of a stop that the system refused or that failed.
pub(crate) fn stop_failure(error: &io::Error) -> NativeStopOutcome {
  if is_denied(error) {
    NativeStopOutcome::with(
      StopOutcomeKind::Denied,
      "The system denied the stop request for this process.",
    )
  } else {
    NativeStopOutcome::with(StopOutcomeKind::Failed, format!("The stop request failed: {error}"))
  }
}

/// The outcome when the exit of a signaled process could not be watched.
pub(crate) fn unobserved_exit(error: &io::Error) -> NativeStopOutcome {
  NativeStopOutcome::with(
    StopOutcomeKind::Unconfirmed,
    format!("The process exit could not be observed: {error}"),
  )
}

/// The outcome when the time limit passed and the process still runs.
pub(crate) fn still_running() -> NativeStopOutcome {
  NativeStopOutcome::with(
    StopOutcomeKind::StillRunning,
    "The process is still running after the stop request.",
  )
}

#[cfg(test)]
mod tests {
  use super::{read_issue, stop_failure};
  use crate::model::StopOutcomeKind;
  use std::io;

  #[test]
  fn a_denied_error_gives_the_denied_texts() {
    let denied = io::Error::from(io::ErrorKind::PermissionDenied);
    assert_eq!(read_issue(&denied), "The system denied access to the process details.");
    assert_eq!(stop_failure(&denied).kind, StopOutcomeKind::Denied);
  }

  #[test]
  fn another_error_keeps_the_system_message() {
    let error = io::Error::other("disk gone");
    assert_eq!(read_issue(&error), "The process details could not be read: disk gone");
    assert_eq!(
      stop_failure(&error).message.as_deref(),
      Some("The stop request failed: disk gone")
    );
  }
}
