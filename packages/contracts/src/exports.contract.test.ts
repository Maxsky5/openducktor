import { describe, expect, test } from "bun:test";
import type {
  AgentModelDefault,
  AgentPromptOverride,
  AgentPromptTemplateId,
  AgentRole,
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
  AutopilotActionId,
  AutopilotEventId,
  AutopilotRule,
  AutopilotSettings,
  BeadsCheck,
  BuildContinuationTarget,
  BuildContinuationTargetSource,
  ChatSettings,
  CommitsAheadBehind,
  FailureKind,
  FileDiff,
  FileStatus,
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
  GitPullBranchRequest,
  GitPullBranchResult,
  GitRebaseBranchRequest,
  GitRebaseBranchResult,
  GitResetSnapshot,
  GitResetWorktreeSelection,
  GitResetWorktreeSelectionRequest,
  GitResetWorktreeSelectionResult,
  GitUpstreamAheadBehind,
  GitWorktreeStatus,
  GitWorktreeStatusSnapshot,
  GitWorktreeStatusSummary,
  GitWorktreeSummary,
  GlobalConfig,
  IssueType,
  KanbanSettings,
  PlanSubtaskInput,
  PlanSubtaskIssueType,
  PlanSubtaskPriority,
  QaReportVerdict,
  QaWorkflowVerdict,
  RepoAgentDefaults,
  RepoConfig,
  RepoDevServerScript,
  RepoHooks,
  RepoPromptOverrides,
  RepoRuntimeStartupStage,
  RepoRuntimeStartupStatus,
  RunEvent,
  RunState,
  RunSummary,
  RuntimeCapabilities,
  RuntimeCapabilityClass,
  RuntimeCapabilityKey,
  RuntimeCheck,
  RuntimeInstanceSummary,
  RuntimeInstanceSummaryRole,
  RuntimeKind,
  RuntimeProvisioningMode,
  RuntimeRef,
  RuntimeSupportedScope,
  SettingsSnapshot,
  SlashCommandCatalog,
  SlashCommandDescriptor,
  SlashCommandSource,
  SoftGuardrails,
  SystemCheck,
  TaskAction,
  TaskCard,
  TaskCreateInput,
  TaskDirectMergeInput,
  TaskDirectMergeResult,
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
  "agentScenarioDefinitionByScenario",
  "agentScenarioSchema",
  "agentScenarioValues",
  "agentModelDefaultSchema",
  "agentKickoffScenarioSchema",
  "agentKickoffScenarioValues",
  "agentToolNameSchema",
  "agentToolNameValues",
  "buildContinuationTargetSchema",
  "buildContinuationTargetSourceSchema",
  "runtimeInstanceSummarySchema",
  "runtimeInstanceSummaryRoleSchema",
  "agentPromptOverrideSchema",
  "agentPromptPlaceholderSchema",
  "agentPromptPlaceholderValues",
  "agentPromptTemplateIdSchema",
  "agentPromptTemplateIdValues",
  "agentSessionModelSelectionSchema",
  "agentSessionPermissionRequestSchema",
  "agentSessionQuestionItemSchema",
  "agentSessionQuestionOptionSchema",
  "agentSessionQuestionRequestSchema",
  "agentSessionRecordSchema",
  "agentSessionRoleSchema",
  "agentSessionScenarioSchema",
  "agentSessionStartModeSchema",
  "agentSessionStartModeValues",
  "agentSessionStatusSchema",
  "AUTOPILOT_ACTION_IDS",
  "AUTOPILOT_EVENT_IDS",
  "autopilotActionIdSchema",
  "autopilotEventIdSchema",
  "autopilotRuleSchema",
  "autopilotSettingsSchema",
  "parseAgentSessionTodoPayloadEntry",
  "parseAgentSessionTodoPayloadList",
  "beadsCheckSchema",
  "chatSettingsSchema",
  "DEFAULT_KANBAN_SETTINGS",
  "devServerEventSchema",
  "devServerGroupStateSchema",
  "devServerLogLineSchema",
  "devServerLogStreamSchema",
  "devServerScriptStateSchema",
  "devServerScriptStatusSchema",
  "DEFAULT_BRANCH_PREFIX",
  "failureKindSchema",
  "gitCommitAllRequestSchema",
  "gitCommitAllResultSchema",
  "gitConflictAbortRequestSchema",
  "gitConflictAbortResultSchema",
  "gitConflictOperationSchema",
  "gitConflictSchema",
  "commitsAheadBehindSchema",
  "createDefaultAutopilotSettings",
  "directMergeRecordSchema",
  "gitDiffScopeSchema",
  "gitMergeMethodSchema",
  "gitProviderAvailabilitySchema",
  "gitProviderConfigSchema",
  "gitProviderIdSchema",
  "gitProviderRepositoryKey",
  "gitProviderRepositorySchema",
  "gitPullBranchRequestSchema",
  "gitPullBranchResultSchema",
  "gitResetSnapshotSchema",
  "gitResetWorktreeSelectionSchema",
  "gitResetWorktreeSelectionRequestSchema",
  "gitResetWorktreeSelectionResultSchema",
  "gitPullRequestStateSchema",
  "gitPushBranchResultSchema",
  "gitTargetBranchSchema",
  "defaultSpecTemplateMarkdown",
  "defaultAgentScenarioForRole",
  "defaultStartModeForScenario",
  "extractPromptTemplatePlaceholders",
  "fileDiffSchema",
  "fileStatusSchema",
  "getAgentScenarioDefinition",
  "getAgentScenariosForRole",
  "gitFileStatusCountsSchema",
  "gitBranchSchema",
  "gitCurrentBranchSchema",
  "gitUpstreamAheadBehindSchema",
  "gitWorktreeStatusSchema",
  "gitWorktreeStatusSummarySchema",
  "gitWorktreeStatusSnapshotSchema",
  "gitWorktreeSummarySchema",
  "kanbanSettingsSchema",
  "globalConfigSchema",
  "globalGitConfigSchema",
  "issueTypeSchema",
  "knownGitProviderIdSchema",
  "knownGitProviderIdValues",
  "knownRuntimeKindSchema",
  "knownRuntimeKindValues",
  "missingSpecSections",
  "OPENCODE_RUNTIME_CAPABILITIES",
  "OPENCODE_RUNTIME_DESCRIPTOR",
  "parseGitProviderRepositoryFromRemoteUrl",
  "qaWorkflowVerdictSchema",
  "repoPromptOverridesSchema",
  "repoAgentDefaultsSchema",
  "repoConfigSchema",
  "repoDevServerScriptSchema",
  "repoGitConfigSchema",
  "repoGitProviderConfigsSchema",
  "repoHooksSchema",
  "gitRebaseBranchRequestSchema",
  "gitRebaseBranchResultSchema",
  "gitRebaseAbortRequestSchema",
  "gitRebaseAbortResultSchema",
  "runEventSchema",
  "runStateSchema",
  "runSummarySchema",
  "isAgentKickoffScenario",
  "isScenarioStartModeAllowed",
  "runtimeCheckSchema",
  "runtimeCapabilitiesSchema",
  "runtimeCapabilityClasses",
  "runtimeCapabilityKeySchema",
  "runtimeCapabilityKeyValues",
  "runtimeDescriptorCatalogSchema",
  "runtimeDescriptorSchema",
  "runtimeHealthSchema",
  "runtimeKindSchema",
  "repoRuntimeStartupStageSchema",
  "repoRuntimeStartupStatusSchema",
  "runtimeRouteSchema",
  "runtimeProvisioningModeSchema",
  "getMissingRequiredRuntimeSupportedScopes",
  "runtimeRequiredScopesByRole",
  "runtimeRefSchema",
  "requiredRuntimeSupportedScopes",
  "runtimeSupportedScopeSchema",
  "runtimeSupportedScopeValues",
  "runtimeSupportedScopesSchema",
  "runtimeTransportSchema",
  "slashCommandCatalogSchema",
  "slashCommandDescriptorSchema",
  "slashCommandSourceSchema",
  "slashCommandSourceValues",
  "mandatoryRuntimeCapabilityKeys",
  "optionalRuntimeCapabilityKeys",
  "softGuardrailsSchema",
  "settingsSnapshotSchema",
  "specTemplateSections",
  "systemCheckSchema",
  "planSubtaskInputSchema",
  "planSubtaskIssueTypeSchema",
  "planSubtaskPrioritySchema",
  "taskActionSchema",
  "taskApprovalContextSchema",
  "taskCardSchema",
  "taskCreateInputSchema",
  "taskDirectMergeInputSchema",
  "taskDirectMergeResultSchema",
  "taskPullRequestDetectResultSchema",
  "taskMetadataDocumentSchema",
  "taskMetadataPayloadSchema",
  "taskMetadataQaReportSchema",
  "taskPrioritySchema",
  "qaReportVerdictSchema",
  "taskStatusSchema",
  "taskUpdatePatchSchema",
  "themeSchema",
  "pullRequestSchema",
  "validatePromptTemplatePlaceholders",
  "validateSpecMarkdown",
  "workspaceRecordSchema",
] as const;

