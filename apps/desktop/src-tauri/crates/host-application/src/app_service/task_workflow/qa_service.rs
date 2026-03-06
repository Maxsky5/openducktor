use anyhow::{Context, Result};
use crate::app_service::service_core::AppService;
use crate::app_service::workflow_rules::validate_transition;
use host_domain::{QaVerdict, SpecDocument, TaskCard, TaskStatus};

impl AppService {
    pub fn qa_get_report(&self, repo_path: &str, task_id: &str) -> Result<SpecDocument> {
        let report = self
            .task_metadata_get(repo_path, task_id)?
            .qa_report
            .map(|entry| SpecDocument {
                markdown: entry.markdown,
                updated_at: Some(entry.updated_at),
            })
            .unwrap_or_else(|| SpecDocument {
                markdown: String::new(),
                updated_at: None,
            });
        Ok(report)
    }

    pub fn qa_approved(&self, repo_path: &str, task_id: &str, markdown: &str) -> Result<TaskCard> {
        let context = self.load_task_context(repo_path, task_id)?;
        validate_transition(
            &context.task,
            &context.repo.tasks,
            &context.task.status,
            &TaskStatus::HumanReview,
        )?;

        self.task_store
            .append_qa_report(context.repo_dir(), task_id, markdown, QaVerdict::Approved)
            .with_context(|| format!("Failed to persist QA report for {task_id}"))?;

        self.task_transition(
            context.repo.repo_path.as_str(),
            task_id,
            TaskStatus::HumanReview,
            Some("QA approved"),
        )
    }

    pub fn qa_rejected(&self, repo_path: &str, task_id: &str, markdown: &str) -> Result<TaskCard> {
        let context = self.load_task_context(repo_path, task_id)?;
        validate_transition(
            &context.task,
            &context.repo.tasks,
            &context.task.status,
            &TaskStatus::InProgress,
        )?;

        self.task_store
            .append_qa_report(context.repo_dir(), task_id, markdown, QaVerdict::Rejected)
            .with_context(|| format!("Failed to persist QA report for {task_id}"))?;

        self.task_transition(
            context.repo.repo_path.as_str(),
            task_id,
            TaskStatus::InProgress,
            Some("QA requested changes"),
        )
    }
}
