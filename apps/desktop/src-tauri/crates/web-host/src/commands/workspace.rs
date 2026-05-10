use base64::Engine;
use serde::Serialize;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedLocalAttachmentPayload {
    pub path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedLocalAttachmentPayload {
    pub path: String,
}

const LOCAL_ATTACHMENT_STAGE_DIR_NAME: &str = "openducktor-local-attachments";
const MAX_ATTACHMENT_LOOKUP_DISPLAY_LEN: usize = 128;

pub(crate) fn local_attachment_stage_dir() -> PathBuf {
    std::env::temp_dir().join(LOCAL_ATTACHMENT_STAGE_DIR_NAME)
}

pub(crate) fn is_staged_local_attachment_path(path: &Path) -> Result<bool, String> {
    let allowed_dir = local_attachment_stage_dir();
    if !allowed_dir.exists() {
        return Ok(false);
    }

    let canonical_allowed_dir = std::fs::canonicalize(&allowed_dir)
        .map_err(|error| format!("Failed to resolve staged attachment directory: {error}"))?;
    let canonical_path = std::fs::canonicalize(path)
        .map_err(|error| format!("Failed to resolve staged attachment path: {error}"))?;
    Ok(canonical_path.starts_with(canonical_allowed_dir))
}

fn sanitize_attachment_filename(name: &str) -> String {
    let sanitized = name
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '\0' | '*' | '?' | '"' | '<' | '>' | '|' | '%' => '_',
            character if character.is_control() => '_',
            _ => character,
        })
        .collect::<String>();
    let trimmed = sanitized.trim().trim_matches('.');
    let candidate = if trimmed.is_empty() {
        "attachment.bin"
    } else {
        trimmed
    };
    let stem = Path::new(candidate)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(candidate)
        .to_ascii_uppercase();
    let is_windows_reserved_name = matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    );
    if is_windows_reserved_name {
        format!("_{candidate}")
    } else {
        candidate.to_string()
    }
}

fn canonical_staged_local_attachment_path(
    path: &Path,
    canonical_stage_dir: &Path,
) -> Result<Option<PathBuf>, String> {
    let canonical_path = std::fs::canonicalize(path)
        .map_err(|error| format!("Failed to resolve staged attachment path: {error}"))?;
    if canonical_path.starts_with(canonical_stage_dir) {
        Ok(Some(canonical_path))
    } else {
        Ok(None)
    }
}

fn sanitize_attachment_lookup_token(path_or_name: &str) -> Result<String, String> {
    let trimmed = path_or_name.trim();
    if trimmed.is_empty() {
        return Err("Attachment path is required.".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed == "." || trimmed == ".." {
        return Err("Attachment path must be a staged attachment filename token.".to_string());
    }
    Ok(trimmed.to_string())
}

fn format_attachment_lookup_display_name(token: &str) -> String {
    let sanitized = token
        .chars()
        .map(|character| {
            if character.is_control() {
                '_'
            } else {
                character
            }
        })
        .collect::<String>();
    if sanitized.chars().count() <= MAX_ATTACHMENT_LOOKUP_DISPLAY_LEN {
        return sanitized;
    }

    let truncated = sanitized
        .chars()
        .take(MAX_ATTACHMENT_LOOKUP_DISPLAY_LEN.saturating_sub(3))
        .collect::<String>();
    format!("{truncated}...")
}

fn read_staged_attachment_original_name(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    if name.len() <= 37 {
        return Some(name.to_string());
    }
    let separator_index = name.char_indices().nth(36)?.0;
    let (uuid_prefix, rest) = name.split_at(separator_index);
    if !rest.starts_with('-') || Uuid::parse_str(uuid_prefix).is_err() {
        return Some(name.to_string());
    }
    Some(rest[1..].to_string())
}

pub(crate) fn stage_local_attachment_to_temp(
    name: &str,
    base64_data: &str,
) -> Result<PathBuf, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|error| format!("Failed to decode attachment payload: {error}"))?;
    let attachment_dir = local_attachment_stage_dir();
    std::fs::create_dir_all(&attachment_dir)
        .map_err(|error| format!("Failed to prepare attachment staging directory: {error}"))?;
    let file_name = format!("{}-{}", Uuid::new_v4(), sanitize_attachment_filename(name));
    let path = attachment_dir.join(file_name);
    std::fs::write(&path, bytes)
        .map_err(|error| format!("Failed to stage local attachment: {error}"))?;
    Ok(path)
}

