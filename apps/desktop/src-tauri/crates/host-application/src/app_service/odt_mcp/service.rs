use std::collections::HashSet;

use anyhow::{anyhow, Result};
use host_domain::{CreateTaskInput, IssueType, PlanSubtaskInput};

use super::super::AppService;
use super::mapping::{
    direct_subtask_ids, is_active_status, map_persisted_document, map_public_task,
    map_task_documents, map_task_summary,
};
use super::task_resolution::resolve_task_reference;
use super::types::{
    OdtBuildBlockedResult, OdtBuildCompletedResult, OdtCreateTaskInput, OdtHostBridgeReady,
    OdtSearchTasksInput, OdtSearchTasksResult, OdtSetPlanResult, OdtSetPullRequestResult,
    OdtSetSpecResult, OdtTaskDocumentsRead, OdtTaskResult, OdtTaskSummary,
};
use crate::app_service::workflow_rules::normalize_title_key;

pub(super) const ODT_MCP_TOOL_NAMES: [&str; 12] = [
    "odt_create_task",
    "odt_search_tasks",
    "odt_read_task",
    "odt_read_task_documents",
    "odt_set_spec",
    "odt_set_plan",
    "odt_build_blocked",
    "odt_build_resumed",
    "odt_build_completed",
    "odt_set_pull_request",
    "odt_qa_approved",
    "odt_qa_rejected",
];

