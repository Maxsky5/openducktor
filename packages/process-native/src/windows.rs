//! Windows reads use the Tool Help snapshot, the process environment block, and the owner-PID TCP
//! tables. One process handle holds the instance through the final checks, termination, and exit
//! observation, so Windows does not reuse its PID meanwhile.

use crate::issues::{listener_issue, port_list_issue, read_issue, still_running, stop_failure, unobserved_exit};
use crate::model::{
  InputKind, NativeInspection, NativeListener, NativeProcess, NativeProcessTarget, NativeStandardInput,
  NativeStopOutcome, NativeStopRequest, StopMode, StopOutcomeKind,
};
use crate::parse::process_parameters::{Layout, ProcessParameters, RemoteString, utf16_le};
use crate::parse::tcp_table::{RowLayout, parse_table};
use crate::parse::unknown_format;
use crate::parse::windows_path::{directory_path, without_verbatim_prefix};
use std::collections::HashMap;
use std::ffi::c_void;
use std::io;
use std::mem::{offset_of, size_of, zeroed};
use std::os::windows::io::{AsRawHandle, FromRawHandle, HandleOrInvalid, HandleOrNull, OwnedHandle};
use windows_sys::Wdk::System::Threading::{
  NtQueryInformationProcess, ProcessBasicInformation, ProcessWow64Information,
};
use windows_sys::Win32::Foundation::{
  DUPLICATE_SAME_ACCESS, DuplicateHandle, ERROR_INSUFFICIENT_BUFFER, ERROR_INVALID_HANDLE, ERROR_INVALID_PARAMETER,
  ERROR_NO_MORE_FILES, FILETIME, HANDLE, LocalFree, NO_ERROR, NTSTATUS, RtlNtStatusToDosError, WAIT_OBJECT_0,
  WAIT_TIMEOUT, WIN32_ERROR,
};
use windows_sys::Win32::NetworkManagement::IpHelper::{
  GetExtendedTcpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCPROW_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
};
use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_INET6};
use windows_sys::Win32::Storage::FileSystem::{
  CreateFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_NAME_NORMALIZED, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
  FILE_TYPE_PIPE, GetFileType, GetFinalPathNameByHandleW, OPEN_EXISTING, VOLUME_NAME_DOS,
};
use windows_sys::Win32::System::Com::{
  COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoInitializeEx, CoUninitialize,
};
use windows_sys::Win32::System::Diagnostics::Debug::ReadProcessMemory;
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
  CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Pipes::GetNamedPipeServerProcessId;
