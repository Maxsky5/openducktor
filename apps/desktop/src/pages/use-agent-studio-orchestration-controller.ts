import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import type { AgentStudioTaskTabsModel } from "@/components/features/agents";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue, RepoSettingsInput } from "@/types/state-slices";
import { useAgentSessionPermissionActions } from "./use-agent-session-permission-actions";
import { useAgentStudioDocuments } from "./use-agent-studio-documents";
import { useAgentStudioModelSelection } from "./use-agent-studio-model-selection";
import { useAgentStudioPageModels } from "./use-agent-studio-page-models";
import { useAgentStudioRepoSettings } from "./use-agent-studio-repo-settings";
import { useAgentStudioRightPanel } from "./use-agent-studio-right-panel";
import { useAgentStudioSessionActions } from "./use-agent-studio-session-actions";
import type { RequestNewSessionStart } from "./use-agent-studio-session-start-types";

type QueryUpdate = Record<string, string | undefined>;

type UseAgentStudioOrchestrationControllerArgs = {
  activeRepo: string | null;
  loadRepoSettings: () => Promise<RepoSettingsInput>;
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
  agentStudioReady: boolean;
  agentStudioBlockedReason: string;
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
  input: string;
  setInput: (value: string) => void;
  updateQuery: (updates: QueryUpdate) => void;
  onContextSwitchIntent: () => void;
  onCreateTab: (taskId: string) => void;
  onCloseTab: (taskId: string) => void;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  stopAgentSession: AgentStateContextValue["stopAgentSession"];
  updateAgentSessionModel: AgentStateContextValue["updateAgentSessionModel"];
  replyAgentPermission: AgentStateContextValue["replyAgentPermission"];
  answerAgentQuestion: AgentStateContextValue["answerAgentQuestion"];
  requestNewSessionStart?: RequestNewSessionStart;
};

type UseAgentStudioOrchestrationControllerResult = {
  repoSettings: RepoSettingsInput | null;
  activeTabValue: string;
  agentStudioTaskTabsModel: AgentStudioTaskTabsModel;
  agentStudioHeaderModel: ReturnType<typeof useAgentStudioPageModels>["agentStudioHeaderModel"];
  agentStudioWorkspaceSidebarModel: ReturnType<
    typeof useAgentStudioPageModels
  >["agentStudioWorkspaceSidebarModel"];
  agentChatModel: ReturnType<typeof useAgentStudioPageModels>["agentChatModel"];
  rightPanel: ReturnType<typeof useAgentStudioRightPanel>;
};

export function useAgentStudioOrchestrationController({
  activeRepo,
  loadRepoSettings,
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
  agentStudioReady,
  agentStudioBlockedReason,
  isLoadingChecks,
  refreshChecks,
  input,
  setInput,
  updateQuery,
  onContextSwitchIntent,
  onCreateTab,
  onCloseTab,
  startAgentSession,
  sendAgentMessage,
  stopAgentSession,
  updateAgentSessionModel,
  replyAgentPermission,
  answerAgentQuestion,
  requestNewSessionStart,
}: UseAgentStudioOrchestrationControllerArgs): UseAgentStudioOrchestrationControllerResult {
  const { repoSettings } = useAgentStudioRepoSettings({
    activeRepo,
    loadRepoSettings,
  });

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
    autostart: false,
    sessionStartPreference: null,
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

  const {
    activeTabValue,
    agentStudioTaskTabsModel,
    agentStudioHeaderModel,
    agentStudioWorkspaceSidebarModel,
    agentChatModel,
  } = useAgentStudioPageModels({
    core: {
      activeTabValue: activeTaskTabId || viewTaskId || "__agent_studio_empty__",
      taskId: viewTaskId,
      role: viewRole,
      selectedTask: viewSelectedTask,
      sessionsForTask: viewSessionsForTask,
      contextSessionsLength: viewSessionsForTask.length,
      activeSession: viewActiveSession,
      isTaskHydrating: Boolean(viewTaskId && !isActiveTaskHydrated),
      contextSwitchVersion,
    },
    taskTabs: {
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
    readiness: {
      agentStudioReady,
      agentStudioBlockedReason,
      isLoadingChecks,
      refreshChecks,
    },
    sessionActions: {
      handleWorkflowStepSelect,
      handleSessionSelectionChange,
      handleCreateSession,
      isStarting,
      isSending,
      isSessionWorking,
      canKickoffNewSession,
      kickoffLabel,
      canStopSession,
      startScenarioKickoff,
      onSend,
      onSubmitQuestionAnswers,
      isSubmittingQuestionByRequestId,
      stopAgentSession,
    },
    modelSelection: {
      selectedModelSelection,
      isSelectionCatalogLoading,
      agentOptions,
      modelOptions,
      modelGroups,
      variantOptions,
      onSelectAgent: handleSelectAgent,
      onSelectModel: handleSelectModel,
      onSelectVariant: handleSelectVariant,
      activeSessionAgentColors,
      activeSessionContextUsage,
    },
    permissions: {
      isSubmittingPermissionByRequestId,
      permissionReplyErrorByRequestId,
      onReplyPermission,
    },
    composer: {
      input,
      setInput,
    },
  });

  const rightPanel = useAgentStudioRightPanel({
    role: viewRole,
    hasTaskContext: Boolean(viewTaskId),
    hasDocumentPanel: Boolean(agentStudioWorkspaceSidebarModel.activeDocument),
    hasDiffPanel: false,
  });

  return {
    repoSettings,
    activeTabValue,
    agentStudioTaskTabsModel,
    agentStudioHeaderModel,
    agentStudioWorkspaceSidebarModel,
    agentChatModel,
    rightPanel,
  };
}
