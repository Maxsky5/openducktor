import type {
  AgentStudioTaskTabsModel,
  SessionStartModalModel,
} from "@/components/features/agents";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import type { AgentStateContextValue, RepoSettingsInput } from "@/types/state-slices";
import type { AgentStudioQueryUpdate as QueryUpdate } from "./agent-studio-navigation";
import { useAgentSessionPermissionActions } from "./use-agent-session-permission-actions";
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
  openTaskDetails: () => void;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  stopAgentSession: AgentStateContextValue["stopAgentSession"];
  updateAgentSessionModel: AgentStateContextValue["updateAgentSessionModel"];
  readSessionSlashCommands: AgentStateContextValue["readSessionSlashCommands"];
  bootstrapTaskSessions: AgentStateContextValue["bootstrapTaskSessions"];
  hydrateRequestedTaskSessionHistory: AgentStateContextValue["hydrateRequestedTaskSessionHistory"];
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  replyAgentPermission: AgentStateContextValue["replyAgentPermission"];
  answerAgentQuestion: AgentStateContextValue["answerAgentQuestion"];
};
type UseAgentStudioOrchestrationControllerArgs = {
  activeRepo: string | null;
  selection: AgentStudioOrchestrationSelectionContext;
  readiness: AgentStudioOrchestrationReadinessContext;
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
  | "isViewSessionHistoryHydrationFailed"
  | "isViewSessionHistoryHydrating"
>;

type AgentStudioPageModelsSessionsContext = Pick<
  AgentStudioOrchestrationSelectionContext,
  "viewSessionsForTask" | "viewActiveSession"
>;

type AgentStudioPageModelsTabsContext = Pick<
  AgentStudioOrchestrationSelectionContext,
  | "activeTaskTabId"
  | "taskTabs"
  | "availableTabTasks"
  | "isLoadingTasks"
  | "handleCreateTab"
  | "handleCloseTab"
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
  | "isSelectionCatalogLoading"
  | "supportsSlashCommands"
  | "slashCommandCatalog"
  | "slashCommands"
  | "slashCommandsError"
  | "isSlashCommandsLoading"
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
  tabs: AgentStudioPageModelsTabsContext;
  documents: AgentStudioPageModelsDocumentsContext;
  readiness: AgentStudioOrchestrationReadinessContext;
  sessionActions: AgentStudioPageModelsSessionActionsContext;
  modelSelection: AgentStudioPageModelsModelSelectionContext;
  permissions: ReturnType<typeof useAgentSessionPermissionActions>;
  chatSettings: {
    showThinkingMessages: boolean;
  };
  composer: AgentStudioOrchestrationComposerContext;
};