use windows_sys::Win32::System::Threading::{
  GetCurrentProcess, GetProcessTimes, INFINITE, OpenProcess, PROCESS_ACCESS_RIGHTS, PROCESS_BASIC_INFORMATION,
  PROCESS_DUP_HANDLE, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
  PROCESS_VM_READ, QueryFullProcessImageNameW, TerminateProcess, WaitForSingleObject,
};
use windows_sys::Win32::UI::Shell::{
  CommandLineToArgvW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW, ShellExecuteExW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

// The row layouts of the table parser match the Windows structs.
const _: () = {
  assert!(size_of::<MIB_TCPROW_OWNER_PID>() == RowLayout::IPV4.length);
  assert!(offset_of!(MIB_TCPROW_OWNER_PID, dwLocalAddr) == RowLayout::IPV4.address);
  assert!(offset_of!(MIB_TCPROW_OWNER_PID, dwLocalPort) == RowLayout::IPV4.port);
  assert!(offset_of!(MIB_TCPROW_OWNER_PID, dwOwningPid) == RowLayout::IPV4.pid);
  assert!(size_of::<MIB_TCP6ROW_OWNER_PID>() == RowLayout::IPV6.length);
  assert!(offset_of!(MIB_TCP6ROW_OWNER_PID, ucLocalAddr) == RowLayout::IPV6.address);
  assert!(offset_of!(MIB_TCP6ROW_OWNER_PID, dwLocalPort) == RowLayout::IPV6.port);
  assert!(offset_of!(MIB_TCP6ROW_OWNER_PID, dwOwningPid) == RowLayout::IPV6.pid);
};

/// PID 0 is the System Idle Process and PID 4 the System process. Neither has user parameters.
const LAST_KERNEL_PID: u32 = 4;
/// The longest Windows path, in UTF-16 units.
const MAX_LONG_PATH: usize = 32_768;

fn win32_error(code: WIN32_ERROR) -> io::Error {
  io::Error::from_raw_os_error(code.cast_signed())
}

fn is_error(error: &io::Error, code: WIN32_ERROR) -> bool {
  error.raw_os_error() == Some(code.cast_signed())
}

/// The error of a failed `NtQueryInformationProcess`, as the matching Windows error.
fn nt_result(status: NTSTATUS) -> io::Result<()> {
  if status >= 0 {
    return Ok(());
  }
  // SAFETY: `RtlNtStatusToDosError` maps a value and reads no memory.
  Err(win32_error(unsafe { RtlNtStatusToDosError(status) }))
}

/// The byte size of a struct, as the `u32` that Windows calls take.
fn size_u32<T>() -> u32 {
  u32::try_from(size_of::<T>()).unwrap_or(u32::MAX)
}

fn open(pid: u32, access: PROCESS_ACCESS_RIGHTS) -> io::Result<OwnedHandle> {
  // SAFETY: `OpenProcess` reads no memory.
  let raw = unsafe { OpenProcess(access, 0, pid) };
  // SAFETY: `OpenProcess` returns null or a new handle that nothing else owns.
  OwnedHandle::try_from(unsafe { HandleOrNull::from_raw_handle(raw) }).map_err(|_| io::Error::last_os_error())
}

fn creation_time(handle: &OwnedHandle) -> io::Result<u64> {
  let empty = FILETIME {
    dwLowDateTime: 0,
    dwHighDateTime: 0,
  };
  let mut times = [empty; 4];
  let [creation, exit, kernel, user] = &mut times;
  // SAFETY: The handle is open, and the four pointers point to `times`.
  if unsafe { GetProcessTimes(handle.as_raw_handle(), creation, exit, kernel, user) } == 0 {
    return Err(io::Error::last_os_error());
  }
  Ok((u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime))
}

fn has_exited(handle: &OwnedHandle) -> bool {
  // SAFETY: The handle is open, and a zero wait only reads its state.
  (unsafe { WaitForSingleObject(handle.as_raw_handle(), 0) }) == WAIT_OBJECT_0
}

fn wide(value: &str) -> Vec<u16> {
  value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn wide_text(buffer: &[u16]) -> String {
  let end = buffer.iter().position(|unit| *unit == 0).unwrap_or(buffer.len());
  String::from_utf16_lossy(buffer.get(..end).unwrap_or_default())
}

/// Calls `read` with a growing UTF-16 buffer until the text fits. `read` returns the text length,
/// or the length that it needs.
fn read_wide(mut read: impl FnMut(&mut [u16]) -> io::Result<usize>) -> io::Result<String> {
  let mut capacity = 1024;
  loop {
    let mut buffer = vec![0u16; capacity];
    let length = read(&mut buffer)?;
    if length < capacity {
      buffer.truncate(length);
      return Ok(String::from_utf16_lossy(&buffer));
    }
    if capacity >= MAX_LONG_PATH {
      return Err(win32_error(ERROR_INSUFFICIENT_BUFFER));
    }
    capacity = length.max(capacity * 2).min(MAX_LONG_PATH);
  }
}

fn read_executable(handle: &OwnedHandle) -> io::Result<String> {
  read_wide(|buffer| {
    let mut length = u32::try_from(buffer.len()).unwrap_or(u32::MAX);
    // SAFETY: The handle is open, and the pointer and the length describe `buffer`.
    let read = unsafe {
      QueryFullProcessImageNameW(
        handle.as_raw_handle(),
        PROCESS_NAME_WIN32,
        buffer.as_mut_ptr(),
        &raw mut length,
      )
    };
    if read != 0 {
      return Ok(usize::try_from(length).unwrap_or(usize::MAX));
    }
    let error = io::Error::last_os_error();
    if is_error(&error, ERROR_INSUFFICIENT_BUFFER) {
      Ok(buffer.len())
    } else {
      Err(error)
    }
  })
}

/// Reads `length` bytes at `address` in the memory of another process.
fn read_memory(handle: &OwnedHandle, address: u64, length: usize) -> io::Result<Vec<u8>> {
  let address = usize::try_from(address).map_err(|_| unknown_format("A process memory address"))?;
  let mut buffer = vec![0u8; length];
  let mut read = 0usize;
  // SAFETY: The handle is open. The local pointer and length describe `buffer`, and the remote
  // address is only a value that Windows resolves in the other process.
  let copied = unsafe {
    ReadProcessMemory(
      handle.as_raw_handle(),
      std::ptr::without_provenance(address),
      buffer.as_mut_ptr().cast(),
      buffer.len(),
      &raw mut read,
    )
  };
  if copied == 0 {
    return Err(io::Error::last_os_error());
  }
  if read != length {
    return Err(io::Error::new(
      io::ErrorKind::UnexpectedEof,
      "The process memory read was short.",
    ));
  }
  Ok(buffer)
}

/// The address of `RTL_USER_PROCESS_PARAMETERS`, with the layout of the process.
fn parameters_address(handle: &OwnedHandle) -> io::Result<(u64, Layout)> {
  let mut wow64_peb: usize = 0;
  // SAFETY: The handle is open, and the pointer and the size describe `wow64_peb`.
  let status = unsafe {
    NtQueryInformationProcess(
      handle.as_raw_handle(),
      ProcessWow64Information,
      (&raw mut wow64_peb).cast(),
      size_u32::<usize>(),
      std::ptr::null_mut(),
    )
  };
  nt_result(status)?;
  let (peb, layout) = if wow64_peb == 0 {
    // SAFETY: All-zero bytes are a valid value of this plain C struct.
    let mut basic: PROCESS_BASIC_INFORMATION = unsafe { zeroed() };
    // SAFETY: The handle is open, and the pointer and the size describe `basic`.
    let status = unsafe {
      NtQueryInformationProcess(
        handle.as_raw_handle(),
        ProcessBasicInformation,
        (&raw mut basic).cast(),
        size_u32::<PROCESS_BASIC_INFORMATION>(),
        std::ptr::null_mut(),
      )
    };
    nt_result(status)?;
    (basic.PebBaseAddress.addr(), Layout::NATIVE)
  } else {
    (wow64_peb, Layout::WOW64)
  };
  if peb == 0 {
    return Err(unknown_format("The process environment"));
  }
  let peb = u64::try_from(peb).map_err(|_| unknown_format("The process environment"))?;
  let pointer = read_memory(handle, peb + layout.parameters_in_peb, layout.pointer_length)?;
  let address = layout
    .pointer(&pointer, 0)
    .ok_or_else(|| unknown_format("The process environment"))?;
  Ok((address, layout))
}

fn read_parameters(handle: &OwnedHandle) -> io::Result<ProcessParameters> {
  let (address, layout) = parameters_address(handle)?;
  let header = read_memory(handle, address, layout.header_length)?;
  layout
    .parse(&header)
    .ok_or_else(|| unknown_format("The process parameters"))
}

fn read_string(handle: &OwnedHandle, string: &RemoteString) -> io::Result<String> {
  // An empty string can have no buffer, so it needs no read.
  if string.byte_length == 0 {
    return Ok(String::new());
  }
  Ok(utf16_le(&read_memory(handle, string.address, string.byte_length)?))
}

/// The kind of the standard input, and the process that serves it when it is a pipe. `None` when
/// the process has no standard input. A child that inherits its input from the host shares the
/// pipe that the host serves.
fn standard_input(handle: &OwnedHandle) -> io::Result<Option<(InputKind, Option<u32>)>> {
  let input = read_parameters(handle)?.standard_input;
  if input == 0 {
    return Ok(None);
  }
  let input = usize::try_from(input).map_err(|_| unknown_format("The process input handle"))?;
  // SAFETY: `GetCurrentProcess` returns a pseudo handle and reads no memory.
  let current = unsafe { GetCurrentProcess() };
  let mut duplicate: HANDLE = std::ptr::null_mut();
  // SAFETY: Both process handles are open, the source handle is only a value that Windows
  // resolves in the other process, and the call writes `duplicate`.
  let duplicated = unsafe {
    DuplicateHandle(
      handle.as_raw_handle(),
      std::ptr::without_provenance_mut(input),
      current,
      &raw mut duplicate,
      0,
      0,
      DUPLICATE_SAME_ACCESS,
    )
  };
  if duplicated == 0 {
    let error = io::Error::last_os_error();
    // The process closed its standard input, so it has no pipe.
    return if is_error(&error, ERROR_INVALID_HANDLE) {
      Ok(None)
    } else {
      Err(error)
    };
  }
  // SAFETY: `DuplicateHandle` returned a new handle that nothing else owns.
  let duplicate = unsafe { OwnedHandle::from_raw_handle(duplicate) };
  // SAFETY: The handle is open.
  if unsafe { GetFileType(duplicate.as_raw_handle()) } != FILE_TYPE_PIPE {
    return Ok(Some((InputKind::Other, None)));
  }
  let mut server = 0u32;
  // SAFETY: The handle is open, and the pointer points to `server`.
  if unsafe { GetNamedPipeServerProcessId(duplicate.as_raw_handle(), &raw mut server) } == 0 {
    return Err(io::Error::last_os_error());
  }
  Ok(Some((InputKind::Pipe, Some(server))))
}

pub(crate) fn read_standard_inputs(targets: &[NativeProcessTarget]) -> Vec<NativeStandardInput> {
  targets
    .iter()
    .map(|target| {
      let gone = NativeStandardInput::gone(target);
      let access = PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ | PROCESS_DUP_HANDLE | PROCESS_SYNCHRONIZE;
      let read = match open_instance(target.pid, &target.identity, access) {
        Ok(Some(handle)) => standard_input(&handle),
        Ok(None) => return gone,
        Err(error) => Err(error),
      };
      match read {
        Ok(input) => NativeStandardInput {
          live: true,
          kind: input.map(|(kind, _)| kind),
          server_pid: input.and_then(|(_, server)| server),
          ..gone
        },
        Err(error) => NativeStandardInput {
          live: true,
          issue: Some(format!("The process input could not be read: {error}")),
          ..gone
        },
      }
    })
    .collect()
}

/// Resolves junctions, links, and letter case, as `realpath` does, so path checks see the target.
fn canonical_directory(path: &str) -> io::Result<String> {
  let wide_path = wide(path);
  // SAFETY: The path is NUL-terminated and outlives the call. The other pointers are null.
  let raw = unsafe {
    CreateFileW(
      wide_path.as_ptr(),
      0,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      std::ptr::null(),
      OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS,
      std::ptr::null_mut(),
    )
  };
  // SAFETY: `CreateFileW` returns `INVALID_HANDLE_VALUE` or a new handle that nothing else owns.
  let handle =
    OwnedHandle::try_from(unsafe { HandleOrInvalid::from_raw_handle(raw) }).map_err(|_| io::Error::last_os_error())?;
  let resolved = read_wide(|buffer| {
    let capacity = u32::try_from(buffer.len()).unwrap_or(u32::MAX);
    // SAFETY: The handle is open, and the pointer and the capacity describe `buffer`.
    let length = unsafe {
      GetFinalPathNameByHandleW(
        handle.as_raw_handle(),
        buffer.as_mut_ptr(),
        capacity,
        FILE_NAME_NORMALIZED | VOLUME_NAME_DOS,
      )
    };
    // A result at least as long as the buffer is the length that the call needs.
    match length {
      0 => Err(io::Error::last_os_error()),
      length => Ok(usize::try_from(length).unwrap_or(usize::MAX)),
    }
  })?;
  Ok(without_verbatim_prefix(resolved))
}

/// The argument array of `CommandLineToArgvW`. `LocalFree` releases it.
struct ArgumentArray(*mut *mut u16);

impl Drop for ArgumentArray {
  fn drop(&mut self) {
    // SAFETY: `CommandLineToArgvW` allocated the array, and only this guard frees it.
    unsafe { LocalFree(self.0.cast::<c_void>()) };
  }
}

/// Copies a NUL-terminated UTF-16 string into text.
///
/// # Safety
///
/// `pointer` must point to a NUL-terminated UTF-16 string that stays valid during the call.
unsafe fn text_until_nul(pointer: *const u16) -> String {
  let mut length = 0;
  // SAFETY: The caller promises a NUL-terminated string, so each unit up to the NUL is readable.
  while unsafe { pointer.wrapping_add(length).read() } != 0 {
    length += 1;
  }
  // SAFETY: The loop counted `length` readable units before the NUL.
  String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(pointer, length) })
}

