use crate::app_service::service_core::AppService;
use crate::app_service::workflow_rules::validate_transition;
use anyhow::{anyhow, Context, Result};
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
        self.record_qa_outcome(
            repo_path,
            task_id,
            TaskStatus::HumanReview,
            markdown,
            QaVerdict::Approved,
        )
    }

    pub fn qa_rejected(&self, repo_path: &str, task_id: &str, markdown: &str) -> Result<TaskCard> {
        self.record_qa_outcome(
            repo_path,
            task_id,
            TaskStatus::InProgress,
            markdown,
            QaVerdict::Rejected,
        )
    }

    fn record_qa_outcome(
        &self,
        repo_path: &str,
        task_id: &str,
        target_status: TaskStatus,
        markdown: &str,
        verdict: QaVerdict,
    ) -> Result<TaskCard> {
        let mut context = self.load_task_context(repo_path, task_id)?;
        if context.task.status != TaskStatus::AiReview {
            return Err(anyhow!(
                "QA outcomes are only allowed from ai_review (current: {}).",
                context.task.status.as_cli_value()
            ));
        }
        validate_transition(
            &context.task,
            &context.repo.tasks,
            &context.task.status,
            &target_status,
        )?;

        let updated = self
            .task_store
            .record_qa_outcome(
                context.repo_dir(),
                task_id,
                target_status,
                markdown,
                verdict,
            )
            .with_context(|| format!("Failed to persist QA outcome for {task_id}"))?;

        if let Some(index) = context
            .repo
            .tasks
            .iter()
            .position(|entry| entry.id == task_id)
        {
            context.repo.tasks[index] = updated.clone();
        }

        Ok(self.enrich_task(updated, &context.repo.tasks))
    }
}
