//! The parts that Linux and macOS share: checked PIDs, the list loop over a `ProcessSource`, the
//! cache of the details that stay fixed while an instance runs, and the inspection order.

#[cfg(target_os = "linux")]
pub(crate) mod linux;
#[cfg(target_os = "macos")]
pub(crate) mod macos;

use crate::issues::{read_issue, stop_failure};
use crate::model::{
  InputKind, NativeInspection, NativeListener, NativeProcess, NativeProcessTarget, NativeStandardInput,
  NativeStopOutcome, StopOutcomeKind,
};
use std::collections::HashMap;
use std::io;
use std::sync::{LazyLock, Mutex, PoisonError};

/// A PID that the process calls accept: positive and inside `pid_t`. `kill` treats zero and
/// negative values as process groups, so no other value reaches a signal.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) struct Pid(libc::pid_t);

impl Pid {
  pub(crate) fn new(pid: u32) -> Option<Self> {
    libc::pid_t::try_from(pid).ok().filter(|pid| *pid > 0).map(Self)
  }

  pub(crate) fn raw(self) -> libc::pid_t {
    self.0
  }

  pub(crate) fn number(self) -> u32 {
    self.0.unsigned_abs()
  }
}

impl std::fmt::Display for Pid {
  fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    self.0.fmt(formatter)
  }
}

/// True when the error says that the process or the read item no longer exists.
pub(crate) fn is_gone(error: &io::Error) -> bool {
  matches!(error.raw_os_error(), Some(libc::ESRCH | libc::ENOENT))
}

/// The outcome of a stop whose read or signal failed. A process that exited meanwhile is no failure.
pub(crate) fn stop_outcome(error: &io::Error) -> NativeStopOutcome {
  if is_gone(error) {
    NativeStopOutcome::of(StopOutcomeKind::AlreadyExited)
  } else {
    stop_failure(error)
  }
}

/// True when the host account may signal the process. Signal 0 checks permission only.
pub(crate) fn can_signal(pid: Pid) -> bool {
  // SAFETY: `kill` reads no memory, `pid` is positive, and signal 0 sends nothing.
  unsafe { libc::kill(pid.raw(), 0) == 0 }
}

/// The facts of a process that tell its instance apart.
pub(crate) struct Snapshot {
  pub(crate) parent_pid: u32,
  /// The Linux start time or the macOS unique ID.
  pub(crate) identity: u64,
  pub(crate) name: String,
  /// A value that changes when the instance runs another program after `exec`, also one with the
  /// same name: the macOS PID version. `None` where the system has no such value, as on Linux, so
  /// the list reads the executable and the arguments each time.
  pub(crate) program: Option<u64>,
}

/// The system reads that a process list needs. `Ok(None)` means that the process or the item does
/// not exist, such as the executable of a kernel thread.
pub(crate) trait ProcessSource {
  fn pids(&mut self) -> io::Result<Vec<Pid>>;
  /// `Ok(None)` also for a zombie, which no longer runs.
  fn snapshot(&mut self, pid: Pid) -> io::Result<Option<Snapshot>>;
  fn cwd(&mut self, pid: Pid) -> io::Result<Option<String>>;
  fn executable(&mut self, pid: Pid) -> io::Result<Option<String>>;
  fn arguments(&mut self, pid: Pid) -> io::Result<Option<Vec<String>>>;
}

/// The value of one read. A missing item or an exited process gives none. Any other failure records
/// the first issue of the process.
fn keep<T>(issue: &mut Option<String>, result: io::Result<Option<T>>) -> Option<T> {
  match result {
    Ok(value) => value,
    Err(error) if is_gone(&error) => None,
    Err(error) => {
      issue.get_or_insert_with(|| read_issue(&error));
      None
    }
  }
}

/// The details of a process instance that a list reads once: its executable and its arguments,
/// with the reason when a read failed. They stay the same while the instance runs one program.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FixedDetails {
  executable: Option<String>,
  arguments: Option<Vec<String>>,
  issue: Option<String>,
}

struct CachedDetails {
  program: u64,
  details: FixedDetails,
  seen: bool,
}

/// The fixed details of the instances of the last list, by PID and identity.
#[derive(Default)]
pub(crate) struct FixedDetailsCache(HashMap<(Pid, u64), CachedDetails>);

