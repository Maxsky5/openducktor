import type {
  GitBranch,
  GitTargetBranch,
  RuntimeDescriptor,
  WorkspaceRecord,
} from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type {
  AgentStudioTaskTabsModel,
  SessionStartModalModel,
} from "@/components/features/agents";
import { useAgentSessionApprovalActions } from "@/components/features/agents/agent-chat/use-agent-session-permission-actions";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import type { AgentStateContextValue, RepoSettingsInput } from "@/types/state-slices";
import type { AgentStudioQueryUpdate as QueryUpdate } from "./agent-studio-navigation";
import type { AgentStudioReadinessState } from "./agent-studio-task-hydration-state";
import { useAgentStudioChatSettings } from "./use-agent-studio-chat-settings";
import { useAgentStudioDocuments } from "./use-agent-studio-documents";
import { useAgentStudioModelSelection } from "./use-agent-studio-model-selection";
import { useAgentStudioPageModels } from "./use-agent-studio-page-models";
import { useAgentStudioRepoSettings } from "./use-agent-studio-repo-settings";
import { useAgentStudioRightPanel } from "./use-agent-studio-right-panel";
import type { AgentStudioSelectionControllerResult } from "./use-agent-studio-selection-controller";
import { useAgentStudioSessionActions } from "./use-agent-studio-session-actions";

export type AgentStudioOrchestrationSelectionContext = AgentStudioSelectionControllerResult & {
  contextSwitchVersion: number;
};

export type AgentStudioOrchestrationReadinessContext = {
  agentStudioReadinessState: AgentStudioReadinessState;
  agentStudioReady: boolean;
  agentStudioBlockedReason: string | null;
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
};

type AgentStudioOrchestrationComposerContext = {
  draftStateKey: string;
};

type AgentStudioOrchestrationActionsContext = {
  updateQuery: (updates: QueryUpdate) => void;
  onContextSwitchIntent: () => void;
  scheduleSelectionIntent: (intent: {
    taskId: string;
    externalSessionId: string | null;
    role: AgentRole;
  }) => void;
  openTaskDetails: () => void;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  stopAgentSession: AgentStateContextValue["stopAgentSession"];
  updateAgentSessionModel: AgentStateContextValue["updateAgentSessionModel"];
  readSessionFileSearch: AgentStateContextValue["readSessionFileSearch"];
  readSessionSlashCommands: AgentStateContextValue["readSessionSlashCommands"];
  bootstrapTaskSessions: AgentStateContextValue["bootstrapTaskSessions"];
  hydrateRequestedTaskSessionHistory: AgentStateContextValue["hydrateRequestedTaskSessionHistory"];
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  setTaskTargetBranch: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  replyAgentApproval: AgentStateContextValue["replyAgentApproval"];
  answerAgentQuestion: AgentStateContextValue["answerAgentQuestion"];
};
type UseAgentStudioOrchestrationControllerArgs = {
  activeWorkspace: WorkspaceRecord | null;
  branches: GitBranch[];
  runtimeDefinitions: RuntimeDescriptor[];
  selection: AgentStudioOrchestrationSelectionContext;
  readiness: AgentStudioOrchestrationReadinessContext;
  hasActiveGitConflict: boolean;
  draftStateKey: string;
  actions: AgentStudioOrchestrationActionsContext;
};

type UseAgentStudioOrchestrationControllerResult = {
  repoSettings: RepoSettingsInput | null;
  chatSettingsLoadError: Error | null;
  retryChatSettingsLoad: () => void;
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  sessionStartModal: SessionStartModalModel | null;
  activeTabValue: string;
  agentStudioTaskTabsModel: AgentStudioTaskTabsModel;
  agentStudioHeaderModel: ReturnType<typeof useAgentStudioPageModels>["agentStudioHeaderModel"];
  agentStudioWorkspaceSidebarModel: ReturnType<
    typeof useAgentStudioPageModels
  >["agentStudioWorkspaceSidebarModel"];
  agentChatModel: ReturnType<typeof useAgentStudioPageModels>["agentChatModel"];
  rightPanel: ReturnType<typeof useAgentStudioRightPanel>;
  startSessionRequest: ReturnType<typeof useAgentStudioSessionActions>["startSessionRequest"];
};

