use super::{
    can_replace_epic_subtask_status, can_set_plan, can_set_spec_from_status,
    default_qa_required_for_issue_type,
    normalize_issue_type, normalize_required_markdown, normalize_subtask_plan_inputs,
    normalize_title_key, validate_parent_relationships_for_create,
    validate_parent_relationships_for_update, validate_plan_subtask_rules, validate_transition,
    AppService,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{
    AgentSessionDocument, CreateTaskInput, IssueType, PlanSubtaskInput, QaVerdict, SpecDocument,
    TaskCard, TaskMetadata, TaskStatus, UpdateTaskPatch,
};
use std::collections::HashSet;
use std::path::Path;

impl AppService {
    pub fn tasks_list(&self, repo_path: &str) -> Result<Vec<TaskCard>> {
        self.ensure_repo_initialized(repo_path)?;
        let tasks = self.task_store.list_tasks(Path::new(repo_path))?;
        Ok(self.enrich_tasks(tasks))
    }

    pub fn task_create(&self, repo_path: &str, mut input: CreateTaskInput) -> Result<TaskCard> {
        self.ensure_repo_initialized(repo_path)?;
        if input.ai_review_enabled.is_none() {
            input.ai_review_enabled = Some(default_qa_required_for_issue_type(&input.issue_type));
        }

        let mut existing = self.task_store.list_tasks(Path::new(repo_path))?;
        validate_parent_relationships_for_create(&existing, &input)?;

        let created = self.task_store.create_task(Path::new(repo_path), input)?;
        existing.push(created.clone());
        Ok(self.enrich_task(created, &existing))
    }

    pub fn task_update(
        &self,
        repo_path: &str,
        task_id: &str,
        mut patch: UpdateTaskPatch,
    ) -> Result<TaskCard> {
        self.ensure_repo_initialized(repo_path)?;
        if patch.status.is_some() {
            return Err(anyhow!(
                "Status cannot be updated directly. Use workflow transitions."
            ));
        }
        if let Some(issue_type) = patch.issue_type.as_ref() {
            patch.issue_type = Some(normalize_issue_type(issue_type).as_cli_value().to_string());
        }

        let mut existing = self.task_store.list_tasks(Path::new(repo_path))?;
        let current = existing
            .iter()
            .find(|task| task.id == task_id)
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;
        validate_parent_relationships_for_update(&existing, current, &patch)?;

        let updated = self
            .task_store
            .update_task(Path::new(repo_path), task_id, patch)?;
        if let Some(index) = existing.iter().position(|task| task.id == task_id) {
            existing[index] = updated.clone();
        }
        Ok(self.enrich_task(updated, &existing))
    }

    pub fn task_delete(&self, repo_path: &str, task_id: &str, delete_subtasks: bool) -> Result<()> {
        self.ensure_repo_initialized(repo_path)?;
        let tasks = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = tasks
            .iter()
            .find(|entry| entry.id == task_id)
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;

        let direct_subtask_ids = tasks
            .iter()
            .filter(|entry| entry.parent_id.as_deref() == Some(task.id.as_str()))
            .map(|entry| entry.id.clone())
            .collect::<Vec<_>>();

        if !direct_subtask_ids.is_empty() && !delete_subtasks {
            return Err(anyhow!(
                "Task {task_id} has {} subtasks. Confirm subtask deletion to continue.",
                direct_subtask_ids.len()
            ));
        }

        self.task_store
            .delete_task(Path::new(repo_path), task_id, delete_subtasks)
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
        self.ensure_repo_initialized(repo_path)?;
        let mut existing = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = existing
            .iter()
            .find(|entry| entry.id == task_id)
            .cloned()
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;

        validate_transition(&task, &existing, &task.status, &target_status)?;

        if task.status == target_status {
            return Ok(self.enrich_task(task, &existing));
        }

        let updated = self.task_store.update_task(
            Path::new(repo_path),
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

        if let Some(index) = existing.iter().position(|entry| entry.id == task_id) {
            existing[index] = updated.clone();
        }

        Ok(self.enrich_task(updated, &existing))
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
        self.ensure_repo_initialized(repo_path)?;
        let tasks = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = tasks
            .iter()
            .find(|entry| entry.id == task_id)
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;
        let next_status = if task.ai_review_enabled {
            TaskStatus::AiReview
        } else {
            TaskStatus::HumanReview
        };

        self.task_transition(repo_path, task_id, next_status, Some("Builder completed"))
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
        self.ensure_repo_initialized(repo_path)?;
        let existing = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = existing
            .iter()
            .find(|entry| entry.id == task_id)
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;

        if task.parent_id.is_some() {
            return Err(anyhow!("Subtasks cannot be deferred."));
        }

        if !super::workflow_rules::is_open_state(&task.status) {
            return Err(anyhow!("Only non-closed open-state tasks can be deferred."));
        }

        self.task_transition(
            repo_path,
            task_id,
            TaskStatus::Deferred,
            Some("Deferred by user"),
        )
    }

    pub fn task_resume_deferred(&self, repo_path: &str, task_id: &str) -> Result<TaskCard> {
        self.ensure_repo_initialized(repo_path)?;
        let existing = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = existing
            .iter()
            .find(|entry| entry.id == task_id)
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;
        if task.status != TaskStatus::Deferred {
            return Err(anyhow!("Task is not deferred: {task_id}"));
        }
        self.task_transition(
            repo_path,
            task_id,
            TaskStatus::Open,
            Some("Deferred task resumed"),
        )
    }

    pub fn task_metadata_get(&self, repo_path: &str, task_id: &str) -> Result<TaskMetadata> {
        self.ensure_repo_initialized(repo_path)?;
        self.task_store
            .get_task_metadata(Path::new(repo_path), task_id)
            .with_context(|| format!("Failed to load task metadata for {task_id}"))
    }

    pub fn spec_get(&self, repo_path: &str, task_id: &str) -> Result<SpecDocument> {
        Ok(self.task_metadata_get(repo_path, task_id)?.spec)
    }

    pub fn set_spec(&self, repo_path: &str, task_id: &str, markdown: &str) -> Result<SpecDocument> {
        self.ensure_repo_initialized(repo_path)?;
        let markdown = normalize_required_markdown(markdown, "spec")?;
        let tasks = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = tasks
            .iter()
            .find(|entry| entry.id == task_id)
            .cloned()
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;
        if !can_set_spec_from_status(&task.status) {
            return Err(anyhow!(
                "set_spec is only allowed from open/spec_ready (current: {})",
                task.status.as_cli_value()
            ));
        }

        let spec = self
            .task_store
            .set_spec(Path::new(repo_path), task_id, &markdown)
            .with_context(|| format!("Failed to persist spec markdown for {task_id}"))?;

        if task.status == TaskStatus::Open {
            self.task_transition(
                repo_path,
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
        self.ensure_repo_initialized(repo_path)?;
        let markdown = normalize_required_markdown(markdown, "spec")?;
        let tasks = self.task_store.list_tasks(Path::new(repo_path))?;
        if tasks.iter().all(|entry| entry.id != task_id) {
            return Err(anyhow!("Task not found: {task_id}"));
        }

        self.task_store
            .set_spec(Path::new(repo_path), task_id, &markdown)
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
        self.ensure_repo_initialized(repo_path)?;
        let markdown = normalize_required_markdown(markdown, "implementation plan")?;
        let tasks = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = tasks
            .iter()
            .find(|entry| entry.id == task_id)
            .cloned()
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;
        if !can_set_plan(&task) {
            return Err(anyhow!(
                "set_plan is not allowed for issue type {} from status {}",
                task.issue_type.as_cli_value(),
                task.status.as_cli_value()
            ));
        }

        let issue_type = task.issue_type.clone();
        let mut subtask_creates = normalize_subtask_plan_inputs(subtasks.unwrap_or_default())?;
        validate_plan_subtask_rules(&task, &tasks, &subtask_creates)?;
        if issue_type != IssueType::Epic {
            subtask_creates.clear();
        }

        let plan = self
            .task_store
            .set_plan(Path::new(repo_path), task_id, &markdown)
            .with_context(|| format!("Failed to persist implementation plan for {task_id}"))?;

        if issue_type == IssueType::Epic {
            let mut current_tasks = self.task_store.list_tasks(Path::new(repo_path))?;
            let refreshed_task = current_tasks
                .iter()
                .find(|entry| entry.id == task_id)
                .cloned()
                .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;
            if !can_set_plan(&refreshed_task) {
                return Err(anyhow!(
                    "set_plan is not allowed for issue type {} from status {}",
                    refreshed_task.issue_type.as_cli_value(),
                    refreshed_task.status.as_cli_value()
                ));
            }

            let existing_direct_subtasks = current_tasks
                .iter()
                .filter(|entry| entry.parent_id.as_deref() == Some(task_id))
                .cloned()
                .collect::<Vec<_>>();
            let blocked_subtasks = existing_direct_subtasks
                .iter()
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
            let existing_direct_subtask_ids = existing_direct_subtasks
                .iter()
                .map(|entry| entry.id.clone())
                .collect::<Vec<_>>();
            let mut proposal_titles = HashSet::new();

            for existing_subtask_id in &existing_direct_subtask_ids {
                self.task_store
                    .delete_task(Path::new(repo_path), existing_subtask_id, false)
                    .with_context(|| {
                        format!("Failed to delete replaced subtask {}", existing_subtask_id)
                    })?;
            }

            if !existing_direct_subtask_ids.is_empty() {
                let removed_ids = existing_direct_subtask_ids
                    .iter()
                    .map(String::as_str)
                    .collect::<HashSet<_>>();
                current_tasks.retain(|entry| !removed_ids.contains(entry.id.as_str()));
            }

            for mut create_input in subtask_creates {
                let title_key = normalize_title_key(&create_input.title);
                if !proposal_titles.insert(title_key) {
                    continue;
                }
                create_input.parent_id = Some(task_id.to_string());
                validate_parent_relationships_for_create(&current_tasks, &create_input)?;
                let created = self
                    .task_store
                    .create_task(Path::new(repo_path), create_input)?;
                current_tasks.push(created);
            }
        }

        self.task_transition(
            repo_path,
            task_id,
            TaskStatus::ReadyForDev,
            Some("Implementation plan ready"),
        )?;

        Ok(plan)
    }

    pub fn save_plan_document(
        &self,
        repo_path: &str,
        task_id: &str,
        markdown: &str,
    ) -> Result<SpecDocument> {
        self.ensure_repo_initialized(repo_path)?;
        let markdown = normalize_required_markdown(markdown, "implementation plan")?;
        let tasks = self.task_store.list_tasks(Path::new(repo_path))?;
        if tasks.iter().all(|entry| entry.id != task_id) {
            return Err(anyhow!("Task not found: {task_id}"));
        }

        self.task_store
            .set_plan(Path::new(repo_path), task_id, &markdown)
            .with_context(|| format!("Failed to persist implementation plan for {task_id}"))
    }

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
        self.ensure_repo_initialized(repo_path)?;
        let tasks = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = tasks
            .iter()
            .find(|entry| entry.id == task_id)
            .cloned()
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;
        validate_transition(&task, &tasks, &task.status, &TaskStatus::HumanReview)?;

        self.task_store
            .append_qa_report(Path::new(repo_path), task_id, markdown, QaVerdict::Approved)
            .with_context(|| format!("Failed to persist QA report for {task_id}"))?;

        self.task_transition(
            repo_path,
            task_id,
            TaskStatus::HumanReview,
            Some("QA approved"),
        )
    }

    pub fn qa_rejected(&self, repo_path: &str, task_id: &str, markdown: &str) -> Result<TaskCard> {
        self.ensure_repo_initialized(repo_path)?;
        let tasks = self.task_store.list_tasks(Path::new(repo_path))?;
        let task = tasks
            .iter()
            .find(|entry| entry.id == task_id)
            .cloned()
            .ok_or_else(|| anyhow!("Task not found: {task_id}"))?;
        validate_transition(&task, &tasks, &task.status, &TaskStatus::InProgress)?;

        self.task_store
            .append_qa_report(Path::new(repo_path), task_id, markdown, QaVerdict::Rejected)
            .with_context(|| format!("Failed to persist QA report for {task_id}"))?;

        self.task_transition(
            repo_path,
            task_id,
            TaskStatus::InProgress,
            Some("QA requested changes"),
        )
    }

    pub fn agent_sessions_list(
        &self,
        repo_path: &str,
        task_id: &str,
    ) -> Result<Vec<AgentSessionDocument>> {
        Ok(self.task_metadata_get(repo_path, task_id)?.agent_sessions)
    }

    pub fn agent_session_upsert(
        &self,
        repo_path: &str,
        task_id: &str,
        mut session: AgentSessionDocument,
    ) -> Result<bool> {
        self.ensure_repo_initialized(repo_path)?;
        if session.task_id != task_id {
            session.task_id = task_id.to_string();
        }
        self.task_store
            .upsert_agent_session(Path::new(repo_path), task_id, session)
            .with_context(|| format!("Failed to persist agent session for {task_id}"))?;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use crate::app_service::test_support::{build_service_with_state, make_task};
    use host_domain::{TaskStatus, UpdateTaskPatch};

    #[test]
    fn module_task_update_rejects_direct_status_patch() {
        let (service, _task_state, _git_state) =
            build_service_with_state(vec![make_task("task-1", "task", TaskStatus::Open)]);

        let patch = UpdateTaskPatch {
            title: None,
            description: None,
            acceptance_criteria: None,
            notes: None,
            status: Some(TaskStatus::Closed),
            priority: None,
            issue_type: None,
            ai_review_enabled: None,
            labels: None,
            assignee: None,
            parent_id: None,
        };

        let error = service
            .task_update("/tmp/odt-repo-module", "task-1", patch)
            .expect_err("status patch should be rejected");

        assert!(error
            .to_string()
            .contains("Status cannot be updated directly"));
    }

    #[test]
    fn module_task_resume_deferred_requires_deferred_status() {
        let (service, _task_state, _git_state) =
            build_service_with_state(vec![make_task("task-1", "task", TaskStatus::Open)]);

        let error = service
            .task_resume_deferred("/tmp/odt-repo-module", "task-1")
            .expect_err("resume should fail outside deferred status");

        assert!(error.to_string().contains("Task is not deferred: task-1"));
    }
}
