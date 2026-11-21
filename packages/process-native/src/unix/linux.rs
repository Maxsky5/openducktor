//! Linux reads use `/proc` and `NETLINK_SOCK_DIAG`. Stop signals a pidfd when the kernel has
//! `pidfd_open`, and waits for the pidfd to report the exit. Older kernels signal the PID after a
//! final check through a `/proc/<pid>` directory descriptor, which also observes the exit of that
//! instance.

use super::{Pid, ProcessSource, Snapshot, inspect_instance, is_gone, read_standard_input, stop_outcome};
use crate::issues::{listener_issue, port_list_issue, still_running, unobserved_exit};
use crate::model::{
  NativeInspection, NativeListener, NativeProcess, NativeProcessTarget, NativeStandardInput, NativeStopOutcome,
  NativeStopRequest, StopMode, StopOutcomeKind,
};
use crate::parse::proc_files::{ProcStat, input_kind, parse_cmdline, parse_stat, socket_inode};
use crate::parse::sock_diag::{AF_INET, AF_INET6, Progress, listener_request, read_listeners};
use crate::parse::unknown_format;
use std::collections::HashMap;
use std::ffi::{CStr, OsStr};
use std::fs;
use std::io::{self, Read};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::OpenOptionsExt;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

fn read_stat(pid: Pid) -> io::Result<ProcStat> {
  let content = fs::read(format!("/proc/{pid}/stat"))?;
  parse_stat(&content).ok_or_else(|| unknown_format("The process status"))
}

fn read_link(pid: Pid, name: &str) -> io::Result<Option<String>> {
  let path = fs::read_link(format!("/proc/{pid}/{name}"))?;
  Ok(Some(path.to_string_lossy().into_owned()))
}

/// The process files of `/proc`.
struct ProcFs;

impl ProcessSource for ProcFs {
  fn pids(&mut self) -> io::Result<Vec<Pid>> {
    let pids = fs::read_dir("/proc")?
      .flatten()
      .filter_map(|entry| entry.file_name().to_str()?.parse().ok())
      .filter_map(Pid::new)
      .collect();
    Ok(pids)
  }

  fn snapshot(&mut self, pid: Pid) -> io::Result<Option<Snapshot>> {
    match read_stat(pid) {
      Ok(stat) if stat.is_gone() => Ok(None),
      Ok(stat) => Ok(Some(Snapshot {
        parent_pid: stat.parent_pid,
        identity: stat.start_time,
        name: stat.name,
        // Linux counts no `exec`, so the list reads the executable and the arguments each time.
        program: None,
      })),
      Err(error) if is_gone(&error) => Ok(None),
      Err(error) => Err(error),
    }
  }

  fn cwd(&mut self, pid: Pid) -> io::Result<Option<String>> {
    read_link(pid, "cwd")
  }

  fn executable(&mut self, pid: Pid) -> io::Result<Option<String>> {
    read_link(pid, "exe")
  }

  fn arguments(&mut self, pid: Pid) -> io::Result<Option<Vec<String>>> {
    Ok(Some(parse_cmdline(&fs::read(format!("/proc/{pid}/cmdline"))?)))
  }
}

pub(crate) fn list_processes() -> io::Result<Vec<NativeProcess>> {
  super::list_processes(&mut ProcFs)
}

/// A new descriptor from a system call result, or the error of the call.
fn owned_fd(raw: libc::c_long) -> io::Result<OwnedFd> {
  if raw < 0 {
    return Err(io::Error::last_os_error());
  }
  let raw = libc::c_int::try_from(raw).map_err(|_| io::Error::from_raw_os_error(libc::EBADF))?;
  // SAFETY: The call returned a new descriptor that nothing else owns.
  Ok(unsafe { OwnedFd::from_raw_fd(raw) })
}

