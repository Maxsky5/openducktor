import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { type UIEvent, useCallback, useMemo, useState } from "react";
import {
  type AgentChatModel,
  type AgentStudioTaskTabsModel,
  isNearBottom,
  useAgentChatLayout,
} from "@/components/features/agents";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { ROLE_OPTIONS } from "./agents-page-constants";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import {
  buildAgentStudioTaskTabsModel,
  buildAgentStudioWorkspaceSidebarModel,
  buildRoleLabelByRole,
} from "./agents-page-view-model";
import {
  type AgentStudioDocumentsContext,
  type AgentStudioSessionContextUsage,
  buildActiveDocumentForRole,
  buildWorkflowModelContext,
  toChatContextUsage,
} from "./use-agent-studio-page-model-builders";
import {
  useAgentStudioComposerModel,
  useAgentStudioHeaderModel,
  useAgentStudioThreadModel,
} from "./use-agent-studio-page-submodels";
import { useAgentStudioThreadContext } from "./use-agent-studio-thread-context";

type AgentStudioCoreContext = {
  activeTabValue: string;
  taskId: string;
  role: AgentRole;
  selectedTask: TaskCard | null;
  sessionsForTask: AgentSessionState[];
  contextSessionsLength: number;
  activeSession: AgentSessionState | null;
  isTaskHydrating: boolean;
  contextSwitchVersion: number;
};

type AgentStudioTaskTabsContext = {
  taskTabs: AgentStudioTaskTabsModel["tabs"];
  availableTabTasks: TaskCard[];
  isLoadingTasks: boolean;
  onCreateTab: (taskId: string) => void;
  onCloseTab: (taskId: string) => void;
};

type AgentStudioSessionActionsContext = {
  handleWorkflowStepSelect: (role: AgentRole, sessionId: string | null) => void;
  handleSessionSelectionChange: (nextValue: string) => void;
  handleCreateSession: (option: SessionCreateOption) => void;
  isStarting: boolean;
  isSending: boolean;
  isSessionWorking: boolean;
  canKickoffNewSession: boolean;
  kickoffLabel: string;
  canStopSession: boolean;
  startScenarioKickoff: () => Promise<void>;
  onSend: () => Promise<void>;
  onSubmitQuestionAnswers: (requestId: string, answers: string[][]) => Promise<void>;
  isSubmittingQuestionByRequestId: Record<string, boolean>;
  stopAgentSession: (sessionId: string) => Promise<void>;
};

type AgentStudioReadinessContext = {
  agentStudioReady: boolean;
  agentStudioBlockedReason: string;
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
};

type AgentStudioModelSelectionContext = {
  selectedModelSelection: AgentModelSelection | null;
  isSelectionCatalogLoading: boolean;
  agentOptions: ComboboxOption[];
  modelOptions: ComboboxOption[];
  modelGroups: ComboboxGroup[];
  variantOptions: ComboboxOption[];
  onSelectAgent: (agent: string) => void;
  onSelectModel: (model: string) => void;
  onSelectVariant: (variant: string) => void;
  activeSessionAgentColors: Record<string, string>;
  activeSessionContextUsage: AgentStudioSessionContextUsage;
};

type AgentStudioPermissionContext = {
  isSubmittingPermissionByRequestId: Record<string, boolean>;
  permissionReplyErrorByRequestId: Record<string, string>;
  onReplyPermission: (requestId: string, reply: "once" | "always" | "reject") => Promise<void>;
};

type AgentStudioComposerContext = {
  input: string;
  setInput: (value: string) => void;
};

type UseAgentStudioPageModelsArgs = {
  core: AgentStudioCoreContext;
  taskTabs: AgentStudioTaskTabsContext;
  documents: AgentStudioDocumentsContext;
  readiness: AgentStudioReadinessContext;
  sessionActions: AgentStudioSessionActionsContext;
  modelSelection: AgentStudioModelSelectionContext;
  permissions: AgentStudioPermissionContext;
  composer: AgentStudioComposerContext;
};

