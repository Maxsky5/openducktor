use anyhow::anyhow;
use host_domain::{
    AgentSessionDocument, CreateTaskInput, DirectMergeRecord, PullRequestRecord, QaReportDocument,
    QaVerdict, SpecDocument, TaskCard, TaskMetadata, TaskStatus, TaskStore, UpdateTaskPatch,
};
use std::path::Path;

pub(crate) struct CommandTaskStore;

fn empty_spec_document() -> SpecDocument {
    SpecDocument {
        markdown: String::new(),
        updated_at: None,
    }
}

impl TaskStore for CommandTaskStore {
    fn ensure_repo_initialized(&self, _repo_path: &Path) -> anyhow::Result<()> {
        Ok(())
    }

    fn list_tasks(&self, _repo_path: &Path) -> anyhow::Result<Vec<TaskCard>> {
        Ok(Vec::new())
    }

    fn create_task(&self, _repo_path: &Path, _input: CreateTaskInput) -> anyhow::Result<TaskCard> {
        Err(anyhow!(
            "unexpected task store create_task call in git command tests"
        ))
    }

    fn update_task(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        _patch: UpdateTaskPatch,
    ) -> anyhow::Result<TaskCard> {
        Err(anyhow!(
            "unexpected task store update_task call in git command tests"
        ))
    }

    fn delete_task(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        _delete_subtasks: bool,
    ) -> anyhow::Result<bool> {
        Err(anyhow!(
            "unexpected task store delete_task call in git command tests"
        ))
    }

    fn get_spec(&self, _repo_path: &Path, _task_id: &str) -> anyhow::Result<SpecDocument> {
        Ok(empty_spec_document())
    }

    fn set_spec(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        markdown: &str,
    ) -> anyhow::Result<SpecDocument> {
        Ok(SpecDocument {
            markdown: markdown.to_string(),
            updated_at: None,
        })
    }

    fn get_plan(&self, _repo_path: &Path, _task_id: &str) -> anyhow::Result<SpecDocument> {
        Ok(empty_spec_document())
    }

    fn set_plan(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        markdown: &str,
    ) -> anyhow::Result<SpecDocument> {
        Ok(SpecDocument {
            markdown: markdown.to_string(),
            updated_at: None,
        })
    }

    fn get_latest_qa_report(
        &self,
        _repo_path: &Path,
        _task_id: &str,
    ) -> anyhow::Result<Option<QaReportDocument>> {
        Ok(None)
    }

    fn append_qa_report(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        markdown: &str,
        verdict: QaVerdict,
    ) -> anyhow::Result<QaReportDocument> {
        Ok(QaReportDocument {
            markdown: markdown.to_string(),
            verdict,
            updated_at: String::new(),
            revision: 0,
        })
    }

    fn record_qa_outcome(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        _target_status: TaskStatus,
        _markdown: &str,
        _verdict: QaVerdict,
    ) -> anyhow::Result<TaskCard> {
        Err(anyhow!(
            "unexpected task store record_qa_outcome call in git command tests"
        ))
    }

    fn list_agent_sessions(
        &self,
        _repo_path: &Path,
        _task_id: &str,
    ) -> anyhow::Result<Vec<AgentSessionDocument>> {
        Ok(Vec::new())
    }

    fn upsert_agent_session(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        _session: AgentSessionDocument,
    ) -> anyhow::Result<()> {
        Ok(())
    }

    fn clear_agent_sessions_by_roles(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        _roles: &[&str],
    ) -> anyhow::Result<()> {
        Err(anyhow!(
            "unexpected task store clear_agent_sessions_by_roles call in git command tests"
        ))
    }

    fn clear_qa_reports(&self, _repo_path: &Path, _task_id: &str) -> anyhow::Result<()> {
        Err(anyhow!(
            "unexpected task store clear_qa_reports call in git command tests"
        ))
    }

    fn set_delivery_metadata(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        _pull_request: Option<PullRequestRecord>,
        _direct_merge: Option<DirectMergeRecord>,
    ) -> anyhow::Result<()> {
        Err(anyhow!(
            "unexpected task store set_delivery_metadata call in git command tests"
        ))
    }

    fn set_pull_request(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        _pull_request: Option<PullRequestRecord>,
    ) -> anyhow::Result<()> {
        Err(anyhow!(
            "unexpected task store set_pull_request call in git command tests"
        ))
    }

    fn set_direct_merge_record(
        &self,
        _repo_path: &Path,
        _task_id: &str,
        _direct_merge: Option<DirectMergeRecord>,
    ) -> anyhow::Result<()> {
        Err(anyhow!(
            "unexpected task store set_direct_merge_record call in git command tests"
        ))
    }

    fn get_task_metadata(&self, _repo_path: &Path, _task_id: &str) -> anyhow::Result<TaskMetadata> {
        Ok(TaskMetadata {
            spec: empty_spec_document(),
            plan: empty_spec_document(),
            qa_report: None,
            pull_request: None,
            direct_merge: None,
            agent_sessions: Vec::new(),
        })
    }
}
