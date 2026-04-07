use super::approval_support::normalize_approval_target_branch;
use crate::app_service::service_core::AppService;
use crate::app_service::task_workflow::session_service::BuildContinuationTargetLookup;
use anyhow::{anyhow, Result};
use host_domain::{BuildContinuationTargetSource, GitTargetBranch};
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
        let target = match self
            .service
            .build_continuation_target_lookup(repo_path, task_id)?
        {
            BuildContinuationTargetLookup::Found(target) => target,
            BuildContinuationTargetLookup::NoBuilderContext => {
                return Ok(BuilderBranchContextLoadResult::MissingContext);
            }
            BuildContinuationTargetLookup::MissingBuilderWorktree => {
                return Ok(BuilderBranchContextLoadResult::MissingWorktree(
                    MissingBuilderWorktree::new(task_id, operation_label),
                ));
            }
        };
        let working_directory = target.working_directory;
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

        Ok(BuilderBranchContextLoadResult::Ready(
            BuilderBranchContext {
                working_directory,
                source_branch,
            },
        ))
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
        if let Ok(Some(target)) = self
            .service
            .build_continuation_target_get(repo_path, task_id)
        {
            if matches!(target.source, BuildContinuationTargetSource::ActiveBuildRun) {
                if let Some(cleanup_target) = self.cleanup_target_for_working_directory(
                    target.working_directory,
                    preferred_source_branch,
                )? {
                    return Ok(Some(cleanup_target));
                }
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
                .then_with(|| left.session_id.cmp(&right.session_id))
        });
        builder_sessions.reverse();

        for session in builder_sessions {
            if let Some(cleanup_target) = self.cleanup_target_for_working_directory(
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
        working_directory: String,
        preferred_source_branch: Option<&str>,
    ) -> Result<Option<BuilderCleanupTarget>> {
        let working_directory = working_directory.trim().to_string();
        if working_directory.is_empty() {
            return Ok(None);
        }
        if !Path::new(working_directory.as_str()).exists() {
            return Ok(None);
        }
        let current_branch = self
            .service
            .git_port
            .get_current_branch(Path::new(working_directory.as_str()))?;
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
}

#[cfg(test)]
mod tests {
    use super::BuilderBranchService;
    use crate::app_service::test_support::{
        build_service_with_store, init_git_repo, make_session, make_task, unique_temp_path,
    };
    use anyhow::Result;
    use host_domain::{AgentRuntimeKind, GitCurrentBranch, RunState, RunSummary, TaskStatus};
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
    fn latest_cleanup_target_prefers_active_build_run_over_sessions() -> Result<()> {
        let root = unique_temp_path("builder-branch-active-run");
        let repo = root.join("repo");
        let active_worktree = root.join("active");
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
        service.workspace_add(repo_path.as_str())?;

        let mut older = make_session("task-1", "session-1");
        older.started_at = "2026-03-11T10:00:00Z".to_string();
        older.working_directory = older_worktree.to_string_lossy().to_string();
        task_state
            .lock()
            .expect("task state lock poisoned")
            .agent_sessions
            .push(older);

        let active_repo_path = repo.to_string_lossy().to_string();
        service.runs.lock().expect("run lock poisoned").insert(
            "run-1".to_string(),
            crate::app_service::RunProcess {
                summary: RunSummary {
                    run_id: "run-1".to_string(),
                    runtime_kind: AgentRuntimeKind::Opencode,
                    runtime_route: AgentRuntimeKind::Opencode.route_for_port(4444),
                    repo_path: active_repo_path.clone(),
                    task_id: "task-1".to_string(),
                    branch: "odt/task-1".to_string(),
                    worktree_path: active_worktree.to_string_lossy().to_string(),
                    port: 4444,
                    state: RunState::Running,
                    last_message: None,
                    started_at: "2026-03-11T11:00:00Z".to_string(),
                },
                child: None,
                _opencode_process_guard: None,
                repo_path: active_repo_path,
                task_id: "task-1".to_string(),
                worktree_path: active_worktree.to_string_lossy().to_string(),
                repo_config: host_infra_system::RepoConfig::default(),
            },
        );

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
            .expect("expected active run cleanup target");

        assert_eq!(target.working_directory, active_worktree.to_string_lossy());

        let _ = fs::remove_dir_all(root);
        Ok(())
    }
}
