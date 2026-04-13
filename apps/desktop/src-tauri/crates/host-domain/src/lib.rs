mod document;
mod git;
mod runtime;
mod store;
mod system;
mod task;

pub use document::{
    AgentSessionDocument, AgentSessionModelSelection, AgentWorkflowState, AgentWorkflows,
    QaReportDocument, QaVerdict, QaWorkflowVerdict, SpecDocument, TaskDocumentPresence,
    TaskDocumentSummary, TaskMetadata, TaskQaDocumentPresence, ODT_QA_APPROVED_SOURCE_TOOL,
    ODT_QA_REJECTED_SOURCE_TOOL, ODT_SET_PLAN_SOURCE_TOOL, ODT_SET_SPEC_SOURCE_TOOL,
};
pub use git::{
    DirectMergeRecord, GitAheadBehind, GitBranch, GitCommitAllRequest, GitCommitAllResult,
    GitConflict, GitConflictAbortRequest, GitConflictAbortResult, GitConflictOperation,
    GitCurrentBranch, GitDiffScope, GitFileDiff, GitFileStatus, GitFileStatusCounts,
    GitMergeBranchRequest, GitMergeBranchResult, GitMergeMethod, GitPort, GitProviderAvailability,
    GitProviderRepository, GitPullRequest, GitPullResult, GitPushResult, GitRebaseAbortRequest,
    GitRebaseAbortResult, GitRebaseBranchRequest, GitRebaseBranchResult, GitResetSnapshot,
    GitResetWorktreeSelection, GitResetWorktreeSelectionRequest, GitResetWorktreeSelectionResult,
    GitTargetBranch, GitUpstreamAheadBehind, GitWorktreeStatus, GitWorktreeStatusData,
    GitWorktreeStatusSnapshot, GitWorktreeStatusSummary, GitWorktreeStatusSummaryData,
    GitWorktreeSummary, PullRequestRecord, TaskApprovalContext, TaskApprovalContextLoadResult,
    TaskPullRequestDetectResult,
};
pub use runtime::{
    AgentRuntimeKind, BuildContinuationTarget, BuildContinuationTargetSource, DevServerEvent,
    DevServerGroupState, DevServerScriptState, DevServerScriptStatus, DevServerTerminalChunk,
    RepoRuntimeHealthCheck, RepoRuntimeHealthMcp, RepoRuntimeHealthObservation,
    RepoRuntimeHealthRuntime, RepoRuntimeHealthState, RepoRuntimeMcpStatus,
    RepoRuntimeStartupFailureKind, RepoRuntimeStartupStage, RepoRuntimeStartupStatus, RunEvent,
    RunState, RunSummary, RuntimeCapabilities, RuntimeDescriptor, RuntimeInstanceSummary,
    RuntimeProvisioningMode, RuntimeRole, RuntimeRoute, RuntimeSupportedScope,
};
pub use store::TaskStore;
pub use system::{
    BeadsCheck, RepoStoreAttachmentHealth, RepoStoreHealth, RepoStoreHealthCategory,
    RepoStoreHealthStatus, RepoStoreSharedServerHealth, RepoStoreSharedServerOwnershipState,
    RuntimeCheck, RuntimeHealth, SystemCheck, WorkspaceRecord,
};
pub use task::{
    is_syncable_pull_request_state, is_terminal_task_status, CreateTaskInput, IssueType,
    PlanSubtaskInput, TaskAction, TaskCard, TaskDirectMergeResult, TaskStatus, UpdateTaskPatch,
};