/// Splits a command line as the C runtime of the process does.
fn split_command_line(command_line: &str) -> io::Result<Vec<String>> {
  if command_line.is_empty() {
    return Ok(Vec::new());
  }
  let units = wide(command_line);
  let mut count = 0i32;
  // SAFETY: The command line is NUL-terminated and outlives the call, and the call writes `count`.
  let array = unsafe { CommandLineToArgvW(units.as_ptr(), &raw mut count) };
  if array.is_null() {
    return Err(io::Error::last_os_error());
  }
  let array = ArgumentArray(array);
  let count = usize::try_from(count).unwrap_or(0);
  // SAFETY: The array holds `count` pointers and lives until `array` drops.
  let pointers = unsafe { std::slice::from_raw_parts(array.0, count) };
  let arguments = pointers
    .iter()
    // SAFETY: Each pointer is a NUL-terminated string inside the array allocation.
    .map(|pointer| unsafe { text_until_nul(*pointer) })
    .collect();
  Ok(arguments)
}

pub(crate) fn list_processes() -> io::Result<Vec<NativeProcess>> {
  // SAFETY: `CreateToolhelp32Snapshot` reads no memory.
  let raw = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
  // SAFETY: The call returns `INVALID_HANDLE_VALUE` or a new handle that nothing else owns.
  let snapshot =
    OwnedHandle::try_from(unsafe { HandleOrInvalid::from_raw_handle(raw) }).map_err(|_| io::Error::last_os_error())?;
  // SAFETY: All-zero bytes are a valid value of this plain C struct.
  let mut entry: PROCESSENTRY32W = unsafe { zeroed() };
  entry.dwSize = size_u32::<PROCESSENTRY32W>();
  let mut processes = Vec::new();
  // Many processes share a directory, so each directory resolves once.
  let mut directories = HashMap::new();
  // SAFETY: The snapshot is open, and `entry` holds its size.
  let mut more = unsafe { Process32FirstW(snapshot.as_raw_handle(), &raw mut entry) } != 0;
  while more {
    if entry.th32ProcessID > LAST_KERNEL_PID
      && let Some(process) = read_process(
        entry.th32ProcessID,
        entry.th32ParentProcessID,
        wide_text(&entry.szExeFile),
        &mut directories,
      )
    {
      processes.push(process);
    }
    // SAFETY: The snapshot is open, and `entry` holds its size.
    more = unsafe { Process32NextW(snapshot.as_raw_handle(), &raw mut entry) } != 0;
  }
  let error = io::Error::last_os_error();
  if !is_error(&error, ERROR_NO_MORE_FILES) {
    return Err(error);
  }
  Ok(processes)
}

