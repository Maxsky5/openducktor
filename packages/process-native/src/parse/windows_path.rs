//! Windows path forms that the native reads return.

/// Removes the trailing separator that Windows keeps on a current directory, except on a root
/// such as `C:\`.
pub(crate) fn directory_path(mut path: String) -> String {
  if path.len() > 3 && path.ends_with('\\') {
    path.pop();
  }
  path
}

/// Removes the `\\?\` prefix of `GetFinalPathNameByHandleW`, so a path matches the form that other
/// programs use: `\\?\C:\work` becomes `C:\work`, and `\\?\UNC\server\share` becomes
/// `\\server\share`.
pub(crate) fn without_verbatim_prefix(path: String) -> String {
  if let Some(share) = path.strip_prefix("\\\\?\\UNC\\") {
    return format!("\\\\{share}");
  }
  match path.strip_prefix("\\\\?\\") {
    Some(local) => local.to_string(),
    None => path,
  }
}

#[cfg(test)]
mod tests {
  use super::{directory_path, without_verbatim_prefix};

  #[test]
  fn removes_the_trailing_separator_except_on_a_root() {
    assert_eq!(directory_path("C:\\work\\".into()), "C:\\work");
    assert_eq!(directory_path("C:\\".into()), "C:\\");
    assert_eq!(directory_path("C:\\work".into()), "C:\\work");
  }

  #[test]
  fn removes_the_verbatim_prefix() {
    assert_eq!(without_verbatim_prefix("\\\\?\\C:\\work".into()), "C:\\work");
    assert_eq!(
      without_verbatim_prefix("\\\\?\\UNC\\server\\share".into()),
      "\\\\server\\share"
    );
    assert_eq!(without_verbatim_prefix("C:\\work".into()), "C:\\work");
  }
}
