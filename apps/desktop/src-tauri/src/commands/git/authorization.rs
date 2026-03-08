use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const FNV1A_64_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV1A_64_PRIME: u64 = 0x100000001b3;
#[cfg(not(test))]
const AUTHORIZED_WORKTREE_CACHE_TTL: Duration = Duration::from_secs(3);
#[cfg(test)]
const AUTHORIZED_WORKTREE_CACHE_TTL: Duration = Duration::from_secs(60);
const WORKTREE_STATE_STABILIZATION_ATTEMPTS: usize = 3;

#[derive(Clone)]
pub(super) struct AuthorizedWorktreeCacheEntry {
    pub(super) cached_at: Instant,
    pub(super) worktree_state_token: String,
    pub(super) worktrees: HashSet<PathBuf>,
}

struct AuthorizedWorktreeListEntry {
    path: String,
    prunable: bool,
}

static AUTHORIZED_WORKTREE_CACHE: OnceLock<Mutex<HashMap<String, AuthorizedWorktreeCacheEntry>>> =
    OnceLock::new();
static AUTHORIZED_WORKTREE_MISS_LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> =
    OnceLock::new();

pub(super) fn authorized_worktree_cache(
) -> &'static Mutex<HashMap<String, AuthorizedWorktreeCacheEntry>> {
    AUTHORIZED_WORKTREE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn authorized_worktree_miss_locks() -> &'static Mutex<HashMap<String, Arc<Mutex<()>>>> {
    AUTHORIZED_WORKTREE_MISS_LOCKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cache_lock_error(operation: &str) -> String {
    format!("authorized worktree cache is unavailable while {operation}: lock poisoned")
}

pub(super) fn cache_key(canonical_repo: &Path) -> String {
    canonical_repo.to_string_lossy().to_string()
}

fn get_authorized_worktree_miss_lock(repo_key: &str) -> Result<Arc<Mutex<()>>, String> {
    let mut locks = authorized_worktree_miss_locks()
        .lock()
        .map_err(|_| cache_lock_error("loading worktree miss lock"))?;
    Ok(locks
        .entry(repo_key.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone())
}

fn fnv1a_update_bytes(state: &mut u64, bytes: &[u8]) {
    for byte in bytes {
        *state ^= u64::from(*byte);
        *state = state.wrapping_mul(FNV1A_64_PRIME);
    }
}

fn fnv1a_update_u64(state: &mut u64, value: u64) {
    fnv1a_update_bytes(state, &value.to_le_bytes());
}

fn fnv1a_update_u128(state: &mut u64, value: u128) {
    fnv1a_update_bytes(state, &value.to_le_bytes());
}

fn fnv1a_update_str(state: &mut u64, value: &str) {
    fnv1a_update_u64(state, value.len() as u64);
    fnv1a_update_bytes(state, value.as_bytes());
}

fn read_worktree_entry_gitdir(
    worktree_entry_dir: &Path,
    entry_name: &str,
) -> Result<(u128, String), String> {
    let gitdir_path = worktree_entry_dir.join("gitdir");
    let gitdir_metadata = fs::metadata(&gitdir_path).map_err(|e| {
        format!(
            "failed to read gitdir metadata for worktree entry '{entry_name}' ({}): {e}",
            gitdir_path.display()
        )
    })?;
    if !gitdir_metadata.is_file() {
        return Err(format!(
            "worktree entry '{entry_name}' has invalid gitdir metadata path: {}",
            gitdir_path.display()
        ));
    }
    let gitdir_modified_nanos = system_time_to_nanos(
        gitdir_metadata.modified().map_err(|e| {
            format!(
                "failed to read gitdir modified time for worktree entry '{entry_name}' ({}): {e}",
                gitdir_path.display()
            )
        })?,
        "git worktree gitdir modified time",
    )?;
    let gitdir_raw = fs::read_to_string(&gitdir_path).map_err(|e| {
        format!(
            "failed to read gitdir file for worktree entry '{entry_name}' ({}): {e}",
            gitdir_path.display()
        )
    })?;
    let gitdir = gitdir_raw.trim_end_matches(['\r', '\n']).to_string();
    if gitdir.is_empty() {
        return Err(format!(
            "worktree entry '{entry_name}' has an empty gitdir path: {}",
            gitdir_path.display()
        ));
    }
    Ok((gitdir_modified_nanos, gitdir))
}

fn read_git_dir_from_dot_git_file(
    canonical_repo: &Path,
    dot_git_file: &Path,
) -> Result<PathBuf, String> {
    let contents = fs::read_to_string(dot_git_file).map_err(|e| {
        format!(
            "failed to read git metadata file {}: {e}",
            dot_git_file.display()
        )
    })?;
    let git_dir_raw = contents
        .lines()
        .find_map(|line| line.strip_prefix("gitdir:").map(str::trim))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!(
                "failed to parse gitdir from metadata file {}",
                dot_git_file.display()
            )
        })?;

    let git_dir_path = PathBuf::from(git_dir_raw);
    let resolved_git_dir = if git_dir_path.is_absolute() {
        git_dir_path
    } else {
        canonical_repo.join(git_dir_path)
    };
    fs::canonicalize(&resolved_git_dir).map_err(|e| {
        format!(
            "failed to canonicalize gitdir path {}: {e}",
            resolved_git_dir.display()
        )
    })
}

