use crate::app_service::service_core::AppService;
use crate::app_service::workflow_rules::can_reset_implementation_from_status;
use anyhow::{anyhow, Context, Result};
use host_domain::{
    AgentSessionDocument, GitWorktreeSummary, TaskCard, TaskStatus, DEFAULT_BRANCH_PREFIX,
};
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Clone, Debug, Default)]
pub(super) struct WorktreeCleanupPlan {
    paths: Vec<String>,
}

impl WorktreeCleanupPlan {
    pub(super) fn for_delete_targets(
        service: &AppService,
        repo_path: &str,
        branch_prefix: &str,
        target_tasks: &[&TaskCard],
    ) -> Result<Self> {
        let mut paths = Vec::new();
        let mut seen_worktree_keys = HashSet::new();
        for target_task in target_tasks {
            let sessions = service.agent_sessions_list(repo_path, target_task.id.as_str())?;
            let task_worktree_plan = Self::for_task_sessions(
                service,
                repo_path,
                target_task.id.as_str(),
                branch_prefix,
                &sessions,
                "delete",
                true,
            )?;
            for worktree_path in task_worktree_plan.paths {
                let worktree_key = normalize_path_key(worktree_path.as_str());
                if seen_worktree_keys.insert(worktree_key) {
                    paths.push(worktree_path);
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
        operation_label: &'static str,
        skip_detached_head: bool,
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
            operation_label,
            skip_detached_head,
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
        let mut names = service
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
        names.sort_unstable();
        Ok(Self { names })
    }

    pub(super) fn for_task(
        service: &AppService,
        repo_path: &Path,
        branch_prefix: &str,
        task_id: &str,
    ) -> Result<Self> {
        let mut names = collect_related_task_branches(service, repo_path, branch_prefix, task_id)?
            .into_iter()
            .collect::<Vec<_>>();
        names.sort_unstable();
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
    if can_reset_implementation_from_status(&task.status) {
        return Ok(());
    }

    Err(anyhow!(
        "Implementation reset is only allowed from in_progress, blocked, ai_review, or human_review (current: {}).",
        task.status.as_cli_value()
    ))
}

pub(super) fn with_reset_cleanup_progress(
    error: anyhow::Error,
    removed_worktrees: &[String],
    deleted_branches: &[String],
) -> anyhow::Error {
    with_cleanup_progress(
        error,
        removed_worktrees,
        deleted_branches,
        "Reset cleanup",
        "Retry reset to finish cleanup safely.",
    )
}

pub(super) fn with_delete_cleanup_progress(
    error: anyhow::Error,
    removed_worktrees: &[String],
    deleted_branches: &[String],
) -> anyhow::Error {
    with_cleanup_progress(
        error,
        removed_worktrees,
        deleted_branches,
        "Delete cleanup",
        "Retry delete to finish cleanup safely.",
    )
}

fn with_cleanup_progress(
    error: anyhow::Error,
    removed_worktrees: &[String],
    deleted_branches: &[String],
    cleanup_label: &str,
    retry_instruction: &str,
) -> anyhow::Error {
    let mut progress = Vec::new();
    if !removed_worktrees.is_empty() {
        progress.push(format!(
            "{cleanup_label} already removed worktrees: {}.",
            removed_worktrees.join(", ")
        ));
    }
    if !deleted_branches.is_empty() {
        progress.push(format!(
            "{cleanup_label} already deleted branches: {}.",
            deleted_branches.join(", ")
        ));
    }
    if progress.is_empty() {
        return error;
    }

    progress.push(retry_instruction.to_string());
    error.context(progress.join("\n"))
}

pub(crate) fn normalize_path_for_comparison(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return PathBuf::new();
    }

    fs::canonicalize(trimmed).unwrap_or_else(|_| lexical_normalize_path(trimmed))
}

pub(crate) fn normalize_path_key(path: &str) -> String {
    normalize_path_for_comparison(path)
        .to_string_lossy()
        .to_string()
}

struct ManagedTaskWorktreeScope<'a> {
    task_id: &'a str,
    branch_prefix: &'a str,
    normalized_repo: &'a Path,
    managed_worktree_base: &'a Path,
    operation_label: &'static str,
    skip_detached_head: bool,
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

    if !Path::new(working_directory).exists() {
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
        .filter(|value| !value.is_empty());
    let Some(branch_name) = branch_name else {
        if scope.skip_detached_head {
            return Ok(false);
        }
        return Err(anyhow!(
            "Cannot {} task {} because worktree {working_directory} is detached or has no active branch.",
            scope.operation_label,
            scope.task_id
        ));
    };

    Ok(is_related_task_branch(
        branch_name,
        scope.branch_prefix,
        scope.task_id,
    ))
}

fn lexical_normalize_path(path: &str) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in PathBuf::from(path).components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }

    if normalized.as_os_str().is_empty() {
        PathBuf::from(path)
    } else {
        normalized
    }
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

#[cfg(test)]
mod tests {
    use super::normalize_path_for_comparison;
    use std::path::PathBuf;

    #[test]
    fn normalize_path_for_comparison_lexically_collapses_parent_dirs_when_missing() {
        let normalized = normalize_path_for_comparison("/tmp/openducktor-base/../outside");
        assert_eq!(normalized, PathBuf::from("/tmp/outside"));
    }
}
