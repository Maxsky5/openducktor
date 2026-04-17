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
    use crate::app_service::test_support::{
        build_service_with_state, init_git_repo, unique_temp_path, workspace_id_for_repo_path,
    };
    use crate::app_service::AppService;
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
            target_branch: None,
            target_branch_error: None,
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

    fn create_workspace_id(service: &AppService, label: &str) -> String {
        let repo_path = unique_temp_path(label);
        init_git_repo(&repo_path).expect("test repo should initialize");
        let repo_path = repo_path.to_string_lossy().to_string();
        service
            .workspace_add(repo_path.as_str())
            .expect("workspace should be created");
        workspace_id_for_repo_path(service, repo_path.as_str())
            .expect("workspace id should resolve")
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
        let workspace_id = create_workspace_id(&service, "odt-mcp-create-task");

        let result = service
            .odt_create_task(
                workspace_id.as_str(),
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
        let workspace_id = create_workspace_id(&service, "odt-mcp-search-tasks");

        let result = service
            .odt_search_tasks(
                workspace_id.as_str(),
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
        let workspace_id = create_workspace_id(&service, "odt-mcp-read-empty-documents");

        let result = service
            .odt_read_task_documents(workspace_id.as_str(), "fairnest-4y3", true, true, true)
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
        let workspace_id = create_workspace_id(&service, "odt-mcp-read-qa-errors");
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
            .odt_read_task_documents(workspace_id.as_str(), "fairnest-4y3", false, false, true)
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

    #[test]
    fn odt_read_task_documents_preserves_spec_and_plan_decode_errors() {
        let (service, task_state, _) =
            build_service_with_state(vec![task("fairnest-4y3", "Fairnest")]);
        let workspace_id = create_workspace_id(&service, "odt-mcp-read-spec-plan-errors");
        {
            let mut state = task_state.lock().expect("task state lock poisoned");
            state.metadata_spec = Some(host_domain::SpecDocument {
                markdown: String::new(),
                updated_at: Some("2026-02-20T10:00:00Z".to_string()),
                revision: Some(1),
                error: Some(
                    "Failed to decode openducktor.documents.spec[0]: invalid base64 payload"
                        .to_string(),
                ),
            });
            state.metadata_plan = Some(host_domain::SpecDocument {
                markdown: String::new(),
                updated_at: Some("2026-02-20T11:00:00Z".to_string()),
                revision: Some(2),
                error: Some(
                    "Failed to decode openducktor.documents.implementationPlan[0]: invalid gzip payload"
                        .to_string(),
                ),
            });
        }

        let result = service
            .odt_read_task_documents(workspace_id.as_str(), "fairnest-4y3", true, true, false)
            .expect("read task documents should succeed");

        let spec = result
            .documents
            .spec
            .expect("spec should be present when requested");
        assert!(spec.markdown.is_empty());
        assert_eq!(spec.updated_at.as_deref(), Some("2026-02-20T10:00:00Z"));
        assert_eq!(
            spec.error.as_deref(),
            Some("Failed to decode openducktor.documents.spec[0]: invalid base64 payload"),
        );

        let plan = result
            .documents
            .implementation_plan
            .expect("plan should be present when requested");
        assert!(plan.markdown.is_empty());
        assert_eq!(plan.updated_at.as_deref(), Some("2026-02-20T11:00:00Z"));
        assert_eq!(
            plan.error.as_deref(),
            Some("Failed to decode openducktor.documents.implementationPlan[0]: invalid gzip payload"),
        );
    }
}
