use super::task_context::LoadedTaskContext;
use crate::app_service::service_core::AppService;
use crate::app_service::workflow_rules::{
    can_replace_epic_subtask_status, can_set_plan, can_set_spec_from_status,
    is_active_or_review_status, normalize_required_markdown, normalize_subtask_plan_inputs,
    normalize_title_key, validate_parent_relationships_for_create, validate_plan_subtask_rules,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{CreateTaskInput, IssueType, PlanSubtaskInput, SpecDocument, TaskStatus};
use std::collections::HashSet;

impl AppService {
    pub fn spec_get(&self, repo_path: &str, task_id: &str) -> Result<SpecDocument> {
        Ok(self.task_metadata_get(repo_path, task_id)?.spec)
    }

    pub fn set_spec(&self, repo_path: &str, task_id: &str, markdown: &str) -> Result<SpecDocument> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        let markdown = normalize_required_markdown(markdown, "spec")?;
        let context = self.load_task_context_from_resolved(repo_path, task_id)?;
        if !can_set_spec_from_status(&context.task.status) {
            return Err(anyhow!(
                "set_spec is only allowed from open/spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review (current: {})",
                context.task.status.as_cli_value()
            ));
        }

        let spec = self
            .task_store
            .set_spec(context.repo_dir(), task_id, &markdown)
            .with_context(|| format!("Failed to persist spec markdown for {task_id}"))?;

        if context.task.status == TaskStatus::Open {
            self.task_transition(
                context.repo.repo_path.as_str(),
                task_id,
                TaskStatus::SpecReady,
                Some("Spec ready"),
            )?;
        }

        Ok(spec)
    }

    pub fn save_spec_document(
        &self,
        repo_path: &str,
        task_id: &str,
        markdown: &str,
    ) -> Result<SpecDocument> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        let markdown = normalize_required_markdown(markdown, "spec")?;
        let context = self.load_task_context_from_resolved(repo_path, task_id)?;

        self.task_store
            .set_spec(context.repo_dir(), task_id, &markdown)
            .with_context(|| format!("Failed to persist spec markdown for {task_id}"))
    }

    pub fn plan_get(&self, repo_path: &str, task_id: &str) -> Result<SpecDocument> {
        Ok(self.task_metadata_get(repo_path, task_id)?.plan)
    }

    pub fn set_plan(
        &self,
        repo_path: &str,
        task_id: &str,
        markdown: &str,
        subtasks: Option<Vec<PlanSubtaskInput>>,
    ) -> Result<SpecDocument> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        let markdown = normalize_required_markdown(markdown, "implementation plan")?;
        let mut context = self.load_task_context_from_resolved(repo_path, task_id)?;
        if !can_set_plan(&context.task) {
            return Err(anyhow!(
                "set_plan is not allowed for issue type {} from status {}. feature/epic allow spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review; task/bug also allow open.",
                context.task.issue_type.as_cli_value(),
                context.task.status.as_cli_value()
            ));
        }

        let issue_type = context.task.issue_type.clone();
        let has_explicit_subtasks = subtasks.is_some();
        let mut subtask_creates = normalize_subtask_plan_inputs(subtasks.unwrap_or_default())?;
        let is_active_or_review = is_active_or_review_status(&context.task.status);
        let should_validate_subtask_rules =
            issue_type != IssueType::Epic || !is_active_or_review || has_explicit_subtasks;
        if should_validate_subtask_rules {
            validate_plan_subtask_rules(&context.task, &context.repo.tasks, &subtask_creates)?;
        }
        if issue_type != IssueType::Epic {
            subtask_creates.clear();
        }

        let should_replace_epic_subtasks =
            issue_type == IssueType::Epic && (!is_active_or_review || has_explicit_subtasks);
        if should_replace_epic_subtasks {
            self.validate_epic_subtasks_replaceable(&context)?;
        }

        let plan = self
            .task_store
            .set_plan(context.repo_dir(), task_id, &markdown)
            .with_context(|| format!("Failed to persist implementation plan for {task_id}"))?;

        if should_replace_epic_subtasks {
            self.replace_epic_plan_subtasks(&mut context, subtask_creates)?;
        }

        if matches!(
            context.task.status,
            TaskStatus::Open | TaskStatus::SpecReady
        ) {
            self.task_transition(
                context.repo.repo_path.as_str(),
                task_id,
                TaskStatus::ReadyForDev,
                Some("Implementation plan ready"),
            )?;
        }

        Ok(plan)
    }

    pub fn save_plan_document(
        &self,
        repo_path: &str,
        task_id: &str,
        markdown: &str,
    ) -> Result<SpecDocument> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        let markdown = normalize_required_markdown(markdown, "implementation plan")?;
        let context = self.load_task_context_from_resolved(repo_path, task_id)?;

        self.task_store
            .set_plan(context.repo_dir(), task_id, &markdown)
            .with_context(|| format!("Failed to persist implementation plan for {task_id}"))
    }

    fn replace_epic_plan_subtasks(
        &self,
        context: &mut LoadedTaskContext,
        subtask_creates: Vec<CreateTaskInput>,
    ) -> Result<()> {
        let task_id = context.task.id.clone();
        self.validate_epic_subtasks_replaceable(context)?;

        let existing_direct_subtasks = context
            .repo
            .tasks
            .iter()
            .filter(|entry| entry.parent_id.as_deref() == Some(task_id.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        let existing_direct_subtask_ids = existing_direct_subtasks
            .iter()
            .map(|entry| entry.id.clone())
            .collect::<Vec<_>>();
        for existing_subtask_id in &existing_direct_subtask_ids {
            self.task_store
                .delete_task(context.repo_dir(), existing_subtask_id, false)
                .with_context(|| {
                    format!("Failed to delete replaced subtask {existing_subtask_id}")
                })?;
        }

        if !existing_direct_subtask_ids.is_empty() {
            let removed_ids = existing_direct_subtask_ids
                .iter()
                .map(String::as_str)
                .collect::<HashSet<_>>();
            context
                .repo
                .tasks
                .retain(|entry| !removed_ids.contains(entry.id.as_str()));
        }

        let mut proposal_titles = HashSet::new();
        for mut create_input in subtask_creates {
            let title_key = normalize_title_key(&create_input.title);
            if !proposal_titles.insert(title_key) {
                continue;
            }

            create_input.parent_id = Some(task_id.to_string());
            validate_parent_relationships_for_create(&context.repo.tasks, &create_input)?;
            let created = self
                .task_store
                .create_task(context.repo_dir(), create_input)?;
            context.repo.tasks.push(created);
        }

        Ok(())
    }

    fn validate_epic_subtasks_replaceable(&self, context: &LoadedTaskContext) -> Result<()> {
        let task_id = context.task.id.as_str();
        let blocked_subtasks = context
            .repo
            .tasks
            .iter()
            .filter(|entry| entry.parent_id.as_deref() == Some(task_id))
            .filter(|entry| !can_replace_epic_subtask_status(&entry.status))
            .map(|entry| format!("{} ({})", entry.id, entry.status.as_cli_value()))
            .collect::<Vec<_>>();
        if !blocked_subtasks.is_empty() {
            return Err(anyhow!(
                "Cannot replace epic subtasks while active work exists. \
Move subtasks to open/spec_ready/ready_for_dev first: {}",
                blocked_subtasks.join(", ")
            ));
        }

        Ok(())
    }
}