impl FixedDetailsCache {
  fn get_or_read(&mut self, pid: Pid, snapshot: &Snapshot, read: impl FnOnce() -> FixedDetails) -> FixedDetails {
    let Some(program) = snapshot.program else {
      return read();
    };
    match self.0.get_mut(&(pid, snapshot.identity)) {
      Some(cached) if cached.program == program => {
        cached.seen = true;
        cached.details.clone()
      }
      _ => {
        let details = read();
        let cached = CachedDetails {
          program,
          details: details.clone(),
          seen: true,
        };
        self.0.insert((pid, snapshot.identity), cached);
        details
      }
    }
  }

  /// Forgets the instances that the list did not see, and starts the next list.
  fn keep_seen(&mut self) {
    self.0.retain(|_, cached| std::mem::take(&mut cached.seen));
  }
}

/// Lists the processes of `source`. The working directory is read on every list, because a
/// process can change it. The executable and the arguments come from `cache` when the list before
/// saw the instance.
pub(crate) fn list_processes_with(
  source: &mut impl ProcessSource,
  cache: &mut FixedDetailsCache,
) -> io::Result<Vec<NativeProcess>> {
  let pids = source.pids()?;
  let mut processes = Vec::with_capacity(pids.len());
  for pid in pids {
    let Ok(Some(snapshot)) = source.snapshot(pid) else {
      continue;
    };
    let mut issue = None;
    let cwd = keep(&mut issue, source.cwd(pid));
    let details = cache.get_or_read(pid, &snapshot, || {
      let mut issue = None;
      let executable = keep(&mut issue, source.executable(pid));
      let arguments = keep(&mut issue, source.arguments(pid));
      FixedDetails {
        executable,
        arguments,
        issue,
      }
    });
    // Another identity means that the PID now belongs to another instance during the reads.
    match source.snapshot(pid) {
      Ok(Some(after)) if after.identity == snapshot.identity => {}
      _ => continue,
    }
    processes.push(NativeProcess {
      pid: pid.number(),
      parent_pid: snapshot.parent_pid,
      identity: snapshot.identity.to_string(),
      name: snapshot.name,
      cwd,
      executable: details.executable,
      arguments: details.arguments,
      issue: issue.or(details.issue),
    });
  }
  cache.keep_seen();
  Ok(processes)
}

#[cfg(all(test, target_os = "linux"))]
use linux::{list_processes as platform_list, read_standard_inputs as platform_inputs};
#[cfg(all(test, target_os = "macos"))]
use macos::{list_processes as platform_list, read_standard_inputs as platform_inputs};

/// Lists the processes of `source` with the cache of this module. Two lists at the same time take
/// turns, so each one sees the whole cache.
pub(crate) fn list_processes(source: &mut impl ProcessSource) -> io::Result<Vec<NativeProcess>> {
  static CACHE: LazyLock<Mutex<FixedDetailsCache>> = LazyLock::new(Mutex::default);
  // A panic during a list leaves only whole entries, so the cache stays usable.
  let mut cache = CACHE.lock().unwrap_or_else(PoisonError::into_inner);
  list_processes_with(source, &mut cache)
}

/// Reads the standard input of one instance. It reads the identity before and after, so a PID
/// that another process took during the read reports the instance as gone.
pub(crate) fn read_standard_input(
  target: &NativeProcessTarget,
  same_instance: impl Fn(Pid, u64) -> bool,
  read_kind: impl FnOnce(Pid) -> io::Result<Option<InputKind>>,
) -> NativeStandardInput {
  let gone = NativeStandardInput::gone(target);
  let (Some(pid), Ok(identity)) = (Pid::new(target.pid), target.identity.parse::<u64>()) else {
    return gone;
  };
  if !same_instance(pid, identity) {
    return gone;
  }
  let kind = read_kind(pid);
  if !same_instance(pid, identity) {
    return gone;
  }
  match kind {
    Ok(kind) => NativeStandardInput {
      live: true,
      kind,
      ..gone
    },
    Err(error) => NativeStandardInput {
      live: true,
      issue: Some(format!("The process input could not be read: {error}")),
      ..gone
    },
  }
}

/// Inspects one instance. It reads the identity before and after the listener and permission
/// reads, so a PID that another process took during the reads reports the instance as gone.
pub(crate) fn inspect_instance(
  target: &NativeProcessTarget,
  same_instance: impl Fn(Pid, u64) -> bool,
  read_listeners: impl FnOnce(Pid) -> Result<Vec<NativeListener>, String>,
) -> NativeInspection {
  let gone = NativeInspection::gone(target);
  let (Some(pid), Ok(identity)) = (Pid::new(target.pid), target.identity.parse::<u64>()) else {
    return gone;
  };
  if !same_instance(pid, identity) {
    return gone;
  }
  let listeners = read_listeners(pid);
  let can_stop = can_signal(pid);
  if !same_instance(pid, identity) {
    return gone;
  }
  let (listeners, listener_issue) = match listeners {
    Ok(listeners) => (Some(listeners), None),
    Err(issue) => (None, Some(issue)),
  };
  NativeInspection {
    live: true,
    listeners,
    listener_issue,
    can_stop,
    ..gone
  }
}