fn read_process(
  pid: u32,
  parent_pid: u32,
  name: String,
  directories: &mut HashMap<String, Result<String, String>>,
) -> Option<NativeProcess> {
  let mut process = NativeProcess {
    pid,
    parent_pid,
    identity: String::new(),
    name,
    cwd: None,
    executable: None,
    arguments: None,
    issue: None,
  };
  let handle = match open(pid, PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ) {
    Ok(handle) => handle,
    Err(error) if is_error(&error, ERROR_INVALID_PARAMETER) => return None,
    Err(error) => {
      // A process that denies memory reads still has a creation time and an executable path.
      let handle = open(pid, PROCESS_QUERY_LIMITED_INFORMATION).ok()?;
      process.identity = creation_time(&handle).ok()?.to_string();
      process.executable = read_executable(&handle).ok();
      process.issue = Some(read_issue(&error));
      return Some(process);
    }
  };
  process.identity = creation_time(&handle).ok()?.to_string();
  if has_exited(&handle) {
    return None;
  }
  let mut issue = None;
  match read_executable(&handle) {
    Ok(executable) => process.executable = Some(executable),
    Err(error) => issue = Some(read_issue(&error)),
  }
  let parameters = read_parameters(&handle).and_then(|parameters| {
    let cwd = read_string(&handle, &parameters.current_directory)?;
    let command_line = read_string(&handle, &parameters.command_line)?;
    Ok((cwd, command_line))
  });
  match parameters {
    Ok((cwd, command_line)) => {
      match split_command_line(&command_line) {
        Ok(arguments) => process.arguments = Some(arguments),
        Err(error) => issue = issue.or_else(|| Some(read_issue(&error))),
      }
      let resolved = directories.entry(directory_path(cwd)).or_insert_with_key(|directory| {
        canonical_directory(directory).map_err(|error| format!("The process directory could not be resolved: {error}"))
      });
      match resolved {
        Ok(cwd) => process.cwd = Some(cwd.clone()),
        Err(message) => issue = issue.or_else(|| Some(message.clone())),
      }
    }
    Err(error) => issue = issue.or_else(|| Some(read_issue(&error))),
  }
  process.issue = issue;
  Some(process)
}

