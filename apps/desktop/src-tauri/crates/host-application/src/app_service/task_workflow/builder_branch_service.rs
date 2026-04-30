use super::approval_support::{
    normalize_approval_target_branch, normalize_recorded_target_branch,
    publish_recorded_target_branch, publish_target_branch,
};
use super::cleanup_plans::{
    is_definitive_non_worktree_git_error, normalize_path_for_comparison,
    path_exists_including_broken_symlink,
};
use crate::app_service::service_core::AppService;
use crate::app_service::task_workflow::session_service::TaskWorktreeLookup;
use anyhow::{anyhow, Context, Result};
use host_domain::GitTargetBranch;
use std::error::Error;
use std::fmt::{self, Display, Formatter};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct BuilderBranchContext {
    pub(super) working_directory: String,
    pub(super) source_branch: String,
}

#[derive(Debug)]
pub(super) struct BuilderCleanupTarget {
    pub(super) working_directory: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct MissingBuilderWorktree {
    task_id: String,
    operation_label: String,
}

impl MissingBuilderWorktree {
    fn new(task_id: &str, operation_label: &str) -> Self {
        Self {
            task_id: task_id.to_string(),
            operation_label: operation_label.to_string(),
        }
    }
}

impl Display for MissingBuilderWorktree {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} requires a builder worktree for task {}. Start Builder first.",
            self.operation_label, self.task_id
        )
    }
}

impl Error for MissingBuilderWorktree {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum BuilderBranchContextLoadResult {
    Ready(BuilderBranchContext),
    MissingContext,
    MissingWorktree(MissingBuilderWorktree),
}

pub(crate) struct BuilderBranchService<'a> {
    service: &'a AppService,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedTaskTargetBranch {
    pub(crate) target_branch: GitTargetBranch,
    pub(crate) has_task_override: bool,
}

impl<'a> BuilderBranchService<'a> {
    pub(crate) fn new(service: &'a AppService) -> Self {
        Self { service }
    }

    pub(super) fn load_builder_branch_context(
        &self,
        repo_path: &str,
        task_id: &str,
        operation_label: &str,
    ) -> Result<BuilderBranchContext> {
        match self.load_builder_branch_context_result(repo_path, task_id, operation_label)? {
            BuilderBranchContextLoadResult::Ready(context) => Ok(context),
            BuilderBranchContextLoadResult::MissingContext => Err(anyhow!(
                "{operation_label} requires a builder worktree for task {task_id}. Start Builder first."
            )),
            BuilderBranchContextLoadResult::MissingWorktree(missing) => {
                Err(anyhow!(missing.to_string()))
            }
        }
    }

    pub(super) fn load_builder_branch_context_result(
        &self,
        repo_path: &str,
        task_id: &str,
        operation_label: &str,
    ) -> Result<BuilderBranchContextLoadResult> {
        let target = match self.service.task_worktree_lookup(repo_path, task_id)? {
            TaskWorktreeLookup::Found(target) => target,
            TaskWorktreeLookup::NoBuilderContext => {
                return Ok(BuilderBranchContextLoadResult::MissingContext);
            }
            TaskWorktreeLookup::MissingBuilderWorktree => {
                return Ok(BuilderBranchContextLoadResult::MissingWorktree(
                    MissingBuilderWorktree::new(task_id, operation_label),
                ));
            }
        };
        let working_directory = target.working_directory;
        let current_branch = match self
            .service
            .git_port
            .get_current_branch(Path::new(&working_directory))
        {
            Ok(current_branch) => current_branch,
            Err(error)
                if is_definitive_non_worktree_git_error(&error)
                    && self.is_stranded_managed_task_worktree(
                        repo_path,
                        task_id,
                        working_directory.as_str(),
                    )? =>
            {
                return Ok(BuilderBranchContextLoadResult::MissingWorktree(
                    MissingBuilderWorktree::new(task_id, operation_label),
                ));
            }
            Err(error) => return Err(error),
        };
        if current_branch.detached {
            return Err(anyhow!(
                "{operation_label} requires a builder branch, but the builder worktree is detached."
            ));
        }
        let source_branch = current_branch
            .name
            .ok_or_else(|| anyhow!("{operation_label} requires a builder branch name."))?;

        Ok(BuilderBranchContextLoadResult::Ready(
            BuilderBranchContext {
                working_directory,
                source_branch,
            },
        ))
    }

