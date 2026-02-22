use anyhow::{anyhow, Result};
use host_domain::{TaskCard, TaskStatus};

use crate::metadata::{
    metadata_bool_qa_required, metadata_document_summary, metadata_namespace, parse_metadata_root,
};
use crate::model::RawIssue;
use crate::normalize::{default_ai_review_enabled, normalize_issue_type, normalize_labels};
use crate::store::BeadsTaskStore;

impl BeadsTaskStore {
    pub(crate) fn parse_task_card(&self, issue: RawIssue) -> Result<TaskCard> {
        let status = TaskStatus::from_cli_value(&issue.status)
            .ok_or_else(|| anyhow!("Unknown task status from bd: {}", issue.status))?;

        let metadata_root = parse_metadata_root(issue.metadata);
        let namespace = metadata_namespace(&metadata_root, &self.metadata_namespace);
        let ai_review_enabled = namespace
            .and_then(metadata_bool_qa_required)
            .unwrap_or_else(|| default_ai_review_enabled(&issue.issue_type));
        let document_summary = metadata_document_summary(namespace);

        let normalized_issue_type = if issue.issue_type == "event" || issue.issue_type == "gate" {
            issue.issue_type.clone()
        } else {
            normalize_issue_type(&issue.issue_type).to_string()
        };

        let parent_id = issue.parent.or_else(|| {
            issue.dependencies.iter().find_map(|dependency| {
                if dependency.dependency_type != "parent-child" {
                    return None;
                }
                dependency
                    .depends_on_id
                    .clone()
                    .or_else(|| dependency.id.clone())
            })
        });

        Ok(TaskCard {
            id: issue.id,
            title: issue.title,
            description: issue.description,
            acceptance_criteria: issue.acceptance_criteria,
            notes: issue.notes,
            status,
            priority: issue.priority,
            issue_type: normalized_issue_type,
            ai_review_enabled,
            available_actions: Vec::new(),
            labels: normalize_labels(issue.labels),
            assignee: issue.owner,
            parent_id,
            subtask_ids: Vec::new(),
            document_summary,
            updated_at: issue.updated_at,
            created_at: issue.created_at,
        })
    }
}
