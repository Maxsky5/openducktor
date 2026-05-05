use anyhow::{anyhow, Result};
use host_domain::{
    GitAheadBehind, GitBranch, GitCommitAllRequest, GitCommitAllResult, GitConflictAbortRequest,
    GitConflictAbortResult, GitCurrentBranch, GitFetchRequest, GitFetchResult, GitFileDiff,
    GitFileStatus, GitPullRequest, GitPullResult, GitPushResult, GitRebaseAbortRequest,
    GitRebaseAbortResult, GitRebaseBranchRequest, GitRebaseBranchResult,
};
use std::path::Path;

use super::AppService;

pub(super) fn resolve_execution_path(repo_path: &str, working_dir: Option<&str>) -> String {
    working_dir
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(repo_path)
        .to_string()
}

impl AppService {
    pub fn git_get_branches(&self, repo_path: &str) -> Result<Vec<GitBranch>> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        self.git_port.get_branches(Path::new(&repo_path))
    }

    pub fn git_get_current_branch(&self, repo_path: &str) -> Result<GitCurrentBranch> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        self.git_port.get_current_branch(Path::new(&repo_path))
    }

    pub fn git_switch_branch(
        &self,
        repo_path: &str,
        branch: &str,
        create: bool,
    ) -> Result<GitCurrentBranch> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        self.git_port
            .switch_branch(Path::new(&repo_path), branch, create)
    }

    pub fn git_delete_local_branch(
        &self,
        repo_path: &str,
        branch: &str,
        force: bool,
    ) -> Result<bool> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        let branch = branch.trim();
        if branch.is_empty() {
            return Err(anyhow!("branch cannot be empty"));
        }

        self.git_port
            .delete_local_branch(Path::new(&repo_path), branch, force)?;
        Ok(true)
    }

    pub fn git_push_branch(
        &self,
        repo_path: &str,
        working_dir: Option<&str>,
        remote: Option<&str>,
        branch: &str,
        set_upstream: bool,
        force_with_lease: bool,
    ) -> Result<GitPushResult> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        let execution_path = resolve_execution_path(repo_path.as_str(), working_dir);
        let remote = remote
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("origin");
        self.git_port.push_branch(
            Path::new(&execution_path),
            remote,
            branch,
            set_upstream,
            force_with_lease,
        )
    }

    pub fn git_pull_branch(
        &self,
        repo_path: &str,
        request: GitPullRequest,
    ) -> Result<GitPullResult> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        let execution_path =
            resolve_execution_path(repo_path.as_str(), request.working_dir.as_deref());
        self.git_port
            .pull_branch(Path::new(&execution_path), request)
    }

    pub fn git_fetch_remote(
        &self,
        repo_path: &str,
        request: GitFetchRequest,
    ) -> Result<GitFetchResult> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        let execution_path =
            resolve_execution_path(repo_path.as_str(), request.working_dir.as_deref());
        let target_branch = request.target_branch.trim();
        if target_branch.is_empty() {
            return Err(anyhow!("target branch cannot be empty"));
        }

        self.git_port.fetch_remote(
            Path::new(&execution_path),
            GitFetchRequest {
                working_dir: request.working_dir,
                target_branch: target_branch.to_string(),
            },
        )
    }

    pub fn git_commit_all(
        &self,
        repo_path: &str,
        request: GitCommitAllRequest,
    ) -> Result<GitCommitAllResult> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        let execution_path =
            resolve_execution_path(repo_path.as_str(), request.working_dir.as_deref());
        let message = request.message.trim();
        if message.is_empty() {
            return Err(anyhow!("commit message cannot be empty"));
        }

        self.git_port.commit_all(
            Path::new(&execution_path),
            GitCommitAllRequest {
                working_dir: request.working_dir,
                message: message.to_string(),
            },
        )
    }

    pub fn git_rebase_branch(
        &self,
        repo_path: &str,
        request: GitRebaseBranchRequest,
    ) -> Result<GitRebaseBranchResult> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        let execution_path =
            resolve_execution_path(repo_path.as_str(), request.working_dir.as_deref());
        let target_branch = request.target_branch.trim();
        if target_branch.is_empty() {
            return Err(anyhow!("target branch cannot be empty"));
        }

        self.git_port.rebase_branch(
            Path::new(&execution_path),
            GitRebaseBranchRequest {
                working_dir: request.working_dir,
                target_branch: target_branch.to_string(),
            },
        )
    }

    pub fn git_rebase_abort(
        &self,
        repo_path: &str,
        request: GitRebaseAbortRequest,
    ) -> Result<GitRebaseAbortResult> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        let execution_path =
            resolve_execution_path(repo_path.as_str(), request.working_dir.as_deref());

        self.git_port.rebase_abort(
            Path::new(&execution_path),
            GitRebaseAbortRequest {
                working_dir: request.working_dir,
            },
        )
    }

    pub fn git_abort_conflict(
        &self,
        repo_path: &str,
        request: GitConflictAbortRequest,
    ) -> Result<GitConflictAbortResult> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        let execution_path =
            resolve_execution_path(repo_path.as_str(), request.working_dir.as_deref());

        self.git_port.abort_conflict(
            Path::new(&execution_path),
            GitConflictAbortRequest {
                operation: request.operation,
                working_dir: request.working_dir,
            },
        )
    }

    pub fn git_get_status(&self, repo_path: &str) -> Result<Vec<GitFileStatus>> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        self.git_port.get_status(Path::new(&repo_path))
    }

    pub fn git_get_diff(
        &self,
        repo_path: &str,
        target_branch: Option<&str>,
    ) -> Result<Vec<GitFileDiff>> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        self.git_port.get_diff(Path::new(&repo_path), target_branch)
    }

    pub fn git_commits_ahead_behind(
        &self,
        repo_path: &str,
        target_branch: &str,
    ) -> Result<GitAheadBehind> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        self.git_port
            .commits_ahead_behind(Path::new(&repo_path), target_branch)
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::build_service_with_state;
    use super::*;
    use host_domain::{GitConflictOperation, GitPushResult};

    #[test]
    fn module_git_push_branch_defaults_remote_to_origin() {
        let (service, _task_state, git_state) = build_service_with_state(vec![]);

        let result = service
            .git_push_branch(
                "/tmp/odt-repo-module",
                None,
                Some("   "),
                "feature/x",
                false,
                false,
            )
            .expect("push summary should be returned");

        match result {
            GitPushResult::Pushed { remote, .. } => assert_eq!(remote, "origin"),
            other => panic!("expected pushed result, got {other:?}"),
        }
        let state = git_state.lock().expect("git state lock poisoned");
        assert_eq!(state.last_push_remote.as_deref(), Some("origin"));
    }

    #[test]
    fn module_git_abort_conflict_forwards_operation_and_execution_path() {
        let (service, _task_state, git_state) = build_service_with_state(vec![]);

        let result = service
            .git_abort_conflict(
                "/tmp/odt-repo-module",
                GitConflictAbortRequest {
                    operation: GitConflictOperation::DirectMergeRebase,
                    working_dir: Some("/tmp/odt-repo-module/worktrees/task-1".to_string()),
                },
            )
            .expect("abort conflict should be forwarded");
        assert_eq!(result.output, "conflict aborted");

        let state = git_state.lock().expect("git state lock poisoned");
        assert!(state.calls.iter().any(|call| matches!(
            call,
            crate::app_service::test_support::GitCall::AbortConflict {
                repo_path,
                operation,
                working_dir,
            } if repo_path == "/tmp/odt-repo-module/worktrees/task-1"
                && *operation == GitConflictOperation::DirectMergeRebase
                && working_dir.as_deref() == Some("/tmp/odt-repo-module/worktrees/task-1")
        )));
    }
}
