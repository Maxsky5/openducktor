use anyhow::{anyhow, Context, Result};
use host_domain::{
    now_rfc3339, AgentSessionDocument, CreateTaskInput, DirectMergeRecord, PullRequestRecord,
    QaReportDocument, QaVerdict, QaWorkflowVerdict, SpecDocument, TaskCard, TaskMetadata,
    TaskStatus, TaskStore, UpdateTaskPatch, ODT_QA_APPROVED_SOURCE_TOOL,
    ODT_QA_REJECTED_SOURCE_TOOL, ODT_SET_PLAN_SOURCE_TOOL, ODT_SET_SPEC_SOURCE_TOOL,
};
use host_infra_system::AppConfigStore;
use serde_json::Value;
use std::collections::HashMap;
use std::fmt;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::command_runner::{CommandRunner, ProcessCommandRunner};
use crate::constants::{
    DEFAULT_METADATA_NAMESPACE, PULL_REQUEST_SYNC_CANDIDATE_CACHE_TTL_MS, TASK_LIST_CACHE_TTL_MS,
};
use crate::lifecycle::BeadsLifecycle;
use crate::metadata::{metadata_namespace, parse_agent_sessions, parse_metadata_root};
use crate::model::{MarkdownEntry, QaEntry, RawIssue};
use crate::normalize::{normalize_labels, normalize_text_option};

mod cache;
mod doc_ops;
mod namespace;
mod session_ops;
mod task_ops;

use cache::{KanbanTaskListCacheState, PullRequestSyncCandidateCacheState, TaskListCacheState};

pub struct BeadsTaskStore {
    pub(crate) metadata_namespace: Mutex<String>,
    pub(crate) lifecycle: BeadsLifecycle,
    pub(crate) config_store: Option<AppConfigStore>,
    task_list_cache: Mutex<HashMap<String, TaskListCacheState>>,
    kanban_task_list_cache: Mutex<HashMap<String, KanbanTaskListCacheState>>,
    pull_request_sync_candidate_cache: Mutex<HashMap<String, PullRequestSyncCandidateCacheState>>,
}

impl fmt::Debug for BeadsTaskStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BeadsTaskStore")
            .field("metadata_namespace", &self.metadata_namespace_snapshot())
            .finish_non_exhaustive()
    }
}

impl Default for BeadsTaskStore {
    fn default() -> Self {
        Self::new()
    }
}

impl BeadsTaskStore {
    pub fn new() -> Self {
        Self::with_metadata_namespace_and_runner(
            DEFAULT_METADATA_NAMESPACE,
            None,
            Arc::new(ProcessCommandRunner),
        )
    }

    pub fn with_metadata_namespace(namespace: &str) -> Self {
        Self::with_metadata_namespace_and_runner(namespace, None, Arc::new(ProcessCommandRunner))
    }

    pub fn with_metadata_namespace_and_config(
        namespace: &str,
        config_store: AppConfigStore,
    ) -> Self {
        Self::with_metadata_namespace_and_runner(
            namespace,
            Some(config_store),
            Arc::new(ProcessCommandRunner),
        )
    }

    fn with_metadata_namespace_and_runner(
        namespace: &str,
        config_store: Option<AppConfigStore>,
        command_runner: Arc<dyn CommandRunner>,
    ) -> Self {
        Self::with_metadata_namespace_runner_and_owner_pid(
            namespace,
            config_store,
            command_runner,
            std::process::id(),
        )
    }

    pub fn with_metadata_namespace_config_and_owner_pid(
        namespace: &str,
        config_store: AppConfigStore,
        owner_pid: u32,
    ) -> Self {
        Self::with_metadata_namespace_runner_and_owner_pid(
            namespace,
            Some(config_store),
            Arc::new(ProcessCommandRunner),
            owner_pid,
        )
    }

