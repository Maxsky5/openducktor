//! The values that cross the Node-API boundary. JavaScript gets the fields in camel case and
//! omits each field whose value is `None`. `src/index.ts` declares the same shapes.

use napi_derive::napi;
use std::net::IpAddr;

/// One live process. `identity` is a lossless decimal value that is unique for the process
/// instance while the system runs: the Linux start time, the macOS unique ID, or the Windows
/// creation time.
#[napi(object)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeProcess {
  pub pid: u32,
  pub parent_pid: u32,
  pub identity: String,
  pub name: String,
  pub cwd: Option<String>,
  pub executable: Option<String>,
  pub arguments: Option<Vec<String>>,
  /// The reason when the system denied a read of the directory, executable, or arguments.
  pub issue: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct NativeProcessTarget {
  pub pid: u32,
  pub identity: String,
}

#[napi(object)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeListener {
  pub address: String,
  pub port: u32,
}

#[napi(object)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeInspection {
  pub pid: u32,
  pub identity: String,
  /// False when the instance exited before or during the read.
  pub live: bool,
  /// Absent when the listener read failed. `listener_issue` gives the reason.
  pub listeners: Option<Vec<NativeListener>>,
  pub listener_issue: Option<String>,
  /// True when the host account may signal or terminate the instance.
  pub can_stop: bool,
}

/// The standard input of a process instance.
#[napi(object)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeStandardInput {
  pub pid: u32,
  pub identity: String,
  /// False when the instance exited before or during the read.
  pub live: bool,
  /// Absent when the process has no standard input or when the read failed.
  pub kind: Option<InputKind>,
  /// The PID that serves the pipe, on Windows only.
  pub server_pid: Option<u32>,
  pub issue: Option<String>,
}

/// What the standard input of a process reads from.
#[napi(string_enum = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InputKind {
  /// A pipe or a socket, such as the stdio channel of an MCP or language server.
  Pipe,
  /// Anything else, such as `/dev/null`, a terminal, or a file.
  Other,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct NativeStopRequest {
  pub pid: u32,
  pub identity: String,
  /// The directory or executable path that ties the process to its checkout.
  pub evidence_kind: EvidenceKind,
  pub evidence_path: String,
  pub timeout_ms: u32,
  /// Allows a PID signal on a system without instance-bound signals.
  pub allow_pid_signal: bool,
}

#[napi(string_enum = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EvidenceKind {
  Cwd,
  Executable,
}

#[napi(string_enum = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StopOutcomeKind {
  Stopped,
  AlreadyExited,
  Changed,
  Denied,
  Failed,
  AcknowledgmentRequired,
  StillRunning,
  Unconfirmed,
}

#[napi(object)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeStopOutcome {
  pub kind: StopOutcomeKind,
  pub message: Option<String>,
}

/// How a stop finds its process: by the exact instance, or by the PID after a final check.
#[napi(string_enum = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StopMode {
  Instance,
  Pid,
}

impl NativeListener {
  pub(crate) fn new(address: IpAddr, port: u16) -> Self {
    Self {
      address: address.to_string(),
      port: u32::from(port),
    }
  }

  /// Adds the listener once. A process can hold several descriptors of one socket.
  pub(crate) fn add_to(self, listeners: &mut Vec<NativeListener>) {
    if !listeners.contains(&self) {
      listeners.push(self);
    }
  }
}

impl NativeInspection {
  /// The inspection of an instance that no longer runs.
  pub(crate) fn gone(target: &NativeProcessTarget) -> Self {
    Self {
      pid: target.pid,
      identity: target.identity.clone(),
      live: false,
      listeners: None,
      listener_issue: None,
      can_stop: false,
    }
  }
}

impl NativeStandardInput {
  /// The input read of an instance that no longer runs.
  pub(crate) fn gone(target: &NativeProcessTarget) -> Self {
    Self {
      pid: target.pid,
      identity: target.identity.clone(),
      live: false,
      kind: None,
      server_pid: None,
      issue: None,
    }
  }
}

impl NativeStopOutcome {
  pub(crate) fn of(kind: StopOutcomeKind) -> Self {
    Self { kind, message: None }
  }

  pub(crate) fn with(kind: StopOutcomeKind, message: impl Into<String>) -> Self {
    Self {
      kind,
      message: Some(message.into()),
    }
  }
}

impl NativeStopRequest {
  pub(crate) fn uses_cwd(&self) -> bool {
    self.evidence_kind == EvidenceKind::Cwd
  }

  /// The outcome when the evidence of the request no longer matches the process.
  pub(crate) fn evidence_changed(&self) -> NativeStopOutcome {
    let message = if self.uses_cwd() {
      "The process moved to another directory."
    } else {
      "The process now runs another executable."
    };
    NativeStopOutcome::with(StopOutcomeKind::Changed, message)
  }
}
