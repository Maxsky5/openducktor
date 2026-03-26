use anyhow::{anyhow, Result};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

pub fn normalize_user_path(path: &Path) -> Result<PathBuf> {
    let Some(raw) = path.to_str() else {
        return Ok(path.to_path_buf());
    };
    if raw == "~" {
        return dirs::home_dir().ok_or_else(|| anyhow!("Unable to resolve user home directory"));
    }
    if let Some(suffix) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
        let home =
            dirs::home_dir().ok_or_else(|| anyhow!("Unable to resolve user home directory"))?;
        return Ok(home.join(suffix));
    }
    Ok(path.to_path_buf())
}

pub fn parse_user_path(raw: &str) -> Result<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("Path is empty; provide a valid path"));
    }
    let unquoted = strip_matching_quotes(trimmed);
    if unquoted.is_empty() {
        return Err(anyhow!("Path is empty; provide a valid path"));
    }
    normalize_user_path(Path::new(unquoted))
}

pub fn parse_user_path_os(raw: &OsStr) -> Result<PathBuf> {
    if raw.is_empty() {
        return Err(anyhow!("Path is empty; provide a valid path"));
    }
    let Some(raw_str) = raw.to_str() else {
        return normalize_user_path(Path::new(raw));
    };
    parse_user_path(raw_str)
}

fn strip_matching_quotes(value: &str) -> &str {
    if value.len() >= 2 {
        let first = value.as_bytes()[0];
        let last = value.as_bytes()[value.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return &value[1..value.len() - 1];
        }
    }
    value
}

#[cfg(test)]
mod tests {
    use super::{normalize_user_path, parse_user_path, parse_user_path_os};
    use host_test_support::{lock_env, EnvVarGuard};
    use std::ffi::OsStr;
    use std::path::{Path, PathBuf};

    #[test]
    fn normalize_user_path_expands_home_shorthand() {
        let _env_lock = lock_env();
        let home = std::env::temp_dir().join("odt-user-paths-home");
        let _home_guard = EnvVarGuard::set("HOME", home.to_string_lossy().as_ref());

        let resolved = normalize_user_path(Path::new("~/workspace")).expect("path should resolve");

        assert_eq!(resolved, home.join("workspace"));
    }

    #[test]
    fn parse_user_path_trims_and_unquotes() {
        let _env_lock = lock_env();
        let home = std::env::temp_dir().join("odt-user-paths-quoted-home");
        let _home_guard = EnvVarGuard::set("HOME", home.to_string_lossy().as_ref());

        let resolved =
            parse_user_path("  \"~/.openducktor-local\"  ").expect("quoted path should resolve");

        assert_eq!(resolved, home.join(".openducktor-local"));
    }

    #[test]
    fn parse_user_path_os_supports_utf8_values() {
        let _env_lock = lock_env();
        let home = std::env::temp_dir().join("odt-user-paths-os-home");
        let _home_guard = EnvVarGuard::set("HOME", home.to_string_lossy().as_ref());

        let resolved = parse_user_path_os(OsStr::new("~/.config")).expect("os path should resolve");

        assert_eq!(resolved, home.join(".config"));
    }

    #[test]
    fn parse_user_path_rejects_empty_input() {
        let error = parse_user_path("   ").expect_err("empty path should fail");
        assert!(error.to_string().contains("Path is empty"));
    }

    #[test]
    fn normalize_user_path_preserves_non_tilde_relative_paths() {
        let resolved = normalize_user_path(Path::new("./relative/path"))
            .expect("relative path should resolve");
        assert_eq!(resolved, PathBuf::from("./relative/path"));
    }

    #[test]
    fn normalize_user_path_supports_windows_style_home_shorthand() {
        let _env_lock = lock_env();
        let home = std::env::temp_dir().join("odt-user-paths-windows-home");
        let _home_guard = EnvVarGuard::set("HOME", home.to_string_lossy().as_ref());

        let resolved = normalize_user_path(Path::new("~\\workspace"))
            .expect("windows-style path should resolve");

        assert_eq!(resolved, home.join("workspace"));
    }
}
