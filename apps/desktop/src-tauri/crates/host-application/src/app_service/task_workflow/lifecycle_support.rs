use crate::app_service::{
    has_live_opencode_session_status, is_unreachable_opencode_session_status_error,
    load_opencode_session_statuses, service_core::AppService, OpencodeSessionStatusMap,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{
    AgentRuntimeKind, AgentSessionDocument, GitWorktreeSummary, RunState, RuntimeRole,
    RuntimeRoute, TaskCard, TaskStatus, DEFAULT_BRANCH_PREFIX,
};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

pub(super) struct TaskActivityGuard<'a> {
    service: &'a AppService,
}

impl<'a> TaskActivityGuard<'a> {
    pub(super) fn new(service: &'a AppService) -> Self {
        Self { service }
    }

    pub(super) fn ensure_no_active_task_delete_runs(
        &self,
        repo_path: &str,
        task_ids: &[&str],
    ) -> Result<()> {
        let mut active_task_ids = HashSet::new();
        for task_id in task_ids {
            let sessions = self.service.agent_sessions_list(repo_path, task_id)?;
            let evidence = self
                .collect_active_task_work_evidence(repo_path, task_id, &sessions)
                .with_context(|| {
                    format!("Failed checking active task work before deleting {task_id}")
                })?;
            if evidence.has_any_activity() {
                active_task_ids.insert((*task_id).to_string());
            }
        }

        if active_task_ids.is_empty() {
            return Ok(());
        }

        let active_summary = active_task_ids.into_iter().collect::<Vec<_>>().join(", ");
        Err(anyhow!(
            "Cannot delete tasks with active builder work in progress. Stop the active run(s) first: {active_summary}"
        ))
    }

    pub(super) fn ensure_no_active_task_reset_runs(
        &self,
        repo_path: &str,
        task_id: &str,
        sessions: &[AgentSessionDocument],
    ) -> Result<()> {
        let evidence = self
            .collect_active_task_work_evidence(repo_path, task_id, sessions)
            .with_context(|| {
                format!("Failed checking live runtime state before resetting {task_id}")
            })?;

        if evidence.has_active_run {
            return Err(anyhow!(
                "Cannot reset implementation while builder work is active for task {task_id}. Stop the active run first."
            ));
        }

        if evidence.active_session_roles.is_empty() {
            return Ok(());
        }

        Err(anyhow!(
            "Cannot reset implementation while active {} session(s) exist for task {task_id}. Stop the active session(s) first.",
            evidence.active_session_roles.join("/")
        ))
    }