/// A netlink socket of `NETLINK_SOCK_DIAG`.
fn diag_socket() -> io::Result<OwnedFd> {
  // SAFETY: `socket` reads no memory.
  let raw = unsafe {
    libc::socket(
      libc::AF_NETLINK,
      libc::SOCK_DGRAM | libc::SOCK_CLOEXEC,
      libc::NETLINK_SOCK_DIAG,
    )
  };
  owned_fd(raw.into())
}

/// Reads the listening TCP sockets of one family into `sockets`, by socket inode.
fn read_family(socket: &OwnedFd, family: u8, sockets: &mut HashMap<u64, Vec<NativeListener>>) -> io::Result<()> {
  let request = listener_request(family, u32::from(family));
  // SAFETY: The pointer and the length describe `request`, which outlives the call.
  let sent = unsafe { libc::send(socket.as_raw_fd(), request.as_ptr().cast(), request.len(), 0) };
  if sent < 0 {
    return Err(io::Error::last_os_error());
  }
  let mut buffer = vec![0u8; 64 * 1024];
  loop {
    // `MSG_TRUNC` makes the call return the full datagram length, so a cut datagram shows.
    // SAFETY: The pointer and the length describe `buffer`, which outlives the call.
    let received = unsafe {
      libc::recv(
        socket.as_raw_fd(),
        buffer.as_mut_ptr().cast(),
        buffer.len(),
        libc::MSG_TRUNC,
      )
    };
    let Ok(received) = usize::try_from(received) else {
      let error = io::Error::last_os_error();
      if error.kind() == io::ErrorKind::Interrupted {
        continue;
      }
      return Err(error);
    };
    let datagram = buffer
      .get(..received)
      .ok_or_else(|| unknown_format("The socket list"))?;
    if read_listeners(datagram, sockets)? == Progress::Done {
      return Ok(());
    }
  }
}

/// Maps the inode of each listening TCP socket in this network namespace to its address.
fn listening_sockets() -> io::Result<HashMap<u64, Vec<NativeListener>>> {
  let socket = diag_socket()?;
  let mut sockets = HashMap::new();
  read_family(&socket, AF_INET, &mut sockets)?;
  read_family(&socket, AF_INET6, &mut sockets)?;
  Ok(sockets)
}

fn socket_inodes(pid: Pid) -> io::Result<Vec<u64>> {
  let mut inodes = Vec::new();
  for entry in fs::read_dir(format!("/proc/{pid}/fd"))?.flatten() {
    // A descriptor that closed during the read has no link.
    if let Ok(target) = fs::read_link(entry.path())
      && let Some(inode) = socket_inode(target.as_os_str().as_bytes())
    {
      inodes.push(inode);
    }
  }
  Ok(inodes)
}

fn same_instance(pid: Pid, identity: u64) -> bool {
  matches!(read_stat(pid), Ok(stat) if stat.start_time == identity && !stat.is_gone())
}

pub(crate) fn inspect_processes(targets: &[NativeProcessTarget]) -> Vec<NativeInspection> {
  let sockets = listening_sockets();
  targets
    .iter()
    .map(|target| {
      inspect_instance(target, same_instance, |pid| {
        let sockets = sockets.as_ref().map_err(port_list_issue)?;
        let inodes = socket_inodes(pid).map_err(|error| listener_issue(&error))?;
        let mut listeners = Vec::new();
        for listener in inodes.iter().filter_map(|inode| sockets.get(inode)).flatten() {
          listener.clone().add_to(&mut listeners);
        }
        Ok(listeners)
      })
    })
    .collect()
}

pub(crate) fn read_standard_inputs(targets: &[NativeProcessTarget]) -> Vec<NativeStandardInput> {
  targets
    .iter()
    .map(|target| {
      read_standard_input(target, same_instance, |pid| {
        match fs::read_link(format!("/proc/{pid}/fd/0")) {
          Ok(link) => Ok(Some(input_kind(link.as_os_str().as_bytes()))),
          // A closed standard input has no link.
          Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
          Err(error) => Err(error),
        }
      })
    })
    .collect()
}

