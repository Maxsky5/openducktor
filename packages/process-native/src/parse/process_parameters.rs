//! The start of `RTL_USER_PROCESS_PARAMETERS` in the memory of another Windows process, and the
//! PEB field that points to it. A 64-bit process and a 32-bit WOW64 process use other layouts.

use super::bytes_at;

/// The pointer size and field offsets of one process type.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Layout {
  /// The offset of `ProcessParameters` in the PEB.
  pub(crate) parameters_in_peb: u64,
  pub(crate) pointer_length: usize,
  /// The bytes from the start of the parameters to the end of `CommandLine`.
  pub(crate) header_length: usize,
  standard_input: usize,
  /// `CurrentDirectory.DosPath`, a `UNICODE_STRING`.
  current_directory: usize,
  command_line: usize,
}

impl Layout {
  pub(crate) const NATIVE: Self = Self {
    parameters_in_peb: 0x20,
    pointer_length: 8,
    header_length: 0x80,
    standard_input: 0x20,
    current_directory: 0x38,
    command_line: 0x70,
  };

  pub(crate) const WOW64: Self = Self {
    parameters_in_peb: 0x10,
    pointer_length: 4,
    header_length: 0x48,
    standard_input: 0x18,
    current_directory: 0x24,
    command_line: 0x40,
  };

  /// Reads a pointer of this layout at `offset`.
  pub(crate) fn pointer(self, data: &[u8], offset: usize) -> Option<u64> {
    if self.pointer_length == 8 {
      bytes_at(data, offset).map(u64::from_le_bytes)
    } else {
      bytes_at(data, offset).map(u32::from_le_bytes).map(u64::from)
    }
  }

  /// Parses the parameter header. `None` means an unknown layout.
  pub(crate) fn parse(self, header: &[u8]) -> Option<ProcessParameters> {
    Some(ProcessParameters {
      standard_input: self.pointer(header, self.standard_input)?,
      current_directory: self.remote_string(header, self.current_directory)?,
      command_line: self.remote_string(header, self.command_line)?,
    })
  }

  /// A `UNICODE_STRING`: the byte length, the maximum length, then the buffer pointer at the
  /// pointer alignment.
  fn remote_string(self, header: &[u8], offset: usize) -> Option<RemoteString> {
    let byte_length = usize::from(u16::from_le_bytes(bytes_at(header, offset)?));
    let address = self.pointer(header, offset + self.pointer_length)?;
    let valid = byte_length.is_multiple_of(2) && (byte_length == 0 || address != 0);
    valid.then_some(RemoteString { address, byte_length })
  }
}

/// A UTF-16 string in the memory of another process.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct RemoteString {
  pub(crate) address: u64,
  pub(crate) byte_length: usize,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ProcessParameters {
  /// The handle value of the standard input in the other process. Zero means none.
  pub(crate) standard_input: u64,
  pub(crate) current_directory: RemoteString,
  pub(crate) command_line: RemoteString,
}

/// Text from little-endian UTF-16 bytes.
pub(crate) fn utf16_le(bytes: &[u8]) -> String {
  let units: Vec<u16> = bytes
    .as_chunks::<2>()
    .0
    .iter()
    .map(|pair| u16::from_le_bytes(*pair))
    .collect();
  String::from_utf16_lossy(&units)
}

#[cfg(test)]
mod tests {
  use super::{Layout, ProcessParameters, RemoteString, utf16_le};

  fn put(header: &mut [u8], offset: usize, bytes: &[u8]) {
    header[offset..offset + bytes.len()].copy_from_slice(bytes);
  }

  #[test]
  fn parses_the_parameters_of_a_64_bit_process() {
    let mut header = vec![0u8; Layout::NATIVE.header_length];
    put(&mut header, 0x20, &0x1cu64.to_le_bytes());
    put(&mut header, 0x38, &12u16.to_le_bytes());
    put(&mut header, 0x40, &0x7ff0_0000_1000u64.to_le_bytes());
    put(&mut header, 0x70, &20u16.to_le_bytes());
    put(&mut header, 0x78, &0x7ff0_0000_2000u64.to_le_bytes());
    assert_eq!(
      Layout::NATIVE.parse(&header),
      Some(ProcessParameters {
        standard_input: 0x1c,
        current_directory: RemoteString {
          address: 0x7ff0_0000_1000,
          byte_length: 12
        },
        command_line: RemoteString {
          address: 0x7ff0_0000_2000,
          byte_length: 20
        },
      })
    );
  }

  #[test]
  fn parses_the_parameters_of_a_wow64_process() {
    let mut header = vec![0u8; Layout::WOW64.header_length];
    put(&mut header, 0x18, &0x2cu32.to_le_bytes());
    put(&mut header, 0x24, &6u16.to_le_bytes());
    put(&mut header, 0x28, &0x0050_1000u32.to_le_bytes());
    put(&mut header, 0x40, &8u16.to_le_bytes());
    put(&mut header, 0x44, &0x0050_2000u32.to_le_bytes());
    let parameters = Layout::WOW64.parse(&header).unwrap();
    assert_eq!(parameters.standard_input, 0x2c);
    assert_eq!(parameters.current_directory.address, 0x0050_1000);
    assert_eq!(parameters.command_line.byte_length, 8);
  }

  #[test]
  fn rejects_a_string_with_an_odd_length_or_no_buffer() {
    let mut header = vec![0u8; Layout::NATIVE.header_length];
    put(&mut header, 0x38, &3u16.to_le_bytes());
    put(&mut header, 0x40, &0x1000u64.to_le_bytes());
    assert_eq!(Layout::NATIVE.parse(&header), None);
    put(&mut header, 0x38, &4u16.to_le_bytes());
    put(&mut header, 0x40, &0u64.to_le_bytes());
    assert_eq!(Layout::NATIVE.parse(&header), None);
    assert_eq!(Layout::NATIVE.parse(&header[..0x40]), None);
  }

  #[test]
  fn decodes_utf16_text() {
    let bytes: Vec<u8> = "C:\\work".encode_utf16().flat_map(u16::to_le_bytes).collect();
    assert_eq!(utf16_le(&bytes), "C:\\work");
  }
}
