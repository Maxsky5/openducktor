use super::approval_support::normalize_approval_target_branch;
use crate::app_service::service_core::AppService;
use anyhow::{anyhow, Result};
use host_domain::GitTargetBranch;
use std::path::Path;

#[derive(Debug)]
pub(super) struct BuilderBranchContext {
    pub(super) working_directory: String,
    pub(super) source_branch: String,
}

#[derive(Debug)]
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
            .filter(|session| session.role.trim() == "build")
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

#[cfg(test)]
mod tests {
    use super::BuilderBranchService;
    use crate::app_service::test_support::{
        build_service_with_store, init_git_repo, make_session, make_task, unique_temp_path,
    };
    use anyhow::Result;
    use host_domain::{GitCurrentBranch, TaskStatus};
    use host_infra_system::AppConfigStore;
    use std::fs;

    #[test]
    fn load_builder_branch_context_rejects_detached_branch() -> Result<()> {
        let root = unique_temp_path("builder-branch-detached");
        let repo = root.join("repo");
        let worktree = root.join("worktree");
        init_git_repo(&repo)?;
        fs::create_dir_all(&worktree)?;

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, task_state, git_state) = build_service_with_store(
            vec![make_task("task-1", "task", TaskStatus::HumanReview)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
                revision: None,
            },
            config_store,
        );
        let repo_path = repo.to_string_lossy().to_string();
        service.workspace_add(repo_path.as_str())?;
        let mut session = make_session("task-1", "session-build");
        session.working_directory = worktree.to_string_lossy().to_string();
        task_state
            .lock()
            .expect("task state lock poisoned")
            .agent_sessions
            .push(session);
        git_state
            .lock()
            .expect("git state lock poisoned")
            .current_branches_by_path
            .insert(
                worktree.to_string_lossy().to_string(),
                GitCurrentBranch {
                    name: None,
                    detached: true,
                    revision: None,
                },
            );

        let error = BuilderBranchService::new(&service)
            .load_builder_branch_context(repo_path.as_str(), "task-1", "Pull request detection")
            .expect_err("detached builder branch should be rejected");
        assert_eq!(
            error.to_string(),
            "Pull request detection requires a builder branch, but the latest builder workspace is detached."
        );

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn latest_cleanup_target_prefers_matching_source_branch() -> Result<()> {
        let root = unique_temp_path("builder-branch-cleanup-target");
        let repo = root.join("repo");
        let older_worktree = root.join("older");
        let newer_worktree = root.join("newer");
        init_git_repo(&repo)?;
        fs::create_dir_all(&older_worktree)?;
        fs::create_dir_all(&newer_worktree)?;

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, task_state, git_state) = build_service_with_store(
            vec![make_task("task-1", "task", TaskStatus::HumanReview)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
                revision: None,
            },
            config_store,
        );
        let repo_path = repo.to_string_lossy().to_string();
        service.workspace_add(repo_path.as_str())?;

        let mut older = make_session("task-1", "session-1");
        older.started_at = "2026-03-11T10:00:00Z".to_string();
        older.role = " build ".to_string();
        older.working_directory = older_worktree.to_string_lossy().to_string();
        let mut newer = make_session("task-1", "session-2");
        newer.started_at = "2026-03-11T11:00:00Z".to_string();
        newer.working_directory = newer_worktree.to_string_lossy().to_string();
        task_state
            .lock()
            .expect("task state lock poisoned")
            .agent_sessions
            .extend([older, newer]);

        let mut git = git_state.lock().expect("git state lock poisoned");
        git.current_branches_by_path.insert(
            older_worktree.to_string_lossy().to_string(),
            GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
        git.current_branches_by_path.insert(
            newer_worktree.to_string_lossy().to_string(),
            GitCurrentBranch {
                name: Some("odt/task-1-retry".to_string()),
                detached: false,
                revision: None,
            },
        );
        drop(git);

        let target = BuilderBranchService::new(&service)
            .latest_cleanup_target(repo_path.as_str(), "task-1", Some("odt/task-1"))?
            .expect("expected a matching cleanup target");

        assert_eq!(target.working_directory, older_worktree.to_string_lossy());

        let _ = fs::remove_dir_all(root);
        Ok(())
    }
}