type AgentStudioPageModelsViewContext = Pick<
  AgentStudioOrchestrationSelectionContext,
  | "viewTaskId"
  | "viewRole"
  | "viewSelectedTask"
  | "contextSwitchVersion"
  | "isActiveTaskHydrated"
  | "isActiveTaskHydrationFailed"
  | "isViewSessionHistoryHydrated"
  | "isViewSessionHistoryHydrationFailed"
  | "isViewSessionHistoryHydrating"
  | "isViewSessionWaitingForRuntimeReadiness"
> & {
  hasActiveGitConflict: boolean;
};

type AgentStudioPageModelsSessionsContext = Pick<
  AgentStudioOrchestrationSelectionContext,
  | "allSessionSummaries"
  | "viewSessionsForTask"
  | "viewActiveSession"
  | "viewSessionRuntimeDataError"
>;

type AgentStudioPageModelsTabsContext = Pick<
  AgentStudioOrchestrationSelectionContext,
  | "activeTaskTabId"
  | "taskTabs"
  | "availableTabTasks"
  | "isLoadingTasks"
  | "handleSelectTab"
  | "handleCreateTab"
  | "handleCloseTab"
  | "handleReorderTab"
>;

type AgentStudioPageModelsDocumentsContext = Pick<
  ReturnType<typeof useAgentStudioDocuments>,
  "specDoc" | "planDoc" | "qaDoc"
>;

type AgentStudioPageModelsSessionActionsContext = Parameters<
  typeof useAgentStudioPageModels
>[0]["sessionActions"];

type AgentStudioPageModelsModelSelectionContext = Pick<
  ReturnType<typeof useAgentStudioModelSelection>,
  | "selectedModelSelection"
  | "selectedModelDescriptor"
  | "isSelectionCatalogLoading"
  | "supportsSlashCommands"
  | "supportsFileSearch"
  | "slashCommandCatalog"
  | "slashCommands"
  | "slashCommandsError"
  | "isSlashCommandsLoading"
  | "searchFiles"
  | "agentOptions"
  | "modelOptions"
  | "modelGroups"
  | "variantOptions"
  | "activeSessionAgentColors"
  | "activeSessionContextUsage"
  | "handleSelectAgent"
  | "handleSelectModel"
  | "handleSelectVariant"
>;

type BuildAgentStudioPageModelsArgsInput = {
  view: AgentStudioPageModelsViewContext;
  sessions: AgentStudioPageModelsSessionsContext;
  runtimeDefinitions: RuntimeDescriptor[];
  tabs: AgentStudioPageModelsTabsContext;
  documents: AgentStudioPageModelsDocumentsContext;
  readiness: AgentStudioOrchestrationReadinessContext;
  sessionActions: AgentStudioPageModelsSessionActionsContext;
  modelSelection: AgentStudioPageModelsModelSelectionContext;
  permissions: ReturnType<typeof useAgentSessionApprovalActions>;
  chatSettings: {
    showThinkingMessages: boolean;
  };
  composer: AgentStudioOrchestrationComposerContext;
};

export const buildAgentStudioPageModelsArgs = ({
  view,
  sessions,
  runtimeDefinitions,
  tabs,
  documents,
  readiness,
  sessionActions,
  modelSelection,
  permissions,
  chatSettings,
  composer,
}: BuildAgentStudioPageModelsArgsInput): Parameters<typeof useAgentStudioPageModels>[0] => {
  const {
    activeTaskTabId,
    handleSelectTab,
    handleCreateTab,
    handleCloseTab,
    handleReorderTab,
    ...taskTabs
  } = tabs;
  const { handleSelectAgent, handleSelectModel, handleSelectVariant, ...restOfModelSelection } =
    modelSelection;

  return {
    core: {
      activeTabValue: activeTaskTabId || view.viewTaskId || "__agent_studio_empty__",
      taskId: view.viewTaskId,
      role: view.viewRole,
      selectedTask: view.viewSelectedTask,
      sessionsForTask: sessions.viewSessionsForTask,
      allSessionSummaries: sessions.allSessionSummaries,
      contextSessionsLength: sessions.viewSessionsForTask.length,
      activeSession: sessions.viewActiveSession,
      runtimeDefinitions,
      sessionRuntimeDataError: sessions.viewSessionRuntimeDataError ?? null,
      hasActiveGitConflict: view.hasActiveGitConflict,
      isTaskHydrating: Boolean(
        view.viewTaskId && !view.isActiveTaskHydrated && !view.isActiveTaskHydrationFailed,
      ),
      isSessionHistoryHydrated: view.isViewSessionHistoryHydrated,
      isSessionHistoryHydrating: view.isViewSessionHistoryHydrating,
      isWaitingForRuntimeReadiness: view.isViewSessionWaitingForRuntimeReadiness,
      isSessionHistoryHydrationFailed: view.isViewSessionHistoryHydrationFailed,
      contextSwitchVersion: view.contextSwitchVersion,
    },
    taskTabs: {
      ...taskTabs,
      onSelectTab: handleSelectTab,
      onCreateTab: handleCreateTab,
      onCloseTab: handleCloseTab,
      onReorderTab: handleReorderTab,
    },
    documents,
    readiness,
    sessionActions,
    chatSettings,
    modelSelection: {
      ...restOfModelSelection,
      onSelectAgent: handleSelectAgent,
      onSelectModel: handleSelectModel,
      onSelectVariant: handleSelectVariant,
    },
    permissions,
    composer,
  };
};

