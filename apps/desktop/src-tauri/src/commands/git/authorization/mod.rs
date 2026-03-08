mod cache;
mod listing;
mod metadata;
mod resolution;

pub(crate) use cache::invalidate_worktree_resolution_cache_for_repo;
pub(crate) use metadata::read_worktree_state_token;
pub(crate) use resolution::resolve_working_dir;

#[cfg(test)]
pub(crate) use cache::{
    authorized_worktree_cache, cache_key, AuthorizedWorktreeCacheEntry,
};
#[cfg(test)]
pub(crate) use metadata::read_git_common_dir;
