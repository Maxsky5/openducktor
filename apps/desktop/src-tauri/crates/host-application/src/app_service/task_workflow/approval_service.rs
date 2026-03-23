use crate::app_service::git_provider::{github_provider, GitHostingProvider, ResolvedPullRequest};
use crate::app_service::service_core::AppService;
use anyhow::{anyhow, Result};
use host_domain::{
    now_rfc3339, DirectMergeRecord, GitConflict, GitConflictOperation, GitDiffScope,
    GitMergeBranchRequest, GitMergeBranchResult, GitMergeMethod, GitProviderAvailability,
    GitProviderRepository, GitTargetBranch, PullRequestRecord, TaskApprovalContext, TaskCard,
    TaskDirectMergeResult, TaskPullRequestDetectResult, TaskStatus,
};
use std::path::Path;

impl AppService {
    pub fn task_approval_context_get(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<TaskApprovalContext> {
        let context = self.load_task_context(repo_path, task_id)?;
        ensure_human_approval_status(&context.task.status)?;
        let repo_config = self.workspace_get_repo_config(context.repo.repo_path.as_str())?;
        let metadata = self.task_metadata_get(context.repo.repo_path.as_str(), task_id)?;
        let config = self.config_store.load()?;

        if let Some(direct_merge) = metadata
            .direct_merge
            .clone()
            .filter(|_| !is_terminal_task_status(&context.task.status))
        {
            let target_branch = normalize_recorded_target_branch(&direct_merge.target_branch)?;
            let publish_target = publish_recorded_target_branch(&direct_merge.target_branch)?;
            let working_directory = latest_builder_cleanup_target(
                self,
                context.repo.repo_path.as_str(),
                task_id,
                Some(direct_merge.source_branch.as_str()),
            )?
            .and_then(|target| {
                Path::new(target.working_directory.as_str())
                    .exists()
                    .then_some(target.working_directory)
            });

            return Ok(TaskApprovalContext {
                task_id: task_id.to_string(),
                task_status: context.task.status.as_cli_value().to_string(),
                working_directory,
                source_branch: direct_merge.source_branch.clone(),
                target_branch,
                publish_target,
                default_merge_method: to_domain_merge_method(config.git.default_merge_method),
                has_uncommitted_changes: false,
                uncommitted_file_count: 0,
                pull_request: metadata.pull_request,
                direct_merge: Some(direct_merge),
                suggested_squash_commit_message: None,
                providers: vec![github_provider_availability(
                    Path::new(&context.repo.repo_path),
                    &repo_config,
                )],
            });
        }

        let mut approval = self.load_open_task_approval_context(repo_path, task_id)?;
        approval.suggested_squash_commit_message = self.git_port.suggested_squash_commit_message(
            Path::new(&context.repo.repo_path),
            approval.source_branch.as_str(),
            approval.target_branch.canonical().as_str(),
        )?;
        Ok(approval)
    }

    pub fn task_direct_merge(
        &self,
        repo_path: &str,
        task_id: &str,
        method: GitMergeMethod,
        squash_commit_message: Option<String>,
    ) -> Result<TaskDirectMergeResult> {
        let metadata = self.task_metadata_get(repo_path, task_id)?;
        if metadata.direct_merge.is_some() {
            return Err(anyhow!(
                "A local direct merge is already recorded for task {task_id}. Finish the direct merge workflow before trying again."
            ));
        }
        let approval = self.load_open_task_approval_context(repo_path, task_id)?;
        ensure_clean_builder_worktree(&approval)?;
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        let squash_created_commit = match self.git_port.merge_branch(
            Path::new(&repo_path),
            GitMergeBranchRequest {
                source_branch: approval.source_branch.clone(),
                target_branch: approval.target_branch.canonical(),
                source_working_directory: approval.working_directory.clone(),
                method: method.clone(),
                squash_commit_message,
            },
        )? {
            GitMergeBranchResult::Merged { .. } => matches!(method, GitMergeMethod::Squash),
            GitMergeBranchResult::UpToDate { .. } => false,
            GitMergeBranchResult::Conflicts {
                conflicted_files,
                output,
            } => {
                return Ok(TaskDirectMergeResult::Conflicts {
                    conflict: direct_merge_conflict(
                        repo_path.as_str(),
                        &approval,
                        &method,
                        conflicted_files,
                        output,
                    ),
                });
            }
        };

        self.task_store
            .set_pull_request(Path::new(&repo_path), task_id, None)?;
        self.task_store.set_direct_merge_record(
            Path::new(&repo_path),
            task_id,
            Some(DirectMergeRecord {
                method,
                source_branch: approval.source_branch.clone(),
                target_branch: approval.target_branch.clone(),
                merged_at: now_rfc3339(),
            }),
        )?;

        if approval.publish_target.is_some() {
            let current_task = self.load_task_context(repo_path.as_str(), task_id)?.task;
            if current_task.status == TaskStatus::AiReview {
                return self
                    .task_transition(
                        repo_path.as_str(),
                        task_id,
                        TaskStatus::HumanReview,
                        Some("Local direct merge applied"),
                    )
                    .map(|task| TaskDirectMergeResult::Completed {
                        task: Box::new(task),
                    });
            }
            return Ok(TaskDirectMergeResult::Completed {
                task: Box::new(current_task),
            });
        }

        let task = self.task_transition(
            repo_path.as_str(),
            task_id,
            TaskStatus::Closed,
            Some("Human approved via direct merge"),
        )?;
        self.finalize_direct_merge_cleanup(
            repo_path.as_str(),
            task_id,
            approval.source_branch.as_str(),
            squash_created_commit,
        )?;
        Ok(TaskDirectMergeResult::Completed {
            task: Box::new(task),
        })
    }

    pub fn task_direct_merge_complete(&self, repo_path: &str, task_id: &str) -> Result<TaskCard> {
        let context = self.load_task_context(repo_path, task_id)?;
        let direct_merge = self
            .task_metadata_get(context.repo.repo_path.as_str(), task_id)?
            .direct_merge
            .ok_or_else(|| {
                anyhow!("Task {task_id} does not have a locally applied direct merge to complete.")
            })?;
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        self.ensure_direct_merge_publish_completed(repo_path.as_str(), task_id, &direct_merge)?;

        let task = if context.task.status == TaskStatus::Closed {
            context.task
        } else {
            self.task_transition(
                repo_path.as_str(),
                task_id,
                TaskStatus::Closed,
                Some("Human approved via direct merge"),
            )?
        };
        let force_delete_source_branch =
            self.should_force_delete_source_branch(repo_path.as_str(), &direct_merge)?;

        self.finalize_direct_merge_cleanup(
            repo_path.as_str(),
            task_id,
            direct_merge.source_branch.as_str(),
            force_delete_source_branch,
        )?;
        Ok(task)
    }

    fn ensure_direct_merge_publish_completed(
        &self,
        repo_path: &str,
        task_id: &str,
        direct_merge: &DirectMergeRecord,
    ) -> Result<()> {
        let Some(publish_target) = direct_merge.publish_target() else {
            return Ok(());
        };

        let current_branch = self.git_port.get_current_branch(Path::new(repo_path))?;
        let current_branch_name = current_branch
            .name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .ok_or_else(|| {
                anyhow!(
                    "Cannot finish the direct merge for task {task_id} because the target branch checkout is not active."
                )
            })?;
        let expected_branch = publish_target.checkout_branch();
        if current_branch_name != expected_branch {
            return Err(anyhow!(
                "Cannot finish the direct merge for task {task_id} until branch {} is checked out locally.",
                expected_branch
            ));
        }

        let publish_target_ref = publish_target.canonical();
        let publish_sync = self
            .git_port
            .commits_ahead_behind(Path::new(repo_path), publish_target_ref.as_str())?;
        if publish_sync.ahead != 0 || publish_sync.behind != 0 {
            return Err(anyhow!(
                "Cannot finish the direct merge for task {task_id} until {} is fully published and synchronized.",
                publish_target_ref
            ));
        }

        Ok(())
    }

    pub fn task_pull_request_upsert(
        &self,
        repo_path: &str,
        task_id: &str,
        title: &str,
        body: &str,
    ) -> Result<PullRequestRecord> {
        let metadata = self.task_metadata_get(repo_path, task_id)?;
        if metadata.direct_merge.is_some() {
            return Err(anyhow!(
                "A local direct merge is already recorded for task {task_id}. Finish or discard that direct merge workflow before opening a pull request."
            ));
        }
        let approval = self.load_open_task_approval_context(repo_path, task_id)?;
        ensure_clean_builder_worktree(&approval)?;
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        let provider = github_provider();
        let repository = self.github_pull_request_repository(repo_path.as_str())?;
        let remote_name = provider.resolve_remote_name(Path::new(&repo_path), &repository)?;
        match self.git_push_branch(
            repo_path.as_str(),
            approval.working_directory.as_deref(),
            Some(remote_name.as_str()),
            approval.source_branch.as_str(),
            true,
            false,
        )? {
            host_domain::GitPushResult::Pushed { .. } => {}
            host_domain::GitPushResult::RejectedNonFastForward { output, .. } => {
                return Err(anyhow!(
                    "Failed to push the builder branch before creating the pull request: {output}"
                ));
            }
        }

        let pull_request = match approval.pull_request {
            Some(existing)
                if existing.provider_id == "github"
                    && is_editable_pull_request_state(existing.state.as_str()) =>
            {
                provider.update_pull_request(
                    Path::new(&repo_path),
                    &repository,
                    existing.number,
                    title.trim(),
                    body,
                )?
            }
            _ => provider.create_pull_request(
                Path::new(&repo_path),
                &repository,
                approval.source_branch.as_str(),
                approval.target_branch.checkout_branch().as_str(),
                title.trim(),
                body,
            )?,
        };

        self.task_store
            .set_direct_merge_record(Path::new(&repo_path), task_id, None)?;
        self.task_store.set_pull_request(
            Path::new(&repo_path),
            task_id,
            Some(pull_request.record.clone()),
        )?;

        Ok(pull_request.record)
    }

    fn load_open_task_approval_context(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<TaskApprovalContext> {
        let context = self.load_task_context(repo_path, task_id)?;
        ensure_human_approval_status(&context.task.status)?;
        let repo_config = self.workspace_get_repo_config(context.repo.repo_path.as_str())?;
        let metadata = self.task_metadata_get(context.repo.repo_path.as_str(), task_id)?;
        let config = self.config_store.load()?;
        let target_branch = normalize_approval_target_branch(&repo_config.default_target_branch)?;
        let publish_target = publish_target_branch(&repo_config.default_target_branch)?;
        let working_directory = self
            .build_continuation_target_get(context.repo.repo_path.as_str(), task_id)?
            .working_directory;
        let current_branch = self
            .git_port
            .get_current_branch(Path::new(&working_directory))?;
        if current_branch.detached {
            return Err(anyhow!(
                "Human approval requires a builder branch, but the latest builder workspace is detached."
            ));
        }
        let source_branch = current_branch
            .name
            .ok_or_else(|| anyhow!("Human approval requires a builder branch name."))?;
        let worktree_status = self.git_port.get_worktree_status_summary(
            Path::new(&working_directory),
            target_branch.canonical().as_str(),
            GitDiffScope::Uncommitted,
        )?;

        Ok(TaskApprovalContext {
            task_id: task_id.to_string(),
            task_status: context.task.status.as_cli_value().to_string(),
            working_directory: Some(working_directory),
            source_branch,
            target_branch,
            publish_target,
            default_merge_method: to_domain_merge_method(config.git.default_merge_method),
            has_uncommitted_changes: worktree_status.file_status_counts.total > 0,
            uncommitted_file_count: worktree_status.file_status_counts.total,
            pull_request: metadata.pull_request,
            direct_merge: None,
            suggested_squash_commit_message: None,
            providers: vec![github_provider_availability(
                Path::new(&context.repo.repo_path),
                &repo_config,
            )],
        })
    }

    fn should_force_delete_source_branch(
        &self,
        repo_path: &str,
        direct_merge: &DirectMergeRecord,
    ) -> Result<bool> {
        if !matches!(direct_merge.method, GitMergeMethod::Squash) {
            return Ok(false);
        }

        let source_branch_exists = self
            .git_port
            .get_branches(Path::new(repo_path))?
            .into_iter()
            .any(|branch| !branch.is_remote && branch.name == direct_merge.source_branch);
        if !source_branch_exists {
            return Ok(false);
        }

        let target_branch = direct_merge.target_branch.checkout_branch();
        Ok(!self.git_port.is_ancestor(
            Path::new(repo_path),
            direct_merge.source_branch.as_str(),
            target_branch.as_str(),
        )?)
    }

    pub fn task_pull_request_unlink(&self, repo_path: &str, task_id: &str) -> Result<bool> {
        let context = self.load_task_context(repo_path, task_id)?;
        ensure_pull_request_management_status(&context.task.status)?;
        if self
            .task_metadata_get(context.repo.repo_path.as_str(), task_id)?
            .pull_request
            .is_none()
        {
            return Err(anyhow!(
                "Task {task_id} does not have a linked pull request."
            ));
        }
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        self.task_store
            .set_pull_request(Path::new(&repo_path), task_id, None)?;
        Ok(true)
    }

    pub fn task_pull_request_detect(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<TaskPullRequestDetectResult> {
        let context = self.load_task_context(repo_path, task_id)?;
        ensure_pull_request_management_status(&context.task.status)?;
        let metadata = self.task_metadata_get(context.repo.repo_path.as_str(), task_id)?;
        if metadata.pull_request.is_some() {
            return Err(anyhow!("Task {task_id} already has a linked pull request."));
        }
        if metadata.direct_merge.is_some() {
            return Err(anyhow!(
                "A local direct merge is already recorded for task {task_id}. Finish the direct merge workflow before linking a merged pull request."
            ));
        }
        let repo_config = self.workspace_get_repo_config(context.repo.repo_path.as_str())?;
        let working_directory = self
            .build_continuation_target_get(context.repo.repo_path.as_str(), task_id)?
            .working_directory;
        let current_branch = self
            .git_port
            .get_current_branch(Path::new(&working_directory))?;
        if current_branch.detached {
            return Err(anyhow!(
                "Pull request detection requires a builder branch, but the latest builder workspace is detached."
            ));
        }
        let source_branch = current_branch
            .name
            .ok_or_else(|| anyhow!("Pull request detection requires a builder branch name."))?;
        let target_branch =
            normalize_approval_target_branch(&repo_config.default_target_branch)?.checkout_branch();
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        let provider = github_provider();
        let repository = self.github_pull_request_repository(repo_path.as_str())?;
        let _remote_name = provider.resolve_remote_name(Path::new(&repo_path), &repository)?;
        let pull_request = provider.find_open_pull_request_for_branch(
            Path::new(&repo_path),
            &repository,
            source_branch.as_str(),
        )?;

        if let Some(pull_request) = pull_request {
            let record =
                self.store_linked_pull_request_metadata(repo_path.as_str(), task_id, pull_request)?;
            return Ok(TaskPullRequestDetectResult::Linked {
                pull_request: record,
            });
        }

        let pull_request = provider.find_pull_request_for_branch(
            Path::new(&repo_path),
            &repository,
            source_branch.as_str(),
        )?;

        let Some(pull_request) = pull_request else {
            return Ok(TaskPullRequestDetectResult::NotFound {
                source_branch,
                target_branch,
            });
        };

        if pull_request.record.state == "merged" {
            return Ok(TaskPullRequestDetectResult::Merged {
                pull_request: pull_request.record,
            });
        }

        Ok(TaskPullRequestDetectResult::NotFound {
            source_branch,
            target_branch,
        })
    }

    pub fn task_pull_request_link_merged(
        &self,
        repo_path: &str,
        task_id: &str,
        pull_request: PullRequestRecord,
    ) -> Result<TaskCard> {
        let context = self.load_task_context(repo_path, task_id)?;
        let metadata = self.task_metadata_get(context.repo.repo_path.as_str(), task_id)?;
        let same_existing_pull_request = metadata.pull_request.as_ref().is_some_and(|existing| {
            existing.provider_id == pull_request.provider_id
                && existing.number == pull_request.number
                && existing.state == "merged"
        });
        if context.task.status != TaskStatus::Closed || !same_existing_pull_request {
            ensure_pull_request_management_status(&context.task.status)?;
        }
        if metadata.direct_merge.is_some() {
            return Err(anyhow!(
                "A local direct merge is already recorded for task {task_id}. Finish the direct merge workflow before linking a merged pull request."
            ));
        }
        if pull_request.state != "merged" {
            return Err(anyhow!(
                "Task {task_id} can only link a merged pull request from detection results."
            ));
        }
        if metadata.pull_request.is_some() && !same_existing_pull_request {
            return Err(anyhow!("Task {task_id} already has a linked pull request."));
        }

        let repo_path = self.resolve_task_repo_path(repo_path)?;
        let working_directory = self
            .build_continuation_target_get(context.repo.repo_path.as_str(), task_id)?
            .working_directory;
        let current_branch = self
            .git_port
            .get_current_branch(Path::new(&working_directory))?;
        if current_branch.detached {
            return Err(anyhow!(
                "Pull request linking requires a builder branch, but the latest builder workspace is detached."
            ));
        }
        let source_branch = current_branch
            .name
            .ok_or_else(|| anyhow!("Pull request linking requires a builder branch name."))?;

        if metadata.pull_request.is_none() {
            self.store_linked_pull_request_metadata(
                repo_path.as_str(),
                task_id,
                ResolvedPullRequest {
                    record: pull_request,
                    source_branch: source_branch.clone(),
                },
            )?;
        }
        let task = if context.task.status == TaskStatus::Closed {
            context.task
        } else {
            self.task_transition(
                repo_path.as_str(),
                task_id,
                TaskStatus::Closed,
                Some("Linked pull request merged"),
            )?
        };
        self.finalize_direct_merge_cleanup(
            repo_path.as_str(),
            task_id,
            source_branch.as_str(),
            false,
        )?;
        Ok(task)
    }

    pub fn repo_pull_request_sync(&self, repo_path: &str) -> Result<bool> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        let tasks = self.task_store.list_tasks(Path::new(&repo_path))?;
        let provider = github_provider();
        if !provider.is_available() {
            return Ok(false);
        }
        let github_repository =
            github_repository_from_config(&self.workspace_get_repo_config(repo_path.as_str())?);

        for task in tasks {
            if is_terminal_task_status(&task.status) {
                continue;
            }
            let Some(pull_request) = self
                .task_metadata_get(repo_path.as_str(), task.id.as_str())?
                .pull_request
            else {
                continue;
            };
            if pull_request.provider_id != "github" {
                continue;
            }
            if !is_syncable_pull_request_state(pull_request.state.as_str()) {
                continue;
            };

            let Some(repository) = github_repository.as_ref() else {
                continue;
            };
            let updated = provider.fetch_pull_request(
                Path::new(&repo_path),
                repository,
                pull_request.number,
            )?;
            self.task_store.set_pull_request(
                Path::new(&repo_path),
                task.id.as_str(),
                Some(updated.record.clone()),
            )?;

            if updated.record.state == "merged" && task.status != TaskStatus::Closed {
                let _ = self.task_transition(
                    repo_path.as_str(),
                    task.id.as_str(),
                    TaskStatus::Closed,
                    Some("Linked pull request merged"),
                )?;
                self.finalize_direct_merge_cleanup(
                    repo_path.as_str(),
                    task.id.as_str(),
                    updated.source_branch.as_str(),
                    false,
                )?;
            }
        }

        Ok(true)
    }

    pub fn auto_detect_git_provider_for_repo(&self, repo_path: &str) -> Result<()> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        let mut repo_config = self
            .workspace_get_repo_config_optional(repo_path.as_str())?
            .unwrap_or_default();
        let existing = repo_config
            .git
            .providers
            .get("github")
            .cloned()
            .unwrap_or_default();
        if existing.repository.is_some() {
            return Ok(());
        }

        let provider = github_provider();
        let detected = provider.detect_repository(Path::new(&repo_path))?;
        if let Some(repository) = detected {
            repo_config.git.providers.insert(
                "github".to_string(),
                host_infra_system::GitProviderConfig {
                    enabled: true,
                    repository: Some(to_config_repository(&repository)),
                    auto_detected: true,
                },
            );
            let _ = self.workspace_update_repo_config(repo_path.as_str(), repo_config)?;
        }

        Ok(())
    }

    pub fn workspace_detect_github_repository(
        &self,
        repo_path: &str,
    ) -> Result<Option<host_infra_system::GitProviderRepository>> {
        let repo_path = self.resolve_authorized_repo_path(repo_path)?;
        let provider = github_provider();
        let detected = provider.detect_repository(Path::new(&repo_path))?;
        Ok(detected.map(|repository| to_config_repository(&repository)))
    }

    fn cleanup_builder_branch(
        &self,
        repo_path: &str,
        source_branch: &str,
        force_delete: bool,
    ) -> Result<()> {
        let branch_exists = self
            .git_port
            .get_branches(Path::new(repo_path))?
            .into_iter()
            .any(|branch| !branch.is_remote && branch.name == source_branch);
        if branch_exists {
            let _ = self.git_delete_local_branch(repo_path, source_branch, force_delete)?;
        }

        Ok(())
    }

    fn finalize_direct_merge_cleanup(
        &self,
        repo_path: &str,
        task_id: &str,
        source_branch: &str,
        force_delete_source_branch: bool,
    ) -> Result<()> {
        self.stop_dev_servers_for_task(repo_path, task_id)?;

        if let Some(cleanup_target) =
            latest_builder_cleanup_target(self, repo_path, task_id, Some(source_branch))?
        {
            let normalized_repo = std::fs::canonicalize(repo_path)
                .unwrap_or_else(|_| Path::new(repo_path).to_path_buf());
            let normalized_working_directory =
                std::fs::canonicalize(&cleanup_target.working_directory)
                    .unwrap_or_else(|_| Path::new(&cleanup_target.working_directory).to_path_buf());

            if normalized_repo != normalized_working_directory
                && Path::new(cleanup_target.working_directory.as_str()).exists()
            {
                let _ = self.git_remove_worktree(
                    repo_path,
                    cleanup_target.working_directory.as_str(),
                    false,
                )?;
            }
        }

        self.cleanup_builder_branch(repo_path, source_branch, force_delete_source_branch)
    }

    fn github_pull_request_repository(&self, repo_path: &str) -> Result<GitProviderRepository> {
        let repo_config = self.workspace_get_repo_config(repo_path)?;
        let provider = github_provider();
        if !provider.is_available() {
            return Err(anyhow!(
                "GitHub pull request support requires the gh CLI to be installed."
            ));
        }

        let github_config = repo_config
            .git
            .providers
            .get("github")
            .cloned()
            .unwrap_or_default();
        if !github_config.enabled {
            return Err(anyhow!(
                "GitHub pull request support is not enabled for this repository."
            ));
        }

        let repository = github_repository_from_config(&repo_config).ok_or_else(|| {
            anyhow!("GitHub pull request support requires repository coordinates.")
        })?;
        let auth_status = provider.auth_status(repository.host.as_str())?;
        if !auth_status.authenticated {
            return Err(anyhow!(
                "{}",
                auth_status.error.unwrap_or_else(|| {
                    "GitHub authentication is not configured. Run `gh auth login`.".to_string()
                })
            ));
        }

        Ok(repository)
    }

    fn store_linked_pull_request_metadata(
        &self,
        repo_path: &str,
        task_id: &str,
        pull_request: ResolvedPullRequest,
    ) -> Result<PullRequestRecord> {
        self.task_store
            .set_direct_merge_record(Path::new(repo_path), task_id, None)?;
        self.task_store.set_pull_request(
            Path::new(repo_path),
            task_id,
            Some(pull_request.record.clone()),
        )?;

        Ok(pull_request.record)
    }
}

fn ensure_human_approval_status(status: &TaskStatus) -> Result<()> {
    if matches!(status, TaskStatus::AiReview | TaskStatus::HumanReview) {
        return Ok(());
    }

    Err(anyhow!(
        "Human approval is only allowed from ai_review or human_review."
    ))
}

fn is_terminal_task_status(status: &TaskStatus) -> bool {
    matches!(status, TaskStatus::Closed | TaskStatus::Deferred)
}

fn ensure_pull_request_management_status(status: &TaskStatus) -> Result<()> {
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

fn is_syncable_pull_request_state(state: &str) -> bool {
    matches!(state, "open" | "draft")
}

fn is_editable_pull_request_state(state: &str) -> bool {
    matches!(state, "open" | "draft")
}

fn ensure_clean_builder_worktree(approval: &TaskApprovalContext) -> Result<()> {
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

fn direct_merge_conflict(
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

fn github_provider_availability(
    repo_path: &Path,
    repo_config: &host_infra_system::RepoConfig,
) -> GitProviderAvailability {
    let provider = github_provider();
    let config = repo_config
        .git
        .providers
        .get("github")
        .cloned()
        .unwrap_or_default();
    if !config.enabled {
        return GitProviderAvailability {
            provider_id: "github".to_string(),
            enabled: false,
            available: false,
            reason: Some("GitHub provider is not enabled for this repository.".to_string()),
        };
    }
    if !provider.is_available() {
        return GitProviderAvailability {
            provider_id: "github".to_string(),
            enabled: true,
            available: false,
            reason: Some("gh CLI is not installed.".to_string()),
        };
    }
    let repository = match config.repository.as_ref() {
        Some(repository) => repository,
        None => {
            return GitProviderAvailability {
                provider_id: "github".to_string(),
                enabled: true,
                available: false,
                reason: Some("GitHub repository coordinates are missing.".to_string()),
            };
        }
    };
    let auth_status = match provider.auth_status(repository.host.as_str()) {
        Ok(status) => status,
        Err(error) => {
            return GitProviderAvailability {
                provider_id: "github".to_string(),
                enabled: true,
                available: false,
                reason: Some(format!("Failed to check GitHub authentication: {error}")),
            };
        }
    };
    if !auth_status.authenticated {
        return GitProviderAvailability {
            provider_id: "github".to_string(),
            enabled: true,
            available: false,
            reason: Some(auth_status.error.unwrap_or_else(|| {
                "GitHub authentication is not configured. Run `gh auth login`.".to_string()
            })),
        };
    }
    let repository = to_provider_repository(repository);
    if let Err(error) = provider.resolve_remote_name(repo_path, &repository) {
        return GitProviderAvailability {
            provider_id: "github".to_string(),
            enabled: true,
            available: false,
            reason: Some(format!(
                "No matching Git remote is configured for {}/{} on {}: {error}",
                repository.owner, repository.name, repository.host
            )),
        };
    }
    GitProviderAvailability {
        provider_id: "github".to_string(),
        enabled: true,
        available: true,
        reason: None,
    }
}

fn to_provider_repository(
    repository: &host_infra_system::GitProviderRepository,
) -> host_domain::GitProviderRepository {
    host_domain::GitProviderRepository {
        host: repository.host.clone(),
        owner: repository.owner.clone(),
        name: repository.name.clone(),
    }
}

fn github_repository_from_config(
    repo_config: &host_infra_system::RepoConfig,
) -> Option<GitProviderRepository> {
    repo_config
        .git
        .providers
        .get("github")
        .and_then(|config| config.repository.as_ref())
        .map(to_provider_repository)
}

fn to_config_repository(
    repository: &host_domain::GitProviderRepository,
) -> host_infra_system::GitProviderRepository {
    host_infra_system::GitProviderRepository {
        host: repository.host.clone(),
        owner: repository.owner.clone(),
        name: repository.name.clone(),
    }
}

fn to_domain_merge_method(method: host_infra_system::GitMergeMethod) -> GitMergeMethod {
    match method {
        host_infra_system::GitMergeMethod::MergeCommit => GitMergeMethod::MergeCommit,
        host_infra_system::GitMergeMethod::Squash => GitMergeMethod::Squash,
        host_infra_system::GitMergeMethod::Rebase => GitMergeMethod::Rebase,
    }
}

fn normalize_approval_target_branch(
    target_branch: &host_infra_system::GitTargetBranch,
) -> Result<GitTargetBranch> {
    normalize_target_branch(
        target_branch.remote.as_deref(),
        target_branch.branch.as_str(),
    )
}

fn normalize_recorded_target_branch(target_branch: &GitTargetBranch) -> Result<GitTargetBranch> {
    normalize_target_branch(
        target_branch.remote.as_deref(),
        target_branch.branch.as_str(),
    )
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

fn publish_target_branch(
    target_branch: &host_infra_system::GitTargetBranch,
) -> Result<Option<GitTargetBranch>> {
    let normalized = normalize_approval_target_branch(target_branch)?;
    publish_target_from_normalized(normalized)
}

fn publish_recorded_target_branch(
    target_branch: &GitTargetBranch,
) -> Result<Option<GitTargetBranch>> {
    let normalized = normalize_recorded_target_branch(target_branch)?;
    publish_target_from_normalized(normalized)
}

fn publish_target_from_normalized(normalized: GitTargetBranch) -> Result<Option<GitTargetBranch>> {
    if normalized.remote.is_some() {
        return Ok(Some(normalized));
    }
    Ok(None)
}

struct BuilderCleanupTarget {
    working_directory: String,
}

fn latest_builder_cleanup_target(
    service: &AppService,
    repo_path: &str,
    task_id: &str,
    preferred_source_branch: Option<&str>,
) -> Result<Option<BuilderCleanupTarget>> {
    let sessions = service.agent_sessions_list(repo_path, task_id)?;
    let mut builder_sessions = sessions
        .into_iter()
        .filter(|session| session.role == "build")
        .collect::<Vec<_>>();
    builder_sessions.sort_by(|left, right| {
        let left_key = left.started_at.as_str();
        let right_key = right.started_at.as_str();
        left_key
            .cmp(right_key)
            .then_with(|| left.started_at.cmp(&right.started_at))
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
        let current_branch = service
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
