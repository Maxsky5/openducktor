mod authorization;
mod command_handlers;
mod snapshot;

pub(crate) use authorization::{
    invalidate_worktree_resolution_cache_for_repo, resolve_working_dir,
};
pub use command_handlers::{
    git_commit_all, git_commits_ahead_behind, git_create_worktree, git_get_branches,
    git_get_current_branch, git_get_diff, git_get_status, git_get_worktree_status,
    git_get_worktree_status_summary, git_pull_branch, git_push_branch, git_rebase_abort,
    git_rebase_branch, git_remove_worktree, git_switch_branch,
};
pub(crate) use command_handlers::{parse_diff_scope, require_target_branch};
pub(crate) use snapshot::{
    build_worktree_status_summary_with_snapshot, build_worktree_status_with_snapshot,
    hash_worktree_diff_payload, hash_worktree_diff_summary_payload, hash_worktree_status_payload,
    WorktreeSnapshotMetadata, GIT_WORKTREE_HASH_VERSION,
};

#[cfg(test)]
mod tests;