pub(crate) fn resolve_staged_local_attachment_path(path_or_name: &str) -> Result<PathBuf, String> {
    let trimmed = path_or_name.trim();
    if trimmed.is_empty() {
        return Err("Attachment path is required.".to_string());
    }

    let candidate_path = PathBuf::from(trimmed);
    if candidate_path.is_absolute() {
        let stage_dir = local_attachment_stage_dir();
        if stage_dir.exists() {
            let canonical_stage_dir = std::fs::canonicalize(&stage_dir).map_err(|error| {
                format!("Failed to resolve staged attachment directory: {error}")
            })?;
            if let Some(path) =
                canonical_staged_local_attachment_path(&candidate_path, &canonical_stage_dir)?
            {
                return Ok(path);
            }
        }
        return Err("Attachment path is not a staged attachment file.".to_string());
    }

    let token = sanitize_attachment_lookup_token(trimmed)?;
    let stage_dir = local_attachment_stage_dir();
    let canonical_stage_dir = std::fs::canonicalize(&stage_dir).map_err(|error| {
        format!(
            "Failed to access staged attachment directory for {display_name}: {error}",
            display_name = format_attachment_lookup_display_name(&token)
        )
    })?;
    let direct = stage_dir.join(&token);
    if direct.exists() && direct.is_file() {
        if let Some(path) = canonical_staged_local_attachment_path(&direct, &canonical_stage_dir)? {
            return Ok(path);
        }
    }

    let display_name = format_attachment_lookup_display_name(&token);
    let entries = std::fs::read_dir(&stage_dir).map_err(|error| {
        format!("Failed to access staged attachment directory for {display_name}: {error}")
    })?;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Failed to read staged attachment entry: {error}"))?;
        let path = entry.path();
        if path.is_file() && read_staged_attachment_original_name(&path).as_deref() == Some(&token)
        {
            if let Some(path) = canonical_staged_local_attachment_path(&path, &canonical_stage_dir)?
            {
                return Ok(path);
            }
        }
    }

    Err(format!("Staged attachment not found: {display_name}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_attachment_filename_replaces_windows_reserved_device_names() {
        assert_eq!(sanitize_attachment_filename("CON"), "_CON");
        assert_eq!(sanitize_attachment_filename("con.txt"), "_con.txt");
        assert_eq!(sanitize_attachment_filename("Lpt9.log"), "_Lpt9.log");
        assert_eq!(sanitize_attachment_filename("normal.txt"), "normal.txt");
    }

    #[test]
    fn sanitize_attachment_filename_keeps_empty_names_writable() {
        assert_eq!(sanitize_attachment_filename(" .. "), "attachment.bin");
    }

    #[test]
    fn resolve_staged_local_attachment_path_returns_canonical_absolute_path() {
        let file_name = unique_attachment_name("absolute.txt");
        let path = create_staged_attachment(file_name.as_str(), b"content");
        let canonical_path = std::fs::canonicalize(&path).expect("staged path should canonicalize");

        let resolved = resolve_staged_local_attachment_path(path.to_string_lossy().as_ref())
            .expect("absolute staged path should resolve");

        assert_eq!(resolved, canonical_path);
        remove_file(path);
    }

    #[test]
    fn resolve_staged_local_attachment_path_finds_direct_token() {
        let file_name = unique_attachment_name("token.txt");
        let path = create_staged_attachment(file_name.as_str(), b"content");
        let canonical_path = std::fs::canonicalize(&path).expect("staged path should canonicalize");

        let resolved = resolve_staged_local_attachment_path(file_name.as_str())
            .expect("direct staged token should resolve");

        assert_eq!(resolved, canonical_path);
        remove_file(path);
    }

    #[test]
    fn resolve_staged_local_attachment_path_handles_long_utf8_display_name() {
        let token = "é".repeat(MAX_ATTACHMENT_LOOKUP_DISPLAY_LEN + 20);

        let error = resolve_staged_local_attachment_path(&token)
            .expect_err("missing long UTF-8 token should return not-found error");

        assert!(error.starts_with("Staged attachment not found: "));
        assert!(error.ends_with("..."));
    }

    #[cfg(unix)]
    #[test]
    fn resolve_staged_local_attachment_path_rejects_symlink_escape() {
        use std::os::unix::fs::symlink;

        let file_name = unique_attachment_name("escape.txt");
        let outside_path = std::env::temp_dir().join(unique_attachment_name("outside.txt"));
        std::fs::write(&outside_path, b"outside").expect("outside file should be written");
        let symlink_path = local_attachment_stage_dir().join(&file_name);
        std::fs::create_dir_all(local_attachment_stage_dir())
            .expect("attachment staging directory should be created");
        symlink(&outside_path, &symlink_path).expect("symlink should be created");

        let error = resolve_staged_local_attachment_path(file_name.as_str())
            .expect_err("symlink escape should not resolve");

        assert!(error.starts_with("Staged attachment not found: "));
        remove_file(symlink_path);
        remove_file(outside_path);
    }

    fn unique_attachment_name(suffix: &str) -> String {
        format!("{}-{suffix}", Uuid::new_v4())
    }

    fn create_staged_attachment(file_name: &str, bytes: &[u8]) -> PathBuf {
        let stage_dir = local_attachment_stage_dir();
        std::fs::create_dir_all(&stage_dir)
            .expect("attachment staging directory should be created");
        let path = stage_dir.join(file_name);
        std::fs::write(&path, bytes).expect("staged attachment should be written");
        path
    }

    fn remove_file(path: PathBuf) {
        let _ = std::fs::remove_file(path);
    }
}
