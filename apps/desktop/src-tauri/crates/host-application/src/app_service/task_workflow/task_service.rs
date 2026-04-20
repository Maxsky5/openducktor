use crate::app_service::service_core::AppService;
use crate::app_service::task_workflow::{
    implementation_reset_service::ImplementationResetService,
    task_deletion_service::TaskDeletionService, task_reset_service::TaskResetService,
};
use crate::app_service::workflow_rules::{
    default_qa_required_for_issue_type, is_open_state, validate_parent_relationships_for_create,
    validate_parent_relationships_for_update, validate_transition,
    validate_transition_without_related_tasks,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{
    CreateTaskInput, QaWorkflowVerdict, TaskCard, TaskMetadata, TaskStatus, UpdateTaskPatch,
};

impl AppService {
    pub fn tasks_list(&self, repo_path: &str) -> Result<Vec<TaskCard>> {
        let context = self.load_task_repo_context(repo_path)?;
        Ok(self.enrich_tasks(context.tasks))
    }

    pub fn tasks_list_for_kanban(
        &self,
        repo_path: &str,
        done_visible_days: i32,
    ) -> Result<Vec<TaskCard>> {
        let context = self.load_task_repo_context_for_kanban(repo_path, done_visible_days)?;
        Ok(self.enrich_tasks(context.tasks))
    }

    pub fn task_create(&self, repo_path: &str, mut input: CreateTaskInput) -> Result<TaskCard> {
        let mut context = self.load_task_repo_context(repo_path)?;
        if input.ai_review_enabled.is_none() {
            input.ai_review_enabled = Some(default_qa_required_for_issue_type(&input.issue_type));
        }

        validate_parent_relationships_for_create(&context.tasks, &input)?;

        let created = self.task_store.create_task(context.repo_dir(), input)?;
        context.tasks.push(created.clone());
        Ok(self.enrich_task(created, &context.tasks))
    }

    pub fn task_update(
        &self,
        repo_path: &str,
        task_id: &str,
        patch: UpdateTaskPatch,
    ) -> Result<TaskCard> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        if patch.status.is_some() {
            return Err(anyhow!(
                "Status cannot be updated directly. Use workflow transitions."
            ));
        }

        let mut context = self.load_task_repo_context_from_resolved(repo_path)?;
        let current = context.task(task_id)?;
        validate_parent_relationships_for_update(&context.tasks, current, &patch)?;

        let updated = self
            .task_store
            .update_task(context.repo_dir(), task_id, patch)?;
        if let Some(index) = context.tasks.iter().position(|task| task.id == task_id) {
            context.tasks[index] = updated.clone();
        }
        Ok(self.enrich_task(updated, &context.tasks))
    }

    pub fn task_delete(&self, repo_path: &str, task_id: &str, delete_subtasks: bool) -> Result<()> {
        TaskDeletionService::new(self).delete(repo_path, task_id, delete_subtasks)
    }

    pub fn task_reset_implementation(&self, repo_path: &str, task_id: &str) -> Result<TaskCard> {
        ImplementationResetService::new(self).reset(repo_path, task_id)
    }

    pub fn task_reset(&self, repo_path: &str, task_id: &str) -> Result<TaskCard> {
        TaskResetService::new(self).reset(repo_path, task_id)
    }

    pub fn task_transition(
        &self,
        repo_path: &str,
        task_id: &str,
        target_status: TaskStatus,
        _reason: Option<&str>,
    ) -> Result<TaskCard> {
        let mut context = self.load_task_context(repo_path, task_id)?;

        validate_transition(
            &context.task,
            &context.repo.tasks,
            &context.task.status,
            &target_status,
        )?;

        if context.task.status == target_status {
            return Ok(self.enrich_task(context.task, &context.repo.tasks));
        }

        let updated = self.task_store.update_task(
            context.repo_dir(),
            task_id,
            UpdateTaskPatch {
                title: None,
                description: None,
                notes: None,
                status: Some(target_status),
                priority: None,
                issue_type: None,
                ai_review_enabled: None,
                labels: None,
                assignee: None,
                parent_id: None,
                target_branch: None,
            },
        )?;

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

    pub(crate) fn task_transition_to_in_progress_without_related_tasks(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<TaskCard> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        let repo_dir = std::path::Path::new(&repo_path);
        let task = self.task_store.get_task(repo_dir, task_id)?;

        validate_transition_without_related_tasks(&task, &task.status, &TaskStatus::InProgress)?;

        if task.status == TaskStatus::InProgress {
            return Ok(self.enrich_task(task.clone(), std::slice::from_ref(&task)));
        }

        let updated = self.task_store.update_task(
            repo_dir,
            task_id,
            UpdateTaskPatch {
                title: None,
                description: None,
                notes: None,
                status: Some(TaskStatus::InProgress),
                priority: None,
                issue_type: None,
                ai_review_enabled: None,
                labels: None,
                assignee: None,
                parent_id: None,
                target_branch: None,
            },
        )?;

        Ok(self.enrich_task(updated.clone(), std::slice::from_ref(&updated)))
    }

    pub fn build_blocked(
        &self,
        repo_path: &str,
        task_id: &str,
        reason: Option<&str>,
    ) -> Result<TaskCard> {
        let reason = reason
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .ok_or_else(|| anyhow!("build_blocked requires a non-empty reason"))?;
        self.task_transition(repo_path, task_id, TaskStatus::Blocked, Some(reason))
    }

    pub fn build_resumed(&self, repo_path: &str, task_id: &str) -> Result<TaskCard> {
        self.task_transition_to_in_progress_without_related_tasks(repo_path, task_id)
    }

    pub fn build_completed(
        &self,
        repo_path: &str,
        task_id: &str,
        _summary: Option<&str>,
    ) -> Result<TaskCard> {
        let context = self.load_task_context(repo_path, task_id)?;
        let should_return_to_ai_review = context.task.ai_review_enabled
            && context.task.document_summary.qa_report.verdict != QaWorkflowVerdict::Approved;
        let next_status = if should_return_to_ai_review {
            TaskStatus::AiReview
        } else {
            TaskStatus::HumanReview
        };

        self.task_transition(
            context.repo.repo_path.as_str(),
            task_id,
            next_status,
            Some("Builder completed"),
        )
    }

    pub fn human_request_changes(
        &self,
        repo_path: &str,
        task_id: &str,
        _note: Option<&str>,
    ) -> Result<TaskCard> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        if self
            .task_metadata_get(repo_path.as_str(), task_id)?
            .direct_merge
            .is_some()
        {
            return Err(anyhow!(
                "Cannot request changes after a local direct merge has already been applied for task {task_id}. Push and complete the direct merge workflow first, or manually revert the local merge before reopening the task."
            ));
        }
        self.task_transition_to_in_progress_without_related_tasks(repo_path.as_str(), task_id)
    }

    pub fn human_approve(&self, repo_path: &str, task_id: &str) -> Result<TaskCard> {
        self.task_transition(
            repo_path,
            task_id,
            TaskStatus::Closed,
            Some("Human approved"),
        )
    }

    pub fn task_defer(
        &self,
        repo_path: &str,
        task_id: &str,
        _reason: Option<&str>,
    ) -> Result<TaskCard> {
        let context = self.load_task_context(repo_path, task_id)?;

        if context.task.parent_id.is_some() {
            return Err(anyhow!("Subtasks cannot be deferred."));
        }

        if !is_open_state(&context.task.status) {
            return Err(anyhow!("Only non-closed open-state tasks can be deferred."));
        }

        self.task_transition(
            context.repo.repo_path.as_str(),
            task_id,
            TaskStatus::Deferred,
            Some("Deferred by user"),
        )
    }

    pub fn task_resume_deferred(&self, repo_path: &str, task_id: &str) -> Result<TaskCard> {
        let context = self.load_task_context(repo_path, task_id)?;
        if context.task.status != TaskStatus::Deferred {
            return Err(anyhow!("Task is not deferred: {task_id}"));
        }

        self.task_transition(
            context.repo.repo_path.as_str(),
            task_id,
            TaskStatus::Open,
            Some("Deferred task resumed"),
        )
    }

    pub fn task_metadata_get(&self, repo_path: &str, task_id: &str) -> Result<TaskMetadata> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        self.task_store
            .get_task_metadata(std::path::Path::new(&repo_path), task_id)
            .with_context(|| format!("Failed to load task metadata for {task_id}"))
    }
}