    fn collect_active_task_work_evidence(
        &self,
        repo_path: &str,
        task_id: &str,
        sessions: &[AgentSessionDocument],
    ) -> Result<TaskActiveWorkEvidence> {
        let normalized_repo = normalize_path_for_comparison(repo_path);
        let runs = self
            .service
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?;
        let mut runtime_statuses_by_directory = HashMap::<String, OpencodeSessionStatusMap>::new();
        let mut runtime_routes_by_worktree = HashMap::new();
        let mut has_active_run = false;
        for run in runs.values() {
            if normalize_path_for_comparison(run.repo_path.as_str()) != normalized_repo
                || run.task_id != task_id
                || !matches!(
                    run.summary.state,
                    RunState::Starting
                        | RunState::Running
                        | RunState::Blocked
                        | RunState::AwaitingDoneConfirmation
                )
            {
                continue;
            }

            runtime_routes_by_worktree.insert(
                normalize_path_key(run.worktree_path.as_str()),
                run.summary.runtime_route.clone(),
            );

            if !is_live_build_run_for_task_reset(run, sessions, &mut runtime_statuses_by_directory)?
            {
                continue;
            }

            has_active_run = true;
            break;
        }
        drop(runs);
        let repo_runtime_routes_by_kind = self.collect_repo_runtime_routes_by_kind(repo_path)?;

        let mut active_roles = HashSet::new();
        for session in sessions
            .iter()
            .filter(|session| matches!(session.role.as_str(), "build" | "qa"))
        {
            let external_session_id = session
                .external_session_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let Some(external_session_id) = external_session_id else {
                continue;
            };

            let worktree_key = normalize_path_key(session.working_directory.as_str());
            let fallback_runtime_kind = parse_runtime_kind(session.runtime_kind.as_str());
            let worktree_runtime_route = runtime_routes_by_worktree.get(worktree_key.as_str());
            let repo_runtime_route =
                fallback_runtime_kind.and_then(|kind| repo_runtime_routes_by_kind.get(&kind));
            let runtime_route = worktree_runtime_route.or(repo_runtime_route);
            let Some(runtime_route) = runtime_route else {
                continue;
            };
            if !runtime_statuses_by_directory.contains_key(worktree_key.as_str()) {
                let mut statuses = load_opencode_session_statuses(
                    runtime_route,
                    session.working_directory.as_str(),
                )
                .or_else(|error| {
                    if is_unreachable_opencode_session_status_error(&error) {
                        Ok(OpencodeSessionStatusMap::new())
                    } else {
                        Err(error)
                    }
                })?;

                if statuses.is_empty() {
                    if let (Some(primary_route), Some(fallback_route)) =
                        (worktree_runtime_route, repo_runtime_route)
                    {
                        let primary_endpoint = runtime_route_endpoint(primary_route);
                        let fallback_endpoint = runtime_route_endpoint(fallback_route);
                        if primary_endpoint != fallback_endpoint {
                            let fallback_statuses = load_opencode_session_statuses(
                                fallback_route,
                                session.working_directory.as_str(),
                            )
                            .or_else(|error| {
                                if is_unreachable_opencode_session_status_error(&error) {
                                    Ok(OpencodeSessionStatusMap::new())
                                } else {
                                    Err(error)
                                }
                            })?;
                            if !fallback_statuses.is_empty() {
                                statuses = fallback_statuses;
                            }
                        }
                    }
                }

                if !statuses.is_empty() {
                    runtime_statuses_by_directory.insert(worktree_key.clone(), statuses);
                }
            }

            if runtime_statuses_by_directory
                .get(worktree_key.as_str())
                .is_some_and(|statuses| {
                    has_live_opencode_session_status(statuses, external_session_id)
                })
            {
                active_roles.insert(session.role.as_str());
            }
        }
        let mut active_session_roles = active_roles
            .into_iter()
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        active_session_roles.sort_unstable();

        Ok(TaskActiveWorkEvidence {
            has_active_run,
            active_session_roles,
        })
    }

    fn collect_repo_runtime_routes_by_kind(
        &self,
        repo_path: &str,
    ) -> Result<HashMap<AgentRuntimeKind, RuntimeRoute>> {
        let normalized_repo = normalize_path_for_comparison(repo_path);
        let runtimes = self
            .service
            .agent_runtimes
            .lock()
            .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
        let mut routes_by_kind = HashMap::new();

        for runtime in runtimes.values() {
            if normalize_path_for_comparison(runtime.summary.repo_path.as_str()) != normalized_repo
            {
                continue;
            }

            if runtime.summary.role == RuntimeRole::Workspace {
                routes_by_kind.insert(runtime.summary.kind, runtime.summary.runtime_route.clone());
                continue;
            }

            routes_by_kind
                .entry(runtime.summary.kind)
                .or_insert_with(|| runtime.summary.runtime_route.clone());
        }

        Ok(routes_by_kind)
    }
}

#[derive(Default)]
struct TaskActiveWorkEvidence {
    has_active_run: bool,
    active_session_roles: Vec<String>,
}

impl TaskActiveWorkEvidence {
    fn has_any_activity(&self) -> bool {
        self.has_active_run || !self.active_session_roles.is_empty()
    }
}

#[derive(Clone, Debug, Default)]
pub(super) struct WorktreeCleanupPlan {
    paths: Vec<String>,
}

