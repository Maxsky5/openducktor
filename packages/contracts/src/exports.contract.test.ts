import { describe, expect, test } from "bun:test";
import type {
  AgentModelDefault,
  AgentPromptOverride,
  AgentPromptTemplateId,
  AgentRole,
  AgentRuntimeConfig,
  AgentRuntimes,
  AgentSessionModelSelection,
  AgentSessionRecord,
  AgentSessionRole,
  AgentSessionStatus,
  AgentSessionStopTarget,
  AgentSessionTodoPayloadRecord,
  AgentToolName,
  AgentWorkflowState,
  AgentWorkflows,
  AppearanceSettings,
  AppPlatform,
  AppUpdateCheckInitiator,
  AppUpdateCheckInput,
  AppUpdateCommandRejection,
  AppUpdateCommandResult,
  AppUpdateDownloadableState,
  AppUpdateError,
  AppUpdateErrorCode,
  AppUpdateInstallableState,
  AppUpdateOperation,
  AppUpdateState,
  AppUpdateStateChangedEvent,
  AppUpdateStatus,
  AutopilotActionId,
  AutopilotEventId,
  AutopilotRule,
  AutopilotSettings,
  BuildSessionBootstrap,
  ChatDiffHeight,
  ChatDiffIndicators,
  ChatDiffStyle,
  ChatHunkSeparators,
  ChatLineOverflow,
  ChatSettings,
  CodexReasoningEffort,
  CommitsAheadBehind,
  DirectoryEntry,
  DirectoryListing,
  ExternalTaskSyncEvent,
  ExternalTaskSyncEventKind,
  FailureKind,
  FileContent,
  FileDiff,
  FileStatus,
  GeneralSettings,
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
  HorizontalScrollbarVisibility,
  IssueType,
  KanbanEmptyColumnDisplay,
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
  ReusablePrompt,
  RuntimeApprovalCapabilities,
  RuntimeApprovalReplyOutcome,
  RuntimeApprovalRequestType,
  RuntimeCapabilities,
  RuntimeCapabilityClass,
  RuntimeCapabilityKey,
  RuntimeCheck,
  RuntimeForkTarget,
  RuntimeHistoryCapabilities,
  RuntimeHistoryFidelity,
  RuntimeHistoryReplay,
  RuntimeInstanceRef,
  RuntimeInstanceSummary,
  RuntimeInstanceSummaryRole,
  RuntimeKind,
  RuntimeOmittedPermissionBehavior,
  RuntimeOptionalSurfaceCapabilities,
  RuntimePendingInputVisibility,
  RuntimePromptInputCapabilities,
  RuntimePromptInputPartType,
  RuntimeProvisioningMode,
  RuntimeQuestionAnswerMode,
  RuntimeSessionLifecycleCapabilities,
  RuntimeStructuredInputCapabilities,
  RuntimeSubagentExecutionMode,
  RuntimeSupportedScope,
  RuntimeWorkflowCapabilities,
  SettingsSnapshot,
  SlashCommandCatalog,
  SlashCommandDescriptor,
  SlashCommandSource,
  SoftGuardrails,
  SubagentCatalog,
  SubagentDescriptor,
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
  TaskStoreCheck,
  TaskUpdatePatch,
  TaskWorktreeSummary,
  ToolExecutableProvenance,
  ToolExecutableSourceCategory,
  WorkspaceRecord,
} from "./index";
import * as contracts from "./index";

