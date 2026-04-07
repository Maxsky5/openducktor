use crate::app_service::service_core::AppService;
use anyhow::{anyhow, Context, Result};
use host_domain::{
    AgentSessionDocument, BuildContinuationTarget, BuildContinuationTargetSource, RunState,
};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

impl AppService {
    pub(super) fn build_continuation_target_lookup(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<BuildContinuationTargetLookup> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        let normalized_repo_path = normalize_path_for_comparison(repo_path.as_str());

        let active_worktree_path: Option<String> = {
            let runs = self
                .runs
                .lock()
                .map_err(|_| anyhow!("Run state lock poisoned"))?;
            runs.values()
                .filter(|run| {
                    normalize_path_for_comparison(run.repo_path.as_str()) == normalized_repo_path
                        && run.task_id == task_id
                        && matches!(
                            run.summary.state,
                            RunState::Starting
                                | RunState::Running
                                | RunState::Blocked
                                | RunState::AwaitingDoneConfirmation
                        )
                })
                .max_by(|left, right| left.summary.started_at.cmp(&right.summary.started_at))
                .map(|run| run.worktree_path.clone())
        };

        if let Some(worktree_path) = active_worktree_path {
            let working_directory = validate_build_continuation_working_directory(
                repo_path.as_str(),
                task_id,
                &worktree_path,
            )?;
            return Ok(BuildContinuationTargetLookup::Found(
                BuildContinuationTarget {
                    working_directory,
                    source: BuildContinuationTargetSource::ActiveBuildRun,
                },
            ));
        }

        let sessions = self.agent_sessions_list(repo_path.as_str(), task_id)?;
        let latest_builder_session = sessions
            .into_iter()
            .filter(|session| {
                TaskAgentRole::parse(session.role.trim()) == Some(TaskAgentRole::Build)
            })
            .max_by(|left, right| session_sort_key(left).cmp(&session_sort_key(right)));
        let Some(latest_builder_session) = latest_builder_session else {
            return Ok(BuildContinuationTargetLookup::NoBuilderContext);
        };

        let working_directory = match validate_build_continuation_working_directory(
            repo_path.as_str(),
            task_id,
            &latest_builder_session.working_directory,
        ) {
            Ok(working_directory) => working_directory,
            Err(error) => {
                let message = error.to_string();
                if message.contains("The latest builder workspace does not exist") {
                    return Ok(BuildContinuationTargetLookup::MissingBuilderWorktree);
                }
                return Err(error);
            }
        };
        Ok(BuildContinuationTargetLookup::Found(
            BuildContinuationTarget {
                working_directory,
                source: BuildContinuationTargetSource::BuilderSession,
            },
        ))
    }

    pub fn agent_sessions_list(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<Vec<AgentSessionDocument>> {
        Ok(self.task_metadata_get(repo_path, task_id)?.agent_sessions)
    }

    pub fn agent_session_upsert(
        &self,
        repo_path: &str,
        task_id: &str,
        session: AgentSessionDocument,
    ) -> Result<bool> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        validate_task_agent_session(self, repo_path.as_str(), &session)?;
        self.task_store
            .upsert_agent_session(Path::new(&repo_path), task_id, session)
            .with_context(|| format!("Failed to persist agent session for {task_id}"))?;
        Ok(true)
    }

    pub fn agent_sessions_list_bulk(
        &self,
        repo_path: &str,
        task_ids: &[String],
    ) -> Result<HashMap<String, Vec<AgentSessionDocument>>> {
        if task_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let repo_path = self.resolve_task_repo_path(repo_path)?;
        let repo_dir = Path::new(&repo_path);
        let sessions_by_available_task = self
            .task_store
            .list_tasks(repo_dir)?
            .into_iter()
            .map(|task| (task.id, task.agent_sessions))
            .collect::<HashMap<_, _>>();

        let mut sessions_by_task = HashMap::with_capacity(task_ids.len());
        for task_id in task_ids {
            let sessions = sessions_by_available_task
                .get(task_id)
                .cloned()
                .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;
            sessions_by_task.insert(task_id.clone(), sessions);
        }

        Ok(sessions_by_task)
    }