    fn with_metadata_namespace_runner_and_owner_pid(
        namespace: &str,
        config_store: Option<AppConfigStore>,
        command_runner: Arc<dyn CommandRunner>,
        owner_pid: u32,
    ) -> Self {
        Self {
            metadata_namespace: Mutex::new(Self::normalize_metadata_namespace(namespace)),
            lifecycle: BeadsLifecycle::with_owner_pid(command_runner, owner_pid),
            config_store,
            task_list_cache: Mutex::new(HashMap::new()),
            kanban_task_list_cache: Mutex::new(HashMap::new()),
            pull_request_sync_candidate_cache: Mutex::new(HashMap::new()),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_test_runner(
        namespace: &str,
        command_runner: Arc<dyn CommandRunner>,
    ) -> Self {
        Self::with_metadata_namespace_and_runner(namespace, None, command_runner)
    }

    #[cfg(test)]
    pub(crate) fn with_test_runner_and_owner_pid(
        namespace: &str,
        command_runner: Arc<dyn CommandRunner>,
        owner_pid: u32,
    ) -> Self {
        Self::with_metadata_namespace_runner_and_owner_pid(
            namespace,
            None,
            command_runner,
            owner_pid,
        )
    }

    #[cfg(test)]
    pub(crate) fn repo_key(repo_path: &Path) -> String {
        Self::durable_identity_key(None, repo_path)
    }

    pub(crate) fn identity_key(&self, repo_path: &Path) -> String {
        Self::durable_identity_key(self.config_store.as_ref(), repo_path)
    }

    pub(crate) fn workspace_id(&self, repo_path: &Path) -> Option<String> {
        let config_store = self.config_store.as_ref()?;
        config_store
            .find_workspace_by_repo_path(repo_path.to_string_lossy().as_ref())
            .ok()
            .flatten()
            .map(|workspace| workspace.workspace_id)
    }

    fn durable_identity_key(config_store: Option<&AppConfigStore>, repo_path: &Path) -> String {
        if let Some(config_store) = config_store {
            if let Ok(Some(workspace)) =
                config_store.find_workspace_by_repo_path(repo_path.to_string_lossy().as_ref())
            {
                return workspace.workspace_id;
            }
        }

        BeadsLifecycle::repo_key(repo_path)
    }
}

impl TaskStore for BeadsTaskStore {
    fn diagnose_repo_store(&self, repo_path: &Path) -> Result<host_domain::RepoStoreHealth> {
        let repo_key = self.identity_key(repo_path);
        let workspace_id = self.workspace_id(repo_path);
        self.lifecycle.diagnose_repo_store_for_identity(
            repo_path,
            Some(&repo_key),
            workspace_id.as_deref(),
        )
    }

    fn ensure_repo_initialized(&self, repo_path: &Path) -> Result<()> {
        self.ensure_repo_initialized_impl(repo_path)
    }

    fn list_tasks(&self, repo_path: &Path) -> Result<Vec<TaskCard>> {
        self.list_tasks_impl(repo_path)
    }

    fn list_pull_request_sync_candidates(&self, repo_path: &Path) -> Result<Vec<TaskCard>> {
        self.list_pull_request_sync_candidates_impl(repo_path)
    }

    fn get_task(&self, repo_path: &Path, task_id: &str) -> Result<TaskCard> {
        self.get_task_impl(repo_path, task_id)
    }

    fn list_tasks_for_kanban(
        &self,
        repo_path: &Path,
        done_visible_days: i32,
    ) -> Result<Vec<TaskCard>> {
        self.list_tasks_for_kanban_impl(repo_path, done_visible_days)
    }

    fn create_task(&self, repo_path: &Path, input: CreateTaskInput) -> Result<TaskCard> {
        self.create_task_impl(repo_path, input)
    }

    fn update_task(
        &self,
        repo_path: &Path,
        task_id: &str,
        patch: UpdateTaskPatch,
    ) -> Result<TaskCard> {
        self.update_task_impl(repo_path, task_id, patch)
    }

    fn delete_task(&self, repo_path: &Path, task_id: &str, delete_subtasks: bool) -> Result<bool> {
        self.delete_task_impl(repo_path, task_id, delete_subtasks)
    }

    fn get_spec(&self, repo_path: &Path, task_id: &str) -> Result<SpecDocument> {
        self.get_spec_impl(repo_path, task_id)
    }

    fn set_spec(&self, repo_path: &Path, task_id: &str, markdown: &str) -> Result<SpecDocument> {
        self.set_spec_impl(repo_path, task_id, markdown)
    }

    fn get_plan(&self, repo_path: &Path, task_id: &str) -> Result<SpecDocument> {
        self.get_plan_impl(repo_path, task_id)
    }

    fn set_plan(&self, repo_path: &Path, task_id: &str, markdown: &str) -> Result<SpecDocument> {
        self.set_plan_impl(repo_path, task_id, markdown)
    }

    fn get_latest_qa_report(
        &self,
        repo_path: &Path,
        task_id: &str,
    ) -> Result<Option<QaReportDocument>> {
        self.get_latest_qa_report_impl(repo_path, task_id)
    }

    fn append_qa_report(
        &self,
        repo_path: &Path,
        task_id: &str,
        markdown: &str,
        verdict: QaVerdict,
    ) -> Result<QaReportDocument> {
        self.append_qa_report_impl(repo_path, task_id, markdown, verdict)
    }

    fn record_qa_outcome(
        &self,
        repo_path: &Path,
        task_id: &str,
        target_status: TaskStatus,
        markdown: &str,
        verdict: QaVerdict,
    ) -> Result<TaskCard> {
        self.record_qa_outcome_impl(repo_path, task_id, target_status, markdown, verdict)
    }

    fn list_agent_sessions(
        &self,
        repo_path: &Path,
        task_id: &str,
    ) -> Result<Vec<AgentSessionDocument>> {
        self.list_agent_sessions_impl(repo_path, task_id)
    }

    fn upsert_agent_session(
        &self,
        repo_path: &Path,
        task_id: &str,
        session: AgentSessionDocument,
    ) -> Result<()> {
        self.upsert_agent_session_impl(repo_path, task_id, session)
    }

    fn clear_agent_sessions_by_roles(
        &self,
        repo_path: &Path,
        task_id: &str,
        roles: &[&str],
    ) -> Result<()> {
        self.clear_agent_sessions_by_roles_impl(repo_path, task_id, roles)
    }

    fn clear_workflow_documents(&self, repo_path: &Path, task_id: &str) -> Result<()> {
        self.clear_workflow_documents_impl(repo_path, task_id)
    }

    fn clear_qa_reports(&self, repo_path: &Path, task_id: &str) -> Result<()> {
        self.clear_qa_reports_impl(repo_path, task_id)
    }

    fn set_delivery_metadata(
        &self,
        repo_path: &Path,
        task_id: &str,
        pull_request: Option<PullRequestRecord>,
        direct_merge: Option<DirectMergeRecord>,
    ) -> Result<()> {
        self.set_delivery_metadata_impl(repo_path, task_id, pull_request, direct_merge)
    }

    fn set_pull_request(
        &self,
        repo_path: &Path,
        task_id: &str,
        pull_request: Option<PullRequestRecord>,
    ) -> Result<()> {
        self.set_pull_request_impl(repo_path, task_id, pull_request)
    }

    fn set_direct_merge_record(
        &self,
        repo_path: &Path,
        task_id: &str,
        direct_merge: Option<DirectMergeRecord>,
    ) -> Result<()> {
        self.set_direct_merge_record_impl(repo_path, task_id, direct_merge)
    }

    fn get_task_metadata(&self, repo_path: &Path, task_id: &str) -> Result<TaskMetadata> {
        self.get_task_metadata_impl(repo_path, task_id)
    }
}