    pub(crate) fn target_branch_for_repo(&self, repo_path: &str) -> Result<GitTargetBranch> {
        let repo_config = self
            .service
            .workspace_get_repo_config_by_repo_path(repo_path)?;
        normalize_approval_target_branch(&repo_config.default_target_branch)
    }

    pub(crate) fn task_target_branch_override_for_task(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<Option<GitTargetBranch>> {
        let task = self.task_card_for_task(repo_path, task_id)?;
        if let Some(error) = task.target_branch_error.as_ref() {
            return Err(anyhow!(error.clone()));
        }

        task.target_branch
            .as_ref()
            .map(normalize_recorded_target_branch)
            .transpose()
    }

    pub(crate) fn resolve_target_branch_for_task(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<ResolvedTaskTargetBranch> {
        match self.task_target_branch_override_for_task(repo_path, task_id)? {
            Some(target_branch) => Ok(ResolvedTaskTargetBranch {
                target_branch,
                has_task_override: true,
            }),
            None => Ok(ResolvedTaskTargetBranch {
                target_branch: self.target_branch_for_repo(repo_path)?,
                has_task_override: false,
            }),
        }
    }

    pub(crate) fn effective_target_branch_for_task(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<GitTargetBranch> {
        Ok(self
            .resolve_target_branch_for_task(repo_path, task_id)?
            .target_branch)
    }

    pub(crate) fn effective_publish_target_for_task(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<Option<GitTargetBranch>> {
        let task = self.task_card_for_task(repo_path, task_id)?;
        if let Some(error) = task.target_branch_error.as_ref() {
            return Err(anyhow!(error.clone()));
        }

        match task.target_branch.as_ref() {
            Some(target_branch) => publish_recorded_target_branch(target_branch),
            None => {
                let repo_config = self
                    .service
                    .workspace_get_repo_config_by_repo_path(repo_path)?;
                publish_target_branch(&repo_config.default_target_branch)
            }
        }
    }

    fn task_card_for_task(&self, repo_path: &str, task_id: &str) -> Result<host_domain::TaskCard> {
        let resolved_repo_path = self.service.resolve_task_repo_path(repo_path)?;
        self.service
            .task_store
            .get_task(Path::new(&resolved_repo_path), task_id)
    }

    pub(super) fn latest_cleanup_target(
        &self,
        repo_path: &str,
        task_id: &str,
        preferred_source_branch: Option<&str>,
    ) -> Result<Option<BuilderCleanupTarget>> {
        if let Ok(Some(target)) = self.service.task_worktree_get(repo_path, task_id) {
            if let Some(cleanup_target) = self.cleanup_target_for_working_directory(
                repo_path,
                task_id,
                target.working_directory,
                preferred_source_branch,
            )? {
                return Ok(Some(cleanup_target));
            }
        }

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
                .then_with(|| left.external_session_id.cmp(&right.external_session_id))
        });
        builder_sessions.reverse();

        for session in builder_sessions {
            if let Some(cleanup_target) = self.cleanup_target_for_working_directory(
                repo_path,
                task_id,
                session.working_directory,
                preferred_source_branch,
            )? {
                return Ok(Some(cleanup_target));
            }
        }

        Ok(None)
    }

    fn cleanup_target_for_working_directory(
        &self,
        repo_path: &str,
        task_id: &str,
        working_directory: String,
        preferred_source_branch: Option<&str>,
    ) -> Result<Option<BuilderCleanupTarget>> {
        let working_directory = working_directory.trim().to_string();
        if working_directory.is_empty() {
            return Ok(None);
        }
        if !path_exists_including_broken_symlink(Path::new(working_directory.as_str()))
            .with_context(|| format!("Failed checking builder worktree path {working_directory}"))?
        {
            return Ok(Some(BuilderCleanupTarget { working_directory }));
        }
        let current_branch = match self
            .service
            .git_port
            .get_current_branch(Path::new(working_directory.as_str()))
        {
            Ok(current_branch) => current_branch,
            Err(error)
                if is_definitive_non_worktree_git_error(&error)
                    && self.is_stranded_managed_task_worktree(
                        repo_path,
                        task_id,
                        working_directory.as_str(),
                    )? =>
            {
                return Ok(Some(BuilderCleanupTarget { working_directory }));
            }
            Err(error) => return Err(error),
        };
        let current_branch_name = match current_branch.name {
            Some(name) => {
                let trimmed = name.trim().to_string();
                if trimmed.is_empty() {
                    return Ok(None);
                }
                trimmed
            }
            None => return Ok(None),
        };
        if preferred_source_branch
            .map(str::trim)
            .is_some_and(|expected| current_branch_name != expected)
        {
            return Ok(None);
        }

        Ok(Some(BuilderCleanupTarget { working_directory }))
    }

    fn is_stranded_managed_task_worktree(
        &self,
        repo_path: &str,
        task_id: &str,
        working_directory: &str,
    ) -> Result<bool> {
        if !path_exists_including_broken_symlink(Path::new(working_directory))
            .with_context(|| format!("Failed checking builder worktree path {working_directory}"))?
        {
            return Ok(false);
        }

        let normalized_worktree = normalize_path_for_comparison(working_directory);
        let normalized_repo = normalize_path_for_comparison(repo_path);
        if normalized_worktree == normalized_repo {
            return Ok(false);
        }

        let sessions = self.service.agent_sessions_list(repo_path, task_id)?;
        Ok(sessions
            .into_iter()
            .filter(|session| matches!(session.role.trim(), "build" | "qa"))
            .map(|session| normalize_path_for_comparison(session.working_directory.as_str()))
            .any(|recorded_path| recorded_path == normalized_worktree))
    }
}

#[cfg(test)]
mod tests {
    use super::BuilderBranchService;
    use crate::app_service::test_support::{
        add_workspace_with_repo_config, build_service_with_store, init_git_repo, make_session,
        make_task, unique_temp_path,
    };
    use anyhow::Result;
    use host_domain::{GitCurrentBranch, TaskStatus};
    use host_infra_system::{AppConfigStore, RepoConfig};
    use std::fs;

    #[test]
    fn load_builder_branch_context_rejects_detached_branch() -> Result<()> {
        let root = unique_temp_path("builder-branch-detached");
        let repo = root.join("repo");
        let worktree_base = root.join("worktrees");
        let worktree = worktree_base.join("task-1");
        init_git_repo(&repo)?;
        fs::create_dir_all(&worktree)?;

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, git_state) = build_service_with_store(
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
        add_workspace_with_repo_config(
            &service,
            repo_path.as_str(),
            RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                ..Default::default()
            },
        )?;
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
            "Pull request detection requires a builder branch, but the builder worktree is detached."
        );

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn load_builder_branch_context_uses_operation_label_when_worktree_is_missing() -> Result<()> {
        let root = unique_temp_path("builder-branch-missing");
        let repo = root.join("repo");
        let missing_worktree = root.join("missing-worktree");
        init_git_repo(&repo)?;

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, task_state, _git_state) = build_service_with_store(
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

        fs::create_dir_all(&missing_worktree)?;
        let mut session = make_session("task-1", "session-build");
        session.role = " build ".to_string();
        session.working_directory = missing_worktree.to_string_lossy().to_string();
        task_state
            .lock()
            .expect("task state lock poisoned")
            .agent_sessions
            .push(session);
        let _ = fs::remove_dir_all(&missing_worktree);

        let result = BuilderBranchService::new(&service).load_builder_branch_context_result(
            repo_path.as_str(),
            "task-1",
            "Pull request detection",
        )?;
        assert_eq!(
            result,
            super::BuilderBranchContextLoadResult::MissingWorktree(
                super::MissingBuilderWorktree::new("task-1", "Pull request detection")
            )
        );

        let error = BuilderBranchService::new(&service)
            .load_builder_branch_context(repo_path.as_str(), "task-1", "Pull request detection")
            .expect_err("missing builder worktree should be rejected");
        assert_eq!(
            error.to_string(),
            "Pull request detection requires a builder worktree for task task-1. Start Builder first."
        );

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn load_builder_branch_context_reports_missing_context_when_no_builder_session_exists(
    ) -> Result<()> {
        let root = unique_temp_path("builder-branch-no-context");
        let repo = root.join("repo");
        init_git_repo(&repo)?;

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
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

        let result = BuilderBranchService::new(&service).load_builder_branch_context_result(
            repo_path.as_str(),
            "task-1",
            "Pull request detection",
        )?;
        assert_eq!(
            result,
            super::BuilderBranchContextLoadResult::MissingContext
        );

        let error = BuilderBranchService::new(&service)
            .load_builder_branch_context(repo_path.as_str(), "task-1", "Pull request detection")
            .expect_err("missing builder context should fail fast");
        assert_eq!(
            error.to_string(),
            "Pull request detection requires a builder worktree for task task-1. Start Builder first."
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
        newer.role = " build ".to_string();
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

    #[test]
    fn latest_cleanup_target_prefers_task_worktree_over_sessions() -> Result<()> {
        let root = unique_temp_path("builder-branch-task-worktree");
        let repo = root.join("repo");
        let worktree_base = root.join("worktrees");
        let active_worktree = worktree_base.join("task-1");
        let older_worktree = root.join("older");
        init_git_repo(&repo)?;
        fs::create_dir_all(&active_worktree)?;
        fs::create_dir_all(&older_worktree)?;

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
        let _workspace = add_workspace_with_repo_config(
            &service,
            repo_path.as_str(),
            host_infra_system::RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                ..Default::default()
            },
        )?;

        let mut older = make_session("task-1", "session-1");
        older.started_at = "2026-03-11T10:00:00Z".to_string();
        older.working_directory = older_worktree.to_string_lossy().to_string();
        task_state
            .lock()
            .expect("task state lock poisoned")
            .agent_sessions
            .push(older);

        let mut git = git_state.lock().expect("git state lock poisoned");
        git.current_branches_by_path.insert(
            older_worktree.to_string_lossy().to_string(),
            GitCurrentBranch {
                name: Some("odt/task-1-old".to_string()),
                detached: false,
                revision: None,
            },
        );
        git.current_branches_by_path.insert(
            active_worktree.to_string_lossy().to_string(),
            GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
        drop(git);

        let target = BuilderBranchService::new(&service)
            .latest_cleanup_target(repo_path.as_str(), "task-1", Some("odt/task-1"))?
            .expect("expected task worktree cleanup target");

        assert_eq!(target.working_directory, active_worktree.to_string_lossy());

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn load_builder_branch_context_treats_stranded_managed_worktree_as_missing() -> Result<()> {
        let root = unique_temp_path("builder-branch-stranded-managed-worktree");
        let repo = root.join("repo");
        let worktree_base = root.join("worktrees");
        let stranded_worktree = worktree_base.join("task-1");
        init_git_repo(&repo)?;
        fs::create_dir_all(&stranded_worktree)?;

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
        let _workspace = add_workspace_with_repo_config(
            &service,
            repo_path.as_str(),
            host_infra_system::RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                ..Default::default()
            },
        )?;

        let mut session = make_session("task-1", "session-build");
        session.working_directory = stranded_worktree.to_string_lossy().to_string();
        task_state
            .lock()
            .expect("task state lock poisoned")
            .agent_sessions
            .push(session);
        git_state
            .lock()
            .expect("git state lock poisoned")
            .current_branch_error_by_path
            .insert(
                stranded_worktree.to_string_lossy().to_string(),
                "not a git worktree".to_string(),
            );

        let result = BuilderBranchService::new(&service).load_builder_branch_context_result(
            repo_path.as_str(),
            "task-1",
            "Pull request detection",
        )?;
        assert_eq!(
            result,
            super::BuilderBranchContextLoadResult::MissingWorktree(
                super::MissingBuilderWorktree::new("task-1", "Pull request detection")
            )
        );

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn latest_cleanup_target_uses_stranded_managed_worktree_when_branch_inspection_fails(
    ) -> Result<()> {
        let root = unique_temp_path("builder-branch-stranded-cleanup-target");
        let repo = root.join("repo");
        let worktree_base = root.join("worktrees");
        let stranded_worktree = worktree_base.join("task-1");
        init_git_repo(&repo)?;
        fs::create_dir_all(&stranded_worktree)?;

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
        let _workspace = add_workspace_with_repo_config(
            &service,
            repo_path.as_str(),
            host_infra_system::RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                ..Default::default()
            },
        )?;

        let mut session = make_session("task-1", "session-build");
        session.started_at = "2026-03-11T11:00:00Z".to_string();
        session.working_directory = stranded_worktree.to_string_lossy().to_string();
        task_state
            .lock()
            .expect("task state lock poisoned")
            .agent_sessions
            .push(session);
        git_state
            .lock()
            .expect("git state lock poisoned")
            .current_branch_error_by_path
            .insert(
                stranded_worktree.to_string_lossy().to_string(),
                "not a git worktree".to_string(),
            );

        let target = BuilderBranchService::new(&service)
            .latest_cleanup_target(repo_path.as_str(), "task-1", Some("odt/task-1"))?
            .expect("expected stranded cleanup target");

        assert_eq!(
            target.working_directory,
            stranded_worktree.to_string_lossy()
        );

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn load_builder_branch_context_propagates_non_worktree_errors_for_managed_paths() -> Result<()>
    {
        let root = unique_temp_path("builder-branch-non-worktree-error");
        let repo = root.join("repo");
        let worktree_base = root.join("worktrees");
        let managed_worktree = worktree_base.join("task-1");
        init_git_repo(&repo)?;
        fs::create_dir_all(&managed_worktree)?;

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
        let _workspace = add_workspace_with_repo_config(
            &service,
            repo_path.as_str(),
            host_infra_system::RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                ..Default::default()
            },
        )?;

        let mut session = make_session("task-1", "session-build");
        session.working_directory = managed_worktree.to_string_lossy().to_string();
        task_state
            .lock()
            .expect("task state lock poisoned")
            .agent_sessions
            .push(session);
        git_state
            .lock()
            .expect("git state lock poisoned")
            .current_branch_error_by_path
            .insert(
                managed_worktree.to_string_lossy().to_string(),
                "permission denied".to_string(),
            );

        let error = BuilderBranchService::new(&service)
            .load_builder_branch_context_result(
                repo_path.as_str(),
                "task-1",
                "Pull request detection",
            )
            .expect_err("non-worktree errors should propagate");
        assert!(error.to_string().contains("permission denied"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn latest_cleanup_target_propagates_non_worktree_errors_for_managed_paths() -> Result<()> {
        let root = unique_temp_path("builder-cleanup-target-non-worktree-error");
        let repo = root.join("repo");
        let worktree_base = root.join("worktrees");
        let managed_worktree = worktree_base.join("task-1");
        init_git_repo(&repo)?;
        fs::create_dir_all(&managed_worktree)?;

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
        let _workspace = add_workspace_with_repo_config(
            &service,
            repo_path.as_str(),
            host_infra_system::RepoConfig {
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                ..Default::default()
            },
        )?;

        let mut session = make_session("task-1", "session-build");
        session.working_directory = managed_worktree.to_string_lossy().to_string();
        task_state
            .lock()
            .expect("task state lock poisoned")
            .agent_sessions
            .push(session);
        git_state
            .lock()
            .expect("git state lock poisoned")
            .current_branch_error_by_path
            .insert(
                managed_worktree.to_string_lossy().to_string(),
                "permission denied".to_string(),
            );

        let error = BuilderBranchService::new(&service)
            .latest_cleanup_target(repo_path.as_str(), "task-1", Some("odt/task-1"))
            .expect_err("non-worktree cleanup errors should propagate");
        assert!(error.to_string().contains("permission denied"));

        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn effective_target_branch_for_task_prefers_persisted_task_target_branch() -> Result<()> {
        let root = unique_temp_path("builder-effective-task-target-branch");
        let repo = root.join("repo");
        init_git_repo(&repo)?;

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "task", TaskStatus::InProgress)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
                revision: None,
            },
            config_store,
        );
        let repo_path = repo.to_string_lossy().to_string();
        let _workspace = add_workspace_with_repo_config(
            &service,
            repo_path.as_str(),
            host_infra_system::RepoConfig {
                default_target_branch: host_infra_system::GitTargetBranch {
                    remote: Some("origin".to_string()),
                    branch: "main".to_string(),
                },
                ..Default::default()
            },
        )?;
        task_state.lock().expect("task state lock poisoned").tasks[0].target_branch =
            Some(host_domain::GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "release/2026.04".to_string(),
            });

        let target_branch = BuilderBranchService::new(&service)
            .effective_target_branch_for_task(repo_path.as_str(), "task-1")?;

        assert_eq!(target_branch.canonical(), "origin/release/2026.04");
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn effective_target_branch_for_task_falls_back_to_repo_default_when_task_override_is_missing(
    ) -> Result<()> {
        let root = unique_temp_path("builder-effective-repo-default-target-branch");
        let repo = root.join("repo");
        init_git_repo(&repo)?;

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, _task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "task", TaskStatus::InProgress)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
                revision: None,
            },
            config_store,
        );
        let repo_path = repo.to_string_lossy().to_string();
        let _workspace = add_workspace_with_repo_config(
            &service,
            repo_path.as_str(),
            host_infra_system::RepoConfig {
                default_target_branch: host_infra_system::GitTargetBranch {
                    remote: Some("origin".to_string()),
                    branch: "release/2026.05".to_string(),
                },
                ..Default::default()
            },
        )?;

        let target_branch = BuilderBranchService::new(&service)
            .effective_target_branch_for_task(repo_path.as_str(), "task-1")?;

        assert_eq!(target_branch.canonical(), "origin/release/2026.05");
        let _ = fs::remove_dir_all(root);
        Ok(())
    }

    #[test]
    fn effective_target_branch_for_task_errors_on_invalid_persisted_metadata() -> Result<()> {
        let root = unique_temp_path("builder-invalid-task-target-branch");
        let repo = root.join("repo");
        init_git_repo(&repo)?;

        let config_store = AppConfigStore::from_path(root.join("config.json"));
        let (service, task_state, _git_state) = build_service_with_store(
            vec![make_task("task-1", "task", TaskStatus::InProgress)],
            vec![],
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
                revision: None,
            },
            config_store,
        );
        let repo_path = repo.to_string_lossy().to_string();
        let _workspace = add_workspace_with_repo_config(
            &service,
            repo_path.as_str(),
            host_infra_system::RepoConfig {
                default_target_branch: host_infra_system::GitTargetBranch {
                    remote: Some("origin".to_string()),
                    branch: "main".to_string(),
                },
                ..Default::default()
            },
        )?;
        task_state.lock().expect("task state lock poisoned").tasks[0].target_branch_error = Some(
            "Invalid openducktor.targetBranch metadata: missing field `branch`. Fix the saved task metadata or choose a valid target branch again.".to_string(),
        );

        let error = BuilderBranchService::new(&service)
            .effective_target_branch_for_task(repo_path.as_str(), "task-1")
            .expect_err("invalid task target branch metadata should fail fast");

        assert!(error
            .to_string()
            .contains("Invalid openducktor.targetBranch metadata"));
        let _ = fs::remove_dir_all(root);
        Ok(())
    }
}