    pub fn build_continuation_target_get(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<Option<BuildContinuationTarget>> {
        match self.build_continuation_target_lookup(repo_path, task_id)? {
            BuildContinuationTargetLookup::Found(target) => Ok(Some(target)),
            BuildContinuationTargetLookup::NoBuilderContext
            | BuildContinuationTargetLookup::MissingBuilderWorktree => Ok(None),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum BuildContinuationTargetLookup {
    Found(BuildContinuationTarget),
    NoBuilderContext,
    MissingBuilderWorktree,
}

fn session_sort_key(session: &AgentSessionDocument) -> (&str, &str) {
    (session.started_at.as_str(), session.session_id.as_str())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TaskAgentRole {
    Spec,
    Planner,
    Build,
    Qa,
}

impl TaskAgentRole {
    fn parse(raw_role: &str) -> Option<Self> {
        match raw_role {
            "spec" => Some(Self::Spec),
            "planner" => Some(Self::Planner),
            "build" => Some(Self::Build),
            "qa" => Some(Self::Qa),
            _ => None,
        }
    }
}

fn validate_task_agent_session(
    service: &AppService,
    repo_path: &str,
    session: &AgentSessionDocument,
) -> Result<()> {
    TaskAgentRole::parse(session.role.trim()).ok_or_else(|| {
        anyhow!(
            "Agent session role must be one of spec, planner, build, or qa. Received: {}",
            session.role
        )
    })?;

    let working_directory = session.working_directory.trim();
    if working_directory.is_empty() {
        return Err(anyhow!("Agent session workingDirectory is required"));
    }

    let canonical_repo = canonicalize_existing_path(
        repo_path,
        "Repository path for agent session validation must exist and be accessible",
    )?;
    let canonical_working_directory = canonicalize_existing_path(
        working_directory,
        "Agent session workingDirectory must exist and be accessible",
    )?;
    if canonical_working_directory.starts_with(&canonical_repo) {
        return Ok(());
    }

    let effective_worktree_base_path = service
        .workspace_list()?
        .into_iter()
        .find(|workspace| {
            try_canonicalize_existing_path(workspace.path.as_str())
                .is_some_and(|workspace_path| workspace_path == canonical_repo)
        })
        .and_then(|workspace| workspace.effective_worktree_base_path);

    if let Some(worktree_base_path) = effective_worktree_base_path {
        if let Some(canonical_worktree_base_path) =
            try_canonicalize_existing_path(&worktree_base_path)
        {
            if canonical_working_directory.starts_with(&canonical_worktree_base_path) {
                return Ok(());
            }
        }
    }

    Err(anyhow!(
        "Agent session workingDirectory must stay inside repository {repo_path} or its effective worktree base. Received: {working_directory}"
    ))
}

fn normalize_path_for_comparison(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return PathBuf::new();
    }

    fs::canonicalize(trimmed).unwrap_or_else(|_| {
        let without_trailing_separators = trimmed.trim_end_matches(['/', '\\']);
        if without_trailing_separators.is_empty() {
            PathBuf::from(trimmed)
        } else {
            PathBuf::from(without_trailing_separators)
        }
    })
}

fn canonicalize_existing_path(path: &str, error_message: &str) -> Result<PathBuf> {
    fs::canonicalize(path.trim()).with_context(|| format!("{error_message}: {}", path.trim()))
}

fn try_canonicalize_existing_path(path: &str) -> Option<PathBuf> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }

    fs::canonicalize(trimmed).ok()
}

fn validate_build_continuation_working_directory(
    repo_path: &str,
    task_id: &str,
    working_directory: &str,
) -> Result<String> {
    let trimmed = working_directory.trim();
    if trimmed.is_empty() {
        return Err(anyhow!(
            "Builder continuation cannot start until a builder worktree exists for task {task_id}. The latest builder workspace is empty."
        ));
    }

    if !Path::new(trimmed).exists() {
        return Err(anyhow!(
            "Builder continuation cannot start until a builder worktree exists for task {task_id}. The latest builder workspace does not exist: {trimmed}"
        ));
    }

    let normalized_repo = normalize_path_for_comparison(repo_path);
    let normalized_working_directory = normalize_path_for_comparison(trimmed);
    if normalized_working_directory == normalized_repo {
        return Err(anyhow!(
            "Builder continuation cannot start until a builder worktree exists for task {task_id}. The latest builder workspace points to the repository root."
        ));
    }

    Ok(trimmed.to_string())
}