pub const TASK_METADATA_NAMESPACE: &str = "openducktor";
pub const DEFAULT_BRANCH_PREFIX: &str = "odt";

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
            AgentSessionDocument, AgentSessionModelSelection, AgentWorkflowState, AgentWorkflows,
            BeadsCheck, BuildContinuationTarget, BuildContinuationTargetSource, CreateTaskInput,
            DevServerEvent, DevServerGroupState, DevServerScriptState, DevServerScriptStatus,
            DevServerTerminalChunk, GitBranch, GitCommitAllRequest, GitCommitAllResult,
            GitConflict, GitConflictAbortRequest, GitConflictAbortResult, GitConflictOperation,
            GitCurrentBranch, GitDiffScope, GitFileStatusCounts, GitPort, GitPullRequest,
            GitPullResult, GitPushResult, GitRebaseAbortRequest, GitRebaseAbortResult,
            GitRebaseBranchRequest, GitRebaseBranchResult, GitResetSnapshot,
            GitResetWorktreeSelection, GitResetWorktreeSelectionRequest,
            GitResetWorktreeSelectionResult, GitUpstreamAheadBehind, GitWorktreeStatus,
            GitWorktreeStatusData, GitWorktreeStatusSnapshot, GitWorktreeStatusSummary,
            GitWorktreeStatusSummaryData, GitWorktreeSummary, IssueType, PlanSubtaskInput,
            QaReportDocument, QaVerdict, QaWorkflowVerdict, RepoRuntimeHealthCheck,
            RepoRuntimeHealthMcp, RepoRuntimeHealthObservation, RepoRuntimeHealthRuntime,
            RepoRuntimeHealthState, RepoRuntimeMcpStatus, RepoRuntimeStartupFailureKind,
            RepoRuntimeStartupStage, RepoRuntimeStartupStatus, RepoStoreAttachmentHealth,
            RepoStoreHealth, RepoStoreHealthCategory, RepoStoreHealthStatus,
            RepoStoreSharedServerHealth, RepoStoreSharedServerOwnershipState, RunEvent, RunState,
            RunSummary, RuntimeCheck, RuntimeInstanceSummary, RuntimeRole, SpecDocument,
            SystemCheck, TaskAction, TaskCard, TaskDirectMergeResult, TaskDocumentPresence,
            TaskDocumentSummary, TaskMetadata, TaskQaDocumentPresence, TaskStatus, TaskStore,
            UpdateTaskPatch, WorkspaceRecord,
        };

        macro_rules! check_types_exported {
            ($($t:ty),* $(,)?) => {
                $(
                    let _: Option<$t> = None;
                )*
            };
        }

        check_types_exported!(
            RuntimeInstanceSummary,
            AgentSessionDocument,
            AgentSessionModelSelection,
            AgentWorkflowState,
            AgentWorkflows,
            BeadsCheck,
            CreateTaskInput,
            GitBranch,
            GitCommitAllRequest,
            GitCommitAllResult,
            GitConflict,
            GitConflictAbortRequest,
            GitConflictAbortResult,
            GitConflictOperation,
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
            GitResetSnapshot,
            GitResetWorktreeSelection,
            GitResetWorktreeSelectionRequest,
            GitResetWorktreeSelectionResult,
            GitUpstreamAheadBehind,
            GitWorktreeStatus,
            GitWorktreeStatusData,
            GitWorktreeStatusSnapshot,
            GitWorktreeStatusSummary,
            GitWorktreeStatusSummaryData,
            GitWorktreeSummary,
            RepoRuntimeHealthCheck,
            RepoRuntimeHealthMcp,
            RepoRuntimeHealthObservation,
            RepoRuntimeHealthRuntime,
            RepoRuntimeHealthState,
            RepoRuntimeMcpStatus,
            RepoRuntimeStartupFailureKind,
            RepoRuntimeStartupStage,
            RepoRuntimeStartupStatus,
            RepoStoreAttachmentHealth,
            RepoStoreHealth,
            RepoStoreHealthCategory,
            RepoStoreHealthStatus,
            RepoStoreSharedServerHealth,
            RepoStoreSharedServerOwnershipState,
            IssueType,
            PlanSubtaskInput,
            QaReportDocument,
            BuildContinuationTarget,
            BuildContinuationTargetSource,
            DevServerEvent,
            DevServerGroupState,
            DevServerScriptState,
            DevServerScriptStatus,
            DevServerTerminalChunk,
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
            TaskDirectMergeResult,
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
