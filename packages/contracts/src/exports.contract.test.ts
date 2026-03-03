import { describe, expect, test } from "bun:test";
import type {
  AgentModelDefault,
  AgentRole,
  AgentRuntimeStartRole,
  AgentRuntimeSummary,
  AgentRuntimeSummaryRole,
  AgentScenario,
  AgentSessionModelSelection,
  AgentSessionRecord,
  AgentSessionRole,
  AgentSessionScenario,
  AgentSessionStatus,
  AgentSessionTodoPayloadRecord,
  AgentToolName,
  AgentWorkflowState,
  AgentWorkflows,
  BeadsCheck,
  CommitsAheadBehind,
  FileDiff,
  FileStatus,
  GitBranch,
  GitCommitAllRequest,
  GitCommitAllResult,
  GitCurrentBranch,
  GitDiffScope,
  GitPullBranchRequest,
  GitPullBranchResult,
  GitPushSummary,
  GitRebaseBranchRequest,
  GitRebaseBranchResult,
  GitUpstreamAheadBehind,
  GitWorktreeStatus,
  GitWorktreeStatusSnapshot,
  GitWorktreeSummary,
  GlobalConfig,
  IssueType,
  QaWorkflowVerdict,
  RepoAgentDefaults,
  RepoConfig,
  RepoHooks,
  RunEvent,
  RunState,
  RunSummary,
  RuntimeCheck,
  SoftGuardrails,
  SystemCheck,
  TaskAction,
  TaskCard,
  TaskCreateInput,
  TaskDocumentPresence,
  TaskDocumentSummary,
  TaskMetadataDocument,
  TaskMetadataPayload,
  TaskMetadataQaReport,
  TaskPriority,
  TaskQaDocumentPresence,
  TaskStatus,
  TaskUpdatePatch,
  WorkspaceRecord,
} from "./index";
import * as contracts from "./index";

const EXPECTED_RUNTIME_EXPORTS = [
  "agentRoleSchema",
  "agentRoleValues",
  "agentScenarioSchema",
  "agentScenarioValues",
  "agentModelDefaultSchema",
  "agentToolNameSchema",
  "agentToolNameValues",
  "agentRuntimeStartRoleSchema",
  "agentRuntimeSummarySchema",
  "agentRuntimeSummaryRoleSchema",
  "agentSessionModelSelectionSchema",
  "agentSessionRecordSchema",
  "agentSessionRoleSchema",
  "agentSessionScenarioSchema",
  "agentSessionStatusSchema",
  "parseAgentSessionTodoPayloadEntry",
  "parseAgentSessionTodoPayloadList",
  "beadsCheckSchema",
  "gitCommitAllRequestSchema",
  "gitCommitAllResultSchema",
  "commitsAheadBehindSchema",
  "gitDiffScopeSchema",
  "gitPullBranchRequestSchema",
  "gitPullBranchResultSchema",
  "defaultSpecTemplateMarkdown",
  "fileDiffSchema",
  "fileStatusSchema",
  "gitBranchSchema",
  "gitCurrentBranchSchema",
  "gitPushSummarySchema",
  "gitUpstreamAheadBehindSchema",
  "gitWorktreeStatusSchema",
  "gitWorktreeStatusSnapshotSchema",
  "gitWorktreeSummarySchema",
  "globalConfigSchema",
  "issueTypeSchema",
  "missingSpecSections",
  "qaWorkflowVerdictSchema",
  "repoAgentDefaultsSchema",
  "repoConfigSchema",
  "repoHooksSchema",
  "gitRebaseBranchRequestSchema",
  "gitRebaseBranchResultSchema",
  "runEventSchema",
  "runStateSchema",
  "runSummarySchema",
  "runtimeCheckSchema",
  "softGuardrailsSchema",
  "specTemplateSections",
  "systemCheckSchema",
  "taskActionSchema",
  "taskCardSchema",
  "taskCreateInputSchema",
  "taskMetadataDocumentSchema",
  "taskMetadataPayloadSchema",
  "taskMetadataQaReportSchema",
  "taskPrioritySchema",
  "taskStatusSchema",
  "taskUpdatePatchSchema",
  "validateSpecMarkdown",
  "workspaceRecordSchema",
] as const;

