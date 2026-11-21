//! Pure parsers of system data formats. They take bytes and return values, so every target builds
//! and tests them with fixtures, also the formats of the other systems.

#[cfg(any(target_os = "linux", test))]
pub(crate) mod proc_files;
#[cfg(any(target_os = "macos", test))]
pub(crate) mod procargs;
#[cfg(any(windows, test))]
pub(crate) mod process_parameters;
#[cfg(any(target_os = "linux", test))]
pub(crate) mod sock_diag;
#[cfg(any(windows, test))]
pub(crate) mod tcp_table;
#[cfg(any(windows, test))]
pub(crate) mod windows_path;

use std::io;

/// The `N` bytes at `offset`, or `None` when the data is shorter.
pub(crate) fn bytes_at<const N: usize>(data: &[u8], offset: usize) -> Option<[u8; N]> {
  data.get(offset..offset.checked_add(N)?)?.try_into().ok()
}

/// The error of data that does not match its documented format.
pub(crate) fn unknown_format(what: &str) -> io::Error {
  io::Error::new(io::ErrorKind::InvalidData, format!("{what} has an unknown format."))
}

/// Text from bytes that the system does not promise to be UTF-8, such as a path or an argument.
#[cfg(any(unix, test))]
pub(crate) fn lossy(bytes: &[u8]) -> String {
  String::from_utf8_lossy(bytes).into_owned()
}