pub(super) fn read_git_common_dir(canonical_repo: &Path) -> Result<PathBuf, String> {
    let dot_git = canonical_repo.join(".git");
    let dot_git_metadata = fs::metadata(&dot_git).map_err(|e| {
        format!(
            "failed to access repository metadata {}: {e}",
            dot_git.display()
        )
    })?;

    if dot_git_metadata.is_dir() {
        return fs::canonicalize(&dot_git).map_err(|e| {
            format!(
                "failed to canonicalize repository git directory {}: {e}",
                dot_git.display()
            )
        });
    }

    if !dot_git_metadata.is_file() {
        return Err(format!(
            "repository metadata path is neither a directory nor file: {}",
            dot_git.display()
        ));
    }

    let git_dir = read_git_dir_from_dot_git_file(canonical_repo, dot_git.as_path())?;
    let common_dir_path = git_dir.join("commondir");
    if !common_dir_path.exists() {
        return Ok(git_dir);
    }
    if !common_dir_path.is_file() {
        return Err(format!(
            "git commondir metadata is not a file: {}",
            common_dir_path.display()
        ));
    }

    let common_dir_raw = fs::read_to_string(&common_dir_path).map_err(|e| {
        format!(
            "failed to read git commondir metadata {}: {e}",
            common_dir_path.display()
        )
    })?;
    let common_dir_value = common_dir_raw.trim();
    if common_dir_value.is_empty() {
        return Err(format!(
            "git commondir metadata is empty: {}",
            common_dir_path.display()
        ));
    }

    let common_dir = PathBuf::from(common_dir_value);
    let resolved_common_dir = if common_dir.is_absolute() {
        common_dir
    } else {
        git_dir.join(common_dir)
    };
    fs::canonicalize(&resolved_common_dir).map_err(|e| {
        format!(
            "failed to canonicalize git common directory {}: {e}",
            resolved_common_dir.display()
        )
    })
}

fn system_time_to_nanos(value: SystemTime, context: &str) -> Result<u128, String> {
    value
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .map_err(|e| format!("{context} is before unix epoch: {e}"))
}

