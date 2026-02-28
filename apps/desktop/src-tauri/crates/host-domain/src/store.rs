use crate::document::{
    AgentSessionDocument, QaReportDocument, QaVerdict, SpecDocument, TaskMetadata,
};
use crate::task::{CreateTaskInput, TaskCard, UpdateTaskPatch};
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
    /// Fetch all task metadata (spec, plan, QA report, sessions) in a single CLI call.
    /// Use this when you need multiple metadata fields for the same task to avoid
    /// redundant `bd show` invocations.
    fn get_task_metadata(&self, repo_path: &Path, task_id: &str) -> Result<TaskMetadata>;
}
