use base64::{engine::general_purpose, Engine as _};
use std::fs;
use std::path::Path;

const WORKSPACE_ICON_CANDIDATES: [&str; 8] = [
    "favicon.ico",
    "favicon.png",
    "icon.png",
    "apple-touch-icon.png",
    "public/favicon.ico",
    "public/favicon.png",
    "public/icon.png",
    "public/apple-touch-icon.png",
];

fn workspace_icon_mime_type(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "ico" => Some("image/x-icon"),
        _ => None,
    }
}

pub(super) fn discover_workspace_icon_data_url(repo_path: &str) -> Option<String> {
    let repo_root = Path::new(repo_path);

    for relative_path in WORKSPACE_ICON_CANDIDATES {
        let candidate_path = repo_root.join(relative_path);
        if !candidate_path.is_file() {
            continue;
        }

        let Some(mime_type) = workspace_icon_mime_type(&candidate_path) else {
            continue;
        };
        let Ok(bytes) = fs::read(&candidate_path) else {
            continue;
        };
        if bytes.is_empty() {
            continue;
        }

        let encoded = general_purpose::STANDARD.encode(bytes);
        return Some(format!("data:{mime_type};base64,{encoded}"));
    }

    None
}
