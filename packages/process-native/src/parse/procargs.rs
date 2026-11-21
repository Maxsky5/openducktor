//! The `KERN_PROCARGS2` buffer of macOS: the argument count as a native `int`, the executable path,
//! NUL padding, then the arguments and the environment, each one NUL-terminated.

use super::{bytes_at, lossy};

/// The arguments of the buffer, or `None` when the buffer is shorter than its header.
pub(crate) fn parse_procargs2(data: &[u8]) -> Option<Vec<String>> {
  let count = usize::try_from(i32::from_ne_bytes(bytes_at(data, 0)?)).ok()?;
  let after_count = data.get(4..)?;
  let path_end = after_count.iter().position(|byte| *byte == 0)?;
  let padding = after_count.get(path_end..)?;
  let start = padding.iter().position(|byte| *byte != 0).unwrap_or(padding.len());
  let strings = padding.get(start..)?;
  Some(strings.split(|byte| *byte == 0).take(count).map(lossy).collect())
}

#[cfg(test)]
mod tests {
  use super::parse_procargs2;

  fn buffer(count: i32, rest: &[u8]) -> Vec<u8> {
    let mut data = count.to_ne_bytes().to_vec();
    data.extend_from_slice(rest);
    data
  }

  #[test]
  fn reads_the_arguments_and_skips_the_environment() {
    let data = buffer(3, b"/usr/bin/node\0\0\0\0node\0server.js\0\0HOME=/Users/me\0");
    let arguments = ["node", "server.js", ""].map(String::from).to_vec();
    assert_eq!(parse_procargs2(&data), Some(arguments));
    let data = buffer(1, b"/bin/sh\0\0sh\0PATH=/bin\0");
    assert_eq!(parse_procargs2(&data), Some(vec!["sh".to_string()]));
  }

  #[test]
  fn reads_a_process_without_arguments() {
    assert_eq!(
      parse_procargs2(&buffer(0, b"/bin/tool\0\0PATH=/bin\0")),
      Some(Vec::new())
    );
  }

  #[test]
  fn rejects_a_short_or_invalid_buffer() {
    assert_eq!(parse_procargs2(&[1, 0]), None);
    assert_eq!(parse_procargs2(&buffer(-1, b"/bin/tool\0arg\0")), None);
    assert_eq!(parse_procargs2(&buffer(1, b"/bin/tool-without-end")), None);
  }
}