#[cfg(test)]
mod tests {
  use super::{FixedDetailsCache, Pid, ProcessSource, Snapshot, inspect_instance, list_processes_with};
  use crate::model::{NativeListener, NativeProcessTarget};
  use std::cell::Cell;
  use std::collections::HashMap;
  use std::io;
  use std::net::IpAddr;

  #[derive(Clone)]
  struct FakeProcess {
    identity: u64,
    name: &'static str,
    cwd: Result<&'static str, i32>,
    arguments: Vec<&'static str>,
    /// The identity that the second snapshot reads, such as after a PID reuse.
    identity_after: Option<u64>,
    /// The program version, which a new program after `exec` changes.
    program: Option<u64>,
  }

  #[derive(Default)]
  struct FakeSource {
    processes: HashMap<u32, FakeProcess>,
    snapshots: HashMap<u32, u32>,
    argument_reads: u32,
  }

  impl FakeSource {
    fn with(processes: &[(u32, FakeProcess)]) -> Self {
      Self {
        processes: processes.iter().cloned().collect(),
        ..Self::default()
      }
    }
  }

  fn process(identity: u64, name: &'static str) -> FakeProcess {
    FakeProcess {
      identity,
      name,
      cwd: Ok("/work"),
      arguments: vec![name, "dev"],
      identity_after: None,
      program: Some(1),
    }
  }

  impl ProcessSource for FakeSource {
    fn pids(&mut self) -> io::Result<Vec<Pid>> {
      let mut pids: Vec<Pid> = self.processes.keys().filter_map(|pid| Pid::new(*pid)).collect();
      pids.sort_by_key(|pid| pid.number());
      Ok(pids)
    }

    fn snapshot(&mut self, pid: Pid) -> io::Result<Option<Snapshot>> {
      let reads = self.snapshots.entry(pid.number()).or_default();
      *reads += 1;
      Ok(self.processes.get(&pid.number()).map(|process| Snapshot {
        parent_pid: 1,
        identity: if *reads > 1 {
          process.identity_after.unwrap_or(process.identity)
        } else {
          process.identity
        },
        name: process.name.to_string(),
        program: process.program,
      }))
    }

    fn cwd(&mut self, pid: Pid) -> io::Result<Option<String>> {
      let process = &self.processes[&pid.number()];
      process
        .cwd
        .map(|cwd| Some(cwd.to_string()))
        .map_err(io::Error::from_raw_os_error)
    }

    fn executable(&mut self, pid: Pid) -> io::Result<Option<String>> {
      Ok(Some(format!("/bin/{}", self.processes[&pid.number()].name)))
    }

    fn arguments(&mut self, pid: Pid) -> io::Result<Option<Vec<String>>> {
      self.argument_reads += 1;
      let arguments = &self.processes[&pid.number()].arguments;
      Ok(Some(arguments.iter().map(ToString::to_string).collect()))
    }
  }

  #[test]
  fn tells_a_pipe_input_from_a_null_input() {
    use crate::model::InputKind;
    use std::process::{Command, Stdio};
    let read = |stdin: Stdio| {
      let mut child = Command::new("sleep").arg("5").stdin(stdin).spawn().unwrap();
      let listed = super::platform_list().unwrap();
      let entry = listed.iter().find(|process| process.pid == child.id()).unwrap();
      let target = NativeProcessTarget {
        pid: entry.pid,
        identity: entry.identity.clone(),
      };
      let input = super::platform_inputs(&[target]).remove(0);
      child.kill().unwrap();
      child.wait().unwrap();
      input
    };
    let piped = read(Stdio::piped());
    assert!(piped.live);
    assert_eq!(piped.kind, Some(InputKind::Pipe));
    assert_eq!(read(Stdio::null()).kind, Some(InputKind::Other));
  }

  #[test]
  fn rejects_pids_that_address_a_group() {
    assert_eq!(Pid::new(0), None);
    assert_eq!(Pid::new(u32::MAX), None);
    assert_eq!(Pid::new(42).map(Pid::number), Some(42));
  }

