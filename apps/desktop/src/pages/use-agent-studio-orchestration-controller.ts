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

export type AgentStudioOrchestrationWorkspaceContext = {
  activeRepo: string | null;
  loadRepoSettings: () => Promise<RepoSettingsInput>;
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
  onCreateTab: (taskId: string) => void;
  onCloseTab: (taskId: string) => void;
};

export type AgentStudioOrchestrationReadinessContext = {
  agentStudioReady: boolean;
  agentStudioBlockedReason: string;
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
  activeTabValue: string;
  agentStudioTaskTabsModel: AgentStudioTaskTabsModel;
  agentStudioHeaderModel: ReturnType<typeof useAgentStudioPageModels>["agentStudioHeaderModel"];
  agentStudioWorkspaceSidebarModel: ReturnType<
    typeof useAgentStudioPageModels
  >["agentStudioWorkspaceSidebarModel"];
  agentChatModel: ReturnType<typeof useAgentStudioPageModels>["agentChatModel"];
  rightPanel: ReturnType<typeof useAgentStudioRightPanel>;
};

type BuildAgentStudioPageModelsArgsInput = {
  viewTaskId: string;
  viewRole: AgentRole;
  viewSelectedTask: TaskCard | null;
  viewSessionsForTask: AgentSessionState[];
  viewActiveSession: AgentSessionState | null;
  activeTaskTabId: string;
  taskTabs: AgentStudioTaskTabsModel["tabs"];
  availableTabTasks: TaskCard[];
  onCreateTab: (taskId: string) => void;
  onCloseTab: (taskId: string) => void;
  contextSwitchVersion: number;
  isLoadingTasks: boolean;
  isActiveTaskHydrated: boolean;
  specDoc: ReturnType<typeof useAgentStudioDocuments>["specDoc"];
  planDoc: ReturnType<typeof useAgentStudioDocuments>["planDoc"];
  qaDoc: ReturnType<typeof useAgentStudioDocuments>["qaDoc"];
  readiness: AgentStudioOrchestrationReadinessContext;
  sessionActions: ReturnType<typeof useAgentStudioSessionActions> & {
    stopAgentSession: AgentStateContextValue["stopAgentSession"];
  };
  modelSelection: {
    selectedModelSelection: ReturnType<
      typeof useAgentStudioModelSelection
    >["selectedModelSelection"];
    isSelectionCatalogLoading: ReturnType<
      typeof useAgentStudioModelSelection
    >["isSelectionCatalogLoading"];
    agentOptions: ReturnType<typeof useAgentStudioModelSelection>["agentOptions"];
    modelOptions: ReturnType<typeof useAgentStudioModelSelection>["modelOptions"];
    modelGroups: ReturnType<typeof useAgentStudioModelSelection>["modelGroups"];
    variantOptions: ReturnType<typeof useAgentStudioModelSelection>["variantOptions"];
    onSelectAgent: ReturnType<typeof useAgentStudioModelSelection>["handleSelectAgent"];
    onSelectModel: ReturnType<typeof useAgentStudioModelSelection>["handleSelectModel"];
    onSelectVariant: ReturnType<typeof useAgentStudioModelSelection>["handleSelectVariant"];
    activeSessionAgentColors: ReturnType<
      typeof useAgentStudioModelSelection
    >["activeSessionAgentColors"];
    activeSessionContextUsage: ReturnType<
      typeof useAgentStudioModelSelection
    >["activeSessionContextUsage"];
  };
  permissions: ReturnType<typeof useAgentSessionPermissionActions>;
  composer: AgentStudioOrchestrationComposerContext;
};

export const buildAgentStudioPageModelsArgs = ({
  viewTaskId,
  viewRole,
  viewSelectedTask,
  viewSessionsForTask,
  viewActiveSession,
  activeTaskTabId,
  taskTabs,
  availableTabTasks,
  onCreateTab,
  onCloseTab,
  contextSwitchVersion,
  isLoadingTasks,
  isActiveTaskHydrated,
  specDoc,
  planDoc,
  qaDoc,
  readiness,
  sessionActions,
  modelSelection,
  permissions,
  composer,
}: BuildAgentStudioPageModelsArgsInput): Parameters<typeof useAgentStudioPageModels>[0] => ({
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
  readiness,
  sessionActions,
  modelSelection,
  permissions,
  composer,
});

export function useAgentStudioOrchestrationController({
  workspace,
  selection,
  readiness,
  composer,
  actions,
}: UseAgentStudioOrchestrationControllerArgs): UseAgentStudioOrchestrationControllerResult {
  const { activeRepo, loadRepoSettings } = workspace;
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

  const pageModelsArgs = buildAgentStudioPageModelsArgs({
    viewTaskId,
    viewRole,
    viewSelectedTask,
    viewSessionsForTask,
    viewActiveSession,
    activeTaskTabId,
    taskTabs,
    availableTabTasks,
    onCreateTab,
    onCloseTab,
    contextSwitchVersion,
    isLoadingTasks,
    isActiveTaskHydrated,
    specDoc,
    planDoc,
    qaDoc,
    readiness,
    sessionActions: {
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
      onSelectAgent: handleSelectAgent,
      onSelectModel: handleSelectModel,
      onSelectVariant: handleSelectVariant,
    },
    permissions: {
      isSubmittingPermissionByRequestId,
      permissionReplyErrorByRequestId,
      onReplyPermission,
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
