use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitCurrentBranch {
    pub name: Option<String>,
    pub detached: bool,
    pub revision: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeSummary {
    pub branch: String,
    pub worktree_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GitMergeMethod {
    MergeCommit,
    Squash,
    Rebase,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GitConflictOperation {
    Rebase,
    PullRebase,
    DirectMergeMergeCommit,
    DirectMergeSquash,
    DirectMergeRebase,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitProviderRepository {
    pub host: String,
    pub owner: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitTargetBranch {
    pub remote: Option<String>,
    pub branch: String,
}

impl GitTargetBranch {
    pub fn canonical(&self) -> String {
        if self.branch == "@{upstream}" {
            return self.branch.clone();
        }
        match self.remote.as_deref() {
            Some(remote) => format!("{remote}/{}", self.branch),
            None => self.branch.clone(),
        }
    }

    pub fn display(&self) -> String {
        self.canonical()
    }

    pub fn checkout_branch(&self) -> String {
        self.branch.clone()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestRecord {
    pub provider_id: String,
    pub number: u32,
    pub url: String,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_synced_at: Option<String>,
    pub merged_at: Option<String>,
    pub closed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum TaskPullRequestDetectResult {
    Linked {
        #[serde(rename = "pullRequest")]
        pull_request: PullRequestRecord,
    },
    Merged {
        #[serde(rename = "pullRequest")]
        pull_request: PullRequestRecord,
    },
    NotFound {
        #[serde(rename = "sourceBranch")]
        source_branch: String,
        #[serde(rename = "targetBranch")]
        target_branch: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirectMergeRecord {
    pub method: GitMergeMethod,
    pub source_branch: String,
    pub target_branch: GitTargetBranch,
    pub merged_at: String,
}

impl DirectMergeRecord {
    pub fn publish_target(&self) -> Option<GitTargetBranch> {
        if self.target_branch.remote.is_some() {
            return Some(self.target_branch.clone());
        }
        None
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitProviderAvailability {
    pub provider_id: String,
    pub enabled: bool,
    pub available: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskApprovalContext {
    pub task_id: String,
    pub task_status: String,
    pub working_directory: Option<String>,
    pub source_branch: String,
    pub target_branch: GitTargetBranch,
    pub publish_target: Option<GitTargetBranch>,
    pub default_merge_method: GitMergeMethod,
    pub has_uncommitted_changes: bool,
    pub uncommitted_file_count: u32,
    pub pull_request: Option<PullRequestRecord>,
    pub direct_merge: Option<DirectMergeRecord>,
    pub suggested_squash_commit_message: Option<String>,
    pub providers: Vec<GitProviderAvailability>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum TaskApprovalContextLoadResult {
    Ready {
        #[serde(rename = "approvalContext")]
        approval_context: TaskApprovalContext,
    },
    MissingBuilderWorktree {
        #[serde(rename = "taskId")]
        task_id: String,
        #[serde(rename = "taskStatus")]
        task_status: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum GitPushResult {
    Pushed {
        remote: String,
        branch: String,
        output: String,
    },
    RejectedNonFastForward {
        remote: String,
        branch: String,
        output: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitPullRequest {
    pub working_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum GitPullResult {
    Pulled {
        output: String,
    },
    UpToDate {
        output: String,
    },
    Conflicts {
        #[serde(rename = "conflictedFiles")]
        conflicted_files: Vec<String>,
        output: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitConflict {
    pub operation: GitConflictOperation,
    pub current_branch: Option<String>,
    pub target_branch: String,
    pub conflicted_files: Vec<String>,
    pub output: String,
    pub working_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
    pub staged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatusCounts {
    pub total: u32,
    pub staged: u32,
    pub unstaged: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitFileDiff {
    pub file: String,
    #[serde(rename = "type")]
    pub diff_type: String,
    pub additions: u32,
    pub deletions: u32,
    pub diff: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitAheadBehind {
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GitDiffScope {
    Target,
    Uncommitted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeStatusSnapshot {
    pub effective_working_dir: String,
    pub target_branch: String,
    pub diff_scope: GitDiffScope,
    pub observed_at_ms: u64,
    pub hash_version: u32,
    pub status_hash: String,
    pub diff_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum GitUpstreamAheadBehind {
    Tracking { ahead: u32, behind: u32 },
    Untracked { ahead: u32 },
    Error { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeStatus {
    pub current_branch: GitCurrentBranch,
    pub file_statuses: Vec<GitFileStatus>,
    pub file_diffs: Vec<GitFileDiff>,
    pub target_ahead_behind: GitAheadBehind,
    pub upstream_ahead_behind: GitUpstreamAheadBehind,
    pub snapshot: GitWorktreeStatusSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeStatusSummary {
    pub current_branch: GitCurrentBranch,
    pub file_status_counts: GitFileStatusCounts,
    pub target_ahead_behind: GitAheadBehind,
    pub upstream_ahead_behind: GitUpstreamAheadBehind,
    pub snapshot: GitWorktreeStatusSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeStatusData {
    pub current_branch: GitCurrentBranch,
    pub file_statuses: Vec<GitFileStatus>,
    pub file_diffs: Vec<GitFileDiff>,
    pub target_ahead_behind: GitAheadBehind,
    pub upstream_ahead_behind: GitUpstreamAheadBehind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeStatusSummaryData {
    pub current_branch: GitCurrentBranch,
    pub file_statuses: Vec<GitFileStatus>,
    pub file_status_counts: GitFileStatusCounts,
    pub target_ahead_behind: GitAheadBehind,
    pub upstream_ahead_behind: GitUpstreamAheadBehind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitResetSnapshot {
    pub hash_version: u32,
    pub status_hash: String,
    pub diff_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GitResetWorktreeSelection {
    File {
        #[serde(rename = "filePath")]
        file_path: String,
    },
    Hunk {
        #[serde(rename = "filePath")]
        file_path: String,
        #[serde(rename = "hunkIndex")]
        hunk_index: u32,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitResetWorktreeSelectionRequest {
    pub working_dir: Option<String>,
    pub target_branch: String,
    pub snapshot: GitResetSnapshot,
    pub selection: GitResetWorktreeSelection,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitResetWorktreeSelectionResult {
    pub affected_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitAllRequest {
    pub working_dir: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum GitCommitAllResult {
    Committed {
        #[serde(rename = "commitHash")]
        commit_hash: String,
        output: String,
    },
    NoChanges {
        output: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRebaseBranchRequest {
    pub working_dir: Option<String>,
    pub target_branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum GitRebaseBranchResult {
    Rebased {
        output: String,
    },
    UpToDate {
        output: String,
    },
    Conflicts {
        #[serde(rename = "conflictedFiles")]
        conflicted_files: Vec<String>,
        output: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRebaseAbortRequest {
    pub working_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum GitRebaseAbortResult {
    Aborted { output: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictAbortRequest {
    pub operation: GitConflictOperation,
    pub working_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictAbortResult {
    pub output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitMergeBranchRequest {
    pub source_branch: String,
    pub target_branch: String,
    pub source_working_directory: Option<String>,
    pub method: GitMergeMethod,
    pub squash_commit_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum GitMergeBranchResult {
    Merged {
        output: String,
    },
    UpToDate {
        output: String,
    },
    Conflicts {
        #[serde(rename = "conflictedFiles")]
        conflicted_files: Vec<String>,
        output: String,
    },
}

pub trait GitPort: Send + Sync {
    fn get_branches(&self, repo_path: &Path) -> Result<Vec<GitBranch>>;
    fn get_current_branch(&self, repo_path: &Path) -> Result<GitCurrentBranch>;
    fn list_worktrees(&self, repo_path: &Path) -> Result<Vec<GitWorktreeSummary>>;
    fn switch_branch(
        &self,
        repo_path: &Path,
        branch: &str,
        create: bool,
    ) -> Result<GitCurrentBranch>;
    fn create_worktree(
        &self,
        repo_path: &Path,
        worktree_path: &Path,
        branch: &str,
        create_branch: bool,
    ) -> Result<()>;
    fn remove_worktree(&self, repo_path: &Path, worktree_path: &Path, force: bool) -> Result<()>;
    fn delete_local_branch(&self, repo_path: &Path, branch: &str, force: bool) -> Result<()>;
    fn push_branch(
        &self,
        repo_path: &Path,
        remote: &str,
        branch: &str,
        set_upstream: bool,
        force_with_lease: bool,
    ) -> Result<GitPushResult>;
    fn pull_branch(&self, repo_path: &Path, request: GitPullRequest) -> Result<GitPullResult>;
    fn get_status(&self, repo_path: &Path) -> Result<Vec<GitFileStatus>>;
    fn get_diff(&self, repo_path: &Path, target_branch: Option<&str>) -> Result<Vec<GitFileDiff>>;
    fn get_worktree_status(
        &self,
        repo_path: &Path,
        target_branch: &str,
        diff_scope: GitDiffScope,
    ) -> Result<GitWorktreeStatusData>;
    fn get_worktree_status_summary(
        &self,
        repo_path: &Path,
        target_branch: &str,
        diff_scope: GitDiffScope,
    ) -> Result<GitWorktreeStatusSummaryData>;
    fn resolve_upstream_target(&self, repo_path: &Path) -> Result<Option<String>>;
    fn suggested_squash_commit_message(
        &self,
        repo_path: &Path,
        source_branch: &str,
        target_branch: &str,
    ) -> Result<Option<String>>;
    fn is_ancestor(
        &self,
        repo_path: &Path,
        ancestor_ref: &str,
        descendant_ref: &str,
    ) -> Result<bool>;
    fn commits_ahead_behind(&self, repo_path: &Path, target_branch: &str)
        -> Result<GitAheadBehind>;
    fn commit_all(
        &self,
        repo_path: &Path,
        request: GitCommitAllRequest,
    ) -> Result<GitCommitAllResult>;
    fn reset_worktree_selection(
        &self,
        repo_path: &Path,
        request: GitResetWorktreeSelectionRequest,
    ) -> Result<GitResetWorktreeSelectionResult>;
    fn rebase_branch(
        &self,
        repo_path: &Path,
        request: GitRebaseBranchRequest,
    ) -> Result<GitRebaseBranchResult>;
    fn rebase_abort(
        &self,
        repo_path: &Path,
        request: GitRebaseAbortRequest,
    ) -> Result<GitRebaseAbortResult>;
    fn abort_conflict(
        &self,
        repo_path: &Path,
        request: GitConflictAbortRequest,
    ) -> Result<GitConflictAbortResult>;
    fn merge_branch(
        &self,
        repo_path: &Path,
        request: GitMergeBranchRequest,
    ) -> Result<GitMergeBranchResult>;
}

#[cfg(test)]
mod tests {
    use super::{
        GitCommitAllResult, GitPullResult, GitPushResult, GitRebaseAbortResult,
        GitRebaseBranchResult,
    };

    #[test]
    fn git_commit_all_no_changes_is_first_class_variant() {
        let result = GitCommitAllResult::NoChanges {
            output: "nothing to commit".to_string(),
        };

        assert_eq!(
            result,
            GitCommitAllResult::NoChanges {
                output: "nothing to commit".to_string(),
            }
        );
    }

    #[test]
    fn git_rebase_up_to_date_is_first_class_variant() {
        let result = GitRebaseBranchResult::UpToDate {
            output: "already up to date".to_string(),
        };

        assert_eq!(
            result,
            GitRebaseBranchResult::UpToDate {
                output: "already up to date".to_string(),
            }
        );
    }

    #[test]
    fn git_rebase_conflicts_keeps_conflicted_files() {
        let result = GitRebaseBranchResult::Conflicts {
            conflicted_files: vec!["src/main.rs".to_string(), "src/lib.rs".to_string()],
            output: "rebase stopped due to conflicts".to_string(),
        };

        assert_eq!(
            result,
            GitRebaseBranchResult::Conflicts {
                conflicted_files: vec!["src/main.rs".to_string(), "src/lib.rs".to_string()],
                output: "rebase stopped due to conflicts".to_string(),
            }
        );
    }

    #[test]
    fn git_pull_up_to_date_is_first_class_variant() {
        let result = GitPullResult::UpToDate {
            output: "Already up to date.".to_string(),
        };

        assert_eq!(
            result,
            GitPullResult::UpToDate {
                output: "Already up to date.".to_string(),
            }
        );
    }

    #[test]
    fn git_pull_conflicts_keeps_conflicted_files() {
        let result = GitPullResult::Conflicts {
            conflicted_files: vec!["src/main.rs".to_string(), "src/lib.rs".to_string()],
            output: "pull stopped due to conflicts".to_string(),
        };

        assert_eq!(
            result,
            GitPullResult::Conflicts {
                conflicted_files: vec!["src/main.rs".to_string(), "src/lib.rs".to_string()],
                output: "pull stopped due to conflicts".to_string(),
            }
        );
    }

    #[test]
    fn git_push_non_fast_forward_is_first_class_variant() {
        let result = GitPushResult::RejectedNonFastForward {
            remote: "origin".to_string(),
            branch: "feature/rebase".to_string(),
            output: "non-fast-forward".to_string(),
        };

        assert_eq!(
            result,
            GitPushResult::RejectedNonFastForward {
                remote: "origin".to_string(),
                branch: "feature/rebase".to_string(),
                output: "non-fast-forward".to_string(),
            }
        );
    }

    #[test]
    fn git_rebase_abort_is_first_class_variant() {
        let result = GitRebaseAbortResult::Aborted {
            output: "aborted".to_string(),
        };

        assert_eq!(
            result,
            GitRebaseAbortResult::Aborted {
                output: "aborted".to_string(),
            }
        );
    }
}