export function useAgentStudioOrchestrationController({
  activeWorkspace,
  branches,
  runtimeDefinitions,
  selection,
  readiness,
  hasActiveGitConflict,
  draftStateKey,
  actions,
}: UseAgentStudioOrchestrationControllerArgs): UseAgentStudioOrchestrationControllerResult {
  const {
    viewTaskId,
    viewRole,
    viewLaunchActionId,
    viewSelectedTask,
    viewSessionsForTask,
    viewActiveSessionSummary,
    viewActiveSession,
    viewSessionRuntimeDataError = null,
    activeTaskTabId,
    taskTabs,
    availableTabTasks,
    contextSwitchVersion,
    isLoadingTasks,
    isActiveTaskHydrated,
    handleSelectTab,
    handleCreateTab,
    handleCloseTab,
    handleReorderTab,
  } = selection;
  const { agentStudioReady } = readiness;
  const {
    updateQuery,
    onContextSwitchIntent,
    startAgentSession,
    sendAgentMessage,
    stopAgentSession,
    updateAgentSessionModel,
    readSessionFileSearch,
    readSessionSlashCommands,
    bootstrapTaskSessions,
    hydrateRequestedTaskSessionHistory,
    humanRequestChangesTask,
    setTaskTargetBranch,
    replyAgentApproval,
    answerAgentQuestion,
    scheduleSelectionIntent,
  } = actions;

  const { repoSettings } = useAgentStudioRepoSettings({
    activeWorkspace,
  });
  const { showThinkingMessages, reusablePrompts, chatSettingsLoadError, retryChatSettingsLoad } =
    useAgentStudioChatSettings({ activeWorkspace });

  const { specDoc, planDoc, qaDoc } = useAgentStudioDocuments({
    activeWorkspace,
    taskId: viewTaskId,
    activeSession: viewActiveSession,
    selectedTask: viewSelectedTask,
  });

  const {
    selectionForNewSession,
    selectedModelSelection,
    selectedModelDescriptor,
    isSelectionCatalogLoading,
    supportsSlashCommands,
    supportsFileSearch,
    slashCommandCatalog,
    slashCommands,
    slashCommandsError,
    isSlashCommandsLoading,
    searchFiles,
    agentOptions,
    modelOptions,
    modelGroups,
    variantOptions,
    activeSessionAgentColors,
    activeSessionContextUsage,
    handleSelectAgent,
    handleSelectModel,
    handleSelectVariant,
  } = useAgentStudioModelSelection({
    activeWorkspace,
    activeSession: viewActiveSession,
    activeSessionSummary: viewActiveSessionSummary,
    role: viewRole,
    reusablePrompts,
    repoSettings,
    updateAgentSessionModel,
    readSessionFileSearch,
    readSessionSlashCommands,
  });

  const {
    isStarting,
    sessionStartModal,
    humanReviewFeedbackModal,
    startSessionRequest,
    isSending,
    isSubmittingQuestionByRequestId,
    isSessionWorking,
    isWaitingInput,
    busySendBlockedReason,
    canKickoffNewSession,
    kickoffLabel,
    canStopSession,
    startLaunchKickoff,
    onSend,
    onSubmitQuestionAnswers,
    handleWorkflowStepSelect,
    handleSessionSelectionChange,
    handleCreateSession,
    handlePrepareMessageFirstSession,
    handleQuickAction,
  } = useAgentStudioSessionActions({
    activeWorkspace,
    branches,
    taskId: viewTaskId,
    role: viewRole,
    launchActionId: viewLaunchActionId,
    activeSession: viewActiveSession,
    selectedModelSelection,
    selectedModelDescriptor,
    sessionsForTask: viewSessionsForTask,
    selectedTask: viewSelectedTask,
    agentStudioReady,
    isActiveTaskHydrated,
    selectionForNewSession,
    reusablePrompts,
    repoSettings,
    startAgentSession,
    sendAgentMessage,
    bootstrapTaskSessions,
    hydrateRequestedTaskSessionHistory,
    humanRequestChangesTask,
    setTaskTargetBranch,
    answerAgentQuestion,
    updateQuery,
    scheduleSelectionIntent,
    onContextSwitchIntent,
  });

  const { isSubmittingApprovalByRequestId, approvalReplyErrorByRequestId, onReplyApproval } =
    useAgentSessionApprovalActions({
      activeExternalSessionId: viewActiveSession?.externalSessionId ?? null,
      pendingApprovals: viewActiveSession?.pendingApprovals ?? [],
      agentStudioReady,
      replyAgentApproval,
    });

  const pageModelsArgs = buildAgentStudioPageModelsArgs({
    view: {
      viewTaskId,
      viewRole,
      viewSelectedTask,
      contextSwitchVersion,
      isActiveTaskHydrated,
      isActiveTaskHydrationFailed: selection.isActiveTaskHydrationFailed,
      isViewSessionHistoryHydrated: selection.isViewSessionHistoryHydrated,
      isViewSessionHistoryHydrationFailed: selection.isViewSessionHistoryHydrationFailed,
      isViewSessionHistoryHydrating: selection.isViewSessionHistoryHydrating,
      isViewSessionWaitingForRuntimeReadiness: selection.isViewSessionWaitingForRuntimeReadiness,
      hasActiveGitConflict,
    },
    sessions: {
      allSessionSummaries: selection.allSessionSummaries,
      viewSessionsForTask,
      viewActiveSession,
      viewSessionRuntimeDataError,
    },
    runtimeDefinitions,
    tabs: {
      activeTaskTabId,
      taskTabs,
      availableTabTasks,
      isLoadingTasks,
      handleSelectTab,
      handleCreateTab,
      handleCloseTab,
      handleReorderTab,
    },
    documents: {
      specDoc,
      planDoc,
      qaDoc,
    },
    readiness,
    sessionActions: {
      openTaskDetails: actions.openTaskDetails,
      isStarting,
      isSending,
      isSubmittingQuestionByRequestId,
      isSessionWorking,
      isWaitingInput,
      busySendBlockedReason,
      canKickoffNewSession,
      kickoffLabel,
      canStopSession,
      startLaunchKickoff,
      onSend,
      onSubmitQuestionAnswers,
      handleWorkflowStepSelect,
      handleSessionSelectionChange,
      handleCreateSession,
      handlePrepareMessageFirstSession,
      handleQuickAction,
      stopAgentSession,
    },
    modelSelection: {
      selectedModelSelection,
      selectedModelDescriptor,
      isSelectionCatalogLoading,
      supportsSlashCommands,
      supportsFileSearch,
      slashCommandCatalog,
      slashCommands,
      slashCommandsError,
      isSlashCommandsLoading,
      searchFiles,
      agentOptions,
      modelOptions,
      modelGroups,
      variantOptions,
      activeSessionAgentColors,
      activeSessionContextUsage,
      handleSelectAgent,
      handleSelectModel,
      handleSelectVariant,
    },
    permissions: {
      isSubmittingApprovalByRequestId,
      approvalReplyErrorByRequestId,
      onReplyApproval,
    },
    chatSettings: {
      showThinkingMessages,
    },
    composer: {
      draftStateKey,
    },
  });

  const {
    activeTabValue,
    agentStudioTaskTabsModel,
    agentStudioHeaderModel,
    agentStudioWorkspaceSidebarModel,
    agentChatModel,
  } = useAgentStudioPageModels(pageModelsArgs);

  const rightPanel = useAgentStudioRightPanel({
    role: viewRole,
    hasTaskContext: Boolean(viewTaskId),
    hasDocumentPanel: Boolean(agentStudioWorkspaceSidebarModel.activeDocument),
    hasBuildToolsPanel: viewRole === "build",
  });

  return {
    repoSettings,
    chatSettingsLoadError,
    retryChatSettingsLoad,
    humanReviewFeedbackModal,
    sessionStartModal,
    activeTabValue,
    agentStudioTaskTabsModel,
    agentStudioHeaderModel,
    agentStudioWorkspaceSidebarModel,
    agentChatModel,
    rightPanel,
    startSessionRequest,
  };
}