impl WorktreeCleanupPlan {
    pub(super) fn for_delete_targets(
        service: &AppService,
        repo_path: &str,
        target_tasks: &[&TaskCard],
    ) -> Result<Self> {
        let normalized_repo = normalize_path_for_comparison(repo_path);
        let mut paths = Vec::new();
        let mut seen_worktree_keys = HashSet::new();

        for target_task in target_tasks {
            let sessions = service.agent_sessions_list(repo_path, target_task.id.as_str())?;
            for session in sessions {
                let worktree_path = session.working_directory.trim();
                if !is_managed_worktree_session(&session, &normalized_repo, worktree_path) {
                    continue;
                }
                let worktree_key = normalize_path_key(worktree_path);
                if !seen_worktree_keys.insert(worktree_key) {
                    continue;
                }

                if Path::new(worktree_path).exists() {
                    paths.push(worktree_path.to_string());
                }
            }
        }

        Ok(Self { paths })
    }

    pub(super) fn for_task_sessions(
        service: &AppService,
        repo_path: &str,
        task_id: &str,
        branch_prefix: &str,
        sessions: &[AgentSessionDocument],
        require_existing_path: bool,
    ) -> Result<Self> {
        let mut paths = Vec::new();
        let mut seen_worktree_keys = HashSet::new();
        let normalized_repo = normalize_path_for_comparison(repo_path);
        let managed_worktree_base = resolve_effective_worktree_base_path(service, repo_path)?
            .map(|path| normalize_path_for_comparison(path.as_str()));

        let Some(managed_worktree_base) = managed_worktree_base else {
            return Ok(Self { paths });
        };
        let scope = ManagedTaskWorktreeScope {
            task_id,
            branch_prefix,
            normalized_repo: normalized_repo.as_path(),
            managed_worktree_base: managed_worktree_base.as_path(),
            require_existing_path,
        };

        for session in sessions {
            let worktree_path = session.working_directory.trim();
            if !is_managed_task_worktree_session(service, &scope, session, worktree_path)? {
                continue;
            }
            let worktree_key = normalize_path_key(worktree_path);
            if !seen_worktree_keys.insert(worktree_key) {
                continue;
            }

            paths.push(worktree_path.to_string());
        }

        Ok(Self { paths })
    }

    pub(super) fn paths(&self) -> &[String] {
        &self.paths
    }
}

#[derive(Clone, Debug, Default)]
pub(super) struct BranchCleanupPlan {
    names: Vec<String>,
}

impl BranchCleanupPlan {
    pub(super) fn for_task_ids(
        service: &AppService,
        repo_path: &Path,
        branch_prefix: &str,
        task_ids: &[String],
    ) -> Result<Self> {
        let names = service
            .git_port
            .get_branches(repo_path)?
            .into_iter()
            .filter(|branch| !branch.is_remote)
            .filter(|branch| {
                task_ids.iter().any(|task_id| {
                    is_related_task_branch(branch.name.as_str(), branch_prefix, task_id.as_str())
                })
            })
            .map(|branch| branch.name)
            .collect::<HashSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        Ok(Self { names })
    }

    pub(super) fn for_task(
        service: &AppService,
        repo_path: &Path,
        branch_prefix: &str,
        task_id: &str,
    ) -> Result<Self> {
        let names = collect_related_task_branches(service, repo_path, branch_prefix, task_id)?
            .into_iter()
            .collect::<Vec<_>>();
        Ok(Self { names })
    }

    pub(super) fn ensure_unused_by_worktrees(
        &self,
        service: &AppService,
        repo_path: &Path,
    ) -> Result<()> {
        ensure_related_branches_are_unused_by_worktrees(service, repo_path, &self.name_set())
    }

    pub(super) fn names(&self) -> &[String] {
        &self.names
    }

    fn name_set(&self) -> HashSet<String> {
        self.names.iter().cloned().collect()
    }
}

pub(super) fn collect_task_delete_targets<'a>(
    tasks: &'a [TaskCard],
    task_id: &str,
    delete_subtasks: bool,
) -> Vec<&'a TaskCard> {
    let mut target_ids = HashSet::from([task_id.to_string()]);
    if delete_subtasks {
        loop {
            let previous_len = target_ids.len();
            for task in tasks {
                if task
                    .parent_id
                    .as_deref()
                    .is_some_and(|parent_id| target_ids.contains(parent_id))
                {
                    target_ids.insert(task.id.clone());
                }
            }
            if target_ids.len() == previous_len {
                break;
            }
        }
    }

    tasks
        .iter()
        .filter(|task| target_ids.contains(task.id.as_str()))
        .collect()
}

