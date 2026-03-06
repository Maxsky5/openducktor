use crate::{as_error, AppState};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::State;

const GIT_WORKTREE_HASH_VERSION: u32 = 1;
const FNV1A_64_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV1A_64_PRIME: u64 = 0x100000001b3;
#[cfg(not(test))]
const AUTHORIZED_WORKTREE_CACHE_TTL: Duration = Duration::from_secs(3);
#[cfg(test)]
const AUTHORIZED_WORKTREE_CACHE_TTL: Duration = Duration::from_secs(60);
const WORKTREE_STATE_STABILIZATION_ATTEMPTS: usize = 3;

#[derive(Clone)]
struct AuthorizedWorktreeCacheEntry {
    cached_at: Instant,
    worktree_state_token: String,
    worktrees: HashSet<PathBuf>,
}

struct AuthorizedWorktreeListEntry {
    path: String,
    prunable: bool,
}

static AUTHORIZED_WORKTREE_CACHE: OnceLock<Mutex<HashMap<String, AuthorizedWorktreeCacheEntry>>> =
    OnceLock::new();
static AUTHORIZED_WORKTREE_MISS_LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> =
    OnceLock::new();

fn authorized_worktree_cache() -> &'static Mutex<HashMap<String, AuthorizedWorktreeCacheEntry>> {
    AUTHORIZED_WORKTREE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn authorized_worktree_miss_locks() -> &'static Mutex<HashMap<String, Arc<Mutex<()>>>> {
    AUTHORIZED_WORKTREE_MISS_LOCKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cache_lock_error(operation: &str) -> String {
    format!("authorized worktree cache is unavailable while {operation}: lock poisoned")
}