/// The owner PID and the listener of each listening TCP socket of one address family.
fn port_table(family: u16, layout: RowLayout) -> io::Result<Vec<(u32, NativeListener)>> {
  let mut table: Vec<u8> = Vec::new();
  let mut size = 0u32;
  loop {
    let pointer = if table.is_empty() {
      std::ptr::null_mut()
    } else {
      table.as_mut_ptr().cast()
    };
    // SAFETY: The pointer and `size` describe `table`. A null pointer with size 0 asks for the size.
    let result = unsafe {
      GetExtendedTcpTable(
        pointer,
        &raw mut size,
        0,
        u32::from(family),
        TCP_TABLE_OWNER_PID_LISTENER,
        0,
      )
    };
    match result {
      NO_ERROR => return parse_table(&table, layout),
      // The table grew since the size request, or this was the size request.
      ERROR_INSUFFICIENT_BUFFER => table.resize(usize::try_from(size).unwrap_or(usize::MAX), 0),
      code => return Err(win32_error(code)),
    }
  }
}

fn listeners_by_pid() -> io::Result<HashMap<u32, Vec<NativeListener>>> {
  let mut listeners: HashMap<u32, Vec<NativeListener>> = HashMap::new();
  let rows = port_table(AF_INET, RowLayout::IPV4)?
    .into_iter()
    .chain(port_table(AF_INET6, RowLayout::IPV6)?);
  for (pid, listener) in rows {
    listener.add_to(listeners.entry(pid).or_default());
  }
  Ok(listeners)
}