impl AppService {
    pub fn odt_mcp_ready(&self, repo_path: &str) -> Result<OdtHostBridgeReady> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        Ok(OdtHostBridgeReady {
            bridge_version: 1,
            repo_path,
            tool_names: ODT_MCP_TOOL_NAMES
                .iter()
                .map(|name| name.to_string())
                .collect(),
        })
    }

    pub fn odt_read_task(&self, repo_path: &str, task_id: &str) -> Result<OdtTaskSummary> {
        let tasks = self.tasks_list(repo_path)?;
        let task = resolve_task_reference(&tasks, task_id)?;
        Ok(map_task_summary(&task))
    }

    pub fn odt_read_task_documents(
        &self,
        repo_path: &str,
        task_id: &str,
        include_spec: bool,
        include_plan: bool,
        include_qa_report: bool,
    ) -> Result<OdtTaskDocumentsRead> {
        let tasks = self.tasks_list(repo_path)?;
        let task = resolve_task_reference(&tasks, task_id)?;
        let metadata = self.task_metadata_get(repo_path, &task.id)?;
        Ok(map_task_documents(
            metadata,
            include_spec,
            include_plan,
            include_qa_report,
        ))
    }

    pub fn odt_create_task(
        &self,
        repo_path: &str,
        input: OdtCreateTaskInput,
    ) -> Result<OdtTaskSummary> {
        if input.issue_type == IssueType::Epic {
            return Err(anyhow!(
                "Epic creation is not supported by odt_create_task."
            ));
        }

        let task = self.task_create(
            repo_path,
            CreateTaskInput {
                title: input.title,
                issue_type: input.issue_type,
                priority: input.priority,
                description: input.description,
                labels: input.labels,
                ai_review_enabled: input.ai_review_enabled,
                parent_id: None,
            },
        )?;
        Ok(map_task_summary(&task))
    }

    pub fn odt_search_tasks(
        &self,
        repo_path: &str,
        input: OdtSearchTasksInput,
    ) -> Result<OdtSearchTasksResult> {
        let normalized_title = input.title.as_ref().map(|value| normalize_title_key(value));
        let normalized_tags = input.tags.as_ref().map(|tags| {
            tags.iter()
                .map(|tag| normalize_title_key(tag))
                .collect::<HashSet<_>>()
        });

        let matching = self
            .tasks_list(repo_path)?
            .into_iter()
            .filter(|task| is_active_status(&task.status))
            .filter(|task| match input.priority {
                Some(priority) => task.priority == priority,
                None => true,
            })
            .filter(|task| match input.issue_type.as_ref() {
                Some(issue_type) => &task.issue_type == issue_type,
                None => true,
            })
            .filter(|task| match input.status.as_ref() {
                Some(status) => &task.status == status,
                None => true,
            })
            .filter(|task| match normalized_title.as_ref() {
                Some(title) => normalize_title_key(&task.title).contains(title),
                None => true,
            })
            .filter(|task| match normalized_tags.as_ref() {
                Some(tags) => {
                    let task_tags = task
                        .labels
                        .iter()
                        .map(|label| normalize_title_key(label))
                        .collect::<HashSet<_>>();
                    tags.iter().all(|tag| task_tags.contains(tag))
                }
                None => true,
            })
            .collect::<Vec<_>>();

        let total_count = matching.len();
        let results = matching
            .into_iter()
            .take(input.limit)
            .map(|task| map_task_summary(&task))
            .collect::<Vec<_>>();

        Ok(OdtSearchTasksResult {
            has_more: total_count > results.len(),
            limit: input.limit,
            total_count,
            results,
        })
    }

    pub fn odt_set_spec(
        &self,
        repo_path: &str,
        task_id: &str,
        markdown: &str,
    ) -> Result<OdtSetSpecResult> {
        let tasks = self.tasks_list(repo_path)?;
        let task = resolve_task_reference(&tasks, task_id)?;
        let document = self.set_spec(repo_path, &task.id, markdown)?;
        let updated = self.odt_read_task(repo_path, &task.id)?;

        Ok(OdtSetSpecResult {
            task: updated.task.task,
            document: map_persisted_document(document, "odt_set_spec")?,
        })
    }

    pub fn odt_set_plan(
        &self,
        repo_path: &str,
        task_id: &str,
        markdown: &str,
        subtasks: Option<Vec<PlanSubtaskInput>>,
    ) -> Result<OdtSetPlanResult> {
        let before_tasks = self.tasks_list(repo_path)?;
        let task = resolve_task_reference(&before_tasks, task_id)?;
        let previous_subtask_ids = direct_subtask_ids(&before_tasks, &task.id);
        let document = self.set_plan(repo_path, &task.id, markdown, subtasks)?;
        let after_tasks = self.tasks_list(repo_path)?;
        let updated_task = resolve_task_reference(&after_tasks, &task.id)?;
        let created_subtask_ids = after_tasks
            .iter()
            .filter(|entry| entry.parent_id.as_deref() == Some(task.id.as_str()))
            .filter(|entry| !previous_subtask_ids.contains(&entry.id))
            .map(|entry| entry.id.clone())
            .collect::<Vec<_>>();

        Ok(OdtSetPlanResult {
            task: map_public_task(&updated_task),
            document: map_persisted_document(document, "odt_set_plan")?,
            created_subtask_ids,
        })
    }

    pub fn odt_build_blocked(
        &self,
        repo_path: &str,
        task_id: &str,
        reason: &str,
    ) -> Result<OdtBuildBlockedResult> {
        let task = resolve_task_reference(&self.tasks_list(repo_path)?, task_id)?;
        let updated = self.build_blocked(repo_path, &task.id, Some(reason))?;
        Ok(OdtBuildBlockedResult {
            task: map_public_task(&updated),
            reason: reason.trim().to_string(),
        })
    }

    pub fn odt_build_resumed(&self, repo_path: &str, task_id: &str) -> Result<OdtTaskResult> {
        let task = resolve_task_reference(&self.tasks_list(repo_path)?, task_id)?;
        let updated = self.build_resumed(repo_path, &task.id)?;
        Ok(OdtTaskResult {
            task: map_public_task(&updated),
        })
    }

    pub fn odt_build_completed(
        &self,
        repo_path: &str,
        task_id: &str,
        summary: Option<String>,
    ) -> Result<OdtBuildCompletedResult> {
        let task = resolve_task_reference(&self.tasks_list(repo_path)?, task_id)?;
        let updated = self.build_completed(repo_path, &task.id, summary.as_deref())?;
        Ok(OdtBuildCompletedResult {
            task: map_public_task(&updated),
            summary,
        })
    }

    pub fn odt_set_pull_request(
        &self,
        repo_path: &str,
        task_id: &str,
        provider_id: &str,
        number: u32,
    ) -> Result<OdtSetPullRequestResult> {
        let task = resolve_task_reference(&self.tasks_list(repo_path)?, task_id)?;
        let pull_request = self.task_pull_request_link(repo_path, &task.id, provider_id, number)?;
        let updated = self.odt_read_task(repo_path, &task.id)?;

        Ok(OdtSetPullRequestResult {
            task: updated.task.task,
            pull_request,
        })
    }

    pub fn odt_qa_approved(
        &self,
        repo_path: &str,
        task_id: &str,
        markdown: &str,
    ) -> Result<OdtTaskResult> {
        let task = resolve_task_reference(&self.tasks_list(repo_path)?, task_id)?;
        let updated = self.qa_approved(repo_path, &task.id, markdown)?;
        Ok(OdtTaskResult {
            task: map_public_task(&updated),
        })
    }

    pub fn odt_qa_rejected(
        &self,
        repo_path: &str,
        task_id: &str,
        markdown: &str,
    ) -> Result<OdtTaskResult> {
        let task = resolve_task_reference(&self.tasks_list(repo_path)?, task_id)?;
        let updated = self.qa_rejected(repo_path, &task.id, markdown)?;
        Ok(OdtTaskResult {
            task: map_public_task(&updated),
        })
    }
}
