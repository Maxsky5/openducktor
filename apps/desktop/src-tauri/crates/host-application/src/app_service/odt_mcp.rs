use super::workflow_rules::normalize_title_key;
use super::AppService;
use anyhow::{anyhow, Result};
use host_domain::{
    CreateTaskInput, IssueType, PlanSubtaskInput, PullRequestRecord, QaWorkflowVerdict,
    SpecDocument, TaskCard, TaskMetadata, TaskStatus, TASK_METADATA_NAMESPACE,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

const MAX_TASK_CANDIDATES: usize = 5;
const ODT_MCP_TOOL_NAMES: [&str; 12] = [
    "create_task",
    "search_tasks",
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtPublicTask {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: TaskStatus,
    pub priority: i32,
    pub issue_type: IssueType,
    pub ai_review_enabled: bool,
    pub labels: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtTaskDocumentPresence {
    pub has_spec: bool,
    pub has_plan: bool,
    pub has_qa_report: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtTaskSummaryTask {
    #[serde(flatten)]
    pub task: OdtPublicTask,
    pub qa_verdict: QaWorkflowVerdict,
    pub documents: OdtTaskDocumentPresence,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtTaskSummary {
    pub task: OdtTaskSummaryTask,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OdtRequestedDocuments {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec: Option<OdtMarkdownDocument>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub implementation_plan: Option<OdtMarkdownDocument>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_qa_report: Option<OdtQaReportDocument>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtTaskDocumentsRead {
    pub documents: OdtRequestedDocuments,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtMarkdownDocument {
    pub markdown: String,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtQaReportDocument {
    pub markdown: String,
    pub updated_at: Option<String>,
    pub verdict: QaWorkflowVerdict,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtPersistedDocument {
    pub markdown: String,
    pub updated_at: String,
    pub revision: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtSetSpecResult {
    pub task: OdtPublicTask,
    pub document: OdtPersistedDocument,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtSetPlanResult {
    pub task: OdtPublicTask,
    pub document: OdtPersistedDocument,
    pub created_subtask_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtBuildBlockedResult {
    pub task: OdtPublicTask,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtTaskResult {
    pub task: OdtPublicTask,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtBuildCompletedResult {
    pub task: OdtPublicTask,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtSetPullRequestResult {
    pub task: OdtPublicTask,
    pub pull_request: PullRequestRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtSearchTasksInput {
    pub priority: Option<i32>,
    pub issue_type: Option<IssueType>,
    pub status: Option<TaskStatus>,
    pub title: Option<String>,
    pub tags: Option<Vec<String>>,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtSearchTasksResult {
    pub results: Vec<OdtTaskSummary>,
    pub limit: usize,
    pub total_count: usize,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtCreateTaskInput {
    pub title: String,
    pub issue_type: IssueType,
    pub priority: i32,
    pub description: Option<String>,
    pub labels: Option<Vec<String>>,
    pub ai_review_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtHostBridgeReady {
    pub bridge_version: u8,
    pub repo_path: String,
    pub metadata_namespace: String,
    pub tool_names: Vec<String>,
}

fn sanitize_slug(input: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;

    for ch in input.chars() {
        let lower = ch.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() {
            slug.push(lower);
            last_dash = false;
            continue;
        }
        if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }

    slug.trim_matches('-').to_string()
}

fn format_task_ref(task: &TaskCard) -> String {
    format!("{} ({})", task.id, task.title)
}

fn qa_verdict(task: &TaskCard) -> QaWorkflowVerdict {
    task.document_summary.qa_report.verdict.clone()
}

fn map_public_task(task: &TaskCard) -> OdtPublicTask {
    OdtPublicTask {
        id: task.id.clone(),
        title: task.title.clone(),
        description: task.description.clone(),
        status: task.status.clone(),
        priority: task.priority,
        issue_type: task.issue_type.clone(),
        ai_review_enabled: task.ai_review_enabled,
        labels: task.labels.clone(),
        created_at: task.created_at.clone(),
        updated_at: task.updated_at.clone(),
    }
}

fn map_task_summary(task: &TaskCard) -> OdtTaskSummary {
    OdtTaskSummary {
        task: OdtTaskSummaryTask {
            task: map_public_task(task),
            qa_verdict: qa_verdict(task),
            documents: OdtTaskDocumentPresence {
                has_spec: task.document_summary.spec.has,
                has_plan: task.document_summary.plan.has,
                has_qa_report: task.document_summary.qa_report.has,
            },
        },
    }
}

fn map_markdown_document(document: SpecDocument) -> OdtMarkdownDocument {
    OdtMarkdownDocument {
        markdown: document.markdown,
        updated_at: document.updated_at,
    }
}

fn map_task_documents(
    metadata: TaskMetadata,
    include_spec: bool,
    include_plan: bool,
    include_qa: bool,
) -> OdtTaskDocumentsRead {
    OdtTaskDocumentsRead {
        documents: OdtRequestedDocuments {
            spec: include_spec.then(|| map_markdown_document(metadata.spec)),
            implementation_plan: include_plan.then(|| map_markdown_document(metadata.plan)),
            latest_qa_report: if include_qa {
                metadata.qa_report.map(|report| OdtQaReportDocument {
                    markdown: report.markdown,
                    updated_at: Some(report.updated_at),
                    verdict: match report.verdict {
                        host_domain::QaVerdict::Approved => QaWorkflowVerdict::Approved,
                        host_domain::QaVerdict::Rejected => QaWorkflowVerdict::Rejected,
                    },
                })
            } else {
                None
            },
        },
    }
}

fn map_persisted_document(document: SpecDocument, action: &str) -> Result<OdtPersistedDocument> {
    let updated_at = document
        .updated_at
        .ok_or_else(|| anyhow!("{action} did not return an updatedAt timestamp"))?;
    let revision = document
        .revision
        .ok_or_else(|| anyhow!("{action} did not return a document revision"))?;

    Ok(OdtPersistedDocument {
        markdown: document.markdown,
        updated_at,
        revision,
    })
}

fn is_active_status(status: &TaskStatus) -> bool {
    matches!(
        status,
        TaskStatus::Open
            | TaskStatus::SpecReady
            | TaskStatus::ReadyForDev
            | TaskStatus::InProgress
            | TaskStatus::Blocked
            | TaskStatus::AiReview
            | TaskStatus::HumanReview
    )
}

fn direct_subtask_ids(tasks: &[TaskCard], parent_id: &str) -> HashSet<String> {
    tasks
        .iter()
        .filter(|task| task.parent_id.as_deref() == Some(parent_id))
        .map(|task| task.id.clone())
        .collect()
}

fn throw_ambiguous_task_identifier(
    requested_task_id: &str,
    matches: &[TaskCard],
) -> Result<TaskCard> {
    let candidates = matches
        .iter()
        .take(MAX_TASK_CANDIDATES)
        .map(format_task_ref)
        .collect::<Vec<_>>()
        .join(", ");
    Err(anyhow!(
        "Task identifier \"{}\" is ambiguous. Use exact task id. Candidates: {}",
        requested_task_id,
        candidates
    ))
}

fn resolve_task_reference(tasks: &[TaskCard], requested_task_id: &str) -> Result<TaskCard> {
    let requested_literal = requested_task_id.trim();
    if requested_literal.is_empty() {
        return Err(anyhow!("Missing taskId."));
    }

    let requested_lower = normalize_title_key(requested_literal);
    let requested_slug = sanitize_slug(requested_literal);

    if let Some(task) = tasks.iter().find(|task| task.id == requested_literal) {
        return Ok(task.clone());
    }

    let by_case_insensitive_id = tasks
        .iter()
        .filter(|task| normalize_title_key(&task.id) == requested_lower)
        .cloned()
        .collect::<Vec<_>>();
    if by_case_insensitive_id.len() == 1 {
        return Ok(by_case_insensitive_id[0].clone());
    }
    if by_case_insensitive_id.len() > 1 {
        return throw_ambiguous_task_identifier(requested_task_id, &by_case_insensitive_id);
    }

    if !requested_slug.is_empty() {
        let by_id_suffix = tasks
            .iter()
            .filter(|task| {
                let normalized_id = normalize_title_key(&task.id);
                normalized_id == requested_slug
                    || normalized_id
                        .split('-')
                        .any(|suffix| !suffix.is_empty() && suffix == requested_slug)
            })
            .cloned()
            .collect::<Vec<_>>();
        if by_id_suffix.len() == 1 {
            return Ok(by_id_suffix[0].clone());
        }
        if by_id_suffix.len() > 1 {
            return throw_ambiguous_task_identifier(requested_task_id, &by_id_suffix);
        }
    }

    let by_title_exact = tasks
        .iter()
        .filter(|task| normalize_title_key(&task.title) == requested_lower)
        .cloned()
        .collect::<Vec<_>>();
    if by_title_exact.len() == 1 {
        return Ok(by_title_exact[0].clone());
    }
    if by_title_exact.len() > 1 {
        return throw_ambiguous_task_identifier(requested_task_id, &by_title_exact);
    }

    if !requested_slug.is_empty() {
        let by_title_slug_exact = tasks
            .iter()
            .filter(|task| sanitize_slug(&task.title) == requested_slug)
            .cloned()
            .collect::<Vec<_>>();
        if by_title_slug_exact.len() == 1 {
            return Ok(by_title_slug_exact[0].clone());
        }
        if by_title_slug_exact.len() > 1 {
            return throw_ambiguous_task_identifier(requested_task_id, &by_title_slug_exact);
        }
    }

    let by_title_contains = tasks
        .iter()
        .filter(|task| {
            let title_lower = normalize_title_key(&task.title);
            let title_slug = sanitize_slug(&task.title);
            (!requested_lower.is_empty() && title_lower.contains(&requested_lower))
                || (!requested_slug.is_empty() && title_slug.contains(&requested_slug))
        })
        .take(MAX_TASK_CANDIDATES + 1)
        .cloned()
        .collect::<Vec<_>>();
    if by_title_contains.len() == 1 {
        return Ok(by_title_contains[0].clone());
    }
    if by_title_contains.len() > 1 {
        return throw_ambiguous_task_identifier(requested_task_id, &by_title_contains);
    }

    let hints = tasks
        .iter()
        .filter(|task| {
            let id_lower = normalize_title_key(&task.id);
            let title_lower = normalize_title_key(&task.title);
            let title_slug = sanitize_slug(&task.title);
            (!requested_lower.is_empty()
                && (id_lower.contains(&requested_lower) || title_lower.contains(&requested_lower)))
                || (!requested_slug.is_empty()
                    && (id_lower.contains(&requested_slug) || title_slug.contains(&requested_slug)))
        })
        .take(MAX_TASK_CANDIDATES)
        .map(format_task_ref)
        .collect::<Vec<_>>();
    let candidates = if hints.is_empty() {
        tasks
            .iter()
            .take(MAX_TASK_CANDIDATES)
            .map(format_task_ref)
            .collect::<Vec<_>>()
    } else {
        hints
    };

    if candidates.is_empty() {
        return Err(anyhow!("Task not found: {}.", requested_task_id));
    }

    Err(anyhow!(
        "Task not found: {}. Candidate task ids: {}",
        requested_task_id,
        candidates.join(", ")
    ))
}

impl AppService {
    pub fn odt_mcp_ready(&self, repo_path: &str) -> Result<OdtHostBridgeReady> {
        let repo_path = self.resolve_task_repo_path(repo_path)?;
        Ok(OdtHostBridgeReady {
            bridge_version: 1,
            repo_path,
            metadata_namespace: TASK_METADATA_NAMESPACE.to_string(),
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
            return Err(anyhow!("Epic creation is not supported by create_task."));
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

#[cfg(test)]
mod tests {
    use super::*;
    use host_domain::{
        IssueType, TaskCard, TaskDocumentPresence, TaskDocumentSummary, TaskQaDocumentPresence,
    };

    fn task(id: &str, title: &str) -> TaskCard {
        TaskCard {
            id: id.to_string(),
            title: title.to_string(),
            description: String::new(),
            notes: String::new(),
            status: TaskStatus::Open,
            priority: 2,
            issue_type: IssueType::Task,
            ai_review_enabled: true,
            available_actions: Vec::new(),
            labels: Vec::new(),
            assignee: None,
            parent_id: None,
            subtask_ids: Vec::new(),
            agent_sessions: Vec::new(),
            pull_request: None,
            document_summary: TaskDocumentSummary {
                spec: TaskDocumentPresence::default(),
                plan: TaskDocumentPresence::default(),
                qa_report: TaskQaDocumentPresence::default(),
            },
            agent_workflows: host_domain::AgentWorkflows::default(),
            updated_at: "2026-04-09T00:00:00Z".to_string(),
            created_at: "2026-04-09T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn resolve_task_reference_matches_unique_suffix() {
        let tasks = vec![task("alpha-wsp", "Alpha workflow")];
        let resolved = resolve_task_reference(&tasks, "wsp").expect("suffix should resolve");
        assert_eq!(resolved.id, "alpha-wsp");
    }

    #[test]
    fn resolve_task_reference_rejects_ambiguous_suffix() {
        let tasks = vec![
            task("alpha-wsp", "Alpha workflow"),
            task("beta-wsp", "Beta workflow"),
        ];
        let error = resolve_task_reference(&tasks, "wsp").expect_err("suffix should be ambiguous");
        assert!(error.to_string().contains("ambiguous"));
        assert!(error.to_string().contains("alpha-wsp"));
        assert!(error.to_string().contains("beta-wsp"));
    }
}
