import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import type { AgentStudioTaskTabsModel } from "@/components/features/agents";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue, RepoSettingsInput } from "@/types/state-slices";
import type { AgentStudioQueryUpdate as QueryUpdate } from "./agent-studio-navigation";
import { useAgentSessionPermissionActions } from "./use-agent-session-permission-actions";
import { useAgentStudioChatSettings } from "./use-agent-studio-chat-settings";
import { useAgentStudioDocuments } from "./use-agent-studio-documents";
import { useAgentStudioModelSelection } from "./use-agent-studio-model-selection";
import { useAgentStudioPageModels } from "./use-agent-studio-page-models";
import { useAgentStudioRepoSettings } from "./use-agent-studio-repo-settings";
import { useAgentStudioRightPanel } from "./use-agent-studio-right-panel";
import { useAgentStudioSessionActions } from "./use-agent-studio-session-actions";
import type { RequestNewSessionStart } from "./use-agent-studio-session-start-types";

export type AgentStudioOrchestrationWorkspaceContext = {
  activeRepo: string | null;
};

export type AgentStudioOrchestrationSelectionContext = {
  viewTaskId: string;
  viewRole: AgentRole;
  viewScenario: AgentScenario;
  viewSelectedTask: TaskCard | null;
  viewSessionsForTask: AgentSessionState[];
  viewActiveSession: AgentSessionState | null;
  activeTaskTabId: string;
  taskTabs: AgentStudioTaskTabsModel["tabs"];
  availableTabTasks: TaskCard[];
  contextSwitchVersion: number;
  isLoadingTasks: boolean;
  isActiveTaskHydrated: boolean;
  isActiveTaskHydrationFailed: boolean;
  isViewSessionHistoryHydrationFailed: boolean;
  isViewSessionHistoryHydrating: boolean;
  onCreateTab: (taskId: string) => void;
  onCloseTab: (taskId: string) => void;
};

export type AgentStudioOrchestrationReadinessContext = {
  agentStudioReady: boolean;
  agentStudioBlockedReason: string | null;
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
};

export type AgentStudioOrchestrationComposerContext = {
  input: string;
  setInput: (value: string) => void;
};

export type AgentStudioOrchestrationActionsContext = {
  updateQuery: (updates: QueryUpdate) => void;
  onContextSwitchIntent: () => void;
  openTaskDetails: () => void;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  stopAgentSession: AgentStateContextValue["stopAgentSession"];
  updateAgentSessionModel: AgentStateContextValue["updateAgentSessionModel"];
  replyAgentPermission: AgentStateContextValue["replyAgentPermission"];
  answerAgentQuestion: AgentStateContextValue["answerAgentQuestion"];
  requestNewSessionStart?: RequestNewSessionStart;
};

type UseAgentStudioOrchestrationControllerArgs = {
  workspace: AgentStudioOrchestrationWorkspaceContext;
  selection: AgentStudioOrchestrationSelectionContext;
  readiness: AgentStudioOrchestrationReadinessContext;
  composer: AgentStudioOrchestrationComposerContext;
  actions: AgentStudioOrchestrationActionsContext;
};

type UseAgentStudioOrchestrationControllerResult = {
  repoSettings: RepoSettingsInput | null;
  chatSettingsLoadError: Error | null;
  retryChatSettingsLoad: () => void;
  activeTabValue: string;
  agentStudioTaskTabsModel: AgentStudioTaskTabsModel;
  agentStudioHeaderModel: ReturnType<typeof useAgentStudioPageModels>["agentStudioHeaderModel"];
  agentStudioWorkspaceSidebarModel: ReturnType<
    typeof useAgentStudioPageModels
  >["agentStudioWorkspaceSidebarModel"];
  agentChatModel: ReturnType<typeof useAgentStudioPageModels>["agentChatModel"];
  rightPanel: ReturnType<typeof useAgentStudioRightPanel>;
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
  | "onCreateTab"
  | "onCloseTab"
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
  const { activeTaskTabId, ...taskTabs } = tabs;
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
    taskTabs,
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
  workspace,
  selection,
  readiness,
  composer,
  actions,
}: UseAgentStudioOrchestrationControllerArgs): UseAgentStudioOrchestrationControllerResult {
  const { activeRepo } = workspace;
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
    onCreateTab,
    onCloseTab,
  } = selection;
  const { agentStudioReady } = readiness;
  const { input, setInput } = composer;
  const {
    updateQuery,
    onContextSwitchIntent,
    startAgentSession,
    sendAgentMessage,
    stopAgentSession,
    updateAgentSessionModel,
    replyAgentPermission,
    answerAgentQuestion,
    requestNewSessionStart,
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
  });

  const {
    isStarting,
    isSending,
    isSubmittingQuestionByRequestId,
    isSessionWorking,
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
    input,
    setInput,
    startAgentSession,
    sendAgentMessage,
    updateAgentSessionModel,
    answerAgentQuestion,
    updateQuery,
    onContextSwitchIntent,
    ...(requestNewSessionStart ? { requestNewSessionStart } : {}),
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
      onCreateTab,
      onCloseTab,
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
    composer,
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
    hasDiffPanel: viewRole === "build",
  });

  return {
    repoSettings,
    chatSettingsLoadError,
    retryChatSettingsLoad,
    activeTabValue,
    agentStudioTaskTabsModel,
    agentStudioHeaderModel,
    agentStudioWorkspaceSidebarModel,
    agentChatModel,
    rightPanel,
  };
}
