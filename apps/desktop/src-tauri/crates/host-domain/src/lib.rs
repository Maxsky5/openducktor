mod document;
mod git;
mod runtime;
mod store;
mod system;
mod task;

pub use document::{
    AgentSessionDocument, AgentSessionModelSelection, AgentWorkflowState, AgentWorkflows,
    QaReportDocument, QaVerdict, QaWorkflowVerdict, SpecDocument, TaskDocumentPresence,
    TaskDocumentSummary, TaskMetadata, TaskQaDocumentPresence,
};
pub use git::{GitBranch, GitCurrentBranch, GitPort, GitPushSummary, GitWorktreeSummary};
pub use runtime::{AgentRuntimeSummary, RunEvent, RunState, RunSummary};
pub use store::TaskStore;
pub use system::{BeadsCheck, RuntimeCheck, SystemCheck, WorkspaceRecord};
pub use task::{
    CreateTaskInput, IssueType, PlanSubtaskInput, TaskAction, TaskCard, TaskStatus, UpdateTaskPatch,
};

pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::{now_rfc3339, IssueType, TaskStatus};

    #[test]
    fn task_status_cli_roundtrip() {
        let statuses = [
            TaskStatus::Open,
            TaskStatus::SpecReady,
            TaskStatus::ReadyForDev,
            TaskStatus::InProgress,
            TaskStatus::Blocked,
            TaskStatus::AiReview,
            TaskStatus::HumanReview,
            TaskStatus::Deferred,
            TaskStatus::Closed,
        ];

        for status in statuses {
            let raw = status.as_cli_value();
            let parsed = TaskStatus::from_cli_value(raw).expect("status should parse");
            assert_eq!(parsed, status);
        }
    }

    #[test]
    fn task_status_rejects_unknown_value() {
        assert!(TaskStatus::from_cli_value("backlog").is_none());
        assert!(TaskStatus::from_cli_value("").is_none());
    }

    #[test]
    fn issue_type_cli_roundtrip() {
        let issue_types = [
            IssueType::Task,
            IssueType::Feature,
            IssueType::Bug,
            IssueType::Epic,
        ];

        for issue_type in issue_types {
            let raw = issue_type.as_cli_value();
            let parsed = IssueType::from_cli_value(raw).expect("issue type should parse");
            assert_eq!(parsed, issue_type);
        }
    }

    #[test]
    fn issue_type_rejects_unknown_value() {
        assert!(IssueType::from_cli_value("event").is_none());
        assert!(IssueType::from_cli_value("").is_none());
    }

    #[test]
    fn now_rfc3339_returns_parseable_timestamp() {
        let timestamp = now_rfc3339();
        assert!(!timestamp.trim().is_empty());
        assert!(chrono::DateTime::parse_from_rfc3339(&timestamp).is_ok());
    }

    #[test]
    fn public_api_exports_compile() {
        use super::{
            AgentRuntimeSummary, AgentSessionDocument, AgentSessionModelSelection,
            AgentWorkflowState, AgentWorkflows, BeadsCheck, CreateTaskInput, GitBranch,
            GitCurrentBranch, GitPort, GitPushSummary, GitWorktreeSummary, IssueType,
            PlanSubtaskInput, QaReportDocument, QaVerdict, QaWorkflowVerdict, RunEvent, RunState,
            RunSummary, RuntimeCheck, SpecDocument, SystemCheck, TaskAction, TaskCard,
            TaskDocumentPresence, TaskDocumentSummary, TaskMetadata, TaskQaDocumentPresence,
            TaskStatus, TaskStore, UpdateTaskPatch, WorkspaceRecord,
        };

        let _: Option<AgentRuntimeSummary> = None;
        let _: Option<AgentSessionDocument> = None;
        let _: Option<AgentSessionModelSelection> = None;
        let _: Option<AgentWorkflowState> = None;
        let _: Option<AgentWorkflows> = None;
        let _: Option<BeadsCheck> = None;
        let _: Option<CreateTaskInput> = None;
        let _: Option<GitBranch> = None;
        let _: Option<GitCurrentBranch> = None;
        let _: Option<GitPushSummary> = None;
        let _: Option<GitWorktreeSummary> = None;
        let _: Option<IssueType> = None;
        let _: Option<PlanSubtaskInput> = None;
        let _: Option<QaReportDocument> = None;
        let _: Option<QaVerdict> = None;
        let _: Option<QaWorkflowVerdict> = None;
        let _: Option<RunEvent> = None;
        let _: Option<RunState> = None;
        let _: Option<RunSummary> = None;
        let _: Option<RuntimeCheck> = None;
        let _: Option<SpecDocument> = None;
        let _: Option<SystemCheck> = None;
        let _: Option<TaskAction> = None;
        let _: Option<TaskCard> = None;
        let _: Option<TaskDocumentPresence> = None;
        let _: Option<TaskDocumentSummary> = None;
        let _: Option<TaskMetadata> = None;
        let _: Option<TaskQaDocumentPresence> = None;
        let _: Option<TaskStatus> = None;
        let _: Option<UpdateTaskPatch> = None;
        let _: Option<WorkspaceRecord> = None;
        let _: Option<&dyn GitPort> = None;
        let _: Option<&dyn TaskStore> = None;
    }
}
