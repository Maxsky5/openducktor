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
  AgentSessionStopTarget,
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
  DirectoryEntry,
  DirectoryListing,
  ExternalTaskSyncEvent,
  ExternalTaskSyncEventKind,
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
  GitFetchRemoteRequest,
  GitFetchRemoteResult,
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
  RepoRuntimeHealthCheck,
  RepoRuntimeHealthMcp,
  RepoRuntimeHealthObservation,
  RepoRuntimeHealthRuntime,
  RepoRuntimeHealthState,
  RepoRuntimeMcpStatus,
  RepoRuntimeStartupStage,
  RepoRuntimeStartupStatus,
  RepoStoreAttachmentHealth,
  RepoStoreHealth,
  RepoStoreHealthCategory,
  RepoStoreHealthStatus,
  RepoStoreSharedServerHealth,
  RepoStoreSharedServerOwnershipState,
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
  SystemListOpenInToolsRequest,
  SystemOpenInToolId,
  SystemOpenInToolInfo,
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
  "agentSessionStopTargetSchema",
  "AUTOPILOT_ACTION_IDS",
  "AUTOPILOT_EVENT_IDS",
  "BuildBlockedInputSchema",
  "BuildCompletedInputSchema",
  "BuildResumedInputSchema",
  "autopilotActionIdSchema",
  "autopilotEventIdSchema",
  "autopilotRuleSchema",
  "autopilotSettingsSchema",
  "parseAgentSessionTodoPayloadEntry",
  "parseAgentSessionTodoPayloadList",
  "beadsCheckSchema",
  "buildBlockedResultSchema",
  "buildCompletedResultSchema",
  "chatSettingsSchema",
  "buildResumedResultSchema",
  "CreateTaskInputSchema",
  "DEFAULT_KANBAN_SETTINGS",
  "devServerEventSchema",
  "devServerGroupStateSchema",
  "devServerTerminalChunkSchema",
  "devServerScriptStateSchema",
  "devServerScriptStatusSchema",
  "externalTaskCreatedEventSchema",
  "externalTaskSyncEventKindSchema",
  "externalTaskSyncEventSchema",
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
  "createTaskResultSchema",
  "directoryEntrySchema",
  "directoryListingSchema",
  "directMergeRecordSchema",
  "gitDiffScopeSchema",
  "gitFetchRemoteRequestSchema",
  "gitFetchRemoteResultSchema",
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
  "GetWorkspacesInputSchema",
  "getWorkspacesResultSchema",
  "issueTypeSchema",
  "knownGitProviderIdSchema",
  "knownGitProviderIdValues",
  "knownRuntimeKindSchema",
  "knownRuntimeKindValues",
  "missingSpecSections",
  "odtHostBridgeReadySchema",
  "odtPersistedDocumentSchema",
  "ODT_HOST_BRIDGE_RESPONSE_SCHEMAS",
  "ODT_TOOL_SCHEMAS",
  "ODT_WORKSPACE_SCOPED_TOOL_NAMES",
  "ODT_WORKSPACE_SCOPED_TOOL_SCHEMAS",
  "OPENCODE_RUNTIME_CAPABILITIES",
  "OPENCODE_RUNTIME_DESCRIPTOR",
  "parseGitProviderRepositoryFromRemoteUrl",
  "publicTaskSchema",
  "publicTaskSummaryTaskSchema",
  "QaApprovedInputSchema",
  "qaApprovedResultSchema",
  "QaRejectedInputSchema",
  "qaRejectedResultSchema",
  "qaWorkflowVerdictSchema",
  "ReadTaskDocumentsInputSchema",
  "ReadTaskInputSchema",
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
  "repoRuntimeHealthCheckSchema",
  "repoStoreAttachmentHealthSchema",
  "repoStoreHealthCategorySchema",
  "repoStoreHealthSchema",
  "repoStoreHealthStatusSchema",
  "repoStoreSharedServerHealthSchema",
  "repoStoreSharedServerOwnershipStateSchema",
  "repoRuntimeHealthMcpSchema",
  "repoRuntimeHealthObservationSchema",
  "repoRuntimeHealthRuntimeSchema",
  "repoRuntimeHealthStateSchema",
  "repoRuntimeMcpStatusSchema",
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
  "searchTasksResultSchema",
  "SearchTasksInputSchema",
  "setPlanResultSchema",
  "SetPlanInputSchema",
  "setPullRequestResultSchema",
  "SetPullRequestInputSchema",
  "setSpecResultSchema",
  "SetSpecInputSchema",
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
  "systemListOpenInToolsRequestSchema",
  "systemOpenDirectoryInToolRequestSchema",
  "systemOpenInToolIdSchema",
  "systemOpenInToolInfoSchema",
  "systemOpenInToolIdValues",
  "systemOpenInToolListSchema",
  "planSubtaskInputSchema",
  "planSubtaskIssueTypeSchema",
  "planSubtaskPrioritySchema",
  "taskActionSchema",
  "taskApprovalContextSchema",
  "taskApprovalContextLoadResultSchema",
  "taskCardSchema",
  "taskCreateInputSchema",
  "taskDirectMergeInputSchema",
  "taskDirectMergeResultSchema",
  "taskDocumentPresenceSchema",
  "taskDocumentsReadSchema",
  "taskPullRequestDetectResultSchema",
  "taskMetadataDocumentSchema",
  "taskMetadataPayloadSchema",
  "taskMetadataQaReportSchema",
  "taskPrioritySchema",
  "qaReportVerdictSchema",
  "taskRequestedDocumentsSchema",
  "taskStatusSchema",
  "taskSummarySchema",
  "taskUpdatePatchSchema",
  "tasksUpdatedEventSchema",
  "themeSchema",
  "pullRequestSchema",
  "validatePromptTemplatePlaceholders",
  "validateSpecMarkdown",
  "WORKSPACE_ID_PATTERN",
  "workspaceIdSchema",
  "workspaceNameSchema",
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
  AgentSessionStopTarget: AgentSessionStopTarget;
  AgentToolName: AgentToolName;
  AgentWorkflowState: AgentWorkflowState;
  AgentWorkflows: AgentWorkflows;
  BeadsCheck: BeadsCheck;
  ChatSettings: ChatSettings;
  CommitsAheadBehind: CommitsAheadBehind;
  DirectoryEntry: DirectoryEntry;
  DirectoryListing: DirectoryListing;
  ExternalTaskSyncEvent: ExternalTaskSyncEvent;
  ExternalTaskSyncEventKind: ExternalTaskSyncEventKind;
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
  GitFetchRemoteRequest: GitFetchRemoteRequest;
  GitFetchRemoteResult: GitFetchRemoteResult;
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
  RepoRuntimeHealthCheck: RepoRuntimeHealthCheck;
  RepoStoreAttachmentHealth: RepoStoreAttachmentHealth;
  RepoStoreHealth: RepoStoreHealth;
  RepoStoreHealthCategory: RepoStoreHealthCategory;
  RepoStoreHealthStatus: RepoStoreHealthStatus;
  RepoStoreSharedServerHealth: RepoStoreSharedServerHealth;
  RepoStoreSharedServerOwnershipState: RepoStoreSharedServerOwnershipState;
  RepoRuntimeHealthMcp: RepoRuntimeHealthMcp;
  RepoRuntimeHealthObservation: RepoRuntimeHealthObservation;
  RepoRuntimeHealthRuntime: RepoRuntimeHealthRuntime;
  RepoRuntimeHealthState: RepoRuntimeHealthState;
  RepoRuntimeMcpStatus: RepoRuntimeMcpStatus;
  RepoRuntimeStartupStage: RepoRuntimeStartupStage;
  RepoRuntimeStartupStatus: RepoRuntimeStartupStatus;
  SoftGuardrails: SoftGuardrails;
  RuntimeKind: RuntimeKind;
  RuntimeProvisioningMode: RuntimeProvisioningMode;
  RuntimeRef: RuntimeRef;
  RuntimeSupportedScope: RuntimeSupportedScope;
  SettingsSnapshot: SettingsSnapshot;
  SystemCheck: SystemCheck;
  SystemListOpenInToolsRequest: SystemListOpenInToolsRequest;
  SystemOpenInToolId: SystemOpenInToolId;
  SystemOpenInToolInfo: SystemOpenInToolInfo;
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
      workspaces: {},
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
        workspaces: {},
        globalPromptOverrides: {},
      }),
    ).toThrow();
  });

  test("keeps get_workspaces workspace-free and workspace-scoped tool inputs overrideable", () => {
    expect(contracts.GetWorkspacesInputSchema.parse({})).toEqual({});
    expect(contracts.ReadTaskInputSchema.parse({ workspaceId: "repo", taskId: "task-1" })).toEqual({
      workspaceId: "repo",
      taskId: "task-1",
    });
    expect(
      contracts.CreateTaskInputSchema.parse({
        workspaceId: "repo",
        title: "Bridge task",
        issueType: "task",
        priority: 2,
      }),
    ).toEqual({
      workspaceId: "repo",
      title: "Bridge task",
      issueType: "task",
      priority: 2,
    });
  });
});