fn pidfd_open(pid: Pid) -> io::Result<OwnedFd> {
  // SAFETY: `pidfd_open` takes a PID and flags, and reads no memory.
  let raw = unsafe { libc::syscall(libc::SYS_pidfd_open, pid.raw(), 0 as libc::c_uint) };
  owned_fd(raw)
}

/// Linux 5.3 added `pidfd_open`. Linux 5.1 added `pidfd_send_signal`.
fn has_pidfd() -> bool {
  static AVAILABLE: OnceLock<bool> = OnceLock::new();
  *AVAILABLE.get_or_init(|| {
    let Some(own) = Pid::new(std::process::id()) else {
      return false;
    };
    match pidfd_open(own) {
      Ok(_) => true,
      Err(error) => error.raw_os_error() != Some(libc::ENOSYS),
    }
  })
}

pub(crate) fn stop_mode() -> StopMode {
  if has_pidfd() { StopMode::Instance } else { StopMode::Pid }
}

/// A `/proc/<pid>` directory descriptor stays bound to its process: reads fail with `ESRCH`
/// after the process exits, even when another process gets the same PID.
struct ProcessDirectory(OwnedFd);

impl ProcessDirectory {
  fn open(pid: Pid) -> io::Result<Self> {
    let directory = fs::OpenOptions::new()
      .read(true)
      .custom_flags(libc::O_DIRECTORY)
      .open(format!("/proc/{pid}"))?;
    Ok(Self(directory.into()))
  }

  fn stat(&self) -> io::Result<ProcStat> {
    // SAFETY: The descriptor is open, and the name is a NUL-terminated literal.
    let raw = unsafe { libc::openat(self.0.as_raw_fd(), c"stat".as_ptr(), libc::O_RDONLY | libc::O_CLOEXEC) };
    let mut file = fs::File::from(owned_fd(raw.into())?);
    let mut content = Vec::new();
    file.read_to_end(&mut content)?;
    parse_stat(&content).ok_or_else(|| unknown_format("The process status"))
  }

  fn link(&self, name: &CStr) -> io::Result<String> {
    let mut buffer = vec![0u8; libc::PATH_MAX.unsigned_abs() as usize];
    // SAFETY: The descriptor is open, the name is NUL-terminated, and the pointer and the length
    // describe `buffer`.
    let length = unsafe {
      libc::readlinkat(
        self.0.as_raw_fd(),
        name.as_ptr(),
        buffer.as_mut_ptr().cast(),
        buffer.len(),
      )
    };
    let length = usize::try_from(length).map_err(|_| io::Error::last_os_error())?;
    buffer.truncate(length);
    Ok(OsStr::from_bytes(&buffer).to_string_lossy().into_owned())
  }
}

fn exited(stat: &ProcStat, identity: u64) -> bool {
  stat.start_time != identity || stat.is_gone()
}

pub(crate) fn stop_process(request: &NativeStopRequest) -> NativeStopOutcome {
  let (Some(pid), Ok(identity)) = (Pid::new(request.pid), request.identity.parse::<u64>()) else {
    return NativeStopOutcome::with(StopOutcomeKind::Changed, "The process reference is not valid.");
  };
  let pidfd = if has_pidfd() {
    match pidfd_open(pid) {
      Ok(pidfd) => Some(pidfd),
      Err(error) => return stop_outcome(&error),
    }
  } else if request.allow_pid_signal {
    None
  } else {
    return NativeStopOutcome::of(StopOutcomeKind::AcknowledgmentRequired);
  };
  let directory = match ProcessDirectory::open(pid) {
    Ok(directory) => directory,
    Err(error) => return stop_outcome(&error),
  };
  // The pidfd and the directory were opened before this check, so a match binds both to the instance.
  match directory.stat() {
    Ok(stat) if !exited(&stat, identity) => {}
    Ok(_) => return NativeStopOutcome::of(StopOutcomeKind::AlreadyExited),
    Err(error) => return stop_outcome(&error),
  }
  match directory.link(if request.uses_cwd() { c"cwd" } else { c"exe" }) {
    Ok(path) if path == request.evidence_path => {}
    Ok(_) => return request.evidence_changed(),
    Err(error) => return stop_outcome(&error),
  }
  let timeout = Duration::from_millis(u64::from(request.timeout_ms));
  let Some(pidfd) = pidfd else {
    // SAFETY: `kill` reads no memory, and `pid` is positive.
    if unsafe { libc::kill(pid.raw(), libc::SIGTERM) } != 0 {
      return stop_outcome(&io::Error::last_os_error());
    }
    return observe_directory_exit(&directory, identity, timeout);
  };
  // SAFETY: The descriptor is open, and a null `siginfo_t` asks for the default signal data.
  let sent = unsafe {
    libc::syscall(
      libc::SYS_pidfd_send_signal,
      pidfd.as_raw_fd(),
      libc::SIGTERM,
      std::ptr::null::<libc::siginfo_t>(),
      0 as libc::c_uint,
    )
  };
  if sent < 0 {
    return stop_outcome(&io::Error::last_os_error());
  }
  wait_for_pidfd(&pidfd, timeout)
}

