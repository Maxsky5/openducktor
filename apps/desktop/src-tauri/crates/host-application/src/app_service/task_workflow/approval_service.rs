use super::approval_context_service::ApprovalContextService;
use super::direct_merge_workflow_service::DirectMergeWorkflowService;
use super::pull_request_provider_service::PullRequestProviderService;
use super::pull_request_sync_service::PullRequestSyncService;
use super::pull_request_workflow_service::PullRequestWorkflowService;
use crate::app_service::service_core::AppService;
use anyhow::Result;
use host_domain::{
    GitMergeMethod, PullRequestRecord, TaskApprovalContext, TaskCard, TaskDirectMergeResult,
    TaskPullRequestDetectResult,
};

impl AppService {
    pub fn task_approval_context_get(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<TaskApprovalContext> {
        ApprovalContextService::new(self).task_approval_context_get(repo_path, task_id)
    }

    pub fn task_direct_merge(
        &self,
        repo_path: &str,
        task_id: &str,
        method: GitMergeMethod,
        squash_commit_message: Option<String>,
    ) -> Result<TaskDirectMergeResult> {
        DirectMergeWorkflowService::new(self).task_direct_merge(
            repo_path,
            task_id,
            method,
            squash_commit_message,
        )
    }

    pub fn task_direct_merge_complete(&self, repo_path: &str, task_id: &str) -> Result<TaskCard> {
        DirectMergeWorkflowService::new(self).task_direct_merge_complete(repo_path, task_id)
    }

    pub fn task_pull_request_upsert(
        &self,
        repo_path: &str,
        task_id: &str,
        title: &str,
        body: &str,
    ) -> Result<PullRequestRecord> {
        PullRequestWorkflowService::new(self)
            .task_pull_request_upsert(repo_path, task_id, title, body)
    }

    pub fn task_pull_request_unlink(&self, repo_path: &str, task_id: &str) -> Result<bool> {
        PullRequestWorkflowService::new(self).task_pull_request_unlink(repo_path, task_id)
    }

    pub fn task_pull_request_detect(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<TaskPullRequestDetectResult> {
        PullRequestWorkflowService::new(self).task_pull_request_detect(repo_path, task_id)
    }

    pub fn task_pull_request_link_merged(
        &self,
        repo_path: &str,
        task_id: &str,
        pull_request: PullRequestRecord,
    ) -> Result<TaskCard> {
        PullRequestWorkflowService::new(self).task_pull_request_link_merged(
            repo_path,
            task_id,
            pull_request,
        )
    }

    pub fn repo_pull_request_sync(&self, repo_path: &str) -> Result<bool> {
        PullRequestSyncService::new(self).repo_pull_request_sync(repo_path)
    }

    pub fn auto_detect_git_provider_for_repo(&self, repo_path: &str) -> Result<()> {
        PullRequestProviderService::new(self).auto_detect_git_provider_for_repo(repo_path)
    }

    pub fn workspace_detect_github_repository(
        &self,
        repo_path: &str,
    ) -> Result<Option<host_infra_system::GitProviderRepository>> {
        PullRequestProviderService::new(self).workspace_detect_github_repository(repo_path)
    }
}
