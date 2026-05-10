mod cache;
mod listing;
mod metadata;
mod resolution;

pub use cache::invalidate_worktree_resolution_cache_for_repo;
pub use resolution::resolve_working_dir;

pub(super) use cache::{authorized_worktree_cache, cache_key, AuthorizedWorktreeCacheEntry};
pub use metadata::{read_git_common_dir, read_worktree_state_token};
