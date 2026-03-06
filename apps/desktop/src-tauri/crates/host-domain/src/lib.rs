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
pub use git::{
    GitAheadBehind, GitBranch, GitCommitAllRequest, GitCommitAllResult, GitCurrentBranch,
    GitDiffScope, GitFileDiff, GitFileStatus, GitFileStatusCounts, GitPort, GitPullRequest,
    GitPullResult, GitPushResult, GitRebaseAbortRequest, GitRebaseAbortResult,
    GitRebaseBranchRequest, GitRebaseBranchResult, GitUpstreamAheadBehind, GitWorktreeStatus,
    GitWorktreeStatusData, GitWorktreeStatusSnapshot, GitWorktreeStatusSummary,
    GitWorktreeStatusSummaryData, GitWorktreeSummary,
};
pub use runtime::{
    AgentRuntimeRole, AgentRuntimeSummary, RunEvent, RunState, RunSummary, RuntimeRole,
};
pub use store::TaskStore;
pub use system::{BeadsCheck, RuntimeCheck, SystemCheck, WorkspaceRecord};
pub use task::{
    CreateTaskInput, IssueType, PlanSubtaskInput, TaskAction, TaskCard, TaskStatus, UpdateTaskPatch,
};

pub const TASK_METADATA_NAMESPACE: &str = "openducktor";

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
            AgentRuntimeRole, AgentRuntimeSummary, AgentSessionDocument,
            AgentSessionModelSelection, AgentWorkflowState, AgentWorkflows, BeadsCheck,
            CreateTaskInput, GitBranch, GitCommitAllRequest, GitCommitAllResult, GitCurrentBranch,
            GitDiffScope, GitFileStatusCounts, GitPort, GitPullRequest, GitPullResult,
            GitPushResult, GitRebaseAbortRequest, GitRebaseAbortResult, GitRebaseBranchRequest,
            GitRebaseBranchResult, GitUpstreamAheadBehind, GitWorktreeStatus,
            GitWorktreeStatusData, GitWorktreeStatusSnapshot, GitWorktreeStatusSummary,
            GitWorktreeStatusSummaryData, GitWorktreeSummary, IssueType, PlanSubtaskInput,
            QaReportDocument, QaVerdict, QaWorkflowVerdict, RunEvent, RunState, RunSummary,
            RuntimeCheck, RuntimeRole, SpecDocument, SystemCheck, TaskAction, TaskCard,
            TaskDocumentPresence, TaskDocumentSummary, TaskMetadata, TaskQaDocumentPresence,
            TaskStatus, TaskStore, UpdateTaskPatch, WorkspaceRecord,
        };

        macro_rules! check_types_exported {
            ($($t:ty),* $(,)?) => {
                $(
                    let _: Option<$t> = None;
                )*
            };
        }

        check_types_exported!(
            AgentRuntimeSummary,
            AgentSessionDocument,
            AgentSessionModelSelection,
            AgentWorkflowState,
            AgentWorkflows,
            BeadsCheck,
            AgentRuntimeRole,
            CreateTaskInput,
            GitBranch,
            GitCommitAllRequest,
            GitCommitAllResult,
            GitCurrentBranch,
            GitDiffScope,
            GitFileStatusCounts,
            GitPullRequest,
            GitPullResult,
            GitPushResult,
            GitRebaseAbortRequest,
            GitRebaseAbortResult,
            GitRebaseBranchRequest,
            GitRebaseBranchResult,
            GitUpstreamAheadBehind,
            GitWorktreeStatus,
            GitWorktreeStatusData,
            GitWorktreeStatusSnapshot,
            GitWorktreeStatusSummary,
            GitWorktreeStatusSummaryData,
            GitWorktreeSummary,
            IssueType,
            PlanSubtaskInput,
            QaReportDocument,
            QaVerdict,
            QaWorkflowVerdict,
            RunEvent,
            RunState,
            RunSummary,
            RuntimeCheck,
            RuntimeRole,
            SpecDocument,
            SystemCheck,
            TaskAction,
            TaskCard,
            TaskDocumentPresence,
            TaskDocumentSummary,
            TaskMetadata,
            TaskQaDocumentPresence,
            TaskStatus,
            UpdateTaskPatch,
            WorkspaceRecord,
        );

        // Traits are unsized, so we validate exports via trait objects.
        let _: Option<&dyn GitPort> = None;
        let _: Option<&dyn TaskStore> = None;
    }
}
