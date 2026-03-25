use super::approval_support::normalize_approval_target_branch;
use crate::app_service::service_core::AppService;
use anyhow::{anyhow, Result};
use host_domain::GitTargetBranch;
use std::path::Path;

pub(super) struct BuilderBranchContext {
    pub(super) working_directory: String,
    pub(super) source_branch: String,
}

pub(super) struct BuilderCleanupTarget {
    pub(super) working_directory: String,
}

pub(super) struct BuilderBranchService<'a> {
    service: &'a AppService,
}

impl<'a> BuilderBranchService<'a> {
    pub(super) fn new(service: &'a AppService) -> Self {
        Self { service }
    }

    pub(super) fn load_builder_branch_context(
        &self,
        repo_path: &str,
        task_id: &str,
        operation_label: &str,
    ) -> Result<BuilderBranchContext> {
        let working_directory = self
            .service
            .build_continuation_target_get(repo_path, task_id)?
            .working_directory;
        let current_branch = self
            .service
            .git_port
            .get_current_branch(Path::new(&working_directory))?;
        if current_branch.detached {
            return Err(anyhow!(
                "{operation_label} requires a builder branch, but the latest builder workspace is detached."
            ));
        }
        let source_branch = current_branch
            .name
            .ok_or_else(|| anyhow!("{operation_label} requires a builder branch name."))?;

        Ok(BuilderBranchContext {
            working_directory,
            source_branch,
        })
    }

    pub(super) fn target_branch_for_repo(&self, repo_path: &str) -> Result<GitTargetBranch> {
        let repo_config = self.service.workspace_get_repo_config(repo_path)?;
        normalize_approval_target_branch(&repo_config.default_target_branch)
    }

    pub(super) fn latest_cleanup_target(
        &self,
        repo_path: &str,
        task_id: &str,
        preferred_source_branch: Option<&str>,
    ) -> Result<Option<BuilderCleanupTarget>> {
        let sessions = self.service.agent_sessions_list(repo_path, task_id)?;
        let mut builder_sessions = sessions
            .into_iter()
            .filter(|session| session.role == "build")
            .collect::<Vec<_>>();
        builder_sessions.sort_by(|left, right| {
            let left_key = left.started_at.as_str();
            let right_key = right.started_at.as_str();
            left_key
                .cmp(right_key)
                .then_with(|| left.session_id.cmp(&right.session_id))
        });
        builder_sessions.reverse();

        for session in builder_sessions {
            let working_directory = session.working_directory.trim().to_string();
            if working_directory.is_empty() {
                continue;
            }
            if !Path::new(working_directory.as_str()).exists() {
                continue;
            }
            let current_branch = self
                .service
                .git_port
                .get_current_branch(Path::new(working_directory.as_str()))?;
            let current_branch_name = match current_branch.name {
                Some(name) => {
                    let trimmed = name.trim().to_string();
                    if trimmed.is_empty() {
                        continue;
                    }
                    trimmed
                }
                None => continue,
            };
            if preferred_source_branch
                .map(str::trim)
                .is_some_and(|expected| current_branch_name != expected)
            {
                continue;
            }

            return Ok(Some(BuilderCleanupTarget { working_directory }));
        }

        Ok(None)
    }
}
