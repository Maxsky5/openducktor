//! macOS reads use `libproc` and `sysctl`. Stop uses `proc_signal_with_audittoken`, which checks
//! the PID generation on macOS 14 and later, and a kqueue reports the exit. Older systems signal
//! the PID after a final identity check.

use super::{Pid, ProcessSource, Snapshot, inspect_instance, is_gone, read_standard_input, stop_outcome};
use crate::issues::{listener_issue, still_running, unobserved_exit};
use crate::model::{
  InputKind, NativeInspection, NativeListener, NativeProcess, NativeProcessTarget, NativeStandardInput,
  NativeStopOutcome, NativeStopRequest, StopMode, StopOutcomeKind,
};
use crate::parse::procargs::parse_procargs2;
use crate::parse::unknown_format;
use libc::{c_char, c_int, c_void};
use std::ffi::CStr;
use std::io;
use std::mem::{size_of, zeroed};
use std::net::IpAddr;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// `PROC_PIDT_BSDINFOWITHUNIQID` and its result from `sys/proc_info_private.h` in XNU.
const PROC_PIDT_BSDINFOWITHUNIQID: c_int = 18;

#[repr(C)]
struct UniqueIdentifierInfo {
  uuid: [u8; 16],
  unique_id: u64,
  parent_unique_id: u64,
  id_version: i32,
  reserve2: u32,
  reserve3: u64,
  reserve4: u64,
}

#[repr(C)]
struct BsdInfoWithUniqueId {
  bsd: libc::proc_bsdinfo,
  unique: UniqueIdentifierInfo,
}

/// `audit_token_t`. Index 5 holds the PID and index 7 the PID generation.
#[repr(C)]
struct AuditToken {
  val: [u32; 8],
}

type SignalWithAuditToken = unsafe extern "C" fn(*mut AuditToken, c_int) -> c_int;
const SIGNAL_WITH_AUDIT_TOKEN: &CStr = c"proc_signal_with_audittoken";

// SAFETY: `src/unix/macos_socket.c` defines the function with this signature.
unsafe extern "C" {
  /// Reads one descriptor of `pid`. Returns 1 for a listening TCP socket, 0 for any other
  /// descriptor, or -1 with `errno`. `address` must hold 16 bytes.
  fn odt_tcp_listener(pid: c_int, fd: c_int, family: *mut c_int, address: *mut u8, port: *mut c_int) -> c_int;
}

/// Text from a fixed C character buffer that ends with a NUL byte or at its end.
fn c_text(chars: &[c_char]) -> String {
  let bytes: Vec<u8> = chars
    .iter()
    .map(|char| u8::from_ne_bytes(char.to_ne_bytes()))
    .take_while(|byte| *byte != 0)
    .collect();
  String::from_utf8_lossy(&bytes).into_owned()
}

/// The error of a failed libproc call. A PID without a process can fail without `errno`.
fn last_error() -> io::Error {
  match io::Error::last_os_error() {
    error if error.raw_os_error() == Some(0) => io::Error::from_raw_os_error(libc::ESRCH),
    error => error,
  }
}

/// Fills `info` with one `proc_pidinfo` flavor.
fn pid_info<T>(pid: Pid, flavor: c_int, info: &mut T) -> io::Result<()> {
  let size = c_int::try_from(size_of::<T>()).map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?;
  // SAFETY: The pointer and the size describe `info`, a plain C struct that the call fills.
  let read = unsafe { libc::proc_pidinfo(pid.raw(), flavor, 0, (&raw mut *info).cast(), size) };
  if read == size { Ok(()) } else { Err(last_error()) }
}

/// The BSD info of a running process. `Ok(None)` for a PID without a process or a zombie.
fn bsd_info(pid: Pid) -> io::Result<Option<BsdInfoWithUniqueId>> {
  // SAFETY: All-zero bytes are a valid value of this plain C struct.
  let mut info: BsdInfoWithUniqueId = unsafe { zeroed() };
  match pid_info(pid, PROC_PIDT_BSDINFOWITHUNIQID, &mut info) {
    Ok(()) if info.bsd.pbi_status == libc::SZOMB => Ok(None),
    Ok(()) => Ok(Some(info)),
    Err(error) if is_gone(&error) => Ok(None),
    Err(error) => Err(error),
  }
}