pub(super) fn read_worktree_state_token(canonical_repo: &Path) -> Result<String, String> {
    let common_git_dir = read_git_common_dir(canonical_repo)?;
    let worktrees_dir = common_git_dir.join("worktrees");
    let mut hash_state = FNV1A_64_OFFSET_BASIS;
    fnv1a_update_str(&mut hash_state, common_git_dir.to_string_lossy().as_ref());

    if !worktrees_dir.exists() {
        fnv1a_update_str(&mut hash_state, "worktrees=none");
        return Ok(format!(
            "{}|{:016x}",
            common_git_dir.to_string_lossy(),
            hash_state
        ));
    }

    let worktrees_metadata = fs::metadata(&worktrees_dir).map_err(|e| {
        format!(
            "failed to read git worktrees metadata {}: {e}",
            worktrees_dir.display()
        )
    })?;
    if !worktrees_metadata.is_dir() {
        return Err(format!(
            "git worktrees path is not a directory: {}",
            worktrees_dir.display()
        ));
    }

    let modified_nanos = system_time_to_nanos(
        worktrees_metadata.modified().map_err(|e| {
            format!(
                "failed to read git worktrees modified time {}: {e}",
                worktrees_dir.display()
            )
        })?,
        "git worktrees modified time",
    )?;
    fnv1a_update_str(&mut hash_state, "worktrees=present");
    fnv1a_update_u128(&mut hash_state, modified_nanos);

    let mut entries = fs::read_dir(&worktrees_dir)
        .map_err(|e| {
            format!(
                "failed to read git worktrees directory {}: {e}",
                worktrees_dir.display()
            )
        })?
        .map(|entry_result| {
            entry_result
                .map(|entry| {
                    (
                        entry.file_name().to_string_lossy().to_string(),
                        entry.path(),
                    )
                })
                .map_err(|e| {
                    format!(
                        "failed to read entry from git worktrees directory {}: {e}",
                        worktrees_dir.display()
                    )
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort_by(|left, right| left.0.cmp(&right.0));

    fnv1a_update_u64(&mut hash_state, entries.len() as u64);
    for (entry_name, entry_path) in entries {
        let entry_metadata = fs::metadata(&entry_path).map_err(|e| {
            format!(
                "failed to read metadata for worktree entry '{entry_name}' ({}): {e}",
                entry_path.display()
            )
        })?;
        if !entry_metadata.is_dir() {
            return Err(format!(
                "git worktree entry is not a directory: {}",
                entry_path.display()
            ));
        }
        let entry_modified_nanos = system_time_to_nanos(
            entry_metadata.modified().map_err(|e| {
                format!(
                    "failed to read modified time for worktree entry '{entry_name}' ({}): {e}",
                    entry_path.display()
                )
            })?,
            "git worktree entry modified time",
        )?;
        let (gitdir_modified_nanos, gitdir) =
            read_worktree_entry_gitdir(entry_path.as_path(), entry_name.as_str())?;

        fnv1a_update_str(&mut hash_state, entry_name.as_str());
        fnv1a_update_u128(&mut hash_state, entry_modified_nanos);
        fnv1a_update_u128(&mut hash_state, gitdir_modified_nanos);
        fnv1a_update_str(&mut hash_state, gitdir.as_str());
    }

    Ok(format!(
        "{}|{:016x}",
        common_git_dir.to_string_lossy(),
        hash_state
    ))
}

fn load_cached_worktree_membership(
    repo_key: &str,
    worktree_state_token: &str,
    canonical_working_dir: &Path,
) -> Result<Option<bool>, String> {
    let now = Instant::now();
    let cache = authorized_worktree_cache()
        .lock()
        .map_err(|_| cache_lock_error("loading cached worktree entries"))?;
    Ok(cache.get(repo_key).and_then(|entry| {
        if entry.worktree_state_token == worktree_state_token
            && now.duration_since(entry.cached_at) <= AUTHORIZED_WORKTREE_CACHE_TTL
        {
            Some(entry.worktrees.contains(canonical_working_dir))
        } else {
            None
        }
    }))
}

fn list_authorized_worktrees_with_stable_token(
    canonical_repo: &Path,
) -> Result<(String, HashSet<PathBuf>), String> {
    for _ in 0..WORKTREE_STATE_STABILIZATION_ATTEMPTS {
        let pre_list_token = read_worktree_state_token(canonical_repo)?;
        let worktrees = list_authorized_worktrees(canonical_repo)?
            .into_iter()
            .collect::<HashSet<_>>();
        let post_list_token = read_worktree_state_token(canonical_repo)?;
        if pre_list_token == post_list_token {
            return Ok((post_list_token, worktrees));
        }
    }

    Err(format!(
        "git worktree metadata changed during authorization for {} and did not stabilize after {} attempts; retry the command",
        canonical_repo.display(),
        WORKTREE_STATE_STABILIZATION_ATTEMPTS
    ))
}

fn is_authorized_worktree(
    canonical_repo: &Path,
    canonical_working_dir: &Path,
) -> Result<bool, String> {
    let repo_key = cache_key(canonical_repo);
    let worktree_state_token = read_worktree_state_token(canonical_repo)?;
    if let Some(cached_membership) = load_cached_worktree_membership(
        repo_key.as_str(),
        worktree_state_token.as_str(),
        canonical_working_dir,
    )? {
        return Ok(cached_membership);
    }

    // Coalesce concurrent cache misses for the same repository into a single refresh.
    let miss_lock = get_authorized_worktree_miss_lock(repo_key.as_str())?;
    let _refresh_guard = miss_lock
        .lock()
        .map_err(|_| cache_lock_error("waiting for another worktree cache refresh to complete"))?;

    let worktree_state_token = read_worktree_state_token(canonical_repo)?;
    if let Some(cached_membership) = load_cached_worktree_membership(
        repo_key.as_str(),
        worktree_state_token.as_str(),
        canonical_working_dir,
    )? {
        return Ok(cached_membership);
    }

    let (stable_worktree_state_token, worktree_set) =
        list_authorized_worktrees_with_stable_token(canonical_repo)?;
    let is_member = worktree_set.contains(canonical_working_dir);
    let mut cache = authorized_worktree_cache()
        .lock()
        .map_err(|_| cache_lock_error("storing cached worktree entries"))?;
    cache.insert(
        repo_key,
        AuthorizedWorktreeCacheEntry {
            cached_at: Instant::now(),
            worktree_state_token: stable_worktree_state_token,
            worktrees: worktree_set,
        },
    );
    Ok(is_member)
}

pub(crate) fn invalidate_worktree_resolution_cache_for_repo(repo_path: &str) -> Result<(), String> {
    let canonical_repo = canonicalize_for_validation(repo_path, "repo_path")?;
    let key = cache_key(canonical_repo.as_path());
    let mut cache = authorized_worktree_cache()
        .lock()
        .map_err(|_| cache_lock_error("invalidating repository worktree cache"))?;
    cache.remove(&key);
    Ok(())
}

pub(super) fn canonicalize_for_validation(path: &str, field: &str) -> Result<PathBuf, String> {
    fs::canonicalize(path)
        .map_err(|_| format!("{field} does not exist or is not accessible: {path}"))
}

fn list_authorized_worktrees(repo_path: &Path) -> Result<Vec<PathBuf>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("list")
        .arg("--porcelain")
        .output()
        .map_err(|e| format!("failed to enumerate authorized worktrees: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let reason = stderr.trim();
        return Err(if reason.is_empty() {
            "failed to enumerate authorized worktrees".to_string()
        } else {
            format!("failed to enumerate authorized worktrees: {reason}")
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed_entries = parse_authorized_worktree_entries(stdout.as_ref());
    let mut worktrees = Vec::new();
    for entry in parsed_entries {
        if entry.prunable {
            continue;
        }

        let canonicalized = fs::canonicalize(entry.path.as_str()).map_err(|e| {
            format!(
                "failed to canonicalize authorized worktree path {}: {e}",
                entry.path
            )
        })?;
        worktrees.push(canonicalized);
    }
    Ok(worktrees)
}

fn parse_authorized_worktree_entries(stdout: &str) -> Vec<AuthorizedWorktreeListEntry> {
    let mut entries = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_prunable = false;

    let flush_current = |entries: &mut Vec<AuthorizedWorktreeListEntry>,
                         current_path: &mut Option<String>,
                         current_prunable: &mut bool| {
        if let Some(path) = current_path.take() {
            entries.push(AuthorizedWorktreeListEntry {
                path,
                prunable: *current_prunable,
            });
        }
        *current_prunable = false;
    };

    for line in stdout.lines() {
        if line.is_empty() {
            flush_current(&mut entries, &mut current_path, &mut current_prunable);
            continue;
        }

        if let Some(path) = line.strip_prefix("worktree ") {
            flush_current(&mut entries, &mut current_path, &mut current_prunable);
            current_path = Some(path.to_string());
            continue;
        }

        if line.starts_with("prunable") {
            current_prunable = true;
        }
    }

    flush_current(&mut entries, &mut current_path, &mut current_prunable);
    entries
}

/// Resolve the effective path for a git operation. If `working_dir` is
/// provided, it is validated as a git worktree/repo and used instead of
/// `repo_path`. The caller must have already authorized `repo_path`.
pub(super) fn resolve_working_dir(
    repo_path: &str,
    working_dir: Option<&str>,
) -> Result<String, String> {
    let canonical_repo = canonicalize_for_validation(repo_path, "repo_path")?;

    match working_dir {
        Some(wd) if !wd.is_empty() && wd != repo_path => {
            let canonical_working_dir = canonicalize_for_validation(wd, "working_dir")?;

            if canonical_working_dir == canonical_repo {
                return Ok(canonical_working_dir.to_string_lossy().to_string());
            }

            if is_authorized_worktree(canonical_repo.as_path(), canonical_working_dir.as_path())? {
                return Ok(canonical_working_dir.to_string_lossy().to_string());
            }

            Err(format!(
                "working_dir is not within authorized repository or linked worktrees: {wd}"
            ))
        }
        _ => Ok(canonical_repo.to_string_lossy().to_string()),
    }
}
