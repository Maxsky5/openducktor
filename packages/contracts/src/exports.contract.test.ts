import { describe, expect, test } from "bun:test";
import type {
  AgentModelDefault,
  AgentRuntimeSummary,
  AgentSessionModelSelection,
  AgentSessionRecord,
  AgentSessionRole,
  AgentSessionScenario,
  AgentSessionStatus,
  AgentSessionTodoPayloadRecord,
  AgentWorkflowState,
  AgentWorkflows,
  BeadsCheck,
  GitBranch,
  GitCurrentBranch,
  GitPushSummary,
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
  "agentModelDefaultSchema",
  "agentRuntimeSummarySchema",
  "agentSessionModelSelectionSchema",
  "agentSessionRecordSchema",
  "agentSessionRoleSchema",
  "agentSessionScenarioSchema",
  "agentSessionStatusSchema",
  "parseAgentSessionTodoPayloadEntry",
  "parseAgentSessionTodoPayloadList",
  "beadsCheckSchema",
  "defaultSpecTemplateMarkdown",
  "gitBranchSchema",
  "gitCurrentBranchSchema",
  "gitPushSummarySchema",
  "gitWorktreeSummarySchema",
  "globalConfigSchema",
  "issueTypeSchema",
  "missingSpecSections",
  "qaWorkflowVerdictSchema",
  "repoAgentDefaultsSchema",
  "repoConfigSchema",
  "repoHooksSchema",
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
  AgentModelDefault: AgentModelDefault;
  AgentRuntimeSummary: AgentRuntimeSummary;
  AgentSessionModelSelection: AgentSessionModelSelection;
  AgentSessionTodoPayloadRecord: AgentSessionTodoPayloadRecord;
  AgentSessionRecord: AgentSessionRecord;
  AgentSessionRole: AgentSessionRole;
  AgentSessionScenario: AgentSessionScenario;
  AgentSessionStatus: AgentSessionStatus;
  AgentWorkflowState: AgentWorkflowState;
  AgentWorkflows: AgentWorkflows;
  BeadsCheck: BeadsCheck;
  GitBranch: GitBranch;
  GitCurrentBranch: GitCurrentBranch;
  GitPushSummary: GitPushSummary;
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