fn same_instance(pid: Pid, identity: u64) -> bool {
  matches!(bsd_info(pid), Ok(Some(info)) if info.unique.unique_id == identity)
}

fn read_cwd(pid: Pid) -> io::Result<Option<String>> {
  // SAFETY: All-zero bytes are a valid value of this plain C struct.
  let mut info: libc::proc_vnodepathinfo = unsafe { zeroed() };
  pid_info(pid, libc::PROC_PIDVNODEPATHINFO, &mut info)?;
  // `vip_path` is one contiguous `MAXPATHLEN` character buffer.
  let path = c_text(info.pvi_cdir.vip_path.as_flattened());
  Ok((!path.is_empty()).then_some(path))
}

fn read_executable(pid: Pid) -> io::Result<String> {
  let mut buffer = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE.unsigned_abs() as usize];
  let capacity = u32::try_from(buffer.len()).unwrap_or(u32::MAX);
  // SAFETY: The pointer and the capacity describe `buffer`.
  let read = unsafe { libc::proc_pidpath(pid.raw(), buffer.as_mut_ptr().cast(), capacity) };
  let length = usize::try_from(read)
    .ok()
    .filter(|length| *length > 0)
    .ok_or_else(last_error)?;
  buffer.truncate(length);
  Ok(String::from_utf8_lossy(&buffer).into_owned())
}

/// `KERN_ARGMAX`, the largest argument buffer of a process.
fn argument_buffer_size() -> io::Result<usize> {
  static SIZE: OnceLock<usize> = OnceLock::new();
  if let Some(size) = SIZE.get() {
    return Ok(*size);
  }
  let mut name = [libc::CTL_KERN, libc::KERN_ARGMAX];
  let mut value: c_int = 0;
  let mut length = size_of::<c_int>();
  // SAFETY: The name holds 2 entries, and the value pointer and length describe `value`.
  let result = unsafe {
    libc::sysctl(
      name.as_mut_ptr(),
      2,
      (&raw mut value).cast(),
      &raw mut length,
      std::ptr::null_mut(),
      0,
    )
  };
  if result != 0 {
    return Err(io::Error::last_os_error());
  }
  let size = usize::try_from(value).map_err(|_| unknown_format("KERN_ARGMAX"))?;
  Ok(*SIZE.get_or_init(|| size))
}

/// The libproc and `sysctl` reads. It keeps one argument buffer for the whole list.
#[derive(Default)]
struct LibProc {
  arguments: Vec<u8>,
}

impl ProcessSource for LibProc {
  fn pids(&mut self) -> io::Result<Vec<Pid>> {
    // SAFETY: A null buffer asks for the process count only.
    let count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
    let count = usize::try_from(count)
      .ok()
      .filter(|count| *count > 0)
      .ok_or_else(last_error)?;
    // Room for the processes that start between the two calls.
    let mut pids: Vec<c_int> = vec![0; count + 256];
    let capacity = c_int::try_from(pids.len() * size_of::<c_int>()).unwrap_or(c_int::MAX);
    // SAFETY: The pointer and the byte capacity describe `pids`.
    let filled = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), capacity) };
    let filled = usize::try_from(filled)
      .ok()
      .filter(|filled| *filled > 0)
      .ok_or_else(last_error)?;
    pids.truncate(filled);
    Ok(
      pids
        .into_iter()
        .filter_map(|pid| Pid::new(u32::try_from(pid).ok()?))
        .collect(),
    )
  }

  fn snapshot(&mut self, pid: Pid) -> io::Result<Option<Snapshot>> {
    let Some(info) = bsd_info(pid)? else {
      return Ok(None);
    };
    let name = match c_text(&info.bsd.pbi_name) {
      name if name.is_empty() => c_text(&info.bsd.pbi_comm),
      name => name,
    };
    Ok(Some(Snapshot {
      parent_pid: info.bsd.pbi_ppid,
      identity: info.unique.unique_id,
      name,
    }))
  }

  fn cwd(&mut self, pid: Pid) -> io::Result<Option<String>> {
    read_cwd(pid)
  }

  fn executable(&mut self, pid: Pid) -> io::Result<Option<String>> {
    read_executable(pid).map(Some)
  }

  fn arguments(&mut self, pid: Pid) -> io::Result<Option<Vec<String>>> {
    self.arguments.resize(argument_buffer_size()?, 0);
    let mut name = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid.raw()];
    let mut length = self.arguments.len();
    // SAFETY: The name holds 3 entries, and the pointer and length describe the argument buffer.
    let result = unsafe {
      libc::sysctl(
        name.as_mut_ptr(),
        3,
        self.arguments.as_mut_ptr().cast(),
        &raw mut length,
        std::ptr::null_mut(),
        0,
      )
    };
    if result != 0 {
      return Err(io::Error::last_os_error());
    }
    Ok(self.arguments.get(..length).and_then(parse_procargs2))
  }
}

