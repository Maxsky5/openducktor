use crate::app_service::service_core::AppService;
use anyhow::{anyhow, Context, Result};
use host_domain::{AgentSessionDocument, QaReviewTarget, QaReviewTargetSource, RunState};
use std::fs;
use std::path::{Path, PathBuf};

impl AppService {
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
        mut session: AgentSessionDocument,
    ) -> Result<bool> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        if session.task_id.as_deref() != Some(task_id) {
            session.task_id = Some(task_id.to_string());
        }
        validate_task_agent_session(self, repo_path.as_str(), &session)?;
        self.task_store
            .upsert_agent_session(Path::new(&repo_path), task_id, session)
            .with_context(|| format!("Failed to persist agent session for {task_id}"))?;
        Ok(true)
    }

    pub fn qa_review_target_get(&self, repo_path: &str, task_id: &str) -> Result<QaReviewTarget> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;

        let active_worktree_path: Option<String> = {
            let runs = self
                .runs
                .lock()
                .map_err(|_| anyhow!("Run state lock poisoned"))?;
            runs.values()
                .filter(|run| {
                    run.repo_path == repo_path
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
            let working_directory = validate_qa_review_target_working_directory(
                repo_path.as_str(),
                task_id,
                &worktree_path,
            )?;
            return Ok(QaReviewTarget {
                working_directory,
                source: QaReviewTargetSource::ActiveBuildRun,
            });
        }

        let sessions = self.agent_sessions_list(repo_path.as_str(), task_id)?;
        let latest_builder_session = sessions
            .into_iter()
            .filter(|session| session.role == "build")
            .max_by(|left, right| {
                session_sort_key(left)
                    .cmp(&session_sort_key(right))
                    .then_with(|| left.session_id.cmp(&right.session_id))
            })
            .ok_or_else(|| {
                anyhow!(
                    "QA cannot start until a builder worktree exists for task {task_id}. Start Builder first."
                )
            })?;

        let working_directory = validate_qa_review_target_working_directory(
            repo_path.as_str(),
            task_id,
            &latest_builder_session.working_directory,
        )?;
        Ok(QaReviewTarget {
            working_directory,
            source: QaReviewTargetSource::BuilderSession,
        })
    }
}

fn session_sort_key(session: &AgentSessionDocument) -> (&str, &str) {
    (
        session
            .updated_at
            .as_deref()
            .unwrap_or(session.started_at.as_str()),
        session.started_at.as_str(),
    )
}

fn validate_task_agent_session(
    service: &AppService,
    repo_path: &str,
    session: &AgentSessionDocument,
) -> Result<()> {
    let role = session.role.trim();
    if !matches!(role, "spec" | "planner" | "build" | "qa") {
        return Err(anyhow!(
            "Agent session role must be one of spec, planner, build, or qa. Received: {}",
            session.role
        ));
    }

    let working_directory = session.working_directory.trim();
    if working_directory.is_empty() {
        return Err(anyhow!("Agent session workingDirectory is required"));
    }

    let normalized_repo = normalize_path_for_comparison(repo_path);
    let normalized_working_directory = normalize_path_for_comparison(working_directory);
    if normalized_working_directory.starts_with(&normalized_repo) {
        return Ok(());
    }

    let effective_worktree_base_path = service
        .workspace_list()?
        .into_iter()
        .find(|workspace| normalize_path_for_comparison(workspace.path.as_str()) == normalized_repo)
        .and_then(|workspace| workspace.effective_worktree_base_path);

    if let Some(worktree_base_path) = effective_worktree_base_path {
        let normalized_worktree_base_path = normalize_path_for_comparison(&worktree_base_path);
        if normalized_working_directory.starts_with(&normalized_worktree_base_path) {
            return Ok(());
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

fn validate_qa_review_target_working_directory(
    repo_path: &str,
    task_id: &str,
    working_directory: &str,
) -> Result<String> {
    let trimmed = working_directory.trim();
    if trimmed.is_empty() {
        return Err(anyhow!(
            "QA cannot start until a builder worktree exists for task {task_id}. The latest builder workspace is empty."
        ));
    }

    if !Path::new(trimmed).exists() {
        return Err(anyhow!(
            "QA cannot start until a builder worktree exists for task {task_id}. The latest builder workspace does not exist: {trimmed}"
        ));
    }

    let normalized_repo = normalize_path_for_comparison(repo_path);
    let normalized_working_directory = normalize_path_for_comparison(trimmed);
    if normalized_working_directory == normalized_repo {
        return Err(anyhow!(
            "QA cannot start until a builder worktree exists for task {task_id}. The latest builder workspace points to the repository root."
        ));
    }

    Ok(trimmed.to_string())
}
