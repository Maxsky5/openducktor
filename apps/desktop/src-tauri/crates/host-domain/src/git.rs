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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeSummary {
    pub branch: String,
    pub worktree_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitPushSummary {
    pub remote: String,
    pub branch: String,
    pub output: String,
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

pub trait GitPort: Send + Sync {
    fn get_branches(&self, repo_path: &Path) -> Result<Vec<GitBranch>>;
    fn get_current_branch(&self, repo_path: &Path) -> Result<GitCurrentBranch>;
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
    fn push_branch(
        &self,
        repo_path: &Path,
        remote: &str,
        branch: &str,
        set_upstream: bool,
        force_with_lease: bool,
    ) -> Result<GitPushSummary>;
    fn get_status(&self, repo_path: &Path) -> Result<Vec<GitFileStatus>>;
    fn get_diff(&self, repo_path: &Path, target_branch: Option<&str>) -> Result<Vec<GitFileDiff>>;
    fn commits_ahead_behind(&self, repo_path: &Path, target_branch: &str)
        -> Result<GitAheadBehind>;
    fn commit_all(
        &self,
        repo_path: &Path,
        request: GitCommitAllRequest,
    ) -> Result<GitCommitAllResult>;
    fn rebase_branch(
        &self,
        repo_path: &Path,
        request: GitRebaseBranchRequest,
    ) -> Result<GitRebaseBranchResult>;
}

#[cfg(test)]
mod tests {
    use super::{GitCommitAllResult, GitRebaseBranchResult};

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
}
