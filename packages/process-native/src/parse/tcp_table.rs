//! The `MIB_TCPTABLE_OWNER_PID` and `MIB_TCP6TABLE_OWNER_PID` tables of `GetExtendedTcpTable`: a
//! row count, then the rows at 4-byte alignment. A port sits in the low 16 bits of its `DWORD` in
//! network order, and an IPv4 address in network order.

use super::{bytes_at, unknown_format};
use crate::model::NativeListener;
use std::io;
use std::net::IpAddr;

const ROWS_OFFSET: usize = 4;

/// The row layout of one address family.
#[derive(Clone, Copy, Debug)]
pub(crate) struct RowLayout {
  pub(crate) length: usize,
  pub(crate) address: usize,
  pub(crate) address_length: usize,
  pub(crate) port: usize,
  pub(crate) pid: usize,
}

impl RowLayout {
  /// `MIB_TCPROW_OWNER_PID`: state, local address, local port, remote address, remote port, PID.
  pub(crate) const IPV4: Self = Self {
    length: 24,
    address: 4,
    address_length: 4,
    port: 8,
    pid: 20,
  };

  /// `MIB_TCP6ROW_OWNER_PID`: local address, scope, local port, remote address, scope, remote
  /// port, state, PID.
  pub(crate) const IPV6: Self = Self {
    length: 56,
    address: 0,
    address_length: 16,
    port: 20,
    pid: 52,
  };

  fn listener(self, row: &[u8]) -> Option<(u32, NativeListener)> {
    let address = if self.address_length == 4 {
      IpAddr::from(bytes_at::<4>(row, self.address)?)
    } else {
      IpAddr::from(bytes_at::<16>(row, self.address)?)
    };
    let port = u16::from_be_bytes(bytes_at(row, self.port)?);
    let pid = u32::from_le_bytes(bytes_at(row, self.pid)?);
    Some((pid, NativeListener::new(address, port)))
  }
}

/// The owner PID and the listener of each row.
pub(crate) fn parse_table(table: &[u8], layout: RowLayout) -> io::Result<Vec<(u32, NativeListener)>> {
  let invalid = || unknown_format("The port table");
  let Some(count) = bytes_at(table, 0).map(u32::from_le_bytes) else {
    return Ok(Vec::new());
  };
  let rows_end = usize::try_from(count)
    .ok()
    .and_then(|count| count.checked_mul(layout.length))
    .and_then(|length| length.checked_add(ROWS_OFFSET))
    .ok_or_else(invalid)?;
  let rows = table.get(ROWS_OFFSET..rows_end).ok_or_else(invalid)?;
  rows
    .chunks_exact(layout.length)
    .map(|row| layout.listener(row).ok_or_else(invalid))
    .collect()
}

#[cfg(test)]
mod tests {
  use super::{RowLayout, parse_table};
  use crate::model::NativeListener;
  use std::net::{IpAddr, Ipv6Addr};

  fn table(rows: &[Vec<u8>]) -> Vec<u8> {
    let mut data = u32::try_from(rows.len()).unwrap().to_le_bytes().to_vec();
    for row in rows {
      data.extend_from_slice(row);
    }
    data
  }

  fn ipv4_row(address: [u8; 4], port: u16, pid: u32) -> Vec<u8> {
    let mut row = vec![0u8; RowLayout::IPV4.length];
    row[4..8].copy_from_slice(&address);
    row[8..10].copy_from_slice(&port.to_be_bytes());
    row[20..24].copy_from_slice(&pid.to_le_bytes());
    row
  }

  #[test]
  fn reads_ipv4_rows() {
    let data = table(&[ipv4_row([0, 0, 0, 0], 5173, 900), ipv4_row([127, 0, 0, 1], 3000, 901)]);
    let rows = parse_table(&data, RowLayout::IPV4).unwrap();
    assert_eq!(rows[0], (900, NativeListener::new(IpAddr::from([0, 0, 0, 0]), 5173)));
    assert_eq!(rows[1], (901, NativeListener::new(IpAddr::from([127, 0, 0, 1]), 3000)));
  }

  #[test]
  fn reads_ipv6_rows() {
    let mut row = vec![0u8; RowLayout::IPV6.length];
    row[..16].copy_from_slice(&Ipv6Addr::LOCALHOST.octets());
    row[20..22].copy_from_slice(&8080u16.to_be_bytes());
    row[52..56].copy_from_slice(&77u32.to_le_bytes());
    let rows = parse_table(&table(&[row]), RowLayout::IPV6).unwrap();
    assert_eq!(
      rows,
      [(77, NativeListener::new(IpAddr::from(Ipv6Addr::LOCALHOST), 8080))]
    );
  }

  #[test]
  fn rejects_a_count_beyond_the_buffer() {
    let mut data = table(&[ipv4_row([127, 0, 0, 1], 80, 1)]);
    data[0] = 2;
    assert!(parse_table(&data, RowLayout::IPV4).is_err());
    assert!(parse_table(&u32::MAX.to_le_bytes(), RowLayout::IPV6).is_err());
  }

  #[test]
  fn reads_an_empty_table() {
    assert_eq!(parse_table(&[], RowLayout::IPV4).unwrap(), []);
    assert_eq!(parse_table(&0u32.to_le_bytes(), RowLayout::IPV4).unwrap(), []);
  }
}
