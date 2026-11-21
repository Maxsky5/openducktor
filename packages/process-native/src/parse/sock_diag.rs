//! The messages of `NETLINK_SOCK_DIAG` from `linux/netlink.h`, `linux/sock_diag.h`, and
//! `linux/inet_diag.h`. Netlink fields use the byte order of the host. Ports use network order.

use super::{bytes_at, unknown_format};
use crate::model::NativeListener;
use std::collections::HashMap;
use std::io;
use std::net::IpAddr;

/// `struct nlmsghdr`: length, type, flags, sequence, and port ID.
const HEADER_LENGTH: usize = 16;
/// `struct inet_diag_req_v2`: family, protocol, extensions, padding, states, and `inet_diag_sockid`.
const REQUEST_BODY_LENGTH: usize = 56;
/// `struct inet_diag_msg`.
const MESSAGE_BODY_LENGTH: usize = 72;

const SOCK_DIAG_BY_FAMILY: u16 = 20;
const NLM_F_REQUEST: u16 = 0x1;
const NLM_F_DUMP: u16 = 0x300;
const NLMSG_ERROR: u16 = 0x2;
const NLMSG_DONE: u16 = 0x3;
const IPPROTO_TCP: u8 = 6;
const TCP_LISTEN: u32 = 10;

pub(crate) const AF_INET: u8 = 2;
pub(crate) const AF_INET6: u8 = 10;

/// Field offsets in `struct inet_diag_msg`. `inet_diag_sockid` starts at offset 4.
const MESSAGE_FAMILY: usize = 0;
const MESSAGE_SOURCE_PORT: usize = 4;
const MESSAGE_SOURCE_ADDRESS: usize = 8;
const MESSAGE_INODE: usize = 68;

/// The dump request of the listening TCP sockets of one address family.
pub(crate) fn listener_request(family: u8, sequence: u32) -> Vec<u8> {
  let length = HEADER_LENGTH + REQUEST_BODY_LENGTH;
  let mut message = Vec::with_capacity(length);
  message.extend_from_slice(&u32::try_from(length).unwrap_or(u32::MAX).to_ne_bytes());
  message.extend_from_slice(&SOCK_DIAG_BY_FAMILY.to_ne_bytes());
  message.extend_from_slice(&(NLM_F_REQUEST | NLM_F_DUMP).to_ne_bytes());
  message.extend_from_slice(&sequence.to_ne_bytes());
  message.extend_from_slice(&0u32.to_ne_bytes());
  message.extend_from_slice(&[family, IPPROTO_TCP, 0, 0]);
  message.extend_from_slice(&(1u32 << TCP_LISTEN).to_ne_bytes());
  message.resize(length, 0);
  message
}

/// Whether the dump has more messages after one datagram.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Progress {
  More,
  Done,
}

/// Adds the listeners of one datagram to `sockets`, by socket inode.
pub(crate) fn read_listeners(data: &[u8], sockets: &mut HashMap<u64, Vec<NativeListener>>) -> io::Result<Progress> {
  let invalid = || unknown_format("The socket list");
  let mut rest = data;
  while rest.len() >= HEADER_LENGTH {
    let length = usize::try_from(u32::from_ne_bytes(bytes_at(rest, 0).ok_or_else(invalid)?)).map_err(|_| invalid())?;
    let kind = u16::from_ne_bytes(bytes_at(rest, 4).ok_or_else(invalid)?);
    let body = rest.get(HEADER_LENGTH..length).ok_or_else(invalid)?;
    match kind {
      NLMSG_DONE => return Ok(Progress::Done),
      NLMSG_ERROR => {
        // `struct nlmsgerr` starts with the negative errno. Zero acknowledges the request.
        let code = i32::from_ne_bytes(bytes_at(body, 0).ok_or_else(invalid)?);
        return match code.checked_neg() {
          Some(0) => Ok(Progress::Done),
          Some(errno) => Err(io::Error::from_raw_os_error(errno)),
          None => Err(invalid()),
        };
      }
      SOCK_DIAG_BY_FAMILY => {
        let (inode, listener) = listener_of(body).ok_or_else(invalid)?;
        listener.add_to(sockets.entry(inode).or_default());
      }
      _ => {}
    }
    rest = rest.get(length.next_multiple_of(4)..).unwrap_or_default();
  }
  Ok(Progress::More)
}