type ExportedTypeContract = {
  AgentRole: AgentRole;
  AgentModelDefault: AgentModelDefault;
  AgentPromptOverride: AgentPromptOverride;
  AgentPromptTemplateId: AgentPromptTemplateId;
  AgentScenario: AgentScenario;
  AutopilotActionId: AutopilotActionId;
  AutopilotEventId: AutopilotEventId;
  AutopilotRule: AutopilotRule;
  AutopilotSettings: AutopilotSettings;
  RuntimeInstanceSummary: RuntimeInstanceSummary;
  RuntimeInstanceSummaryRole: RuntimeInstanceSummaryRole;
  BuildContinuationTarget: BuildContinuationTarget;
  BuildContinuationTargetSource: BuildContinuationTargetSource;
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
  ChatSettings: ChatSettings;
  CommitsAheadBehind: CommitsAheadBehind;
  GitCommitAllRequest: GitCommitAllRequest;
  GitCommitAllResult: GitCommitAllResult;
  GitConflict: GitConflict;
  GitConflictAbortRequest: GitConflictAbortRequest;
  GitConflictAbortResult: GitConflictAbortResult;
  GitConflictOperation: GitConflictOperation;
  FileDiff: FileDiff;
  FileStatus: FileStatus;
  FailureKind: FailureKind;
  GitFileStatusCounts: GitFileStatusCounts;
  GitBranch: GitBranch;
  GitCurrentBranch: GitCurrentBranch;
  GitDiffScope: GitDiffScope;
  GitPullBranchRequest: GitPullBranchRequest;
  GitPullBranchResult: GitPullBranchResult;
  GitRebaseBranchRequest: GitRebaseBranchRequest;
  GitRebaseBranchResult: GitRebaseBranchResult;
  GitResetSnapshot: GitResetSnapshot;
  GitResetWorktreeSelection: GitResetWorktreeSelection;
  GitResetWorktreeSelectionRequest: GitResetWorktreeSelectionRequest;
  GitResetWorktreeSelectionResult: GitResetWorktreeSelectionResult;
  GitUpstreamAheadBehind: GitUpstreamAheadBehind;
  GitWorktreeStatus: GitWorktreeStatus;
  GitWorktreeStatusSummary: GitWorktreeStatusSummary;
  GitWorktreeStatusSnapshot: GitWorktreeStatusSnapshot;
  GitWorktreeSummary: GitWorktreeSummary;
  GlobalConfig: GlobalConfig;
  KanbanSettings: KanbanSettings;
  IssueType: IssueType;
  PlanSubtaskInput: PlanSubtaskInput;
  PlanSubtaskIssueType: PlanSubtaskIssueType;
  PlanSubtaskPriority: PlanSubtaskPriority;
  QaReportVerdict: QaReportVerdict;
  QaWorkflowVerdict: QaWorkflowVerdict;
  RepoAgentDefaults: RepoAgentDefaults;
  RepoConfig: RepoConfig;
  RepoDevServerScript: RepoDevServerScript;
  RepoHooks: RepoHooks;
  RepoPromptOverrides: RepoPromptOverrides;
  RunEvent: RunEvent;
  RunState: RunState;
  RunSummary: RunSummary;
  SlashCommandCatalog: SlashCommandCatalog;
  SlashCommandDescriptor: SlashCommandDescriptor;
  SlashCommandSource: SlashCommandSource;
  RuntimeCheck: RuntimeCheck;
  RuntimeCapabilities: RuntimeCapabilities;
  RuntimeCapabilityClass: RuntimeCapabilityClass;
  RuntimeCapabilityKey: RuntimeCapabilityKey;
  RepoRuntimeStartupStage: RepoRuntimeStartupStage;
  RepoRuntimeStartupStatus: RepoRuntimeStartupStatus;
  SoftGuardrails: SoftGuardrails;
  RuntimeKind: RuntimeKind;
  RuntimeProvisioningMode: RuntimeProvisioningMode;
  RuntimeRef: RuntimeRef;
  RuntimeSupportedScope: RuntimeSupportedScope;
  SettingsSnapshot: SettingsSnapshot;
  SystemCheck: SystemCheck;
  TaskAction: TaskAction;
  TaskCard: TaskCard;
  TaskCreateInput: TaskCreateInput;
  TaskDirectMergeInput: TaskDirectMergeInput;
  TaskDirectMergeResult: TaskDirectMergeResult;
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

  test("defaults missing chat settings to disabled thinking messages", () => {
    const parsedSnapshot = contracts.settingsSnapshotSchema.parse({
      theme: "light",
      git: {
        defaultMergeMethod: "merge_commit",
      },
      repos: {},
      globalPromptOverrides: {},
    });

    expect(parsedSnapshot.chat.showThinkingMessages).toBe(false);
    expect(parsedSnapshot.kanban.doneVisibleDays).toBe(1);
  });

  test("rejects settings snapshots without a theme", () => {
    expect(() =>
      contracts.settingsSnapshotSchema.parse({
        git: {
          defaultMergeMethod: "merge_commit",
        },
        repos: {},
        globalPromptOverrides: {},
      }),
    ).toThrow();
  });
});