type ExportedTypeContract = {
  AgentRole: AgentRole;
  AgentModelDefault: AgentModelDefault;
  AgentScenario: AgentScenario;
  AgentRuntimeStartRole: AgentRuntimeStartRole;
  AgentRuntimeSummary: AgentRuntimeSummary;
  AgentRuntimeSummaryRole: AgentRuntimeSummaryRole;
  AgentSessionModelSelection: AgentSessionModelSelection;
  AgentSessionTodoPayloadRecord: AgentSessionTodoPayloadRecord;
  AgentSessionRecord: AgentSessionRecord;
  AgentSessionRole: AgentSessionRole;
  AgentSessionScenario: AgentSessionScenario;
  AgentSessionStatus: AgentSessionStatus;
  AgentToolName: AgentToolName;
  AgentWorkflowState: AgentWorkflowState;
  AgentWorkflows: AgentWorkflows;
  BeadsCheck: BeadsCheck;
  CommitsAheadBehind: CommitsAheadBehind;
  GitCommitAllRequest: GitCommitAllRequest;
  GitCommitAllResult: GitCommitAllResult;
  FileDiff: FileDiff;
  FileStatus: FileStatus;
  GitBranch: GitBranch;
  GitCurrentBranch: GitCurrentBranch;
  GitDiffScope: GitDiffScope;
  GitPullBranchRequest: GitPullBranchRequest;
  GitPullBranchResult: GitPullBranchResult;
  GitPushSummary: GitPushSummary;
  GitRebaseBranchRequest: GitRebaseBranchRequest;
  GitRebaseBranchResult: GitRebaseBranchResult;
  GitUpstreamAheadBehind: GitUpstreamAheadBehind;
  GitWorktreeStatus: GitWorktreeStatus;
  GitWorktreeStatusSnapshot: GitWorktreeStatusSnapshot;
  GitWorktreeSummary: GitWorktreeSummary;
  GlobalConfig: GlobalConfig;
  IssueType: IssueType;
  QaWorkflowVerdict: QaWorkflowVerdict;
  RepoAgentDefaults: RepoAgentDefaults;
  RepoConfig: RepoConfig;
  RepoHooks: RepoHooks;
  RunEvent: RunEvent;
  RunState: RunState;
  RunSummary: RunSummary;
  RuntimeCheck: RuntimeCheck;
  SoftGuardrails: SoftGuardrails;
  SystemCheck: SystemCheck;
  TaskAction: TaskAction;
  TaskCard: TaskCard;
  TaskCreateInput: TaskCreateInput;
  TaskDocumentPresence: TaskDocumentPresence;
  TaskDocumentSummary: TaskDocumentSummary;
  TaskMetadataDocument: TaskMetadataDocument;
  TaskMetadataPayload: TaskMetadataPayload;
  TaskMetadataQaReport: TaskMetadataQaReport;
  TaskPriority: TaskPriority;
  TaskQaDocumentPresence: TaskQaDocumentPresence;
  TaskStatus: TaskStatus;
  TaskUpdatePatch: TaskUpdatePatch;
  WorkspaceRecord: WorkspaceRecord;
};

describe("contracts exports contract", () => {
  test("re-exports the canonical runtime API from the barrel", () => {
    expect(Object.keys(contracts).sort()).toEqual([...EXPECTED_RUNTIME_EXPORTS].sort());
  });

  test("keeps canonical type exports importable from the barrel", () => {
    const compileOnlyTypeContract: ExportedTypeContract | null = null;
    expect(compileOnlyTypeContract).toBeNull();
  });
});