pub(super) fn derive_reset_implementation_status(task: &TaskCard) -> TaskStatus {
    if task.document_summary.plan.has {
        return TaskStatus::ReadyForDev;
    }
    if task.document_summary.spec.has {
        return TaskStatus::SpecReady;
    }
    TaskStatus::Open
}

pub(super) fn ensure_task_reset_status_allowed(task: &TaskCard) -> Result<()> {
    if matches!(
        task.status,
        TaskStatus::InProgress | TaskStatus::AiReview | TaskStatus::HumanReview
    ) {
        return Ok(());
    }

    Err(anyhow!(
        "Implementation reset is only allowed from in_progress, ai_review, or human_review (current: {}).",
        task.status.as_cli_value()
    ))
}

pub(crate) fn normalize_path_for_comparison(path: &str) -> PathBuf {
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

pub(crate) fn normalize_path_key(path: &str) -> String {
    normalize_path_for_comparison(path)
        .to_string_lossy()
        .to_string()
}

pub(super) fn with_reset_cleanup_progress(
    error: anyhow::Error,
    removed_worktrees: &[String],
    deleted_branches: &[String],
) -> anyhow::Error {
    let mut progress = Vec::new();
    if !removed_worktrees.is_empty() {
        progress.push(format!(
            "Reset cleanup already removed worktrees: {}.",
            removed_worktrees.join(", ")
        ));
    }
    if !deleted_branches.is_empty() {
        progress.push(format!(
            "Reset cleanup already deleted branches: {}.",
            deleted_branches.join(", ")
        ));
    }
    if progress.is_empty() {
        return error;
    }

    progress.push("Retry reset to finish cleanup safely.".to_string());
    error.context(progress.join("\n"))
}

fn parse_runtime_kind(value: &str) -> Option<AgentRuntimeKind> {
    match value.trim() {
        "opencode" => Some(AgentRuntimeKind::Opencode),
        _ => None,
    }
}

fn runtime_route_endpoint(route: &RuntimeRoute) -> &str {
    match route {
        RuntimeRoute::LocalHttp { endpoint } => endpoint.as_str(),
    }
}

struct ManagedTaskWorktreeScope<'a> {
    task_id: &'a str,
    branch_prefix: &'a str,
    normalized_repo: &'a Path,
    managed_worktree_base: &'a Path,
    require_existing_path: bool,
}

fn is_managed_worktree_session(
    session: &AgentSessionDocument,
    normalized_repo: &Path,
    working_directory: &str,
) -> bool {
    matches!(session.role.as_str(), "build" | "qa")
        && !working_directory.is_empty()
        && normalize_path_for_comparison(working_directory) != normalized_repo
}

fn is_managed_task_worktree_session(
    service: &AppService,
    scope: &ManagedTaskWorktreeScope<'_>,
    session: &AgentSessionDocument,
    working_directory: &str,
) -> Result<bool> {
    if !matches!(session.role.as_str(), "build" | "qa") || working_directory.is_empty() {
        return Ok(false);
    }

    let normalized_worktree = normalize_path_for_comparison(working_directory);
    if normalized_worktree == scope.normalized_repo
        || !normalized_worktree.starts_with(scope.managed_worktree_base)
    {
        return Ok(false);
    }

    if scope.require_existing_path && !Path::new(working_directory).exists() {
        return Ok(false);
    }

    let current_branch = service
        .git_port
        .get_current_branch(Path::new(working_directory))
        .with_context(|| {
            format!("Failed to inspect implementation worktree branch for {working_directory}")
        })?;
    let branch_name = current_branch
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            anyhow!(
                "Cannot reset implementation for task {} because worktree {working_directory} is detached or has no active branch.",
                scope.task_id
            )
        })?;

    Ok(is_related_task_branch(
        branch_name,
        scope.branch_prefix,
        scope.task_id,
    ))
}

fn is_related_task_branch(branch_name: &str, branch_prefix: &str, task_id: &str) -> bool {
    let clean_prefix = if branch_prefix.trim().is_empty() {
        DEFAULT_BRANCH_PREFIX
    } else {
        branch_prefix.trim()
    };
    let task_prefix = format!("{clean_prefix}/{task_id}");
    branch_name == task_prefix || branch_name.starts_with(&format!("{task_prefix}-"))
}

