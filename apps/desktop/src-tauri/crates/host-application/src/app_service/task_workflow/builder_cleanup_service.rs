use super::approval_support::latest_builder_cleanup_target;
use crate::app_service::service_core::AppService;
use anyhow::Result;
use host_domain::{DirectMergeRecord, GitMergeMethod};
use std::path::Path;

pub(super) struct BuilderCleanupService<'a> {
    service: &'a AppService,
}

impl<'a> BuilderCleanupService<'a> {
    pub(super) fn new(service: &'a AppService) -> Self {
        Self { service }
    }

    pub(super) fn should_force_delete_source_branch(
        &self,
        repo_path: &str,
        direct_merge: &DirectMergeRecord,
    ) -> Result<bool> {
        if !matches!(direct_merge.method, GitMergeMethod::Squash) {
            return Ok(false);
        }

        let source_branch_exists = self
            .service
            .git_port
            .get_branches(Path::new(repo_path))?
            .into_iter()
            .any(|branch| !branch.is_remote && branch.name == direct_merge.source_branch);
        if !source_branch_exists {
            return Ok(false);
        }

        let target_branch = direct_merge.target_branch.checkout_branch();
        Ok(!self.service.git_port.is_ancestor(
            Path::new(repo_path),
            direct_merge.source_branch.as_str(),
            target_branch.as_str(),
        )?)
    }

    pub(super) fn finalize_direct_merge_cleanup(
        &self,
        repo_path: &str,
        task_id: &str,
        source_branch: &str,
        force_delete_source_branch: bool,
    ) -> Result<()> {
        self.service.stop_dev_servers_for_task(repo_path, task_id)?;

        if let Some(cleanup_target) =
            latest_builder_cleanup_target(self.service, repo_path, task_id, Some(source_branch))?
        {
            let normalized_repo = std::fs::canonicalize(repo_path)
                .unwrap_or_else(|_| Path::new(repo_path).to_path_buf());
            let normalized_working_directory =
                std::fs::canonicalize(&cleanup_target.working_directory)
                    .unwrap_or_else(|_| Path::new(&cleanup_target.working_directory).to_path_buf());

            if normalized_repo != normalized_working_directory
                && Path::new(cleanup_target.working_directory.as_str()).exists()
            {
                let _ = self.service.git_remove_worktree(
                    repo_path,
                    cleanup_target.working_directory.as_str(),
                    false,
                )?;
            }
        }

        self.cleanup_builder_branch(repo_path, source_branch, force_delete_source_branch)
    }

    fn cleanup_builder_branch(
        &self,
        repo_path: &str,
        source_branch: &str,
        force_delete: bool,
    ) -> Result<()> {
        let branch_exists = self
            .service
            .git_port
            .get_branches(Path::new(repo_path))?
            .into_iter()
            .any(|branch| !branch.is_remote && branch.name == source_branch);
        if branch_exists {
            let _ = self
                .service
                .git_delete_local_branch(repo_path, source_branch, force_delete)?;
        }

        Ok(())
    }
}
