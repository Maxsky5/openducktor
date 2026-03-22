use anyhow::Result;
use host_domain::{AgentWorkflows, PullRequestRecord, TaskCard};

use crate::metadata::{
    metadata_bool_qa_required, metadata_document_summary, metadata_namespace, parse_metadata_root,
};
use crate::model::RawIssue;
use crate::normalize::{
    default_ai_review_enabled, normalize_labels, parse_issue_type, parse_task_status,
};
use crate::store::BeadsTaskStore;

impl BeadsTaskStore {
    pub(crate) fn parse_task_card(
        &self,
        issue: RawIssue,
        metadata_namespace_key: &str,
    ) -> Result<TaskCard> {
        let issue_type = parse_issue_type(&issue.id, &issue.issue_type)?;
        let status = parse_task_status(&issue.id, &issue.status)?;

        let metadata_root = parse_metadata_root(issue.metadata);
        let namespace = metadata_namespace(&metadata_root, metadata_namespace_key);
        let ai_review_enabled = namespace
            .and_then(metadata_bool_qa_required)
            .unwrap_or_else(|| default_ai_review_enabled(&issue_type));
        let document_summary = metadata_document_summary(namespace);
        let pull_request = parse_pull_request_metadata(namespace);
        let mut agent_sessions = namespace
            .and_then(|ns| ns.get("agentSessions"))
            .and_then(crate::metadata::parse_agent_sessions)
            .unwrap_or_default();
        agent_sessions.sort_by(|a, b| b.started_at.cmp(&a.started_at));

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
            notes: issue.notes,
            status,
            priority: issue.priority,
            issue_type,
            ai_review_enabled,
            available_actions: Vec::new(),
            labels: normalize_labels(issue.labels),
            assignee: issue.owner,
            parent_id,
            subtask_ids: Vec::new(),
            agent_sessions,
            pull_request,
            document_summary,
            agent_workflows: AgentWorkflows::default(),
            updated_at: issue.updated_at,
            created_at: issue.created_at,
        })
    }
}

fn parse_pull_request_metadata(
    namespace: Option<&serde_json::Map<String, serde_json::Value>>,
) -> Option<PullRequestRecord> {
    let root_value = namespace.and_then(|ns| ns.get("pullRequest"));
    let legacy_value = namespace
        .and_then(|ns| ns.get("delivery"))
        .and_then(serde_json::Value::as_object)
        .and_then(|delivery| delivery.get("linkedPullRequest"));

    root_value
        .or(legacy_value)
        .and_then(|value| serde_json::from_value(value.clone()).ok())
}