const EXPECTED_RUNTIME_EXPORTS = [
  "agentRoleSchema",
  "agentRoleValues",
  "agentModelDefaultSchema",
  "agentRuntimeConfigSchema",
  "agentRuntimeEnabledConfigSchema",
  "agentRuntimesSchema",
  "agentToolNameSchema",
  "agentToolNameValues",
  "buildSessionBootstrapSchema",
  "classifyRuntimeDescriptorSchemaIssue",
  "runtimeInstanceSummarySchema",
  "runtimeInstanceSummaryRoleSchema",
  "agentPromptOverrideSchema",
  "agentPromptPlaceholderSchema",
  "agentPromptPlaceholderValues",
  "agentPromptTemplateIdSchema",
  "agentPromptTemplateIdValues",
  "agentSessionApprovalMutationSchema",
  "agentSessionApprovalRequestSchema",
  "agentSessionModelSelectionSchema",
  "agentSessionQuestionItemSchema",
  "agentSessionQuestionOptionSchema",
  "agentSessionQuestionRequestSchema",
  "agentSessionRecordSchema",
  "agentSessionRoleSchema",
  "agentSessionStartModeSchema",
  "agentSessionStartModeValues",
  "agentSessionStatusSchema",
  "agentSessionStopTargetSchema",
  "APP_PLATFORM_VALUES",
  "appUpdateCheckInputSchema",
  "appUpdateCheckInitiatorSchema",
  "appUpdateCheckInitiatorValues",
  "appUpdateCommandRejectionSchema",
  "appUpdateCommandResultSchema",
  "appUpdateErrorCodeSchema",
  "appUpdateErrorCodeValues",
  "appUpdateErrorSchema",
  "appUpdateOperationSchema",
  "appUpdateOperationValues",
  "appUpdateStateChangedEventSchema",
  "appUpdateStateSchema",
  "appUpdateStatusSchema",
  "appUpdateStatusValues",
  "canDownloadAppUpdate",
  "canInstallAppUpdate",
  "CODEX_APP_SERVER_COMMAND_REQUEST_METHODS",
  "CODEX_APP_SERVER_FILE_MUTATION_REQUEST_METHODS",
  "CODEX_APP_SERVER_PERMISSION_REQUEST_METHODS",
  "CODEX_APP_SERVER_SERVER_NOTIFICATION_METHODS",
  "CODEX_APP_SERVER_SERVER_REQUEST_METHOD",
  "CODEX_APP_SERVER_SERVER_REQUEST_METHODS",
  "AUTOPILOT_ACTION_IDS",
  "AUTOPILOT_EVENT_IDS",
  "BuildBlockedInputSchema",
  "BuildCompletedInputSchema",
  "BuildResumedInputSchema",
  "autopilotActionIdSchema",
  "autopilotEventIdSchema",
  "autopilotRuleSchema",
  "autopilotSettingsSchema",
  "isCodexAppServerJsonValue",
  "isCodexAppServerCommandAction",
  "isCodexAppServerCommandRequestMethod",
  "isCodexAppServerFileMutationRequestMethod",
  "isCodexAppServerLegacyParsedCommand",
  "isCodexAppServerMcpServerElicitationRequestParams",
  "isCodexAppServerPermissionRequestMethod",
  "isCodexAppServerRequestPermissionProfile",
  "parseAgentSessionTodoPayloadEntry",
  "parseAgentSessionTodoPayloadList",
  "parseCodexAppServerRequestResult",
  "taskStoreCheckSchema",
  "formatRuntimeDescriptorSchemaIssue",
  "buildBlockedResultSchema",
  "buildCompletedResultSchema",
  "CHAT_DIFF_HEIGHT_VALUES",
  "CHAT_DIFF_INDICATOR_VALUES",
  "CHAT_DIFF_STYLE_VALUES",
  "CHAT_HUNK_SEPARATOR_VALUES",
  "CHAT_LINE_OVERFLOW_VALUES",
  "HORIZONTAL_SCROLLBAR_VISIBILITY_VALUES",
  "appPlatformSchema",
  "appearanceSettingsSchema",
  "chatSettingsSchema",
  "CODEX_APPROVAL_POLICY_VALUES",
  "CODEX_APPROVALS_REVIEWER_VALUES",
  "CODEX_SANDBOX_MODE_VALUES",
  "codexApprovalPolicySchema",
  "codexApprovalsReviewerSchema",
  "codexPolicyFieldsSchema",
  "codexRuntimeConfigSchema",
  "codexSandboxModeSchema",
  "DEFAULT_CODEX_RUNTIME_POLICY",
  "DEFAULT_APPEARANCE_SETTINGS",
  "DEFAULT_CHAT_SETTINGS",
  "DEFAULT_GENERAL_SETTINGS",
  "DEFAULT_AGENT_RUNTIMES",
  "REUSABLE_PROMPT_ARGUMENTS_PLACEHOLDER",
  "REUSABLE_PROMPT_TRIGGER_PATTERN",
  "resolveCodexEffectivePolicy",
  "reusablePromptSchema",
  "reusablePromptsSchema",
  "buildResumedResultSchema",
  "CreateTaskInputSchema",
  "DEFAULT_KANBAN_SETTINGS",
  "DEFAULT_REUSABLE_PROMPTS",
  "KANBAN_EMPTY_COLUMN_DISPLAY_VALUES",
  "devServerEventSchema",
  "devServerGroupStateSchema",
  "devServerRunIdentitySchema",
  "devServerRunOrderSchema",
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
  "extractPromptTemplatePlaceholders",
  "fileContentSchema",
  "fileDiffSchema",
  "fileStatusSchema",
  "gitFileStatusCountsSchema",
  "gitBranchSchema",
  "gitCurrentBranchSchema",
  "gitUpstreamAheadBehindSchema",
  "gitWorktreeStatusSchema",
  "gitWorktreeStatusSummarySchema",
  "gitWorktreeStatusSnapshotSchema",
  "gitWorktreeSummarySchema",
  "kanbanSettingsSchema",
  "kanbanEmptyColumnDisplaySchema",
  "horizontalScrollbarVisibilitySchema",
  "resolveHorizontalScrollbarVisibility",
  "generalSettingsSchema",
  "globalConfigSchema",
  "globalGitConfigSchema",
  "GetWorkspacesInputSchema",
  "getWorkspacesResultSchema",
  "issueTypeSchema",
  "isOpencodeExposedOdtToolAlias",
  "knownGitProviderIdSchema",
  "knownGitProviderIdValues",
  "codexReasoningEffortSchema",
  "codexReasoningEffortValues",
  "knownRuntimeKindSchema",
  "knownRuntimeKindValues",
  "missingSpecSections",
  "odtHostBridgeReadySchema",
  "odtPersistedDocumentSchema",
  "odtToolErrorCodeSchema",
  "odtToolErrorIssueSchema",
  "odtToolErrorPayloadSchema",
  "odtToolErrorSchema",
  "ODT_HOST_BRIDGE_RESPONSE_SCHEMAS",
  "ODT_MCP_TOOL_NAMES",
  "ODT_TOOL_SCHEMAS",
  "ODT_TOOL_NAMES",
  "ODT_WORKFLOW_AGENT_BLOCKED_TOOL_NAMES",
  "ODT_WORKFLOW_AGENT_BLOCKED_TOOL_SCHEMAS",
  "ODT_WORKFLOW_AGENT_TOOL_NAMES",
  "ODT_WORKSPACE_DISCOVERY_TOOL_NAME",
  "ODT_WORKFLOW_TOOL_SCHEMAS",
  "ODT_WORKSPACE_SCOPED_TOOL_NAMES",
  "ODT_WORKSPACE_SCOPED_TOOL_SCHEMAS",
  "OPENCODE_ODT_TOOL_ID_PREFIXES",
  "CODEX_RUNTIME_CAPABILITIES",
  "CODEX_RUNTIME_DESCRIPTOR",
  "OPENCODE_RUNTIME_CAPABILITIES",
  "OPENCODE_RUNTIME_DESCRIPTOR",
  "RUNTIME_DESCRIPTORS_BY_KIND",
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
  "runtimeCheckSchema",
  "runtimeApprovalCapabilitiesSchema",
  "runtimeApprovalReplyOutcomeSchema",
  "runtimeApprovalReplyOutcomeValues",
  "runtimeApprovalRequestTypeSchema",
  "runtimeApprovalRequestTypeValues",
  "runtimeCapabilitiesSchema",
  "runtimeCapabilityClasses",
  "runtimeCapabilityKeySchema",
  "runtimeCapabilityKeyValues",
  "runtimeDescriptorCatalogSchema",
  "runtimeDescriptorSchema",
  "runtimeForkTargetSchema",
  "runtimeForkTargetValues",
  "runtimeHistoryCapabilitiesSchema",
  "runtimeHistoryFidelitySchema",
  "runtimeHistoryFidelityValues",
  "runtimeHistoryReplaySchema",
  "runtimeHistoryReplayValues",
  "runtimeHealthSchema",
  "runtimeKindSchema",
  "repoRuntimeHealthCheckSchema",
  "repoStoreHealthCategorySchema",
  "repoStoreHealthSchema",
  "repoStoreHealthStatusSchema",
  "repoRuntimeHealthMcpSchema",
  "repoRuntimeHealthObservationSchema",
  "repoRuntimeHealthRuntimeSchema",
  "repoRuntimeHealthStateSchema",
  "repoRuntimeMcpStatusSchema",
  "repoRuntimeRefSchema",
  "repoRuntimeStartupStageSchema",
  "repoRuntimeStartupStatusSchema",
  "runtimeRouteSchema",
  "stdioRuntimeIdentitySchema",
  "runtimeProvisioningModeSchema",
  "runtimeOmittedPermissionBehaviorSchema",
  "runtimeOmittedPermissionBehaviorValues",
  "runtimeOptionalSurfaceCapabilitiesSchema",
  "runtimePendingInputVisibilitySchema",
  "runtimePendingInputVisibilityValues",
  "runtimePromptInputCapabilitiesSchema",
  "runtimePromptInputPartTypeSchema",
  "runtimePromptInputPartTypeValues",
  "runtimeQuestionAnswerModeSchema",
  "runtimeQuestionAnswerModeValues",
  "getMissingRequiredRuntimeSupportedScopes",
  "runtimeRequiredScopesByRole",
  "runtimeInstanceRefSchema",
  "runtimeSessionLifecycleCapabilitiesSchema",
  "runtimeStructuredInputCapabilitiesSchema",
  "runtimeSubagentExecutionModeSchema",
  "runtimeSubagentExecutionModeValues",
  "requiredRuntimeSupportedScopes",
  "runtimeSupportedScopeSchema",
  "runtimeSupportedScopeValues",
  "runtimeSupportedScopesSchema",
  "runtimeSupportedSubagentExecutionModesSchema",
  "runtimeTransportSchema",
  "runtimeWorkflowCapabilitiesSchema",
  "searchTasksResultSchema",
  "SearchTasksInputSchema",
  "setPlanResultSchema",
  "SetPlanInputSchema",
  "setPullRequestResultSchema",
  "SetPullRequestInputSchema",
  "setSpecResultSchema",
  "SetSpecInputSchema",
  "skillCatalogSchema",
  "skillDescriptorSchema",
  "slashCommandCatalogSchema",
  "slashCommandDescriptorSchema",
  "slashCommandSourceSchema",
  "slashCommandSourceValues",
  "subagentCatalogSchema",
  "subagentDescriptorSchema",
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
  "taskWorktreeSummarySchema",
  "tasksUpdatedEventSchema",
  "themeSchema",
  "toolExecutableProvenanceSchema",
  "toolExecutableSourceCategorySchema",
  "toOpencodeExposedOdtToolIds",
  "toOpencodeOdtToolAliases",
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
  AgentRuntimeConfig: AgentRuntimeConfig;
  AgentRuntimes: AgentRuntimes;
  AgentPromptOverride: AgentPromptOverride;
  AgentPromptTemplateId: AgentPromptTemplateId;
  AutopilotActionId: AutopilotActionId;
  AutopilotEventId: AutopilotEventId;
  AutopilotRule: AutopilotRule;
  AutopilotSettings: AutopilotSettings;
  RuntimeInstanceSummary: RuntimeInstanceSummary;
  RuntimeInstanceSummaryRole: RuntimeInstanceSummaryRole;
  BuildSessionBootstrap: BuildSessionBootstrap;
  ChatDiffHeight: ChatDiffHeight;
  ChatDiffIndicators: ChatDiffIndicators;
  ChatDiffStyle: ChatDiffStyle;
  ChatHunkSeparators: ChatHunkSeparators;
  ChatLineOverflow: ChatLineOverflow;
  AgentSessionModelSelection: AgentSessionModelSelection;
  AgentSessionTodoPayloadRecord: AgentSessionTodoPayloadRecord;
  AgentSessionRecord: AgentSessionRecord;
  AgentSessionRole: AgentSessionRole;
  AgentSessionStatus: AgentSessionStatus;
  AgentSessionStopTarget: AgentSessionStopTarget;
  AgentToolName: AgentToolName;
  AgentWorkflowState: AgentWorkflowState;
  AgentWorkflows: AgentWorkflows;
  AppearanceSettings: AppearanceSettings;
  AppPlatform: AppPlatform;
  AppUpdateCheckInput: AppUpdateCheckInput;
  AppUpdateCheckInitiator: AppUpdateCheckInitiator;
  AppUpdateCommandRejection: AppUpdateCommandRejection;
  AppUpdateCommandResult: AppUpdateCommandResult;
  AppUpdateDownloadableState: AppUpdateDownloadableState;
  AppUpdateError: AppUpdateError;
  AppUpdateErrorCode: AppUpdateErrorCode;
  AppUpdateInstallableState: AppUpdateInstallableState;
  AppUpdateOperation: AppUpdateOperation;
  AppUpdateState: AppUpdateState;
  AppUpdateStateChangedEvent: AppUpdateStateChangedEvent;
  AppUpdateStatus: AppUpdateStatus;
  TaskStoreCheck: TaskStoreCheck;
  ChatSettings: ChatSettings;
  CodexReasoningEffort: CodexReasoningEffort;
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
  FileContent: FileContent;
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
  GeneralSettings: GeneralSettings;
  HorizontalScrollbarVisibility: HorizontalScrollbarVisibility;
  KanbanEmptyColumnDisplay: KanbanEmptyColumnDisplay;
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
  SlashCommandCatalog: SlashCommandCatalog;
  SlashCommandDescriptor: SlashCommandDescriptor;
  SlashCommandSource: SlashCommandSource;
  RuntimeCheck: RuntimeCheck;
  RuntimeCapabilities: RuntimeCapabilities;
  RuntimeCapabilityClass: RuntimeCapabilityClass;
  RuntimeCapabilityKey: RuntimeCapabilityKey;
  RuntimeApprovalCapabilities: RuntimeApprovalCapabilities;
  RuntimeApprovalReplyOutcome: RuntimeApprovalReplyOutcome;
  RuntimeApprovalRequestType: RuntimeApprovalRequestType;
  RuntimeForkTarget: RuntimeForkTarget;
  RuntimeHistoryCapabilities: RuntimeHistoryCapabilities;
  RuntimeHistoryFidelity: RuntimeHistoryFidelity;
  RuntimeHistoryReplay: RuntimeHistoryReplay;
  RuntimeOmittedPermissionBehavior: RuntimeOmittedPermissionBehavior;
  RuntimeOptionalSurfaceCapabilities: RuntimeOptionalSurfaceCapabilities;
  RuntimePendingInputVisibility: RuntimePendingInputVisibility;
  RuntimePromptInputCapabilities: RuntimePromptInputCapabilities;
  RuntimePromptInputPartType: RuntimePromptInputPartType;
  RuntimeQuestionAnswerMode: RuntimeQuestionAnswerMode;
  RuntimeSessionLifecycleCapabilities: RuntimeSessionLifecycleCapabilities;
  RuntimeStructuredInputCapabilities: RuntimeStructuredInputCapabilities;
  RuntimeWorkflowCapabilities: RuntimeWorkflowCapabilities;
  SubagentCatalog: SubagentCatalog;
  SubagentDescriptor: SubagentDescriptor;
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
  ReusablePrompt: ReusablePrompt;
  SoftGuardrails: SoftGuardrails;
  RuntimeKind: RuntimeKind;
  RuntimeProvisioningMode: RuntimeProvisioningMode;
  RuntimeInstanceRef: RuntimeInstanceRef;
  RuntimeSubagentExecutionMode: RuntimeSubagentExecutionMode;
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
  TaskWorktreeSummary: TaskWorktreeSummary;
  TaskUpdatePatch: TaskUpdatePatch;
  ToolExecutableProvenance: ToolExecutableProvenance;
  ToolExecutableSourceCategory: ToolExecutableSourceCategory;
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
    expect(parsedSnapshot.reusablePrompts).toEqual([]);
    expect(parsedSnapshot.kanban.doneVisibleDays).toBe(1);
    expect(parsedSnapshot.kanban.emptyColumnDisplay).toBe("show");
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

  test("keeps odt_get_workspaces workspace-free and workspace-scoped tool inputs overrideable", () => {
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