pub(crate) fn list_processes() -> io::Result<Vec<NativeProcess>> {
  super::list_processes(&mut LibProc::default())
}

/// The open descriptors of a process.
fn descriptors(pid: Pid) -> io::Result<Vec<libc::proc_fdinfo>> {
  // SAFETY: A null buffer asks for the byte size of the descriptor list only.
  let needed = unsafe { libc::proc_pidinfo(pid.raw(), libc::PROC_PIDLISTFDS, 0, std::ptr::null_mut(), 0) };
  let needed = usize::try_from(needed)
    .ok()
    .filter(|needed| *needed > 0)
    .ok_or_else(last_error)?;
  // Room for the descriptors that open between the two calls.
  let slots = needed / size_of::<libc::proc_fdinfo>() + 32;
  // SAFETY: All-zero bytes are a valid value of this plain C struct.
  let mut descriptors: Vec<libc::proc_fdinfo> = vec![unsafe { zeroed() }; slots];
  let capacity = c_int::try_from(slots * size_of::<libc::proc_fdinfo>()).unwrap_or(c_int::MAX);
  // SAFETY: The pointer and the byte capacity describe `descriptors`.
  let read = unsafe {
    libc::proc_pidinfo(
      pid.raw(),
      libc::PROC_PIDLISTFDS,
      0,
      descriptors.as_mut_ptr().cast::<c_void>(),
      capacity,
    )
  };
  let read = usize::try_from(read)
    .ok()
    .filter(|read| *read > 0)
    .ok_or_else(last_error)?;
  descriptors.truncate(read / size_of::<libc::proc_fdinfo>());
  Ok(descriptors)
}

fn read_listeners(pid: Pid) -> io::Result<Vec<NativeListener>> {
  let descriptors = descriptors(pid)?;
  let mut listeners = Vec::new();
  let sockets = descriptors
    .iter()
    .filter(|descriptor| descriptor.proc_fdtype == libc::PROX_FDTYPE_SOCKET.unsigned_abs());
  for descriptor in sockets {
    let mut family: c_int = 0;
    let mut address = [0u8; 16];
    let mut port: c_int = 0;
    // SAFETY: The out pointers point to live locals, and `address` holds 16 bytes.
    let result = unsafe {
      odt_tcp_listener(
        pid.raw(),
        descriptor.proc_fd,
        &raw mut family,
        address.as_mut_ptr(),
        &raw mut port,
      )
    };
    match result {
      1 => {
        let address = if family == libc::AF_INET {
          let [a, b, c, d, ..] = address;
          IpAddr::from([a, b, c, d])
        } else {
          IpAddr::from(address)
        };
        let port = u16::try_from(port).map_err(|_| unknown_format("A socket port"))?;
        NativeListener::new(address, port).add_to(&mut listeners);
      }
      0 => {}
      _ => return Err(last_error()),
    }
  }
  Ok(listeners)
}

/// The kind of descriptor 0. A pipe and a socket are channels.
fn input_kind(pid: Pid) -> io::Result<Option<InputKind>> {
  let input = descriptors(pid)?.into_iter().find(|descriptor| descriptor.proc_fd == 0);
  Ok(input.map(|input| {
    let kind = input.proc_fdtype;
    if kind == libc::PROX_FDTYPE_PIPE.unsigned_abs() || kind == libc::PROX_FDTYPE_SOCKET.unsigned_abs() {
      InputKind::Pipe
    } else {
      InputKind::Other
    }
  }))
}