/// A pidfd becomes readable when its process exits, also while the process is a zombie.
fn wait_for_pidfd(pidfd: &OwnedFd, timeout: Duration) -> NativeStopOutcome {
  let deadline = Instant::now() + timeout;
  loop {
    let remaining = deadline.saturating_duration_since(Instant::now());
    // Rounds up, so a wait never ends before the deadline.
    let wait = libc::c_int::try_from(remaining.as_micros().div_ceil(1000)).unwrap_or(libc::c_int::MAX);
    let mut poll = libc::pollfd {
      fd: pidfd.as_raw_fd(),
      events: libc::POLLIN,
      revents: 0,
    };
    // SAFETY: The pointer and the count describe the one `poll` entry, which outlives the call.
    let ready = unsafe { libc::poll(&raw mut poll, 1, wait) };
    match ready {
      1.. => return NativeStopOutcome::of(StopOutcomeKind::Stopped),
      0 if remaining.is_zero() => return still_running(),
      0 => {}
      _ => {
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::Interrupted {
          return unobserved_exit(&error);
        }
      }
    }
  }
}

/// How often a kernel without pidfd reads the state of a signaled process.
const OBSERVE_INTERVAL: Duration = Duration::from_millis(50);

/// Kernels before 5.3 have no pidfd, so no event reports the exit of a process that the host did
/// not start. The loop reads the bound directory until the instance exits or the time passes.
fn observe_directory_exit(directory: &ProcessDirectory, identity: u64, timeout: Duration) -> NativeStopOutcome {
  let deadline = Instant::now() + timeout;
  loop {
    match directory.stat() {
      Ok(stat) if exited(&stat, identity) => return NativeStopOutcome::of(StopOutcomeKind::Stopped),
      Err(error) if is_gone(&error) => return NativeStopOutcome::of(StopOutcomeKind::Stopped),
      Err(error) if Instant::now() >= deadline => {
        return NativeStopOutcome::with(
          StopOutcomeKind::Unconfirmed,
          format!("The process state could not be read after the stop request: {error}"),
        );
      }
      _ if Instant::now() >= deadline => return still_running(),
      _ => std::thread::sleep(OBSERVE_INTERVAL),
    }
  }
}

#[cfg(test)]
mod tests {
  use super::{list_processes, stop_mode};
  use crate::model::StopMode;

  #[test]
  fn lists_this_process() {
    let own = std::process::id();
    let processes = list_processes().unwrap();
    let this = processes.iter().find(|process| process.pid == own).unwrap();
    assert!(this.cwd.is_some());
    assert!(this.arguments.as_ref().is_some_and(|arguments| !arguments.is_empty()));
  }

  #[test]
  fn uses_instance_stops_on_a_current_kernel() {
    assert_eq!(stop_mode(), StopMode::Instance);
  }
}
