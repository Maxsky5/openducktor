use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

use super::{
    listing::list_authorized_worktrees, metadata::read_worktree_state_token,
    resolution::canonicalize_for_validation,
};

#[cfg(not(test))]
const AUTHORIZED_WORKTREE_CACHE_TTL: Duration = Duration::from_secs(3);
#[cfg(test)]
const AUTHORIZED_WORKTREE_CACHE_TTL: Duration = Duration::from_secs(60);
const WORKTREE_STATE_STABILIZATION_ATTEMPTS: usize = 3;

#[derive(Clone)]
pub(crate) struct AuthorizedWorktreeCacheEntry {
    pub(crate) cached_at: Instant,
    pub(crate) worktree_state_token: String,
    pub(crate) worktrees: HashSet<PathBuf>,
}

static AUTHORIZED_WORKTREE_CACHE: OnceLock<Mutex<HashMap<String, AuthorizedWorktreeCacheEntry>>> =
    OnceLock::new();
static AUTHORIZED_WORKTREE_MISS_LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> =
    OnceLock::new();

pub(crate) fn authorized_worktree_cache(
) -> &'static Mutex<HashMap<String, AuthorizedWorktreeCacheEntry>> {
    AUTHORIZED_WORKTREE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn authorized_worktree_miss_locks() -> &'static Mutex<HashMap<String, Arc<Mutex<()>>>> {
    AUTHORIZED_WORKTREE_MISS_LOCKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cache_lock_error(operation: &str) -> String {
    format!("authorized worktree cache is unavailable while {operation}: lock poisoned")
}

pub(crate) fn cache_key(canonical_repo: &Path) -> String {
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

pub(super) fn is_authorized_worktree(
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