pub(crate) fn read_standard_inputs(targets: &[NativeProcessTarget]) -> Vec<NativeStandardInput> {
  targets
    .iter()
    .map(|target| read_standard_input(target, same_instance, input_kind))
    .collect()
}

pub(crate) fn inspect_processes(targets: &[NativeProcessTarget]) -> Vec<NativeInspection> {
  targets
    .iter()
    .map(|target| {
      inspect_instance(target, same_instance, |pid| {
        read_listeners(pid).map_err(|error| listener_issue(&error))
      })
    })
    .collect()
}

/// The major Darwin version, or `None` when the system does not report it.
fn darwin_major() -> Option<u32> {
  // SAFETY: All-zero bytes are a valid value of this plain C struct.
  let mut name: libc::utsname = unsafe { zeroed() };
  // SAFETY: The pointer points to `name`, which the call fills.
  if unsafe { libc::uname(&raw mut name) } != 0 {
    return None;
  }
  c_text(&name.release).split('.').next()?.parse().ok()
}

/// macOS 14 (Darwin 23) is the first release whose kernel compares the PID generation. A system
/// without it, or without a known version, signals PIDs.
fn instance_signal() -> Option<SignalWithAuditToken> {
  static SIGNAL: OnceLock<Option<SignalWithAuditToken>> = OnceLock::new();
  *SIGNAL.get_or_init(|| {
    if darwin_major()? < 23 {
      return None;
    }
    // SAFETY: The name is NUL-terminated, and `RTLD_DEFAULT` searches the loaded images.
    let symbol = unsafe { libc::dlsym(libc::RTLD_DEFAULT, SIGNAL_WITH_AUDIT_TOKEN.as_ptr()) };
    if symbol.is_null() {
      return None;
    }
    // SAFETY: The symbol is the libproc function with this signature.
    Some(unsafe { std::mem::transmute::<*mut c_void, SignalWithAuditToken>(symbol) })
  })
}

pub(crate) fn stop_mode() -> StopMode {
  if instance_signal().is_some() {
    StopMode::Instance
  } else {
    StopMode::Pid
  }
}

/// A kqueue that reports the exit of one process. The kernel ties the watch to the process that
/// has the PID when the watch starts, so a later owner of the PID does not trigger it.
struct ExitWatch(OwnedFd);

impl ExitWatch {
  fn new(pid: Pid) -> io::Result<Self> {
    // SAFETY: `kqueue` reads no memory.
    let raw = unsafe { libc::kqueue() };
    if raw < 0 {
      return Err(io::Error::last_os_error());
    }
    // SAFETY: `kqueue` returned a new descriptor that nothing else owns.
    let queue = unsafe { OwnedFd::from_raw_fd(raw) };
    let change = libc::kevent {
      ident: usize::try_from(pid.number()).map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?,
      filter: libc::EVFILT_PROC,
      flags: libc::EV_ADD | libc::EV_ONESHOT,
      fflags: libc::NOTE_EXIT,
      data: 0,
      udata: std::ptr::null_mut(),
    };
    // SAFETY: The change list holds one entry that outlives the call, and the call returns no
    // events, so it reports a failed change as an error.
    let added = unsafe {
      libc::kevent(
        queue.as_raw_fd(),
        &raw const change,
        1,
        std::ptr::null_mut(),
        0,
        std::ptr::null(),
      )
    };
    if added < 0 {
      return Err(io::Error::last_os_error());
    }
    Ok(Self(queue))
  }

  /// Waits until the process exits or the time passes. Returns true when the process exited.
  fn wait(&self, timeout: Duration) -> io::Result<bool> {
    let deadline = Instant::now() + timeout;
    loop {
      let remaining = deadline.saturating_duration_since(Instant::now());
      let time = libc::timespec {
        tv_sec: libc::time_t::try_from(remaining.as_secs()).unwrap_or(libc::time_t::MAX),
        tv_nsec: libc::c_long::from(remaining.subsec_nanos()),
      };
      // SAFETY: All-zero bytes are a valid value of this plain C struct.
      let mut event: libc::kevent = unsafe { zeroed() };
      // SAFETY: The event list holds one entry, and the time outlives the call.
      let ready = unsafe {
        libc::kevent(
          self.0.as_raw_fd(),
          std::ptr::null(),
          0,
          &raw mut event,
          1,
          &raw const time,
        )
      };
      match ready {
        1.. => return Ok(true),
        0 => return Ok(false),
        _ => {
          let error = io::Error::last_os_error();
          if error.kind() != io::ErrorKind::Interrupted {
            return Err(error);
          }
        }
      }
    }
  }
}

