use crate::app_service::service_core::AppService;
use crate::app_service::workflow_rules::{
    default_qa_required_for_issue_type, is_open_state, validate_parent_relationships_for_create,
    validate_parent_relationships_for_update, validate_transition,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{CreateTaskInput, TaskCard, TaskMetadata, TaskStatus, UpdateTaskPatch};

impl AppService {
    pub fn tasks_list(&self, repo_path: &str) -> Result<Vec<TaskCard>> {
        let context = self.load_task_repo_context(repo_path)?;
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
        let context = self.load_task_context(repo_path, task_id)?;
        let direct_subtask_ids = context
            .repo
            .tasks
            .iter()
            .filter(|entry| entry.parent_id.as_deref() == Some(task_id))
            .map(|entry| entry.id.clone())
            .collect::<Vec<_>>();

        if !direct_subtask_ids.is_empty() && !delete_subtasks {
            return Err(anyhow!(
                "Task {task_id} has {} subtasks. Confirm subtask deletion to continue.",
                direct_subtask_ids.len()
            ));
        }

        self.task_store
            .delete_task(context.repo_dir(), task_id, delete_subtasks)
            .with_context(|| format!("Failed to delete task {task_id}"))?;
        Ok(())
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
                acceptance_criteria: None,
                notes: None,
                status: Some(target_status),
                priority: None,
                issue_type: None,
                ai_review_enabled: None,
                labels: None,
                assignee: None,
                parent_id: None,
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
        self.task_transition(
            repo_path,
            task_id,
            TaskStatus::InProgress,
            Some("Builder resumed"),
        )
    }

    pub fn build_completed(
        &self,
        repo_path: &str,
        task_id: &str,
        _summary: Option<&str>,
    ) -> Result<TaskCard> {
        let context = self.load_task_context(repo_path, task_id)?;
        let next_status = if context.task.ai_review_enabled {
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
        note: Option<&str>,
    ) -> Result<TaskCard> {
        let reason = note
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .unwrap_or("Human requested changes");
        self.task_transition(repo_path, task_id, TaskStatus::InProgress, Some(reason))
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
