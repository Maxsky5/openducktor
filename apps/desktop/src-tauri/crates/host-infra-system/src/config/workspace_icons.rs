use base64::{engine::general_purpose, Engine as _};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

const WORKSPACE_ICON_DIRECTORIES: [&str; 6] = ["", "public", "app", "src", "src/assets", "assets"];
const WORKSPACE_ICON_BASENAMES: [&str; 4] = ["favicon", "icon", "logo", "apple-touch-icon"];
const WORKSPACE_ICON_EXTENSIONS: [&str; 5] = ["ico", "png", "svg", "jpg", "jpeg"];
const MAX_WORKSPACE_ICON_BYTES: u64 = 512 * 1024;
const MAX_WORKSPACE_ICON_CACHE_ENTRIES: usize = 128;

#[derive(Clone)]
struct CachedWorkspaceIcon {
    icon_path: PathBuf,
    modified_at: SystemTime,
    byte_len: u64,
    data_url: String,
}

#[derive(Default)]
struct WorkspaceIconCache {
    entries: HashMap<PathBuf, CachedWorkspaceIcon>,
    insertion_order: VecDeque<PathBuf>,
}

static WORKSPACE_ICON_CACHE: OnceLock<Mutex<WorkspaceIconCache>> = OnceLock::new();

fn workspace_icon_cache() -> &'static Mutex<WorkspaceIconCache> {
    WORKSPACE_ICON_CACHE.get_or_init(|| Mutex::new(WorkspaceIconCache::default()))
}

fn workspace_icon_signature(path: &Path) -> Option<(SystemTime, u64)> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_WORKSPACE_ICON_BYTES {
        return None;
    }

    Some((metadata.modified().ok()?, metadata.len()))
}

fn cached_workspace_icon(repo_root: &Path) -> Option<String> {
    let mut cache = workspace_icon_cache().lock().ok()?;
    let cached = cache.entries.get(repo_root)?.clone();

    let Some((modified_at, byte_len)) = workspace_icon_signature(&cached.icon_path) else {
        cache.entries.remove(repo_root);
        cache.insertion_order.retain(|path| path != repo_root);
        return None;
    };

    if cached.modified_at != modified_at || cached.byte_len != byte_len {
        cache.entries.remove(repo_root);
        cache.insertion_order.retain(|path| path != repo_root);
        return None;
    }

    Some(cached.data_url)
}

fn cache_workspace_icon(repo_root: &Path, cached_icon: CachedWorkspaceIcon) {
    let Ok(mut cache) = workspace_icon_cache().lock() else {
        return;
    };

    if !cache.entries.contains_key(repo_root) {
        cache.insertion_order.push_back(repo_root.to_path_buf());
    }
    cache.entries.insert(repo_root.to_path_buf(), cached_icon);

    while cache.entries.len() > MAX_WORKSPACE_ICON_CACHE_ENTRIES {
        let Some(oldest_repo_root) = cache.insertion_order.pop_front() else {
            break;
        };
        cache.entries.remove(&oldest_repo_root);
    }
}

fn clear_cached_workspace_icon(repo_root: &Path) {
    let Ok(mut cache) = workspace_icon_cache().lock() else {
        return;
    };
    cache.entries.remove(repo_root);
    cache.insertion_order.retain(|path| path != repo_root);
}

fn workspace_icon_mime_type(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "ico" => Some("image/x-icon"),
        "svg" => Some("image/svg+xml"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        _ => None,
    }
}

pub(super) fn discover_workspace_icon_data_url(repo_path: &str) -> Option<String> {
    let repo_root = Path::new(repo_path);

    if let Some(icon_data_url) = cached_workspace_icon(repo_root) {
        return Some(icon_data_url);
    }

    for directory in WORKSPACE_ICON_DIRECTORIES {
        for basename in WORKSPACE_ICON_BASENAMES {
            for extension in WORKSPACE_ICON_EXTENSIONS {
                let filename = format!("{basename}.{extension}");
                let candidate_path = if directory.is_empty() {
                    repo_root.join(filename)
                } else {
                    repo_root.join(directory).join(filename)
                };
                if !candidate_path.is_file() {
                    continue;
                }

                let Some(mime_type) = workspace_icon_mime_type(&candidate_path) else {
                    continue;
                };
                let Some((modified_at, byte_len)) = workspace_icon_signature(&candidate_path) else {
                    continue;
                };
                let Ok(bytes) = fs::read(&candidate_path) else {
                    continue;
                };

                let encoded = general_purpose::STANDARD.encode(bytes);
                let data_url = format!("data:{mime_type};base64,{encoded}");
                cache_workspace_icon(
                    repo_root,
                    CachedWorkspaceIcon {
                        icon_path: candidate_path,
                        modified_at,
                        byte_len,
                        data_url: data_url.clone(),
                    },
                );
                return Some(data_url);
            }
        }
    }

    clear_cached_workspace_icon(repo_root);
    None
}