fn listener_of(body: &[u8]) -> Option<(u64, NativeListener)> {
  if body.len() < MESSAGE_BODY_LENGTH {
    return None;
  }
  let source: [u8; 16] = bytes_at(body, MESSAGE_SOURCE_ADDRESS)?;
  let address = match *body.get(MESSAGE_FAMILY)? {
    AF_INET => {
      let [a, b, c, d, ..] = source;
      IpAddr::from([a, b, c, d])
    }
    AF_INET6 => IpAddr::from(source),
    _ => return None,
  };
  let port = u16::from_be_bytes(bytes_at(body, MESSAGE_SOURCE_PORT)?);
  let inode = u32::from_ne_bytes(bytes_at(body, MESSAGE_INODE)?);
  Some((u64::from(inode), NativeListener::new(address, port)))
}

#[cfg(test)]
mod tests {
  use super::{
    AF_INET, AF_INET6, HEADER_LENGTH, MESSAGE_BODY_LENGTH, NLMSG_DONE, NLMSG_ERROR, Progress, SOCK_DIAG_BY_FAMILY,
    listener_request, read_listeners,
  };
  use crate::model::NativeListener;
  use std::collections::HashMap;
  use std::net::{IpAddr, Ipv6Addr};

  fn message(kind: u16, body: &[u8]) -> Vec<u8> {
    let length = u32::try_from(HEADER_LENGTH + body.len()).unwrap_or(u32::MAX);
    let mut data = length.to_ne_bytes().to_vec();
    data.extend_from_slice(&kind.to_ne_bytes());
    data.extend_from_slice(&[0; 10]);
    data.extend_from_slice(body);
    data.resize(data.len().next_multiple_of(4), 0);
    data
  }

  fn socket(family: u8, address: &[u8], port: u16, inode: u32) -> Vec<u8> {
    let mut body = vec![0u8; MESSAGE_BODY_LENGTH];
    body[0] = family;
    body.splice(4..6, port.to_be_bytes());
    body.splice(8..8 + address.len(), address.iter().copied());
    body.splice(68..72, inode.to_ne_bytes());
    message(SOCK_DIAG_BY_FAMILY, &body)
  }

  #[test]
  fn builds_the_listener_dump_request() {
    let request = listener_request(AF_INET6, 7);
    assert_eq!(request.len(), 72);
    assert_eq!(request.get(..4), Some(&72u32.to_ne_bytes()[..]));
    assert_eq!(request.get(16..18), Some(&[AF_INET6, 6][..]));
    assert_eq!(request.get(20..24), Some(&(1u32 << 10).to_ne_bytes()[..]));
  }

  #[test]
  fn maps_each_listening_socket_to_its_inode() {
    let mut data = socket(AF_INET, &[127, 0, 0, 1], 5173, 41);
    data.extend(socket(AF_INET6, &Ipv6Addr::LOCALHOST.octets(), 3000, 42));
    data.extend(socket(AF_INET, &[127, 0, 0, 1], 5173, 41));
    let mut sockets = HashMap::new();
    assert_eq!(read_listeners(&data, &mut sockets).ok(), Some(Progress::More));
    let local = IpAddr::from([127, 0, 0, 1]);
    assert_eq!(sockets.get(&41), Some(&vec![NativeListener::new(local, 5173)]));
    let local6 = IpAddr::from(Ipv6Addr::LOCALHOST);
    assert_eq!(sockets.get(&42), Some(&vec![NativeListener::new(local6, 3000)]));
  }

  #[test]
  fn stops_at_the_end_of_the_dump() {
    let mut data = message(NLMSG_DONE, &[0; 4]);
    data.extend(socket(AF_INET, &[127, 0, 0, 1], 80, 9));
    let mut sockets = HashMap::new();
    assert_eq!(read_listeners(&data, &mut sockets).ok(), Some(Progress::Done));
    assert!(sockets.is_empty());
  }

  #[test]
  fn reports_the_error_of_the_kernel() {
    let mut sockets = HashMap::new();
    let error = read_listeners(&message(NLMSG_ERROR, &(-13i32).to_ne_bytes()), &mut sockets).err();
    assert_eq!(error.and_then(|error| error.raw_os_error()), Some(13));
    let acknowledged = read_listeners(&message(NLMSG_ERROR, &0i32.to_ne_bytes()), &mut sockets);
    assert_eq!(acknowledged.ok(), Some(Progress::Done));
  }

  #[test]
  fn rejects_a_message_longer_than_the_datagram() {
    let mut data = socket(AF_INET, &[127, 0, 0, 1], 80, 9);
    data.truncate(40);
    assert!(read_listeners(&data, &mut HashMap::new()).is_err());
    assert!(read_listeners(&message(SOCK_DIAG_BY_FAMILY, &[AF_INET; 8]), &mut HashMap::new()).is_err());
  }
}