fn collect_related_task_branches(
    service: &AppService,
    repo_path: &Path,
    branch_prefix: &str,
    task_id: &str,
) -> Result<HashSet<String>> {
    Ok(service
        .git_port
        .get_branches(repo_path)?
        .into_iter()
        .filter(|branch| !branch.is_remote)
        .filter(|branch| is_related_task_branch(branch.name.as_str(), branch_prefix, task_id))
        .map(|branch| branch.name)
        .collect())
}

fn resolve_effective_worktree_base_path(
    service: &AppService,
    repo_path: &str,
) -> Result<Option<String>> {
    let normalized_repo = normalize_path_for_comparison(repo_path);
    Ok(service
        .workspace_list()?
        .into_iter()
        .find(|workspace| normalize_path_for_comparison(workspace.path.as_str()) == normalized_repo)
        .and_then(|workspace| workspace.effective_worktree_base_path))
}

fn ensure_related_branches_are_unused_by_worktrees(
    service: &AppService,
    repo_path: &Path,
    related_local_branches: &HashSet<String>,
) -> Result<()> {
    let active_related_worktrees = service
        .git_port
        .list_worktrees(repo_path)?
        .into_iter()
        .filter_map(|worktree| to_active_related_worktree(related_local_branches, worktree))
        .collect::<Vec<_>>();

    if active_related_worktrees.is_empty() {
        return Ok(());
    }

    let joined = active_related_worktrees.join(", ");
    Err(anyhow!(
        "Cannot delete implementation branch while it is still checked out in worktree(s): {joined}. Switch those worktrees to another branch first."
    ))
}

fn to_active_related_worktree(
    related_local_branches: &HashSet<String>,
    worktree: GitWorktreeSummary,
) -> Option<String> {
    let branch_name = worktree.branch.trim();
    if branch_name.is_empty() || !related_local_branches.contains(branch_name) {
        return None;
    }

    let worktree_path = worktree.worktree_path.trim();
    if worktree_path.is_empty() {
        return Some(branch_name.to_string());
    }

    Some(format!("{branch_name} ({worktree_path})"))
}

fn is_live_build_run_for_task_reset(
    run: &crate::app_service::RunProcess,
    sessions: &[AgentSessionDocument],
    runtime_statuses_by_directory: &mut HashMap<String, OpencodeSessionStatusMap>,
) -> Result<bool> {
    let normalized_worktree = normalize_path_for_comparison(run.worktree_path.as_str());
    let external_session_ids = sessions
        .iter()
        .filter(|session| session.role.trim() == "build")
        .filter(|session| session.runtime_kind.trim() == run.summary.runtime_kind.as_str())
        .filter(|session| {
            normalize_path_for_comparison(session.working_directory.as_str()) == normalized_worktree
        })
        .filter_map(|session| {
            session
                .external_session_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .collect::<Vec<_>>();

    if external_session_ids.is_empty() {
        return Ok(true);
    }

    let directory_key = normalize_path_key(run.worktree_path.as_str());
    if !runtime_statuses_by_directory.contains_key(directory_key.as_str()) {
        let statuses = match run.summary.runtime_kind {
            host_domain::AgentRuntimeKind::Opencode => load_opencode_session_statuses(
                &run.summary.runtime_route,
                run.worktree_path.as_str(),
            )
            .or_else(|error| {
                if is_unreachable_opencode_session_status_error(&error) {
                    Ok(OpencodeSessionStatusMap::new())
                } else {
                    Err(error)
                }
            })?,
        };
        if statuses.is_empty() {
            return Ok(false);
        }
        runtime_statuses_by_directory.insert(directory_key.clone(), statuses);
    }

    let statuses = runtime_statuses_by_directory
        .get(directory_key.as_str())
        .ok_or_else(|| {
            anyhow!(
                "Missing cached OpenCode session statuses for {}",
                run.worktree_path
            )
        })?;
    Ok(external_session_ids
        .iter()
        .any(|external_session_id| has_live_opencode_session_status(statuses, external_session_id)))
}