export function useAgentStudioPageModels({
  core,
  taskTabs,
  documents,
  readiness,
  sessionActions,
  modelSelection,
  permissions,
  composer,
}: UseAgentStudioPageModelsArgs): {
  activeTabValue: string;
  agentStudioTaskTabsModel: AgentStudioTaskTabsModel;
  agentStudioHeaderModel: ReturnType<typeof useAgentStudioHeaderModel>;
  agentStudioWorkspaceSidebarModel: ReturnType<typeof buildAgentStudioWorkspaceSidebarModel>;
  agentChatModel: AgentChatModel;
} {
  const [todoPanelCollapsedBySession, setTodoPanelCollapsedBySession] = useState<
    Record<string, boolean>
  >({});
  const { threadSession, activeSessionId, isContextSwitching, scrollTrigger } =
    useAgentStudioThreadContext({
      activeSession: core.activeSession,
      isTaskHydrating: core.isTaskHydrating,
      contextSwitchVersion: core.contextSwitchVersion,
    });

  const {
    messagesContainerRef,
    composerFormRef,
    composerTextareaRef,
    isPinnedToBottom,
    setIsPinnedToBottom,
    todoPanelBottomOffset,
    resizeComposerTextarea,
  } = useAgentChatLayout({
    input: composer.input,
    scrollTrigger,
    activeSessionId: threadSession?.sessionId ?? null,
  });

  const handleMessagesScroll = useCallback(
    (event: UIEvent<HTMLDivElement>): void => {
      setIsPinnedToBottom(isNearBottom(event.currentTarget));
    },
    [setIsPinnedToBottom],
  );

  const agentStudioTaskTabsModel = useMemo(
    () =>
      buildAgentStudioTaskTabsModel({
        taskTabs: taskTabs.taskTabs,
        availableTabTasks: taskTabs.availableTabTasks,
        isLoadingTasks: taskTabs.isLoadingTasks,
        onCreateTab: taskTabs.onCreateTab,
        onCloseTab: taskTabs.onCloseTab,
        agentStudioReady: readiness.agentStudioReady,
      }),
    [
      readiness.agentStudioReady,
      taskTabs.availableTabTasks,
      taskTabs.isLoadingTasks,
      taskTabs.onCloseTab,
      taskTabs.onCreateTab,
      taskTabs.taskTabs,
    ],
  );

  const roleLabelByRole = useMemo(() => buildRoleLabelByRole(ROLE_OPTIONS), []);
  const workflowModelContext = useMemo(
    () =>
      buildWorkflowModelContext({
        selectedTask: core.selectedTask,
        sessionsForTask: core.sessionsForTask,
        activeSession: core.activeSession,
        role: core.role,
        isSessionWorking: sessionActions.isSessionWorking,
        qaDoc: documents.qaDoc,
        roleLabelByRole,
      }),
    [
      core.activeSession,
      core.role,
      core.selectedTask,
      core.sessionsForTask,
      documents.qaDoc,
      roleLabelByRole,
      sessionActions.isSessionWorking,
    ],
  );
  const {
    latestSessionByRole,
    workflowStateByRole,
    sessionSelectorGroups,
    sessionSelectorValue,
    sessionCreateOptions,
    selectedInteractionRole,
    selectedRoleAvailable,
    selectedRoleReadOnlyReason,
    createSessionDisabled,
  } = workflowModelContext;

  const activeDocumentRole = core.activeSession?.role ?? core.role;
  const activeDocument = useMemo(
    () =>
      buildActiveDocumentForRole({
        activeRole: activeDocumentRole,
        specDoc: documents.specDoc,
        planDoc: documents.planDoc,
        qaDoc: documents.qaDoc,
      }),
    [activeDocumentRole, documents.planDoc, documents.qaDoc, documents.specDoc],
  );

  const agentStudioHeaderModel = useAgentStudioHeaderModel({
    selectedTask: core.selectedTask,
    activeSession: core.activeSession,
    sessionsForTaskLength: core.sessionsForTask.length,
    contextSessionsLength: core.contextSessionsLength,
    agentStudioReady: readiness.agentStudioReady,
    isStarting: sessionActions.isStarting,
    onWorkflowStepSelect: sessionActions.handleWorkflowStepSelect,
    onSessionSelectionChange: sessionActions.handleSessionSelectionChange,
    onCreateSession: sessionActions.handleCreateSession,
    workflow: {
      workflowStateByRole,
      selectedInteractionRole,
      latestSessionByRole,
      sessionSelectorValue,
      sessionSelectorGroups,
      sessionCreateOptions,
      createSessionDisabled,
    },
  });

  const agentStudioWorkspaceSidebarModel = useMemo(
    () =>
      buildAgentStudioWorkspaceSidebarModel({
        activeDocument,
      }),
    [activeDocument],
  );

  const chatContextUsage = useMemo(
    () => toChatContextUsage(modelSelection.activeSessionContextUsage),
    [modelSelection.activeSessionContextUsage],
  );

  const activeTodoPanelCollapsed = activeSessionId
    ? (todoPanelCollapsedBySession[activeSessionId] ?? false)
    : false;

  const handleToggleTodoPanel = useCallback((): void => {
    if (!activeSessionId) {
      return;
    }
    setTodoPanelCollapsedBySession((current) => ({
      ...current,
      [activeSessionId]: !(current[activeSessionId] ?? false),
    }));
  }, [activeSessionId]);

  const agentChatThreadModel = useAgentStudioThreadModel({
    threadSession,
    taskId: core.taskId,
    agentStudioReady: readiness.agentStudioReady,
    agentStudioBlockedReason: readiness.agentStudioBlockedReason,
    isLoadingChecks: readiness.isLoadingChecks,
    refreshChecks: readiness.refreshChecks,
    canKickoffNewSession: sessionActions.canKickoffNewSession,
    selectedRoleAvailable,
    kickoffLabel: sessionActions.kickoffLabel,
    startScenarioKickoff: sessionActions.startScenarioKickoff,
    isStarting: sessionActions.isStarting,
    isSending: sessionActions.isSending,
    activeSessionAgentColors: modelSelection.activeSessionAgentColors,
    isSubmittingQuestionByRequestId: sessionActions.isSubmittingQuestionByRequestId,
    onSubmitQuestionAnswers: sessionActions.onSubmitQuestionAnswers,
    isSubmittingPermissionByRequestId: permissions.isSubmittingPermissionByRequestId,
    permissionReplyErrorByRequestId: permissions.permissionReplyErrorByRequestId,
    onReplyPermission: permissions.onReplyPermission,
    todoPanelCollapsed: activeTodoPanelCollapsed,
    onToggleTodoPanel: handleToggleTodoPanel,
    todoPanelBottomOffset,
    isPinnedToBottom,
    messagesContainerRef,
    onMessagesScroll: handleMessagesScroll,
  });

  const agentChatComposerModel = useAgentStudioComposerModel({
    taskId: core.taskId,
    activeSession: core.activeSession,
    agentStudioReady: readiness.agentStudioReady,
    workflow: {
      selectedRoleAvailable,
      selectedRoleReadOnlyReason,
    },
    input: composer.input,
    setInput: composer.setInput,
    onSend: sessionActions.onSend,
    isSending: sessionActions.isSending,
    isStarting: sessionActions.isStarting,
    isSessionWorking: sessionActions.isSessionWorking,
    selectedModelSelection: modelSelection.selectedModelSelection,
    isSelectionCatalogLoading: modelSelection.isSelectionCatalogLoading,
    agentOptions: modelSelection.agentOptions,
    modelOptions: modelSelection.modelOptions,
    modelGroups: modelSelection.modelGroups,
    variantOptions: modelSelection.variantOptions,
    onSelectAgent: modelSelection.onSelectAgent,
    onSelectModel: modelSelection.onSelectModel,
    onSelectVariant: modelSelection.onSelectVariant,
    activeSessionAgentColors: modelSelection.activeSessionAgentColors,
    chatContextUsage,
    canStopSession: sessionActions.canStopSession,
    stopAgentSession: sessionActions.stopAgentSession,
    composerFormRef,
    composerTextareaRef,
    resizeComposerTextarea,
  });

  const agentChatModel = useMemo(
    () => ({
      thread: agentChatThreadModel,
      composer: agentChatComposerModel,
      isContextSwitching,
    }),
    [agentChatComposerModel, agentChatThreadModel, isContextSwitching],
  );

  return {
    activeTabValue: core.activeTabValue,
    agentStudioTaskTabsModel,
    agentStudioHeaderModel,
    agentStudioWorkspaceSidebarModel,
    agentChatModel,
  };
}