/// Opens the instance when it still runs with this identity. `Ok(None)` means that it exited.
fn open_instance(pid: u32, identity: &str, access: PROCESS_ACCESS_RIGHTS) -> io::Result<Option<OwnedHandle>> {
  let handle = match open(pid, access) {
    Ok(handle) => handle,
    Err(error) if is_error(&error, ERROR_INVALID_PARAMETER) => return Ok(None),
    Err(error) => return Err(error),
  };
  if has_exited(&handle) || creation_time(&handle)?.to_string() != identity {
    return Ok(None);
  }
  Ok(Some(handle))
}

pub(crate) fn inspect_processes(targets: &[NativeProcessTarget]) -> Vec<NativeInspection> {
  // Open every instance first. The open handles keep the PIDs from reuse while the table is read.
  let handles: Vec<io::Result<Option<OwnedHandle>>> = targets
    .iter()
    .map(|target| {
      open_instance(
        target.pid,
        &target.identity,
        PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
      )
    })
    .collect();
  let listeners = listeners_by_pid();
  targets
    .iter()
    .zip(handles)
    .map(|(target, handle)| {
      let gone = NativeInspection::gone(target);
      match handle {
        Ok(Some(handle)) if !has_exited(&handle) => {
          let (listeners, listener_issue) = match &listeners {
            Ok(table) => (Some(table.get(&target.pid).cloned().unwrap_or_default()), None),
            Err(error) => (None, Some(port_list_issue(error))),
          };
          NativeInspection {
            live: true,
            listeners,
            listener_issue,
            can_stop: open(target.pid, PROCESS_TERMINATE).is_ok(),
            ..gone
          }
        }
        Ok(_) => gone,
        Err(error) => NativeInspection {
          live: true,
          listener_issue: Some(listener_issue(&error)),
          ..gone
        },
      }
    })
    .collect()
}