export const buildAgentStudioPageModelsArgs = ({
  view,
  sessions,
  tabs,
  documents,
  readiness,
  sessionActions,
  modelSelection,
  permissions,
  chatSettings,
  composer,
}: BuildAgentStudioPageModelsArgsInput): Parameters<typeof useAgentStudioPageModels>[0] => {
  const { activeTaskTabId, handleCreateTab, handleCloseTab, ...taskTabs } = tabs;
  const { handleSelectAgent, handleSelectModel, handleSelectVariant, ...restOfModelSelection } =
    modelSelection;

  return {
    core: {
      activeTabValue: activeTaskTabId || view.viewTaskId || "__agent_studio_empty__",
      taskId: view.viewTaskId,
      role: view.viewRole,
      selectedTask: view.viewSelectedTask,
      sessionsForTask: sessions.viewSessionsForTask,
      contextSessionsLength: sessions.viewSessionsForTask.length,
      activeSession: sessions.viewActiveSession,
      isTaskHydrating: Boolean(
        view.viewTaskId && !view.isActiveTaskHydrated && !view.isActiveTaskHydrationFailed,
      ),
      isSessionHistoryHydrating: view.isViewSessionHistoryHydrating,
      isSessionHistoryHydrationFailed: view.isViewSessionHistoryHydrationFailed,
      contextSwitchVersion: view.contextSwitchVersion,
    },
    taskTabs: {
      ...taskTabs,
      onCreateTab: handleCreateTab,
      onCloseTab: handleCloseTab,
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
  activeRepo,
  selection,
  readiness,
  draftStateKey,
  actions,
}: UseAgentStudioOrchestrationControllerArgs): UseAgentStudioOrchestrationControllerResult {
  const {
    viewTaskId,
    viewRole,
    viewScenario,
    viewSelectedTask,
    viewSessionsForTask,
    viewActiveSession,
    activeTaskTabId,
    taskTabs,
    availableTabTasks,
    contextSwitchVersion,
    isLoadingTasks,
    isActiveTaskHydrated,
    handleCreateTab,
    handleCloseTab,
  } = selection;
  const { agentStudioReady } = readiness;
  const {
    updateQuery,
    onContextSwitchIntent,
    startAgentSession,
    sendAgentMessage,
    stopAgentSession,
    updateAgentSessionModel,
    readSessionSlashCommands,
    bootstrapTaskSessions,
    hydrateRequestedTaskSessionHistory,
    humanRequestChangesTask,
    replyAgentPermission,
    answerAgentQuestion,
  } = actions;

  const { repoSettings } = useAgentStudioRepoSettings({ activeRepo });
  const { showThinkingMessages, chatSettingsLoadError, retryChatSettingsLoad } =
    useAgentStudioChatSettings({ activeRepo });

  const { specDoc, planDoc, qaDoc } = useAgentStudioDocuments({
    activeRepo,
    taskId: viewTaskId,
    activeSession: viewActiveSession,
    selectedTask: viewSelectedTask,
  });

  const {
    selectionForNewSession,
    selectedModelSelection,
    isSelectionCatalogLoading,
    supportsSlashCommands,
    slashCommandCatalog,
    slashCommands,
    slashCommandsError,
    isSlashCommandsLoading,
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
    activeRepo,
    activeSession: viewActiveSession,
    role: viewRole,
    repoSettings,
    updateAgentSessionModel,
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
    startScenarioKickoff,
    onSend,
    onSubmitQuestionAnswers,
    handleWorkflowStepSelect,
    handleSessionSelectionChange,
    handleCreateSession,
  } = useAgentStudioSessionActions({
    activeRepo,
    taskId: viewTaskId,
    role: viewRole,
    scenario: viewScenario,
    activeSession: viewActiveSession,
    sessionsForTask: viewSessionsForTask,
    selectedTask: viewSelectedTask,
    agentStudioReady,
    isActiveTaskHydrated,
    selectionForNewSession,
    repoSettings,
    startAgentSession,
    sendAgentMessage,
    bootstrapTaskSessions,
    hydrateRequestedTaskSessionHistory,
    humanRequestChangesTask,
    answerAgentQuestion,
    updateQuery,
    onContextSwitchIntent,
  });

  const { isSubmittingPermissionByRequestId, permissionReplyErrorByRequestId, onReplyPermission } =
    useAgentSessionPermissionActions({
      activeSessionId: viewActiveSession?.sessionId ?? null,
      pendingPermissions: viewActiveSession?.pendingPermissions ?? [],
      agentStudioReady,
      replyAgentPermission,
    });

  const pageModelsArgs = buildAgentStudioPageModelsArgs({
    view: {
      viewTaskId,
      viewRole,
      viewSelectedTask,
      contextSwitchVersion,
      isActiveTaskHydrated,
      isActiveTaskHydrationFailed: selection.isActiveTaskHydrationFailed,
      isViewSessionHistoryHydrationFailed: selection.isViewSessionHistoryHydrationFailed,
      isViewSessionHistoryHydrating: selection.isViewSessionHistoryHydrating,
    },
    sessions: {
      viewSessionsForTask,
      viewActiveSession,
    },
    tabs: {
      activeTaskTabId,
      taskTabs,
      availableTabTasks,
      isLoadingTasks,
      handleCreateTab,
      handleCloseTab,
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
      startScenarioKickoff,
      onSend,
      onSubmitQuestionAnswers,
      handleWorkflowStepSelect,
      handleSessionSelectionChange,
      handleCreateSession,
      stopAgentSession,
    },
    modelSelection: {
      selectedModelSelection,
      isSelectionCatalogLoading,
      supportsSlashCommands,
      slashCommandCatalog,
      slashCommands,
      slashCommandsError,
      isSlashCommandsLoading,
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
      isSubmittingPermissionByRequestId,
      permissionReplyErrorByRequestId,
      onReplyPermission,
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
