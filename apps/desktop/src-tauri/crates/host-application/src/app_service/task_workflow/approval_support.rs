use anyhow::{anyhow, Result};
use host_domain::{
    now_rfc3339, DirectMergeRecord, GitConflict, GitConflictOperation, GitMergeMethod,
    GitTargetBranch, TaskApprovalContext, TaskStatus,
};

pub(super) fn ensure_human_approval_status(status: &TaskStatus) -> Result<()> {
    if matches!(status, TaskStatus::AiReview | TaskStatus::HumanReview) {
        return Ok(());
    }

    Err(anyhow!(
        "Human approval is only allowed from ai_review or human_review."
    ))
}

pub(super) fn is_terminal_task_status(status: &TaskStatus) -> bool {
    matches!(status, TaskStatus::Closed | TaskStatus::Deferred)
}

pub(super) fn ensure_pull_request_management_status(status: &TaskStatus) -> Result<()> {
    if matches!(
        status,
        TaskStatus::InProgress | TaskStatus::AiReview | TaskStatus::HumanReview
    ) {
        return Ok(());
    }

    Err(anyhow!(
        "Pull request management is only available from in_progress, ai_review, or human_review."
    ))
}

pub(super) fn is_syncable_pull_request_state(state: &str) -> bool {
    matches!(state, "open" | "draft")
}

pub(super) fn is_editable_pull_request_state(state: &str) -> bool {
    matches!(state, "open" | "draft")
}

pub(super) fn ensure_clean_builder_worktree(approval: &TaskApprovalContext) -> Result<()> {
    if !approval.has_uncommitted_changes {
        return Ok(());
    }

    let file_label = if approval.uncommitted_file_count == 1 {
        "1 uncommitted file"
    } else {
        return Err(anyhow!(
            "Human approval is blocked because the builder worktree has {} uncommitted files. Commit or discard them before merging or opening a pull request.",
            approval.uncommitted_file_count
        ));
    };

    Err(anyhow!(
        "Human approval is blocked because the builder worktree has {file_label}. Commit or discard it before merging or opening a pull request."
    ))
}

pub(super) fn direct_merge_conflict(
    repo_path: &str,
    approval: &TaskApprovalContext,
    method: &GitMergeMethod,
    conflicted_files: Vec<String>,
    output: String,
) -> GitConflict {
    let (operation, current_branch, working_dir) = match method {
        GitMergeMethod::MergeCommit => (
            GitConflictOperation::DirectMergeMergeCommit,
            Some(approval.target_branch.checkout_branch()),
            Some(repo_path.to_string()),
        ),
        GitMergeMethod::Squash => (
            GitConflictOperation::DirectMergeSquash,
            Some(approval.target_branch.checkout_branch()),
            Some(repo_path.to_string()),
        ),
        GitMergeMethod::Rebase => (
            GitConflictOperation::DirectMergeRebase,
            Some(approval.source_branch.clone()),
            approval.working_directory.clone(),
        ),
    };

    GitConflict {
        operation,
        current_branch,
        target_branch: approval.target_branch.canonical(),
        conflicted_files,
        output,
        working_dir,
    }
}

pub(super) fn to_domain_merge_method(method: host_infra_system::GitMergeMethod) -> GitMergeMethod {
    match method {
        host_infra_system::GitMergeMethod::MergeCommit => GitMergeMethod::MergeCommit,
        host_infra_system::GitMergeMethod::Squash => GitMergeMethod::Squash,
        host_infra_system::GitMergeMethod::Rebase => GitMergeMethod::Rebase,
    }
}

pub(super) fn normalize_approval_target_branch(
    target_branch: &host_infra_system::GitTargetBranch,
) -> Result<GitTargetBranch> {
    normalize_target_branch(
        target_branch.remote.as_deref(),
        target_branch.branch.as_str(),
    )
}

pub(super) fn normalize_recorded_target_branch(
    target_branch: &GitTargetBranch,
) -> Result<GitTargetBranch> {
    normalize_target_branch(
        target_branch.remote.as_deref(),
        target_branch.branch.as_str(),
    )
}

pub(super) fn publish_target_branch(
    target_branch: &host_infra_system::GitTargetBranch,
) -> Result<Option<GitTargetBranch>> {
    let normalized = normalize_approval_target_branch(target_branch)?;
    publish_target_from_normalized(normalized)
}

pub(super) fn publish_recorded_target_branch(
    target_branch: &GitTargetBranch,
) -> Result<Option<GitTargetBranch>> {
    let normalized = normalize_recorded_target_branch(target_branch)?;
    publish_target_from_normalized(normalized)
}

fn normalize_target_branch(remote: Option<&str>, branch: &str) -> Result<GitTargetBranch> {
    let branch = branch.trim();
    if branch.is_empty() {
        return Err(anyhow!("Human approval requires a target branch."));
    }
    if branch == "@{upstream}" {
        return Err(anyhow!(
            "Human approval requires an explicit target branch. '@{{upstream}}' is not supported for direct merge or pull requests."
        ));
    }
    Ok(GitTargetBranch {
        remote: remote.map(ToOwned::to_owned),
        branch: branch.to_string(),
    })
}

fn publish_target_from_normalized(normalized: GitTargetBranch) -> Result<Option<GitTargetBranch>> {
    if normalized.remote.is_some() {
        return Ok(Some(normalized));
    }
    Ok(None)
}

pub(super) fn direct_merge_record(
    method: GitMergeMethod,
    approval: &TaskApprovalContext,
) -> DirectMergeRecord {
    DirectMergeRecord {
        method,
        source_branch: approval.source_branch.clone(),
        target_branch: approval.target_branch.clone(),
        merged_at: now_rfc3339(),
    }
}