pub(crate) fn stop_mode() -> StopMode {
  StopMode::Instance
}

fn read_evidence(handle: &OwnedHandle, request: &NativeStopRequest) -> io::Result<String> {
  if request.uses_cwd() {
    let cwd = read_string(handle, &read_parameters(handle)?.current_directory)?;
    canonical_directory(&directory_path(cwd))
  } else {
    read_executable(handle)
  }
}

pub(crate) fn stop_process(request: &NativeStopRequest) -> NativeStopOutcome {
  let access = PROCESS_TERMINATE | PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ;
  let handle = match open_instance(request.pid, &request.identity, access) {
    Ok(Some(handle)) => handle,
    Ok(None) => return NativeStopOutcome::of(StopOutcomeKind::AlreadyExited),
    Err(error) => return stop_failure(&error),
  };
  match read_evidence(&handle, request) {
    Ok(path) if path == request.evidence_path => {}
    Ok(_) => return request.evidence_changed(),
    Err(_) if has_exited(&handle) => return NativeStopOutcome::of(StopOutcomeKind::AlreadyExited),
    Err(error) => return stop_failure(&error),
  }
  // SAFETY: The handle is open with terminate access.
  if unsafe { TerminateProcess(handle.as_raw_handle(), 1) } == 0 {
    let error = io::Error::last_os_error();
    if has_exited(&handle) {
      return NativeStopOutcome::of(StopOutcomeKind::AlreadyExited);
    }
    return stop_failure(&error);
  }
  // `INFINITE` would wait forever, so the longest wait stops one millisecond before it.
  let timeout = request.timeout_ms.min(INFINITE - 1);
  // SAFETY: The handle is open with synchronize access.
  match unsafe { WaitForSingleObject(handle.as_raw_handle(), timeout) } {
    WAIT_OBJECT_0 => NativeStopOutcome::of(StopOutcomeKind::Stopped),
    WAIT_TIMEOUT => still_running(),
    _ => unobserved_exit(&io::Error::last_os_error()),
  }
}

/// A COM apartment that this thread entered. Dropping it leaves the apartment.
struct ComApartment;

impl Drop for ComApartment {
  fn drop(&mut self) {
    // SAFETY: The thread entered the apartment with `CoInitializeEx`, and leaves it once.
    unsafe { CoUninitialize() };
  }
}

/// Opens a URL with its default handler. Unlike `explorer.exe`, `ShellExecuteExW` reports failure.
pub(crate) fn open_url(url: &str) -> io::Result<()> {
  // Shell extensions can use COM. A thread that already has another apartment keeps it.
  let flags = (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE).cast_unsigned();
  // SAFETY: The reserved pointer is null.
  let _apartment = (unsafe { CoInitializeEx(std::ptr::null(), flags) } >= 0).then_some(ComApartment);
  let verb = wide("open");
  let file = wide(url);
  // SAFETY: All-zero bytes are a valid value of this plain C struct.
  let mut info: SHELLEXECUTEINFOW = unsafe { zeroed() };
  info.cbSize = size_u32::<SHELLEXECUTEINFOW>();
  info.fMask = SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
  info.lpVerb = verb.as_ptr();
  info.lpFile = file.as_ptr();
  info.nShow = SW_SHOWNORMAL;
  // SAFETY: `info` holds its size, and its strings are NUL-terminated and outlive the call.
  if unsafe { ShellExecuteExW(&raw mut info) } == 0 {
    return Err(io::Error::last_os_error());
  }
  Ok(())
}