  #[test]
  fn lists_processes_with_their_details() {
    let mut source = FakeSource::with(&[(10, process(100, "node"))]);
    let processes = list_processes_with(&mut source, &mut FixedDetailsCache::default()).unwrap();
    assert_eq!(processes.len(), 1);
    assert_eq!(processes[0].identity, "100");
    assert_eq!(processes[0].cwd.as_deref(), Some("/work"));
    assert_eq!(processes[0].executable.as_deref(), Some("/bin/node"));
    assert_eq!(
      processes[0].arguments,
      Some(vec!["node".to_string(), "dev".to_string()])
    );
  }

  #[test]
  fn skips_a_pid_that_another_instance_took_during_the_reads() {
    let reused = FakeProcess {
      identity_after: Some(200),
      ..process(100, "node")
    };
    let mut source = FakeSource::with(&[(10, reused), (11, process(110, "vite"))]);
    let processes = list_processes_with(&mut source, &mut FixedDetailsCache::default()).unwrap();
    assert_eq!(processes.iter().map(|process| process.pid).collect::<Vec<_>>(), [11]);
  }

  #[test]
  fn records_a_denied_read_and_ignores_a_missing_item() {
    let denied = FakeProcess {
      cwd: Err(libc::EACCES),
      ..process(100, "node")
    };
    let missing = FakeProcess {
      cwd: Err(libc::ENOENT),
      ..process(110, "vite")
    };
    let mut source = FakeSource::with(&[(10, denied), (11, missing)]);
    let processes = list_processes_with(&mut source, &mut FixedDetailsCache::default()).unwrap();
    assert_eq!(
      processes[0].issue.as_deref(),
      Some("The system denied access to the process details.")
    );
    assert_eq!(
      (processes[1].cwd.as_deref(), processes[1].issue.as_deref()),
      (None, None)
    );
  }

  #[test]
  fn reads_the_fixed_details_once_per_instance_and_program() {
    let mut cache = FixedDetailsCache::default();
    let mut source = FakeSource::with(&[(10, process(100, "node")), (11, process(110, "vite"))]);
    list_processes_with(&mut source, &mut cache).unwrap();
    list_processes_with(&mut source, &mut cache).unwrap();
    assert_eq!(source.argument_reads, 2);

    // After `exec`, the instance runs another program, so its details are read again, also when
    // the new program has the same name, as `bash` that runs `exec bash -c ...` has.
    let same_name = FakeProcess {
      arguments: vec!["bash", "-c", "while :; do read -t 1; done"],
      program: Some(2),
      ..process(100, "node")
    };
    source.processes.insert(10, same_name);
    let processes = list_processes_with(&mut source, &mut cache).unwrap();
    assert_eq!(source.argument_reads, 3);
    assert_eq!(
      processes[0].arguments,
      Some(["bash", "-c", "while :; do read -t 1; done"].map(String::from).to_vec())
    );

    // An instance that exited leaves the cache, so a new instance with its PID is read.
    source.processes.remove(&11);
    list_processes_with(&mut source, &mut cache).unwrap();
    source.processes.insert(11, process(110, "vite"));
    list_processes_with(&mut source, &mut cache).unwrap();
    assert_eq!(source.argument_reads, 4);
  }

  #[test]
  fn reads_the_details_on_every_list_without_a_program_version() {
    let mut cache = FixedDetailsCache::default();
    let linux = FakeProcess {
      program: None,
      ..process(100, "node")
    };
    let mut source = FakeSource::with(&[(10, linux)]);
    list_processes_with(&mut source, &mut cache).unwrap();
    list_processes_with(&mut source, &mut cache).unwrap();
    assert_eq!(source.argument_reads, 2);
  }

  #[test]
  fn inspects_an_instance_only_while_it_keeps_its_identity() {
    let target = NativeProcessTarget {
      pid: 10,
      identity: "100".to_string(),
    };
    let listener = NativeListener::new(IpAddr::from([127, 0, 0, 1]), 5173);
    let live = inspect_instance(&target, |_, identity| identity == 100, |_| Ok(vec![listener.clone()]));
    assert!(live.live);
    assert_eq!(live.listeners, Some(vec![listener]));

    let checks = Cell::new(0);
    let reused = inspect_instance(
      &target,
      |_, _| {
        checks.set(checks.get() + 1);
        checks.get() == 1
      },
      |_| Ok(Vec::new()),
    );
    assert!(!reused.live);

    let failed = inspect_instance(&target, |_, _| true, |_| Err("no ports".to_string()));
    assert_eq!(
      (failed.listeners, failed.listener_issue.as_deref()),
      (None, Some("no ports"))
    );
  }
}