pub(crate) fn stop_process(request: &NativeStopRequest) -> NativeStopOutcome {
  let (Some(pid), Ok(identity)) = (Pid::new(request.pid), request.identity.parse::<u64>()) else {
    return NativeStopOutcome::with(StopOutcomeKind::Changed, "The process reference is not valid.");
  };
  let signal = instance_signal();
  if signal.is_none() && !request.allow_pid_signal {
    return NativeStopOutcome::of(StopOutcomeKind::AcknowledgmentRequired);
  }
  let info = match bsd_info(pid) {
    Ok(Some(info)) if info.unique.unique_id == identity => info,
    Ok(_) => return NativeStopOutcome::of(StopOutcomeKind::AlreadyExited),
    Err(error) => return stop_outcome(&error),
  };
  let evidence = if request.uses_cwd() {
    read_cwd(pid)
  } else {
    read_executable(pid).map(Some)
  };
  match evidence {
    Ok(Some(path)) if path == request.evidence_path => {}
    Ok(_) => return request.evidence_changed(),
    Err(error) => return stop_outcome(&error),
  }
  let watch = match ExitWatch::new(pid) {
    Ok(watch) => watch,
    Err(error) => return stop_outcome(&error),
  };
  // The watch started before this check, so a match ties it to the instance.
  if !same_instance(pid, identity) {
    return NativeStopOutcome::of(StopOutcomeKind::AlreadyExited);
  }
  let code = match signal {
    Some(signal) => {
      let mut token = AuditToken { val: [0; 8] };
      token.val[5] = pid.number();
      token.val[7] = info.unique.id_version.cast_unsigned();
      // SAFETY: The token outlives the call. The function returns 0 or an `errno` value.
      unsafe { signal(&raw mut token, libc::SIGTERM) }
    }
    // SAFETY: `kill` reads no memory, and `pid` is positive.
    None => match unsafe { libc::kill(pid.raw(), libc::SIGTERM) } {
      0 => 0,
      _ => io::Error::last_os_error().raw_os_error().unwrap_or(libc::EIO),
    },
  };
  if code != 0 {
    return stop_outcome(&io::Error::from_raw_os_error(code));
  }
  match watch.wait(Duration::from_millis(u64::from(request.timeout_ms))) {
    Ok(true) => NativeStopOutcome::of(StopOutcomeKind::Stopped),
    Ok(false) => still_running(),
    Err(error) => unobserved_exit(&error),
  }
}

#[cfg(test)]
mod tests {
  use super::{c_text, list_processes, read_listeners, stop_mode};
  use crate::model::StopMode;
  use crate::unix::Pid;
  use std::net::TcpListener;

  #[test]
  fn lists_this_process() {
    let own = std::process::id();
    let processes = list_processes().unwrap();
    let this = processes.iter().find(|process| process.pid == own).unwrap();
    assert!(this.cwd.is_some());
    assert!(this.executable.is_some());
    assert!(this.arguments.as_ref().is_some_and(|arguments| !arguments.is_empty()));
  }

  #[test]
  fn reads_the_listeners_of_this_process() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = u32::from(listener.local_addr().unwrap().port());
    let listeners = read_listeners(Pid::new(std::process::id()).unwrap()).unwrap();
    assert!(
      listeners
        .iter()
        .any(|found| found.port == port && found.address == "127.0.0.1")
    );
  }

  #[test]
  fn uses_instance_stops_on_macos_14_and_later() {
    assert_eq!(stop_mode(), StopMode::Instance);
  }

  #[test]
  fn reads_c_text_up_to_the_nul_byte() {
    let chars = [b'z', b's', b'h', 0, b'x'].map(|byte| i8::from_ne_bytes([byte]));
    assert_eq!(c_text(&chars), "zsh");
  }
}
