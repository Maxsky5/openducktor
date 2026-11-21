//! The Linux `/proc/<pid>/stat` and `/proc/<pid>/cmdline` files, and the socket links of
//! `/proc/<pid>/fd`, as `proc_pid_stat(5)`, `proc_pid_cmdline(5)`, and `proc_pid_fd(5)` describe them.

use super::lossy;
use crate::model::InputKind;

pub(crate) struct ProcStat {
  pub(crate) state: u8,
  pub(crate) parent_pid: u32,
  pub(crate) start_time: u64,
  pub(crate) name: String,
}

impl ProcStat {
  /// True for a zombie or a dead process, which no longer runs.
  pub(crate) fn is_gone(&self) -> bool {
    self.state == b'Z' || self.state == b'X'
  }
}

/// Parses `/proc/<pid>/stat`. The name sits in parentheses and can hold spaces or parentheses, so
/// the fields start after the last closing parenthesis.
pub(crate) fn parse_stat(content: &[u8]) -> Option<ProcStat> {
  let open = content.iter().position(|byte| *byte == b'(')?;
  let close = content.iter().rposition(|byte| *byte == b')')?;
  let name = lossy(content.get(open + 1..close)?);
  let mut fields = std::str::from_utf8(content.get(close + 1..)?)
    .ok()?
    .split_ascii_whitespace();
  // The iterator starts at field 3 (state). Field 4 is the parent PID, and field 22 the start time.
  let state = *fields.next()?.as_bytes().first()?;
  let parent_pid = fields.next()?.parse().ok()?;
  let start_time = fields.nth(17)?.parse().ok()?;
  Some(ProcStat {
    state,
    parent_pid,
    start_time,
    name,
  })
}

/// Splits `/proc/<pid>/cmdline` into arguments. Each argument ends with a NUL byte. A process that
/// rewrote its arguments can pad them with more NUL bytes, so trailing ones carry no argument.
pub(crate) fn parse_cmdline(content: &[u8]) -> Vec<String> {
  let end = content.iter().rposition(|byte| *byte != 0).map_or(0, |last| last + 1);
  match content.get(..end) {
    Some([]) | None => Vec::new(),
    Some(arguments) => arguments.split(|byte| *byte == 0).map(lossy).collect(),
  }
}

/// The inode of a `socket:[<inode>]` descriptor link, or `None` for another descriptor.
pub(crate) fn socket_inode(link: &[u8]) -> Option<u64> {
  let inode = link.strip_prefix(b"socket:[")?.strip_suffix(b"]")?;
  std::str::from_utf8(inode).ok()?.parse().ok()
}

/// The kind of the `/proc/<pid>/fd/0` link: `pipe:[<inode>]` and `socket:[<inode>]` are channels.
pub(crate) fn input_kind(link: &[u8]) -> InputKind {
  if link.starts_with(b"pipe:[") || link.starts_with(b"socket:[") {
    InputKind::Pipe
  } else {
    InputKind::Other
  }
}

#[cfg(test)]
mod tests {
  use super::{input_kind, parse_cmdline, parse_stat, socket_inode};
  use crate::model::InputKind;

  #[test]
  fn reads_channels_as_pipes() {
    assert_eq!(input_kind(b"pipe:[4026]"), InputKind::Pipe);
    assert_eq!(input_kind(b"socket:[4027]"), InputKind::Pipe);
    assert_eq!(input_kind(b"/dev/null"), InputKind::Other);
    assert_eq!(input_kind(b"/dev/pts/3"), InputKind::Other);
  }

  #[test]
  fn parses_names_with_spaces_and_parentheses() {
    let stat = parse_stat(b"42 (a (b) c) S 7 42 42 0 -1 4194560 0 0 0 0 0 0 0 0 20 0 1 0 98765 0 0");
    let stat = stat.as_ref();
    assert_eq!(stat.map(|stat| stat.name.as_str()), Some("a (b) c"));
    assert_eq!(stat.map(|stat| stat.state), Some(b'S'));
    assert_eq!(stat.map(|stat| stat.parent_pid), Some(7));
    assert_eq!(stat.map(|stat| stat.start_time), Some(98765));
    assert_eq!(stat.map(super::ProcStat::is_gone), Some(false));
  }

  #[test]
  fn rejects_a_truncated_stat() {
    assert!(parse_stat(b"42 (node) S 7 42").is_none());
    assert!(parse_stat(b"42 node S 7").is_none());
  }

  #[test]
  fn keeps_empty_arguments_and_drops_the_padding() {
    assert_eq!(parse_cmdline(b"sh\0-c\0\0"), ["sh", "-c"]);
    assert_eq!(parse_cmdline(b"printf\0\0x\0"), ["printf", "", "x"]);
    assert_eq!(parse_cmdline(b"postgres: writer\0\0\0\0"), ["postgres: writer"]);
    assert_eq!(parse_cmdline(b""), Vec::<String>::new());
    assert_eq!(parse_cmdline(b"\0\0"), Vec::<String>::new());
  }

  #[test]
  fn reads_socket_inodes_only() {
    assert_eq!(socket_inode(b"socket:[123456]"), Some(123_456));
    assert_eq!(socket_inode(b"pipe:[123456]"), None);
    assert_eq!(socket_inode(b"socket:[x]"), None);
    assert_eq!(socket_inode(b"/dev/null"), None);
  }
}
