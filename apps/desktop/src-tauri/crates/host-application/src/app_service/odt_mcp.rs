mod mapping;
mod service;
mod task_resolution;
mod types;

pub use types::{
    OdtCreateTaskInput, OdtHostBridgeReady, OdtSearchTasksInput, OdtSearchTasksResult,
    OdtSetPlanResult, OdtSetPullRequestResult, OdtSetSpecResult, OdtTaskDocumentsRead,
    OdtTaskResult, OdtTaskSummary,
};

#[cfg(test)]
mod tests {
    use super::task_resolution::resolve_task_reference;
    use super::*;
    use crate::app_service::test_support::build_service_with_state;
    use host_domain::{
        AgentWorkflows, IssueType, TaskCard, TaskDocumentPresence, TaskDocumentSummary,
        TaskQaDocumentPresence,
    };

    fn task(id: &str, title: &str) -> TaskCard {
        TaskCard {
            id: id.to_string(),
            title: title.to_string(),
            description: String::new(),
            notes: String::new(),
            status: host_domain::TaskStatus::Open,
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
            agent_workflows: AgentWorkflows::default(),
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

    #[test]
    fn odt_create_task_returns_summary_for_created_task() {
        let (service, task_state, _) = build_service_with_state(Vec::new());

        let result = service
            .odt_create_task(
                "/repo",
                OdtCreateTaskInput {
                    title: "Bridge task".to_string(),
                    issue_type: IssueType::Task,
                    priority: 1,
                    description: Some("Created through host bridge".to_string()),
                    labels: Some(vec!["mcp".to_string()]),
                    ai_review_enabled: Some(true),
                },
            )
            .expect("create task should succeed");

        assert_eq!(result.task.task.title, "Bridge task");
        assert_eq!(result.task.task.issue_type, IssueType::Task);
        assert_eq!(
            result.task.qa_verdict,
            host_domain::QaWorkflowVerdict::NotReviewed
        );

        let state = task_state.lock().expect("task state lock poisoned");
        assert_eq!(state.created_inputs.len(), 1);
        assert_eq!(state.created_inputs[0].title, "Bridge task");
    }

    #[test]
    fn odt_search_tasks_returns_filtered_public_results() {
        let mut open = task("task-1", "Bridge work");
        open.labels = vec!["mcp".to_string()];

        let mut closed = task("task-2", "Closed work");
        closed.status = host_domain::TaskStatus::Closed;
        closed.labels = vec!["mcp".to_string()];

        let (service, _, _) = build_service_with_state(vec![open, closed]);

        let result = service
            .odt_search_tasks(
                "/repo",
                OdtSearchTasksInput {
                    priority: None,
                    issue_type: None,
                    status: Some(host_domain::TaskStatus::Open),
                    title: Some("bridge".to_string()),
                    tags: Some(vec!["mcp".to_string()]),
                    limit: 10,
                },
            )
            .expect("search should succeed");

        assert_eq!(result.total_count, 1);
        assert!(!result.has_more);
        assert_eq!(result.results.len(), 1);
        assert_eq!(result.results[0].task.task.id, "task-1");
    }

    #[test]
    fn odt_read_task_documents_returns_requested_empty_documents_consistently() {
        let (service, _, _) = build_service_with_state(vec![task("fairnest-4y3", "Fairnest")]);

        let result = service
            .odt_read_task_documents("/repo", "fairnest-4y3", true, true, true)
            .expect("read task documents should succeed");

        let spec = result
            .documents
            .spec
            .expect("spec should be present when requested");
        assert_eq!(spec.markdown, "");
        assert_eq!(spec.updated_at, None);

        let plan = result
            .documents
            .implementation_plan
            .expect("plan should be present when requested");
        assert_eq!(plan.markdown, "");
        assert_eq!(plan.updated_at, None);

        let qa = result
            .documents
            .latest_qa_report
            .expect("qa report should be present when requested");
        assert_eq!(qa.markdown, "");
        assert_eq!(qa.updated_at, None);
        assert_eq!(qa.verdict, host_domain::QaWorkflowVerdict::NotReviewed);
    }

    #[test]
    fn odt_read_task_documents_preserves_qa_decode_errors() {
        let (service, task_state, _) =
            build_service_with_state(vec![task("fairnest-4y3", "Fairnest")]);
        {
            let mut state = task_state.lock().expect("task state lock poisoned");
            state.latest_qa_report = Some(host_domain::QaReportDocument {
                markdown: String::new(),
                verdict: host_domain::QaWorkflowVerdict::Approved,
                updated_at: Some("2026-02-20T12:00:00Z".to_string()),
                revision: Some(2),
                error: Some(
                    "Failed to decode openducktor.documents.qaReports[0]: invalid base64 payload"
                        .to_string(),
                ),
            });
        }

        let result = service
            .odt_read_task_documents("/repo", "fairnest-4y3", false, false, true)
            .expect("read task documents should succeed");

        let qa = result
            .documents
            .latest_qa_report
            .expect("qa report should be present when requested");
        assert_eq!(qa.markdown, "");
        assert_eq!(qa.updated_at.as_deref(), Some("2026-02-20T12:00:00Z"));
        assert_eq!(qa.verdict, host_domain::QaWorkflowVerdict::Approved);
        assert_eq!(
            qa.error.as_deref(),
            Some("Failed to decode openducktor.documents.qaReports[0]: invalid base64 payload"),
        );
    }
}