fn cache_key(canonical_repo: &Path) -> String {
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

fn read_git_common_dir(canonical_repo: &Path) -> Result<PathBuf, String> {
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

fn read_worktree_state_token(canonical_repo: &Path) -> Result<String, String> {
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

fn canonicalize_for_validation(path: &str, field: &str) -> Result<PathBuf, String> {
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
            continue;
        }
    }

    flush_current(&mut entries, &mut current_path, &mut current_prunable);
    entries
}

/// Resolve the effective path for a git operation. If `working_dir` is
/// provided, it is validated as a git worktree/repo and used instead of
/// `repo_path`. The caller must have already authorized `repo_path`.
fn resolve_working_dir(repo_path: &str, working_dir: Option<&str>) -> Result<String, String> {
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

fn parse_diff_scope(diff_scope: Option<&str>) -> Result<host_domain::GitDiffScope, String> {
    match diff_scope.unwrap_or("target") {
        "target" => Ok(host_domain::GitDiffScope::Target),
        "uncommitted" => Ok(host_domain::GitDiffScope::Uncommitted),
        value => Err(format!(
            "diffScope must be either 'target' or 'uncommitted', got: {value}"
        )),
    }
}

fn require_target_branch(target_branch: &str) -> Result<&str, String> {
    let trimmed_target = target_branch.trim();
    if trimmed_target.is_empty() {
        return Err("targetBranch is required".to_string());
    }
    Ok(trimmed_target)
}

struct Fnv1a64Hasher {
    state: u64,
}

impl Fnv1a64Hasher {
    fn new() -> Self {
        Self {
            state: FNV1A_64_OFFSET_BASIS,
        }
    }

    fn update_byte(&mut self, byte: u8) {
        self.state ^= u64::from(byte);
        self.state = self.state.wrapping_mul(FNV1A_64_PRIME);
    }

    fn update_bytes(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.update_byte(*byte);
        }
    }

    fn update_bool(&mut self, value: bool) {
        self.update_byte(u8::from(value));
    }

    fn update_u32(&mut self, value: u32) {
        self.update_bytes(&value.to_le_bytes());
    }

    fn update_u64(&mut self, value: u64) {
        self.update_bytes(&value.to_le_bytes());
    }

    fn update_str(&mut self, value: &str) {
        self.update_u64(value.len() as u64);
        self.update_bytes(value.as_bytes());
    }

    fn finish_hex(self) -> String {
        format!("{:016x}", self.state)
    }
}

fn hash_optional_str(hasher: &mut Fnv1a64Hasher, value: Option<&str>) {
    match value {
        Some(value) => {
            hasher.update_byte(1);
            hasher.update_str(value);
        }
        None => {
            hasher.update_byte(0);
        }
    }
}
fn hash_upstream_ahead_behind(
    hasher: &mut Fnv1a64Hasher,
    upstream_ahead_behind: &host_domain::GitUpstreamAheadBehind,
) {
    match upstream_ahead_behind {
        host_domain::GitUpstreamAheadBehind::Tracking { ahead, behind } => {
            hasher.update_str("tracking");
            hasher.update_u32(*ahead);
            hasher.update_u32(*behind);
        }
        host_domain::GitUpstreamAheadBehind::Untracked { ahead } => {
            hasher.update_str("untracked");
            hasher.update_u32(*ahead);
        }
        host_domain::GitUpstreamAheadBehind::Error { message } => {
            hasher.update_str("error");
            hasher.update_str(message);
        }
    }
}

fn hash_worktree_status_payload(
    current_branch: &host_domain::GitCurrentBranch,
    file_statuses: &[host_domain::GitFileStatus],
    target_ahead_behind: &host_domain::GitAheadBehind,
    upstream_ahead_behind: &host_domain::GitUpstreamAheadBehind,
) -> String {
    let mut hasher = Fnv1a64Hasher::new();

    hash_optional_str(&mut hasher, current_branch.name.as_deref());
    hasher.update_bool(current_branch.detached);

    hasher.update_u64(file_statuses.len() as u64);
    for status in file_statuses {
        hasher.update_str(&status.path);
        hasher.update_str(&status.status);
        hasher.update_bool(status.staged);
    }

    hasher.update_u32(target_ahead_behind.ahead);
    hasher.update_u32(target_ahead_behind.behind);

    hash_upstream_ahead_behind(&mut hasher, upstream_ahead_behind);

    hasher.finish_hex()
}

fn hash_worktree_diff_payload(file_diffs: &[host_domain::GitFileDiff]) -> String {
    let mut hasher = Fnv1a64Hasher::new();
    hasher.update_u64(file_diffs.len() as u64);

    for diff in file_diffs {
        hasher.update_str(&diff.file);
        hasher.update_str(&diff.diff_type);
        hasher.update_u32(diff.additions);
        hasher.update_u32(diff.deletions);
        hasher.update_str(&diff.diff);
    }

    hasher.finish_hex()
}

fn hash_worktree_diff_summary_payload(
    diff_scope: &host_domain::GitDiffScope,
    target_ahead_behind: &host_domain::GitAheadBehind,
    file_status_counts: &host_domain::GitFileStatusCounts,
) -> String {
    let mut hasher = Fnv1a64Hasher::new();

    match diff_scope {
        host_domain::GitDiffScope::Target => hasher.update_str("target"),
        host_domain::GitDiffScope::Uncommitted => hasher.update_str("uncommitted"),
    }

    hasher.update_u32(target_ahead_behind.ahead);
    hasher.update_u32(target_ahead_behind.behind);
    hasher.update_u32(file_status_counts.total);
    hasher.update_u32(file_status_counts.staged);
    hasher.update_u32(file_status_counts.unstaged);

    hasher.finish_hex()
}

struct WorktreeSnapshotMetadata {
    effective_working_dir: String,
    target_branch: String,
    diff_scope: host_domain::GitDiffScope,
    observed_at_ms: u64,
    hash_version: u32,
    status_hash: String,
    diff_hash: String,
}

fn build_worktree_status_with_snapshot(
    status_data: host_domain::GitWorktreeStatusData,
    snapshot_metadata: WorktreeSnapshotMetadata,
) -> host_domain::GitWorktreeStatus {
    host_domain::GitWorktreeStatus {
        current_branch: status_data.current_branch,
        file_statuses: status_data.file_statuses,
        file_diffs: status_data.file_diffs,
        target_ahead_behind: status_data.target_ahead_behind,
        upstream_ahead_behind: status_data.upstream_ahead_behind,
        snapshot: host_domain::GitWorktreeStatusSnapshot {
            effective_working_dir: snapshot_metadata.effective_working_dir,
            target_branch: snapshot_metadata.target_branch,
            diff_scope: snapshot_metadata.diff_scope,
            observed_at_ms: snapshot_metadata.observed_at_ms,
            hash_version: snapshot_metadata.hash_version,
            status_hash: snapshot_metadata.status_hash,
            diff_hash: snapshot_metadata.diff_hash,
        },
    }
}

fn build_worktree_status_summary_with_snapshot(
    current_branch: host_domain::GitCurrentBranch,
    file_status_counts: host_domain::GitFileStatusCounts,
    target_ahead_behind: host_domain::GitAheadBehind,
    upstream_ahead_behind: host_domain::GitUpstreamAheadBehind,
    snapshot_metadata: WorktreeSnapshotMetadata,
) -> host_domain::GitWorktreeStatusSummary {
    host_domain::GitWorktreeStatusSummary {
        current_branch,
        file_status_counts,
        target_ahead_behind,
        upstream_ahead_behind,
        snapshot: host_domain::GitWorktreeStatusSnapshot {
            effective_working_dir: snapshot_metadata.effective_working_dir,
            target_branch: snapshot_metadata.target_branch,
            diff_scope: snapshot_metadata.diff_scope,
            observed_at_ms: snapshot_metadata.observed_at_ms,
            hash_version: snapshot_metadata.hash_version,
            status_hash: snapshot_metadata.status_hash,
            diff_hash: snapshot_metadata.diff_hash,
        },
    }
}

#[tauri::command]
pub async fn git_get_branches(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<Vec<host_domain::GitBranch>, String> {
    as_error(state.service.git_get_branches(&repo_path))
}

#[tauri::command]
pub async fn git_get_current_branch(
    state: State<'_, AppState>,
    repo_path: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitCurrentBranch, String> {
    // Authorize against repo_path, execute in working_dir
    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;
    as_error(
        state
            .service
            .git_port()
            .get_current_branch(Path::new(&effective)),
    )
}

#[tauri::command]
pub async fn git_switch_branch(
    state: State<'_, AppState>,
    repo_path: String,
    branch: String,
    create: Option<bool>,
) -> Result<host_domain::GitCurrentBranch, String> {
    as_error(
        state
            .service
            .git_switch_branch(&repo_path, &branch, create.unwrap_or(false)),
    )
}

#[tauri::command]
pub async fn git_create_worktree(
    state: State<'_, AppState>,
    repo_path: String,
    worktree_path: String,
    branch: String,
    create_branch: Option<bool>,
) -> Result<host_domain::GitWorktreeSummary, String> {
    let summary = as_error(state.service.git_create_worktree(
        &repo_path,
        &worktree_path,
        &branch,
        create_branch.unwrap_or(false),
    ))?;
    invalidate_worktree_resolution_cache_for_repo(&repo_path)?;
    Ok(summary)
}

#[tauri::command]
pub async fn git_remove_worktree(
    state: State<'_, AppState>,
    repo_path: String,
    worktree_path: String,
    force: Option<bool>,
) -> Result<serde_json::Value, String> {
    let removed = as_error(state.service.git_remove_worktree(
        &repo_path,
        &worktree_path,
        force.unwrap_or(false),
    ))?;
    invalidate_worktree_resolution_cache_for_repo(&repo_path)?;
    Ok(serde_json::json!({ "ok": removed }))
}

#[tauri::command]
pub async fn git_push_branch(
    state: State<'_, AppState>,
    repo_path: String,
    branch: String,
    working_dir: Option<String>,
    remote: Option<String>,
    set_upstream: Option<bool>,
    force_with_lease: Option<bool>,
) -> Result<host_domain::GitPushResult, String> {
    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;

    as_error(state.service.git_push_branch(
        &repo_path,
        Some(effective.as_str()),
        remote.as_deref(),
        &branch,
        set_upstream.unwrap_or(false),
        force_with_lease.unwrap_or(false),
    ))
}

#[tauri::command]
pub async fn git_get_status(
    state: State<'_, AppState>,
    repo_path: String,
    working_dir: Option<String>,
) -> Result<Vec<host_domain::GitFileStatus>, String> {
    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;
    as_error(state.service.git_port().get_status(Path::new(&effective)))
}

#[tauri::command]
pub async fn git_get_diff(
    state: State<'_, AppState>,
    repo_path: String,
    target_branch: Option<String>,
    working_dir: Option<String>,
) -> Result<Vec<host_domain::GitFileDiff>, String> {
    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;
    as_error(
        state
            .service
            .git_port()
            .get_diff(Path::new(&effective), target_branch.as_deref()),
    )
}

#[tauri::command]
pub async fn git_commits_ahead_behind(
    state: State<'_, AppState>,
    repo_path: String,
    target_branch: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitAheadBehind, String> {
    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;
    as_error(
        state
            .service
            .git_port()
            .commits_ahead_behind(Path::new(&effective), &target_branch),
    )
}

#[tauri::command]
pub async fn git_get_worktree_status(
    state: State<'_, AppState>,
    repo_path: String,
    target_branch: String,
    diff_scope: Option<String>,
    working_dir: Option<String>,
) -> Result<host_domain::GitWorktreeStatus, String> {
    let trimmed_target = require_target_branch(&target_branch)?;
    let scope = parse_diff_scope(diff_scope.as_deref())?;

    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;
    let repo = Path::new(&effective);
    let worktree_status = as_error(state.service.git_port().get_worktree_status(
        repo,
        trimmed_target,
        scope.clone(),
    ))?;
    let observed_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let status_hash = hash_worktree_status_payload(
        &worktree_status.current_branch,
        worktree_status.file_statuses.as_slice(),
        &worktree_status.target_ahead_behind,
        &worktree_status.upstream_ahead_behind,
    );
    let diff_hash = hash_worktree_diff_payload(worktree_status.file_diffs.as_slice());

    Ok(build_worktree_status_with_snapshot(
        worktree_status,
        WorktreeSnapshotMetadata {
            effective_working_dir: effective,
            target_branch: trimmed_target.to_string(),
            diff_scope: scope,
            observed_at_ms,
            hash_version: GIT_WORKTREE_HASH_VERSION,
            status_hash,
            diff_hash,
        },
    ))
}

#[tauri::command]
pub async fn git_get_worktree_status_summary(
    state: State<'_, AppState>,
    repo_path: String,
    target_branch: String,
    diff_scope: Option<String>,
    working_dir: Option<String>,
) -> Result<host_domain::GitWorktreeStatusSummary, String> {
    let trimmed_target = require_target_branch(&target_branch)?;
    let scope = parse_diff_scope(diff_scope.as_deref())?;

    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;
    let repo = Path::new(&effective);
    let worktree_status = as_error(state.service.git_port().get_worktree_status_summary(
        repo,
        trimmed_target,
        scope.clone(),
    ))?;

    let observed_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let status_hash = hash_worktree_status_payload(
        &worktree_status.current_branch,
        worktree_status.file_statuses.as_slice(),
        &worktree_status.target_ahead_behind,
        &worktree_status.upstream_ahead_behind,
    );
    let diff_hash = hash_worktree_diff_summary_payload(
        &scope,
        &worktree_status.target_ahead_behind,
        &worktree_status.file_status_counts,
    );

    Ok(build_worktree_status_summary_with_snapshot(
        worktree_status.current_branch,
        worktree_status.file_status_counts,
        worktree_status.target_ahead_behind,
        worktree_status.upstream_ahead_behind,
        WorktreeSnapshotMetadata {
            effective_working_dir: effective,
            target_branch: trimmed_target.to_string(),
            diff_scope: scope,
            observed_at_ms,
            hash_version: GIT_WORKTREE_HASH_VERSION,
            status_hash,
            diff_hash,
        },
    ))
}

#[tauri::command]
pub async fn git_commit_all(
    state: State<'_, AppState>,
    repo_path: String,
    message: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitCommitAllResult, String> {
    if message.trim().is_empty() {
        return Err("message is required".to_string());
    }

    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;

    as_error(state.service.git_commit_all(
        &repo_path,
        host_domain::GitCommitAllRequest {
            working_dir: Some(effective),
            message: message.trim().to_string(),
        },
    ))
}

#[tauri::command]
pub async fn git_pull_branch(
    state: State<'_, AppState>,
    repo_path: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitPullResult, String> {
    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;

    as_error(state.service.git_pull_branch(
        &repo_path,
        host_domain::GitPullRequest {
            working_dir: Some(effective),
        },
    ))
}

#[tauri::command]
pub async fn git_rebase_branch(
    state: State<'_, AppState>,
    repo_path: String,
    target_branch: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitRebaseBranchResult, String> {
    if target_branch.trim().is_empty() {
        return Err("targetBranch is required".to_string());
    }

    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;

    as_error(state.service.git_rebase_branch(
        &repo_path,
        host_domain::GitRebaseBranchRequest {
            working_dir: Some(effective),
            target_branch: target_branch.trim().to_string(),
        },
    ))
}

#[tauri::command]
pub async fn git_rebase_abort(
    state: State<'_, AppState>,
    repo_path: String,
    working_dir: Option<String>,
) -> Result<host_domain::GitRebaseAbortResult, String> {
    let _ = state
        .service
        .ensure_repo_authorized(&repo_path)
        .map_err(|e| e.to_string())?;
    let effective = resolve_working_dir(&repo_path, working_dir.as_deref())?;

    as_error(state.service.git_rebase_abort(
        &repo_path,
        host_domain::GitRebaseAbortRequest {
            working_dir: Some(effective),
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        authorized_worktree_cache, build_worktree_status_summary_with_snapshot,
        build_worktree_status_with_snapshot, cache_key, git_create_worktree,
        git_get_worktree_status, git_get_worktree_status_summary, git_remove_worktree,
        hash_worktree_diff_payload, hash_worktree_diff_summary_payload,
        hash_worktree_status_payload, invalidate_worktree_resolution_cache_for_repo,
        parse_diff_scope, read_git_common_dir, read_worktree_state_token, require_target_branch,
        resolve_working_dir, AuthorizedWorktreeCacheEntry, WorktreeSnapshotMetadata,
        GIT_WORKTREE_HASH_VERSION,
    };
    use crate::{commands::workspace::workspace_select, AppState};
    use anyhow::anyhow;
    use host_application::AppService;
    use host_domain::GitPort;
    use host_domain::{
        AgentSessionDocument, CreateTaskInput, GitAheadBehind, GitBranch, GitCommitAllRequest,
        GitCommitAllResult, GitCurrentBranch, GitDiffScope, GitFileDiff, GitFileStatus,
        GitFileStatusCounts, GitPullRequest, GitPullResult, GitPushResult, GitRebaseAbortRequest,
        GitRebaseAbortResult, GitRebaseBranchRequest, GitRebaseBranchResult,
        GitUpstreamAheadBehind, GitWorktreeStatus, GitWorktreeStatusData, GitWorktreeStatusSummary,
        GitWorktreeStatusSummaryData, QaReportDocument, QaVerdict, SpecDocument, TaskCard,
        TaskMetadata, TaskStore, UpdateTaskPatch,
    };
    use host_infra_system::AppConfigStore;
    use serde_json::{json, Value};
    use std::{
        collections::{HashMap, HashSet},
        env, fs,
        path::{Path, PathBuf},
        process::Command,
        sync::{Arc, Mutex},
        time::{Instant, SystemTime, UNIX_EPOCH},
    };
    use tauri::{
        ipc::{CallbackFn, InvokeBody},
        test::{mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY},
        webview::InvokeRequest,
        App, Manager, Webview, WebviewWindow, WebviewWindowBuilder,
    };

    #[derive(Clone)]
    enum WorktreeStatusResult {
        Ok(GitWorktreeStatusData),
        Err(String),
    }

    #[derive(Clone)]
    enum WorktreeStatusSummaryResult {
        Ok(GitWorktreeStatusSummaryData),
        Err(String),
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct WorktreeStatusCall {
        repo_path: String,
        target_branch: String,
        diff_scope: GitDiffScope,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct WorktreeStatusSummaryCall {
        repo_path: String,
        target_branch: String,
        diff_scope: GitDiffScope,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct CreateWorktreeCall {
        repo_path: String,
        worktree_path: String,
        branch: String,
        create_branch: bool,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct RemoveWorktreeCall {
        repo_path: String,
        worktree_path: String,
        force: bool,
    }

    struct CommandGitPortState {
        worktree_status_result: WorktreeStatusResult,
        worktree_status_calls: Vec<WorktreeStatusCall>,
        worktree_status_summary_result: WorktreeStatusSummaryResult,
        worktree_status_summary_calls: Vec<WorktreeStatusSummaryCall>,
        worktree_mutation_allowed: bool,
        create_worktree_calls: Vec<CreateWorktreeCall>,
        remove_worktree_calls: Vec<RemoveWorktreeCall>,
    }

    struct CommandGitPort {
        state: Arc<Mutex<CommandGitPortState>>,
    }

    struct CommandTaskStore;

    fn empty_spec_document() -> SpecDocument {
        SpecDocument {
            markdown: String::new(),
            updated_at: None,
        }
    }

    impl TaskStore for CommandTaskStore {
        fn ensure_repo_initialized(&self, _repo_path: &Path) -> anyhow::Result<()> {
            Ok(())
        }

        fn list_tasks(&self, _repo_path: &Path) -> anyhow::Result<Vec<TaskCard>> {
            Ok(Vec::new())
        }

        fn create_task(
            &self,
            _repo_path: &Path,
            _input: CreateTaskInput,
        ) -> anyhow::Result<TaskCard> {
            Err(anyhow!(
                "unexpected task store create_task call in git command tests"
            ))
        }

        fn update_task(
            &self,
            _repo_path: &Path,
            _task_id: &str,
            _patch: UpdateTaskPatch,
        ) -> anyhow::Result<TaskCard> {
            Err(anyhow!(
                "unexpected task store update_task call in git command tests"
            ))
        }

        fn delete_task(
            &self,
            _repo_path: &Path,
            _task_id: &str,
            _delete_subtasks: bool,
        ) -> anyhow::Result<bool> {
            Err(anyhow!(
                "unexpected task store delete_task call in git command tests"
            ))
        }

        fn get_spec(&self, _repo_path: &Path, _task_id: &str) -> anyhow::Result<SpecDocument> {
            Ok(empty_spec_document())
        }

        fn set_spec(
            &self,
            _repo_path: &Path,
            _task_id: &str,
            markdown: &str,
        ) -> anyhow::Result<SpecDocument> {
            Ok(SpecDocument {
                markdown: markdown.to_string(),
                updated_at: None,
            })
        }

        fn get_plan(&self, _repo_path: &Path, _task_id: &str) -> anyhow::Result<SpecDocument> {
            Ok(empty_spec_document())
        }

        fn set_plan(
            &self,
            _repo_path: &Path,
            _task_id: &str,
            markdown: &str,
        ) -> anyhow::Result<SpecDocument> {
            Ok(SpecDocument {
                markdown: markdown.to_string(),
                updated_at: None,
            })
        }

        fn get_latest_qa_report(
            &self,
            _repo_path: &Path,
            _task_id: &str,
        ) -> anyhow::Result<Option<QaReportDocument>> {
            Ok(None)
        }

        fn append_qa_report(
            &self,
            _repo_path: &Path,
            _task_id: &str,
            markdown: &str,
            verdict: QaVerdict,
        ) -> anyhow::Result<QaReportDocument> {
            Ok(QaReportDocument {
                markdown: markdown.to_string(),
                verdict,
                updated_at: String::new(),
                revision: 0,
            })
        }

        fn list_agent_sessions(
            &self,
            _repo_path: &Path,
            _task_id: &str,
        ) -> anyhow::Result<Vec<AgentSessionDocument>> {
            Ok(Vec::new())
        }

        fn upsert_agent_session(
            &self,
            _repo_path: &Path,
            _task_id: &str,
            _session: AgentSessionDocument,
        ) -> anyhow::Result<()> {
            Ok(())
        }

        fn get_task_metadata(
            &self,
            _repo_path: &Path,
            _task_id: &str,
        ) -> anyhow::Result<TaskMetadata> {
            Ok(TaskMetadata {
                spec: empty_spec_document(),
                plan: empty_spec_document(),
                qa_report: None,
                agent_sessions: Vec::new(),
            })
        }
    }

    impl CommandGitPort {
        fn new_with_summary_result(
            result: WorktreeStatusResult,
            summary_result: WorktreeStatusSummaryResult,
            worktree_mutation_allowed: bool,
        ) -> Self {
            Self {
                state: Arc::new(Mutex::new(CommandGitPortState {
                    worktree_status_result: result,
                    worktree_status_calls: Vec::new(),
                    worktree_status_summary_result: summary_result,
                    worktree_status_summary_calls: Vec::new(),
                    worktree_mutation_allowed,
                    create_worktree_calls: Vec::new(),
                    remove_worktree_calls: Vec::new(),
                })),
            }
        }
    }

    impl GitPort for CommandGitPort {
        fn get_branches(&self, _repo_path: &Path) -> anyhow::Result<Vec<GitBranch>> {
            panic!("unexpected call: get_branches");
        }

        fn get_current_branch(&self, _repo_path: &Path) -> anyhow::Result<GitCurrentBranch> {
            panic!("unexpected call: get_current_branch");
        }

        fn switch_branch(
            &self,
            _repo_path: &Path,
            _branch: &str,
            _create: bool,
        ) -> anyhow::Result<GitCurrentBranch> {
            panic!("unexpected call: switch_branch");
        }

        fn create_worktree(
            &self,
            repo_path: &Path,
            worktree_path: &Path,
            branch: &str,
            create_branch: bool,
        ) -> anyhow::Result<()> {
            let mut state = self
                .state
                .lock()
                .expect("command git port state lock should not be poisoned");
            if !state.worktree_mutation_allowed {
                panic!("unexpected call: create_worktree");
            }
            state.create_worktree_calls.push(CreateWorktreeCall {
                repo_path: repo_path.to_string_lossy().to_string(),
                worktree_path: worktree_path.to_string_lossy().to_string(),
                branch: branch.to_string(),
                create_branch,
            });
            Ok(())
        }

        fn remove_worktree(
            &self,
            repo_path: &Path,
            worktree_path: &Path,
            force: bool,
        ) -> anyhow::Result<()> {
            let mut state = self
                .state
                .lock()
                .expect("command git port state lock should not be poisoned");
            if !state.worktree_mutation_allowed {
                panic!("unexpected call: remove_worktree");
            }
            state.remove_worktree_calls.push(RemoveWorktreeCall {
                repo_path: repo_path.to_string_lossy().to_string(),
                worktree_path: worktree_path.to_string_lossy().to_string(),
                force,
            });
            Ok(())
        }

        fn push_branch(
            &self,
            _repo_path: &Path,
            _remote: &str,
            _branch: &str,
            _set_upstream: bool,
            _force_with_lease: bool,
        ) -> anyhow::Result<GitPushResult> {
            panic!("unexpected call: push_branch");
        }

        fn pull_branch(
            &self,
            _repo_path: &Path,
            _request: GitPullRequest,
        ) -> anyhow::Result<GitPullResult> {
            panic!("unexpected call: pull_branch");
        }

        fn rebase_abort(
            &self,
            _repo_path: &Path,
            _request: GitRebaseAbortRequest,
        ) -> anyhow::Result<GitRebaseAbortResult> {
            panic!("unexpected call: rebase_abort");
        }

        fn get_status(&self, _repo_path: &Path) -> anyhow::Result<Vec<GitFileStatus>> {
            panic!("unexpected call: get_status");
        }

        fn get_diff(
            &self,
            _repo_path: &Path,
            _target_branch: Option<&str>,
        ) -> anyhow::Result<Vec<GitFileDiff>> {
            panic!("unexpected call: get_diff");
        }

        fn get_worktree_status(
            &self,
            repo_path: &Path,
            target_branch: &str,
            diff_scope: GitDiffScope,
        ) -> anyhow::Result<GitWorktreeStatusData> {
            let mut state = self
                .state
                .lock()
                .expect("command git port state lock should not be poisoned");
            state.worktree_status_calls.push(WorktreeStatusCall {
                repo_path: repo_path.to_string_lossy().to_string(),
                target_branch: target_branch.to_string(),
                diff_scope,
            });
            match state.worktree_status_result.clone() {
                WorktreeStatusResult::Ok(payload) => Ok(payload),
                WorktreeStatusResult::Err(message) => Err(anyhow!(message)),
            }
        }

        fn get_worktree_status_summary(
            &self,
            repo_path: &Path,
            target_branch: &str,
            diff_scope: GitDiffScope,
        ) -> anyhow::Result<GitWorktreeStatusSummaryData> {
            let mut state = self
                .state
                .lock()
                .expect("command git port state lock should not be poisoned");
            state
                .worktree_status_summary_calls
                .push(WorktreeStatusSummaryCall {
                    repo_path: repo_path.to_string_lossy().to_string(),
                    target_branch: target_branch.to_string(),
                    diff_scope,
                });
            match state.worktree_status_summary_result.clone() {
                WorktreeStatusSummaryResult::Ok(payload) => Ok(payload),
                WorktreeStatusSummaryResult::Err(message) => Err(anyhow!(message)),
            }
        }

        fn resolve_upstream_target(&self, _repo_path: &Path) -> anyhow::Result<Option<String>> {
            panic!("unexpected call: resolve_upstream_target");
        }

        fn commits_ahead_behind(
            &self,
            _repo_path: &Path,
            _target_branch: &str,
        ) -> anyhow::Result<GitAheadBehind> {
            panic!("unexpected call: commits_ahead_behind");
        }

        fn commit_all(
            &self,
            _repo_path: &Path,
            _request: GitCommitAllRequest,
        ) -> anyhow::Result<GitCommitAllResult> {
            panic!("unexpected call: commit_all");
        }

        fn rebase_branch(
            &self,
            _repo_path: &Path,
            _request: GitRebaseBranchRequest,
        ) -> anyhow::Result<GitRebaseBranchResult> {
            panic!("unexpected call: rebase_branch");
        }
    }

    struct CommandGitFixture {
        _app: App<MockRuntime>,
        webview: WebviewWindow<MockRuntime>,
        repo_path: String,
        git_state: Arc<Mutex<CommandGitPortState>>,
        root: PathBuf,
    }

    impl Drop for CommandGitFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn unique_test_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_nanos();
        let dir = env::temp_dir().join(format!("openducktor-{prefix}-{nanos}"));
        fs::create_dir_all(&dir).expect("failed to create test directory");
        dir
    }

    fn run_git(args: &[&str], cwd: &Path) {
        let status = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .status()
            .expect("failed to run git command");
        assert!(status.success(), "git command failed: {:?}", args);
    }

    fn init_repo(path: &Path) {
        fs::create_dir_all(path).expect("failed to create repo directory");
        run_git(&["init", "--initial-branch=main"], path);
        fs::write(path.join("README.md"), "init\n").expect("failed to write seed file");
        run_git(&["add", "."], path);
        run_git(
            &[
                "-c",
                "user.name=OpenDucktor Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "init",
            ],
            path,
        );
    }

    fn setup_command_git_fixture(
        prefix: &str,
        result: WorktreeStatusResult,
        authorize_repo: bool,
    ) -> CommandGitFixture {
        setup_command_git_fixture_with_summary(
            prefix,
            result,
            WorktreeStatusSummaryResult::Ok(sample_worktree_status_summary_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                },
            )),
            authorize_repo,
            false,
        )
    }

    fn setup_command_git_fixture_with_mutations(
        prefix: &str,
        result: WorktreeStatusResult,
        authorize_repo: bool,
    ) -> CommandGitFixture {
        setup_command_git_fixture_with_summary(
            prefix,
            result,
            WorktreeStatusSummaryResult::Ok(sample_worktree_status_summary_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                },
            )),
            authorize_repo,
            true,
        )
    }

    fn setup_command_git_fixture_with_summary(
        prefix: &str,
        result: WorktreeStatusResult,
        summary_result: WorktreeStatusSummaryResult,
        authorize_repo: bool,
        worktree_mutation_allowed: bool,
    ) -> CommandGitFixture {
        let root = unique_test_dir(prefix);
        let repo = root.join("repo");
        init_repo(&repo);

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        if authorize_repo {
            config_store
                .add_workspace(repo.to_string_lossy().as_ref())
                .expect("workspace should be allowlisted");
        }

        let git_port = CommandGitPort::new_with_summary_result(
            result,
            summary_result,
            worktree_mutation_allowed,
        );
        let git_state = git_port.state.clone();
        let task_store: Arc<dyn TaskStore> = Arc::new(CommandTaskStore);
        let service = Arc::new(AppService::with_git_port(
            task_store,
            config_store,
            Arc::new(git_port),
        ));
        let app = mock_builder()
            .manage(AppState {
                service,
                hook_trust_challenges: Mutex::new(HashMap::new()),
                hook_trust_dialog_test_response: Mutex::new(None),
            })
            .invoke_handler(tauri::generate_handler![
                git_get_worktree_status,
                git_get_worktree_status_summary,
                git_create_worktree,
                git_remove_worktree
            ])
            .build(mock_context(noop_assets()))
            .expect("test app should build");
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("test webview should build");

        CommandGitFixture {
            _app: app,
            webview,
            repo_path: repo.to_string_lossy().to_string(),
            git_state,
            root,
        }
    }

    fn invoke_json<W: AsRef<Webview<MockRuntime>>>(
        webview: &W,
        cmd: &str,
        body: Value,
    ) -> Result<Value, Value> {
        tauri::test::get_ipc_response(
            webview,
            InvokeRequest {
                cmd: cmd.to_string(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "http://tauri.localhost"
                    .parse()
                    .expect("invoke URL should parse"),
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|payload| {
            payload
                .deserialize::<Value>()
                .expect("command response should deserialize")
        })
    }

    fn seed_authorized_worktree_cache_with_subset(repo: &Path, allowed_worktrees: &[&Path]) {
        let canonical_repo =
            fs::canonicalize(repo).expect("repo should canonicalize for cache seed");
        let worktree_state_token = read_worktree_state_token(canonical_repo.as_path())
            .expect("worktree state token should be readable for cache seed");
        let seeded_worktrees = allowed_worktrees
            .iter()
            .map(|path| {
                fs::canonicalize(path).expect("worktree should canonicalize for cache seed")
            })
            .collect::<HashSet<_>>();
        let mut cache = authorized_worktree_cache()
            .lock()
            .expect("authorized worktree cache lock should not be poisoned");
        cache.insert(
            cache_key(canonical_repo.as_path()),
            AuthorizedWorktreeCacheEntry {
                cached_at: Instant::now(),
                worktree_state_token,
                worktrees: seeded_worktrees,
            },
        );
    }

    fn clear_authorized_worktree_cache_for_repo(repo: &Path) {
        invalidate_worktree_resolution_cache_for_repo(repo.to_string_lossy().as_ref())
            .expect("worktree cache should clear for repository");
    }

    fn sample_worktree_status_data(upstream: GitUpstreamAheadBehind) -> GitWorktreeStatusData {
        GitWorktreeStatusData {
            current_branch: GitCurrentBranch {
                name: Some("feature/command".to_string()),
                detached: false,
            },
            file_statuses: vec![GitFileStatus {
                path: "src/main.rs".to_string(),
                status: "M".to_string(),
                staged: false,
            }],
            file_diffs: vec![GitFileDiff {
                file: "src/main.rs".to_string(),
                diff_type: "modified".to_string(),
                additions: 1,
                deletions: 0,
                diff: "@@ -1 +1 @@\n-old\n+new\n".to_string(),
            }],
            target_ahead_behind: GitAheadBehind {
                ahead: 1,
                behind: 0,
            },
            upstream_ahead_behind: upstream,
        }
    }

    fn sample_worktree_status_summary_data(
        upstream: GitUpstreamAheadBehind,
    ) -> GitWorktreeStatusSummaryData {
        GitWorktreeStatusSummaryData {
            current_branch: GitCurrentBranch {
                name: Some("feature/command".to_string()),
                detached: false,
            },
            file_statuses: vec![GitFileStatus {
                path: "src/main.rs".to_string(),
                status: "M".to_string(),
                staged: false,
            }],
            file_status_counts: GitFileStatusCounts {
                total: 1,
                staged: 0,
                unstaged: 1,
            },
            target_ahead_behind: GitAheadBehind {
                ahead: 1,
                behind: 0,
            },
            upstream_ahead_behind: upstream,
        }
    }

    #[test]
    fn git_get_worktree_status_rejects_unauthorized_repo() {
        let fixture = setup_command_git_fixture(
            "git-command-unauthorized",
            WorktreeStatusResult::Ok(sample_worktree_status_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                },
            )),
            false,
        );

        let error = invoke_json(
            &fixture.webview,
            "git_get_worktree_status",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "targetBranch": "origin/main",
            }),
        )
        .expect_err("unauthorized repo should fail");

        assert!(
            error
                .to_string()
                .contains("Repository path is not in the configured workspace allowlist"),
            "unexpected error: {error}"
        );
        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert!(
            state.worktree_status_calls.is_empty(),
            "git port should not run when authorization fails"
        );
    }

    #[test]
    fn git_get_worktree_status_keeps_upstream_error_variant_and_snapshot_metadata() {
        let fixture = setup_command_git_fixture(
            "git-command-upstream-error",
            WorktreeStatusResult::Ok(sample_worktree_status_data(GitUpstreamAheadBehind::Error {
                message: "upstream not configured".to_string(),
            })),
            true,
        );

        let response = invoke_json(
            &fixture.webview,
            "git_get_worktree_status",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "targetBranch": "  origin/main  ",
                "diffScope": "uncommitted",
            }),
        )
        .expect("command should succeed");
        let status: GitWorktreeStatus =
            serde_json::from_value(response).expect("response should decode as GitWorktreeStatus");

        assert_eq!(
            status.upstream_ahead_behind,
            GitUpstreamAheadBehind::Error {
                message: "upstream not configured".to_string()
            }
        );
        assert_eq!(status.snapshot.target_branch, "origin/main");
        assert_eq!(status.snapshot.diff_scope, GitDiffScope::Uncommitted);
        assert_eq!(status.snapshot.hash_version, GIT_WORKTREE_HASH_VERSION);
        assert_eq!(status.snapshot.status_hash.len(), 16);
        assert_eq!(status.snapshot.diff_hash.len(), 16);

        let expected_effective = fs::canonicalize(Path::new(&fixture.repo_path))
            .expect("repo should canonicalize")
            .to_string_lossy()
            .to_string();
        assert_eq!(status.snapshot.effective_working_dir, expected_effective);

        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert_eq!(state.worktree_status_calls.len(), 1);
        assert_eq!(
            state.worktree_status_calls[0],
            WorktreeStatusCall {
                repo_path: expected_effective,
                target_branch: "origin/main".to_string(),
                diff_scope: GitDiffScope::Uncommitted,
            }
        );
    }

    #[test]
    fn git_get_worktree_status_propagates_upstream_status_collection_failures() {
        let fixture = setup_command_git_fixture(
            "git-command-status-failure",
            WorktreeStatusResult::Err("failed collecting upstream status".to_string()),
            true,
        );

        let error = invoke_json(
            &fixture.webview,
            "git_get_worktree_status",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "targetBranch": "origin/main",
            }),
        )
        .expect_err("git port failure should be returned");

        assert!(
            error
                .to_string()
                .contains("failed collecting upstream status"),
            "unexpected error: {error}"
        );
        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert_eq!(state.worktree_status_calls.len(), 1);
    }

    #[test]
    fn git_get_worktree_status_rejects_unrelated_working_dir() {
        let fixture = setup_command_git_fixture(
            "git-command-working-dir-reject",
            WorktreeStatusResult::Ok(sample_worktree_status_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                },
            )),
            true,
        );
        let external = fixture.root.join("external");
        init_repo(&external);

        let error = invoke_json(
            &fixture.webview,
            "git_get_worktree_status",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "targetBranch": "origin/main",
                "workingDir": external.to_string_lossy().to_string(),
            }),
        )
        .expect_err("unrelated working_dir should fail");

        assert!(
            error
                .to_string()
                .contains("working_dir is not within authorized repository or linked worktrees"),
            "unexpected error: {error}"
        );
        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert!(
            state.worktree_status_calls.is_empty(),
            "git port should not run for unauthorized working_dir"
        );
    }

    #[test]
    fn git_get_worktree_status_accepts_registered_worktree_working_dir() {
        let fixture = setup_command_git_fixture(
            "git-command-working-dir-accept",
            WorktreeStatusResult::Ok(sample_worktree_status_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 1,
                    behind: 0,
                },
            )),
            true,
        );
        let worktree = fixture.root.join("repo-wt");
        let worktree_str = worktree.to_string_lossy().to_string();
        run_git(
            &[
                "-C",
                fixture.repo_path.as_str(),
                "worktree",
                "add",
                "-b",
                "feature/command-working-dir",
                worktree_str.as_str(),
            ],
            Path::new(&fixture.repo_path),
        );

        let response = invoke_json(
            &fixture.webview,
            "git_get_worktree_status",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "targetBranch": "origin/main",
                "workingDir": worktree_str,
            }),
        )
        .expect("registered worktree should be accepted");
        let status: GitWorktreeStatus =
            serde_json::from_value(response).expect("response should decode as GitWorktreeStatus");
        let expected_worktree = fs::canonicalize(&worktree)
            .expect("worktree should canonicalize")
            .to_string_lossy()
            .to_string();
        assert_eq!(status.snapshot.effective_working_dir, expected_worktree);

        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert_eq!(state.worktree_status_calls.len(), 1);
        assert_eq!(state.worktree_status_calls[0].repo_path, expected_worktree);
    }

    #[test]
    fn git_get_worktree_status_summary_rejects_unauthorized_repo() {
        let fixture = setup_command_git_fixture(
            "git-command-summary-unauthorized",
            WorktreeStatusResult::Ok(sample_worktree_status_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                },
            )),
            false,
        );

        let error = invoke_json(
            &fixture.webview,
            "git_get_worktree_status_summary",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "targetBranch": "origin/main",
            }),
        )
        .expect_err("unauthorized repo should fail");

        assert!(
            error
                .to_string()
                .contains("Repository path is not in the configured workspace allowlist"),
            "unexpected error: {error}"
        );
        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert!(
            state.worktree_status_summary_calls.is_empty(),
            "git port summary path should not run when authorization fails"
        );
    }

    #[test]
    fn git_get_worktree_status_summary_keeps_upstream_error_variant_and_snapshot_metadata() {
        let fixture = setup_command_git_fixture_with_summary(
            "git-command-summary-upstream-error",
            WorktreeStatusResult::Ok(sample_worktree_status_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                },
            )),
            WorktreeStatusSummaryResult::Ok(sample_worktree_status_summary_data(
                GitUpstreamAheadBehind::Error {
                    message: "upstream not configured".to_string(),
                },
            )),
            true,
            false,
        );

        let response = invoke_json(
            &fixture.webview,
            "git_get_worktree_status_summary",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "targetBranch": "  origin/main  ",
                "diffScope": "uncommitted",
            }),
        )
        .expect("summary command should succeed");
        let status: GitWorktreeStatusSummary = serde_json::from_value(response)
            .expect("response should decode as GitWorktreeStatusSummary");

        assert_eq!(
            status.upstream_ahead_behind,
            GitUpstreamAheadBehind::Error {
                message: "upstream not configured".to_string()
            }
        );
        assert_eq!(status.snapshot.target_branch, "origin/main");
        assert_eq!(status.snapshot.diff_scope, GitDiffScope::Uncommitted);
        assert_eq!(status.snapshot.hash_version, GIT_WORKTREE_HASH_VERSION);
        assert_eq!(status.snapshot.status_hash.len(), 16);
        assert_eq!(status.snapshot.diff_hash.len(), 16);

        let expected_effective = fs::canonicalize(Path::new(&fixture.repo_path))
            .expect("repo should canonicalize")
            .to_string_lossy()
            .to_string();
        assert_eq!(status.snapshot.effective_working_dir, expected_effective);

        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert_eq!(state.worktree_status_summary_calls.len(), 1);
        assert_eq!(
            state.worktree_status_summary_calls[0],
            WorktreeStatusSummaryCall {
                repo_path: expected_effective,
                target_branch: "origin/main".to_string(),
                diff_scope: GitDiffScope::Uncommitted,
            }
        );
    }

    #[test]
    fn git_get_worktree_status_summary_propagates_git_port_failures() {
        let fixture = setup_command_git_fixture_with_summary(
            "git-command-summary-status-failure",
            WorktreeStatusResult::Ok(sample_worktree_status_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                },
            )),
            WorktreeStatusSummaryResult::Err("failed collecting summary status".to_string()),
            true,
            false,
        );

        let error = invoke_json(
            &fixture.webview,
            "git_get_worktree_status_summary",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "targetBranch": "origin/main",
            }),
        )
        .expect_err("git port summary failure should be returned");

        assert!(
            error
                .to_string()
                .contains("failed collecting summary status"),
            "unexpected error: {error}"
        );
        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert_eq!(state.worktree_status_summary_calls.len(), 1);
    }

    #[test]
    fn git_get_worktree_status_summary_rejects_invalid_diff_scope_before_git_port_call() {
        let fixture = setup_command_git_fixture(
            "git-command-summary-invalid-scope",
            WorktreeStatusResult::Ok(sample_worktree_status_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                },
            )),
            true,
        );

        let error = invoke_json(
            &fixture.webview,
            "git_get_worktree_status_summary",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "targetBranch": "origin/main",
                "diffScope": "staged",
            }),
        )
        .expect_err("invalid diff scope should fail");

        assert!(
            error
                .to_string()
                .contains("diffScope must be either 'target' or 'uncommitted'"),
            "unexpected error: {error}"
        );
        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert!(
            state.worktree_status_summary_calls.is_empty(),
            "git port summary path should not run when diffScope is invalid"
        );
    }

    #[test]
    fn git_get_worktree_status_summary_rejects_unrelated_working_dir() {
        let fixture = setup_command_git_fixture(
            "git-command-summary-working-dir-reject",
            WorktreeStatusResult::Ok(sample_worktree_status_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                },
            )),
            true,
        );
        let external = fixture.root.join("external-summary");
        init_repo(&external);

        let error = invoke_json(
            &fixture.webview,
            "git_get_worktree_status_summary",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "targetBranch": "origin/main",
                "workingDir": external.to_string_lossy().to_string(),
            }),
        )
        .expect_err("unrelated working_dir should fail");

        assert!(
            error
                .to_string()
                .contains("working_dir is not within authorized repository or linked worktrees"),
            "unexpected error: {error}"
        );
        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert!(
            state.worktree_status_summary_calls.is_empty(),
            "git port summary path should not run for unauthorized working_dir"
        );
    }

    #[test]
    fn resolve_working_dir_accepts_repo_root() {
        let root = unique_test_dir("git-root");
        let repo = root.join("repo");
        init_repo(&repo);

        let resolved = resolve_working_dir(
            repo.to_string_lossy().as_ref(),
            Some(repo.to_string_lossy().as_ref()),
        )
        .expect("repo root should be accepted");
        let expected = fs::canonicalize(&repo)
            .expect("repo should be canonicalizable")
            .to_string_lossy()
            .to_string();
        assert_eq!(resolved, expected);

        fs::remove_dir_all(&root).expect("failed to remove test directory");
    }

    #[test]
    fn resolve_working_dir_accepts_registered_worktree() {
        let root = unique_test_dir("git-worktree");
        let repo = root.join("repo");
        let worktree = root.join("repo-wt");
        init_repo(&repo);

        let repo_str = repo.to_string_lossy().to_string();
        let worktree_str = worktree.to_string_lossy().to_string();
        run_git(
            &[
                "-C",
                repo_str.as_str(),
                "worktree",
                "add",
                "-b",
                "feature/test",
                worktree_str.as_str(),
            ],
            &repo,
        );

        let resolved = resolve_working_dir(repo_str.as_str(), Some(worktree_str.as_str()))
            .expect("registered worktree should be accepted");
        let expected = fs::canonicalize(&worktree)
            .expect("worktree should be canonicalizable")
            .to_string_lossy()
            .to_string();
        assert_eq!(resolved, expected);

        fs::remove_dir_all(&root).expect("failed to remove test directory");
    }

    #[test]
    fn worktree_state_token_changes_when_gitdir_content_changes() {
        let root = unique_test_dir("git-worktree-token-gitdir");
        let repo = root.join("repo");
        let worktree = root.join("repo-wt");
        init_repo(&repo);
        clear_authorized_worktree_cache_for_repo(&repo);

        let repo_str = repo.to_string_lossy().to_string();
        let worktree_str = worktree.to_string_lossy().to_string();
        run_git(
            &[
                "-C",
                repo_str.as_str(),
                "worktree",
                "add",
                "-b",
                "feature/token-gitdir",
                worktree_str.as_str(),
            ],
            &repo,
        );

        let canonical_repo = fs::canonicalize(&repo).expect("repo should canonicalize");
        let token_before = read_worktree_state_token(canonical_repo.as_path())
            .expect("worktree state token should be readable");

        let common_git_dir = read_git_common_dir(canonical_repo.as_path())
            .expect("git common directory should be readable");
        let worktrees_dir = common_git_dir.join("worktrees");
        let mut entry_names = fs::read_dir(&worktrees_dir)
            .expect("worktrees directory should be readable")
            .map(|entry| {
                entry
                    .expect("worktree entry should be readable")
                    .file_name()
                    .to_string_lossy()
                    .to_string()
            })
            .collect::<Vec<_>>();
        entry_names.sort_unstable();
        let first_entry = entry_names
            .first()
            .expect("worktrees directory should contain an entry");

        let gitdir_path = worktrees_dir.join(first_entry).join("gitdir");
        let original_gitdir =
            fs::read_to_string(&gitdir_path).expect("worktree entry gitdir should be readable");
        let mutated_gitdir = format!("{}-moved", original_gitdir.trim_end_matches(['\r', '\n']));
        fs::write(&gitdir_path, format!("{mutated_gitdir}\n"))
            .expect("worktree entry gitdir should be writable for token mutation test");

        let token_after = read_worktree_state_token(canonical_repo.as_path())
            .expect("worktree state token should be readable after gitdir mutation");

        assert_ne!(
            token_before, token_after,
            "worktree state token should change when entry gitdir content changes"
        );

        clear_authorized_worktree_cache_for_repo(&repo);
        fs::remove_dir_all(&root).expect("failed to remove test directory");
    }

    #[test]
    fn resolve_working_dir_refreshes_when_worktree_metadata_changes() {
        let root = unique_test_dir("git-worktree-cache");
        let repo = root.join("repo");
        let worktree_one = root.join("repo-wt-1");
        let worktree_two = root.join("repo-wt-2");
        init_repo(&repo);
        clear_authorized_worktree_cache_for_repo(&repo);

        let repo_str = repo.to_string_lossy().to_string();
        let worktree_one_str = worktree_one.to_string_lossy().to_string();
        let worktree_two_str = worktree_two.to_string_lossy().to_string();

        run_git(
            &[
                "-C",
                repo_str.as_str(),
                "worktree",
                "add",
                "-b",
                "feature/cache-one",
                worktree_one_str.as_str(),
            ],
            &repo,
        );

        let resolved_one = resolve_working_dir(repo_str.as_str(), Some(worktree_one_str.as_str()))
            .expect("initial worktree should resolve and populate cache");
        let expected_one = fs::canonicalize(&worktree_one)
            .expect("first worktree should canonicalize")
            .to_string_lossy()
            .to_string();
        assert_eq!(resolved_one, expected_one);

        run_git(
            &[
                "-C",
                repo_str.as_str(),
                "worktree",
                "add",
                "-b",
                "feature/cache-two",
                worktree_two_str.as_str(),
            ],
            &repo,
        );

        let resolved_two = resolve_working_dir(repo_str.as_str(), Some(worktree_two_str.as_str()))
            .expect("worktree should resolve once metadata coherency forces a refresh");
        let expected_two = fs::canonicalize(&worktree_two)
            .expect("second worktree should canonicalize")
            .to_string_lossy()
            .to_string();
        assert_eq!(resolved_two, expected_two);

        clear_authorized_worktree_cache_for_repo(&repo);
        fs::remove_dir_all(&root).expect("failed to remove test directory");
    }

    #[test]
    fn resolve_working_dir_ignores_prunable_worktree_entries() {
        let root = unique_test_dir("git-worktree-prunable");
        let repo = root.join("repo");
        let removed_worktree = root.join("repo-wt-removed");
        let active_worktree = root.join("repo-wt-active");
        init_repo(&repo);
        clear_authorized_worktree_cache_for_repo(&repo);

        let repo_str = repo.to_string_lossy().to_string();
        let removed_worktree_str = removed_worktree.to_string_lossy().to_string();
        let active_worktree_str = active_worktree.to_string_lossy().to_string();

        run_git(
            &[
                "-C",
                repo_str.as_str(),
                "worktree",
                "add",
                "-b",
                "feature/prunable-removed",
                removed_worktree_str.as_str(),
            ],
            &repo,
        );
        run_git(
            &[
                "-C",
                repo_str.as_str(),
                "worktree",
                "add",
                "-b",
                "feature/prunable-active",
                active_worktree_str.as_str(),
            ],
            &repo,
        );

        fs::remove_dir_all(&removed_worktree)
            .expect("removed worktree directory should be deleted for prunable test");

        let resolved_active =
            resolve_working_dir(repo_str.as_str(), Some(active_worktree_str.as_str()))
                .expect("active worktree should resolve even when another entry is prunable");
        let expected_active = fs::canonicalize(&active_worktree)
            .expect("active worktree should canonicalize")
            .to_string_lossy()
            .to_string();
        assert_eq!(resolved_active, expected_active);

        clear_authorized_worktree_cache_for_repo(&repo);
        fs::remove_dir_all(&root).expect("failed to remove test directory");
    }

    #[test]
    fn git_create_worktree_invalidates_authorized_worktree_cache() {
        let fixture = setup_command_git_fixture_with_mutations(
            "git-command-create-worktree-cache-invalidate",
            WorktreeStatusResult::Ok(sample_worktree_status_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                },
            )),
            true,
        );
        let repo_path = Path::new(&fixture.repo_path);
        clear_authorized_worktree_cache_for_repo(repo_path);
        let worktree_one = fixture.root.join("repo-wt-create-one");
        let worktree_two = fixture.root.join("repo-wt-create-two");
        run_git(
            &[
                "-C",
                fixture.repo_path.as_str(),
                "worktree",
                "add",
                "-b",
                "feature/create-cache-one",
                worktree_one.to_string_lossy().as_ref(),
            ],
            repo_path,
        );
        run_git(
            &[
                "-C",
                fixture.repo_path.as_str(),
                "worktree",
                "add",
                "-b",
                "feature/create-cache-two",
                worktree_two.to_string_lossy().as_ref(),
            ],
            repo_path,
        );

        seed_authorized_worktree_cache_with_subset(repo_path, &[worktree_one.as_path()]);

        let worktree_two_str = worktree_two.to_string_lossy().to_string();
        let stale_error =
            resolve_working_dir(fixture.repo_path.as_str(), Some(worktree_two_str.as_str()))
                .expect_err("seeded cache should reject worktree omitted from subset");
        assert!(
            stale_error.contains("not within authorized repository or linked worktrees"),
            "unexpected stale cache error: {stale_error}"
        );

        let command_worktree_path = fixture.root.join("repo-wt-command-create");
        invoke_json(
            &fixture.webview,
            "git_create_worktree",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "worktreePath": command_worktree_path.to_string_lossy().to_string(),
                "branch": "feature/command-create",
                "createBranch": true,
            }),
        )
        .expect("git_create_worktree should succeed");

        let resolved =
            resolve_working_dir(fixture.repo_path.as_str(), Some(worktree_two_str.as_str()))
                .expect("worktree cache should refresh after create command invalidation");
        let expected = fs::canonicalize(&worktree_two)
            .expect("worktree should canonicalize")
            .to_string_lossy()
            .to_string();
        assert_eq!(resolved, expected);

        clear_authorized_worktree_cache_for_repo(repo_path);

        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert_eq!(state.create_worktree_calls.len(), 1);
    }

    #[test]
    fn git_remove_worktree_invalidates_authorized_worktree_cache() {
        let fixture = setup_command_git_fixture_with_mutations(
            "git-command-remove-worktree-cache-invalidate",
            WorktreeStatusResult::Ok(sample_worktree_status_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                },
            )),
            true,
        );
        let repo_path = Path::new(&fixture.repo_path);
        clear_authorized_worktree_cache_for_repo(repo_path);
        let worktree_one = fixture.root.join("repo-wt-remove-one");
        let worktree_two = fixture.root.join("repo-wt-remove-two");
        run_git(
            &[
                "-C",
                fixture.repo_path.as_str(),
                "worktree",
                "add",
                "-b",
                "feature/remove-cache-one",
                worktree_one.to_string_lossy().as_ref(),
            ],
            repo_path,
        );
        run_git(
            &[
                "-C",
                fixture.repo_path.as_str(),
                "worktree",
                "add",
                "-b",
                "feature/remove-cache-two",
                worktree_two.to_string_lossy().as_ref(),
            ],
            repo_path,
        );

        seed_authorized_worktree_cache_with_subset(repo_path, &[worktree_one.as_path()]);

        let worktree_two_str = worktree_two.to_string_lossy().to_string();
        let stale_error =
            resolve_working_dir(fixture.repo_path.as_str(), Some(worktree_two_str.as_str()))
                .expect_err("seeded cache should reject worktree omitted from subset");
        assert!(
            stale_error.contains("not within authorized repository or linked worktrees"),
            "unexpected stale cache error: {stale_error}"
        );

        invoke_json(
            &fixture.webview,
            "git_remove_worktree",
            json!({
                "repoPath": fixture.repo_path.as_str(),
                "worktreePath": worktree_one.to_string_lossy().to_string(),
                "force": false,
            }),
        )
        .expect("git_remove_worktree should succeed");

        let resolved =
            resolve_working_dir(fixture.repo_path.as_str(), Some(worktree_two_str.as_str()))
                .expect("worktree cache should refresh after remove command invalidation");
        let expected = fs::canonicalize(&worktree_two)
            .expect("worktree should canonicalize")
            .to_string_lossy()
            .to_string();
        assert_eq!(resolved, expected);

        clear_authorized_worktree_cache_for_repo(repo_path);

        let state = fixture
            .git_state
            .lock()
            .expect("command git state lock should not be poisoned");
        assert_eq!(state.remove_worktree_calls.len(), 1);
    }

    #[test]
    fn workspace_select_invalidates_authorized_worktree_cache() {
        let fixture = setup_command_git_fixture(
            "workspace-select-cache-invalidate",
            WorktreeStatusResult::Ok(sample_worktree_status_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                },
            )),
            true,
        );
        let repo_path = Path::new(&fixture.repo_path);
        clear_authorized_worktree_cache_for_repo(repo_path);
        let worktree_one = fixture.root.join("repo-wt-workspace-one");
        let worktree_two = fixture.root.join("repo-wt-workspace-two");
        run_git(
            &[
                "-C",
                fixture.repo_path.as_str(),
                "worktree",
                "add",
                "-b",
                "feature/workspace-cache-one",
                worktree_one.to_string_lossy().as_ref(),
            ],
            repo_path,
        );
        run_git(
            &[
                "-C",
                fixture.repo_path.as_str(),
                "worktree",
                "add",
                "-b",
                "feature/workspace-cache-two",
                worktree_two.to_string_lossy().as_ref(),
            ],
            repo_path,
        );

        seed_authorized_worktree_cache_with_subset(repo_path, &[worktree_one.as_path()]);

        let worktree_two_str = worktree_two.to_string_lossy().to_string();
        let stale_error =
            resolve_working_dir(fixture.repo_path.as_str(), Some(worktree_two_str.as_str()))
                .expect_err("seeded cache should reject worktree omitted from subset");
        assert!(
            stale_error.contains("not within authorized repository or linked worktrees"),
            "unexpected stale cache error: {stale_error}"
        );

        tauri::async_runtime::block_on(workspace_select(
            fixture._app.state(),
            fixture.repo_path.clone(),
        ))
        .expect("workspace_select should succeed");

        let resolved =
            resolve_working_dir(fixture.repo_path.as_str(), Some(worktree_two_str.as_str()))
                .expect("worktree cache should refresh after workspace selection invalidation");
        let expected = fs::canonicalize(&worktree_two)
            .expect("worktree should canonicalize")
            .to_string_lossy()
            .to_string();
        assert_eq!(resolved, expected);

        clear_authorized_worktree_cache_for_repo(repo_path);
    }

    #[test]
    fn workspace_select_invalidates_only_selected_repo_cache_entry() {
        let fixture = setup_command_git_fixture(
            "workspace-select-cache-invalidate-selected-only",
            WorktreeStatusResult::Ok(sample_worktree_status_data(
                GitUpstreamAheadBehind::Tracking {
                    ahead: 0,
                    behind: 0,
                },
            )),
            true,
        );
        let selected_repo = Path::new(&fixture.repo_path);
        clear_authorized_worktree_cache_for_repo(selected_repo);

        let secondary_repo = fixture.root.join("secondary-repo");
        init_repo(&secondary_repo);
        clear_authorized_worktree_cache_for_repo(&secondary_repo);

        seed_authorized_worktree_cache_with_subset(selected_repo, &[]);
        seed_authorized_worktree_cache_with_subset(&secondary_repo, &[]);

        let selected_repo_key = cache_key(
            fs::canonicalize(selected_repo)
                .expect("selected repo should canonicalize")
                .as_path(),
        );
        let secondary_repo_key = cache_key(
            fs::canonicalize(&secondary_repo)
                .expect("secondary repo should canonicalize")
                .as_path(),
        );
        {
            let cache = authorized_worktree_cache()
                .lock()
                .expect("authorized worktree cache lock should not be poisoned");
            assert!(
                cache.contains_key(&selected_repo_key),
                "selected repo cache entry should exist before workspace_select"
            );
            assert!(
                cache.contains_key(&secondary_repo_key),
                "secondary repo cache entry should exist before workspace_select"
            );
        }

        tauri::async_runtime::block_on(workspace_select(
            fixture._app.state(),
            fixture.repo_path.clone(),
        ))
        .expect("workspace_select should succeed");

        let cache = authorized_worktree_cache()
            .lock()
            .expect("authorized worktree cache lock should not be poisoned");
        assert!(
            !cache.contains_key(&selected_repo_key),
            "workspace_select should invalidate selected repo cache entry"
        );
        assert!(
            cache.contains_key(&secondary_repo_key),
            "workspace_select should not invalidate unrelated repo cache entries"
        );
    }

    #[test]
    fn resolve_working_dir_rejects_unrelated_external_repo() {
        let root = unique_test_dir("git-external");
        let authorized_repo = root.join("authorized");
        let external_repo = root.join("external");
        init_repo(&authorized_repo);
        init_repo(&external_repo);

        let error = resolve_working_dir(
            authorized_repo.to_string_lossy().as_ref(),
            Some(external_repo.to_string_lossy().as_ref()),
        )
        .expect_err("unrelated external repo must be rejected");
        assert!(
            error.contains("not within authorized repository or linked worktrees"),
            "unexpected error: {error}"
        );

        fs::remove_dir_all(&root).expect("failed to remove test directory");
    }

    #[test]
    fn require_target_branch_rejects_blank_values() {
        let error = require_target_branch("   ")
            .expect_err("blank target branch should be rejected at command boundary");
        assert_eq!(error, "targetBranch is required");
    }

    #[test]
    fn parse_diff_scope_accepts_uncommitted_and_rejects_unknown_values() {
        assert_eq!(
            parse_diff_scope(Some("uncommitted")).expect("uncommitted scope should parse"),
            GitDiffScope::Uncommitted
        );

        let error = parse_diff_scope(Some("staged"))
            .expect_err("unknown diff scope should be rejected at command boundary");
        assert!(
            error.contains("diffScope must be either 'target' or 'uncommitted'"),
            "unexpected scope parse error: {error}"
        );
    }

    #[test]
    fn build_worktree_status_with_snapshot_preserves_payload_and_snapshot_fields() {
        let status_data = GitWorktreeStatusData {
            current_branch: GitCurrentBranch {
                name: Some("feature/snapshot".to_string()),
                detached: false,
            },
            file_statuses: vec![GitFileStatus {
                path: "src/main.rs".to_string(),
                status: "modified".to_string(),
                staged: false,
            }],
            file_diffs: vec![GitFileDiff {
                file: "src/main.rs".to_string(),
                diff_type: "modified".to_string(),
                additions: 3,
                deletions: 1,
                diff: "@@ -1 +1 @@\n-old\n+new\n".to_string(),
            }],
            target_ahead_behind: GitAheadBehind {
                ahead: 2,
                behind: 0,
            },
            upstream_ahead_behind: GitUpstreamAheadBehind::Tracking {
                ahead: 1,
                behind: 4,
            },
        };

        let built = build_worktree_status_with_snapshot(
            status_data,
            WorktreeSnapshotMetadata {
                effective_working_dir: "/tmp/openducktor-worktree".to_string(),
                target_branch: "origin/main".to_string(),
                diff_scope: GitDiffScope::Target,
                observed_at_ms: 42,
                hash_version: GIT_WORKTREE_HASH_VERSION,
                status_hash: "0123456789abcdef".to_string(),
                diff_hash: "fedcba9876543210".to_string(),
            },
        );

        assert_eq!(
            built.current_branch.name.as_deref(),
            Some("feature/snapshot")
        );
        assert_eq!(built.file_statuses.len(), 1);
        assert_eq!(built.file_diffs.len(), 1);
        assert_eq!(built.target_ahead_behind.ahead, 2);
        assert_eq!(
            built.upstream_ahead_behind,
            GitUpstreamAheadBehind::Tracking {
                ahead: 1,
                behind: 4
            }
        );
        assert_eq!(
            built.snapshot.effective_working_dir,
            "/tmp/openducktor-worktree"
        );
        assert_eq!(built.snapshot.target_branch, "origin/main");
        assert_eq!(built.snapshot.diff_scope, GitDiffScope::Target);
        assert_eq!(built.snapshot.observed_at_ms, 42);
        assert_eq!(built.snapshot.hash_version, GIT_WORKTREE_HASH_VERSION);
        assert_eq!(built.snapshot.status_hash, "0123456789abcdef");
        assert_eq!(built.snapshot.diff_hash, "fedcba9876543210");
    }

    #[test]
    fn status_hash_changes_when_status_payload_changes() {
        let current_branch = GitCurrentBranch {
            name: Some("feature/task-1".to_string()),
            detached: false,
        };
        let file_statuses = vec![GitFileStatus {
            path: "src/main.rs".to_string(),
            status: "M".to_string(),
            staged: false,
        }];
        let target_ahead_behind = GitAheadBehind {
            ahead: 1,
            behind: 0,
        };
        let baseline_upstream = GitUpstreamAheadBehind::Tracking {
            ahead: 1,
            behind: 0,
        };
        let changed_upstream = GitUpstreamAheadBehind::Tracking {
            ahead: 2,
            behind: 0,
        };

        let baseline_hash = hash_worktree_status_payload(
            &current_branch,
            file_statuses.as_slice(),
            &target_ahead_behind,
            &baseline_upstream,
        );
        let changed_hash = hash_worktree_status_payload(
            &current_branch,
            file_statuses.as_slice(),
            &target_ahead_behind,
            &changed_upstream,
        );

        assert_ne!(baseline_hash, changed_hash);
    }

    #[test]
    fn status_hash_is_stable_for_identical_payload() {
        let current_branch = GitCurrentBranch {
            name: Some("feature/task-1".to_string()),
            detached: false,
        };
        let file_statuses = vec![GitFileStatus {
            path: "src/main.rs".to_string(),
            status: "M".to_string(),
            staged: false,
        }];
        let target_ahead_behind = GitAheadBehind {
            ahead: 1,
            behind: 0,
        };
        let upstream = GitUpstreamAheadBehind::Tracking {
            ahead: 1,
            behind: 0,
        };

        let first_hash = hash_worktree_status_payload(
            &current_branch,
            file_statuses.as_slice(),
            &target_ahead_behind,
            &upstream,
        );
        let second_hash = hash_worktree_status_payload(
            &current_branch,
            file_statuses.as_slice(),
            &target_ahead_behind,
            &upstream,
        );

        assert_eq!(first_hash, second_hash);
    }

    #[test]
    fn diff_hash_changes_when_diff_payload_changes() {
        let baseline_diff = vec![GitFileDiff {
            file: "src/main.rs".to_string(),
            diff_type: "modified".to_string(),
            additions: 1,
            deletions: 0,
            diff: "@@ -1 +1 @@".to_string(),
        }];
        let changed_diff = vec![GitFileDiff {
            file: "src/main.rs".to_string(),
            diff_type: "modified".to_string(),
            additions: 2,
            deletions: 1,
            diff: "@@ -1 +1,2 @@".to_string(),
        }];

        let baseline_hash = hash_worktree_diff_payload(baseline_diff.as_slice());
        let changed_hash = hash_worktree_diff_payload(changed_diff.as_slice());

        assert_ne!(baseline_hash, changed_hash);
    }

    #[test]
    fn diff_summary_hash_changes_when_scope_or_counts_change() {
        let target_ahead_behind = GitAheadBehind {
            ahead: 1,
            behind: 0,
        };
        let baseline_counts = GitFileStatusCounts {
            total: 2,
            staged: 1,
            unstaged: 1,
        };
        let changed_counts = GitFileStatusCounts {
            total: 3,
            staged: 1,
            unstaged: 2,
        };

        let baseline_hash = hash_worktree_diff_summary_payload(
            &GitDiffScope::Target,
            &target_ahead_behind,
            &baseline_counts,
        );
        let changed_counts_hash = hash_worktree_diff_summary_payload(
            &GitDiffScope::Target,
            &target_ahead_behind,
            &changed_counts,
        );
        let changed_scope_hash = hash_worktree_diff_summary_payload(
            &GitDiffScope::Uncommitted,
            &target_ahead_behind,
            &baseline_counts,
        );

        assert_ne!(baseline_hash, changed_counts_hash);
        assert_ne!(baseline_hash, changed_scope_hash);
    }

    #[test]
    fn build_worktree_status_summary_with_snapshot_preserves_payload_and_snapshot_fields() {
        let built = build_worktree_status_summary_with_snapshot(
            GitCurrentBranch {
                name: Some("feature/snapshot".to_string()),
                detached: false,
            },
            GitFileStatusCounts {
                total: 4,
                staged: 2,
                unstaged: 2,
            },
            GitAheadBehind {
                ahead: 3,
                behind: 1,
            },
            GitUpstreamAheadBehind::Tracking {
                ahead: 5,
                behind: 0,
            },
            WorktreeSnapshotMetadata {
                effective_working_dir: "/tmp/openducktor-worktree".to_string(),
                target_branch: "origin/main".to_string(),
                diff_scope: GitDiffScope::Uncommitted,
                observed_at_ms: 99,
                hash_version: GIT_WORKTREE_HASH_VERSION,
                status_hash: "0123456789abcdef".to_string(),
                diff_hash: "fedcba9876543210".to_string(),
            },
        );

        assert_eq!(
            built.current_branch.name.as_deref(),
            Some("feature/snapshot")
        );
        assert_eq!(built.file_status_counts.total, 4);
        assert_eq!(built.file_status_counts.staged, 2);
        assert_eq!(built.file_status_counts.unstaged, 2);
        assert_eq!(built.target_ahead_behind.ahead, 3);
        assert_eq!(
            built.upstream_ahead_behind,
            GitUpstreamAheadBehind::Tracking {
                ahead: 5,
                behind: 0
            }
        );
        assert_eq!(built.snapshot.diff_scope, GitDiffScope::Uncommitted);
        assert_eq!(built.snapshot.observed_at_ms, 99);
        assert_eq!(built.snapshot.hash_version, GIT_WORKTREE_HASH_VERSION);
        assert_eq!(built.snapshot.status_hash, "0123456789abcdef");
        assert_eq!(built.snapshot.diff_hash, "fedcba9876543210");
    }
}
