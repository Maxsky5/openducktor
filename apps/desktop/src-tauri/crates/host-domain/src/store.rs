use crate::document::{
    AgentSessionDocument, QaReportDocument, QaVerdict, SpecDocument, TaskMetadata,
};
use crate::git::{DirectMergeRecord, PullRequestRecord};
use crate::task::{CreateTaskInput, TaskCard, TaskStatus, UpdateTaskPatch};
use anyhow::Result;
use std::path::Path;

pub trait TaskStore: Send + Sync {
    fn ensure_repo_initialized(&self, repo_path: &Path) -> Result<()>;
    fn list_tasks(&self, repo_path: &Path) -> Result<Vec<TaskCard>>;
    fn create_task(&self, repo_path: &Path, input: CreateTaskInput) -> Result<TaskCard>;
    fn update_task(
        &self,
        repo_path: &Path,
        task_id: &str,
        patch: UpdateTaskPatch,
    ) -> Result<TaskCard>;
    fn delete_task(&self, repo_path: &Path, task_id: &str, delete_subtasks: bool) -> Result<bool>;
    fn get_spec(&self, repo_path: &Path, task_id: &str) -> Result<SpecDocument>;
    fn set_spec(&self, repo_path: &Path, task_id: &str, markdown: &str) -> Result<SpecDocument>;
    fn get_plan(&self, repo_path: &Path, task_id: &str) -> Result<SpecDocument>;
    fn set_plan(&self, repo_path: &Path, task_id: &str, markdown: &str) -> Result<SpecDocument>;
    fn get_latest_qa_report(
        &self,
        repo_path: &Path,
        task_id: &str,
    ) -> Result<Option<QaReportDocument>>;
    fn append_qa_report(
        &self,
        repo_path: &Path,
        task_id: &str,
        markdown: &str,
        verdict: QaVerdict,
    ) -> Result<QaReportDocument>;
    /// Persist a QA report and its linked status transition together when possible.
    fn record_qa_outcome(
        &self,
        repo_path: &Path,
        task_id: &str,
        target_status: TaskStatus,
        markdown: &str,
        verdict: QaVerdict,
    ) -> Result<TaskCard>;
    fn list_agent_sessions(
        &self,
        repo_path: &Path,
        task_id: &str,
    ) -> Result<Vec<AgentSessionDocument>>;
    fn upsert_agent_session(
        &self,
        repo_path: &Path,
        task_id: &str,
        session: AgentSessionDocument,
    ) -> Result<()>;
    fn clear_agent_sessions_by_roles(
        &self,
        repo_path: &Path,
        task_id: &str,
        roles: &[&str],
    ) -> Result<()>;
    fn clear_qa_reports(&self, repo_path: &Path, task_id: &str) -> Result<()>;
    /// Persist pull request and direct merge metadata together in one store update.
    fn set_delivery_metadata(
        &self,
        repo_path: &Path,
        task_id: &str,
        pull_request: Option<PullRequestRecord>,
        direct_merge: Option<DirectMergeRecord>,
    ) -> Result<()>;
    fn set_pull_request(
        &self,
        repo_path: &Path,
        task_id: &str,
        pull_request: Option<PullRequestRecord>,
    ) -> Result<()>;
    fn set_direct_merge_record(
        &self,
        repo_path: &Path,
        task_id: &str,
        direct_merge: Option<DirectMergeRecord>,
    ) -> Result<()>;
    /// Fetch all task metadata (spec, plan, QA report, sessions) in a single CLI call.
    /// Use this when you need multiple metadata fields for the same task to avoid
    /// redundant `bd show` invocations.
    fn get_task_metadata(&self, repo_path: &Path, task_id: &str) -> Result<TaskMetadata>;
}
