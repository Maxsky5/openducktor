import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { useCallback, useMemo, useState } from "react";
import type { AgentChatModel } from "@/components/features/agents/agent-chat/agent-chat.types";
import { useAgentChatLayout } from "@/components/features/agents/agent-chat/use-agent-chat-layout";
import type { AgentStudioTaskTabsModel } from "@/components/features/agents/agent-studio-task-tabs";
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
import type {
  AgentStudioComposerInteractionContext,
  AgentStudioComposerLayoutContext,
  AgentStudioComposerReadinessContext,
  AgentStudioComposerSelectionContext,
  AgentStudioComposerSessionContext,
  AgentStudioThreadKickoffContext,
  AgentStudioThreadPermissionsContext,
  AgentStudioThreadQuestionsContext,
  AgentStudioThreadReadinessContext,
  AgentStudioThreadScrollContext,
  AgentStudioThreadSessionContext,
  AgentStudioThreadTodoPanelContext,
} from "./use-agent-studio-page-submodel-contracts";
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
  isSessionHistoryHydrating: boolean;
  isSessionHistoryHydrationFailed: boolean;
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
  openTaskDetails: () => void;
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

type AgentStudioReadinessContext = AgentStudioThreadReadinessContext;

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

type AgentStudioPermissionContext = AgentStudioThreadPermissionsContext;

type AgentStudioComposerContext = {
  input: string;
  setInput: (value: string) => void;
};

type AgentStudioChatSettingsContext = {
  showThinkingMessages: boolean;
};

type UseAgentStudioPageModelsArgs = {
  core: AgentStudioCoreContext;
  taskTabs: AgentStudioTaskTabsContext;
  documents: AgentStudioDocumentsContext;
  readiness: AgentStudioReadinessContext;
  sessionActions: AgentStudioSessionActionsContext;
  modelSelection: AgentStudioModelSelectionContext;
  permissions: AgentStudioPermissionContext;
  chatSettings: AgentStudioChatSettingsContext;
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
  chatSettings,
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
  const { threadSession, activeSessionId, isContextSwitching } = useAgentStudioThreadContext({
    activeSession: core.activeSession,
    isTaskHydrating: core.isTaskHydrating,
    isSessionHistoryHydrating: core.isSessionHistoryHydrating,
    contextSwitchVersion: core.contextSwitchVersion,
  });

  const {
    messagesContainerRef,
    composerFormRef,
    composerTextareaRef,
    todoPanelBottomOffset,
    resizeComposerTextarea,
  } = useAgentChatLayout({
    input: composer.input,
    activeSessionId: threadSession?.sessionId ?? null,
  });

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
        roleLabelByRole,
      }),
    [
      core.activeSession,
      core.role,
      core.selectedTask,
      core.sessionsForTask,
      roleLabelByRole,
      sessionActions.isSessionWorking,
    ],
  );
  const {
    workflowSessionByRole,
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
    onOpenTaskDetails: core.selectedTask ? sessionActions.openTaskDetails : null,
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
      workflowSessionByRole,
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

  const threadSessionContext = useMemo<AgentStudioThreadSessionContext>(
    () => ({
      threadSession,
      showThinkingMessages: chatSettings.showThinkingMessages,
      isContextSwitching,
      taskId: core.taskId,
      activeSessionAgentColors: modelSelection.activeSessionAgentColors,
    }),
    [
      chatSettings.showThinkingMessages,
      core.taskId,
      isContextSwitching,
      modelSelection.activeSessionAgentColors,
      threadSession,
    ],
  );

  const threadReadinessContext = useMemo<AgentStudioThreadReadinessContext>(
    () => ({
      agentStudioReady: readiness.agentStudioReady,
      agentStudioBlockedReason: readiness.agentStudioBlockedReason,
      isLoadingChecks: readiness.isLoadingChecks,
      refreshChecks: readiness.refreshChecks,
    }),
    [
      readiness.agentStudioBlockedReason,
      readiness.agentStudioReady,
      readiness.isLoadingChecks,
      readiness.refreshChecks,
    ],
  );

  const threadKickoffContext = useMemo<AgentStudioThreadKickoffContext>(
    () => ({
      canKickoffNewSession: sessionActions.canKickoffNewSession,
      selectedRoleAvailable,
      kickoffLabel: sessionActions.kickoffLabel,
      startScenarioKickoff: sessionActions.startScenarioKickoff,
      isStarting: sessionActions.isStarting,
      isSending: sessionActions.isSending,
    }),
    [
      selectedRoleAvailable,
      sessionActions.canKickoffNewSession,
      sessionActions.isSending,
      sessionActions.isStarting,
      sessionActions.kickoffLabel,
      sessionActions.startScenarioKickoff,
    ],
  );

  const threadQuestionContext = useMemo<AgentStudioThreadQuestionsContext>(
    () => ({
      isSubmittingQuestionByRequestId: sessionActions.isSubmittingQuestionByRequestId,
      onSubmitQuestionAnswers: sessionActions.onSubmitQuestionAnswers,
    }),
    [sessionActions.isSubmittingQuestionByRequestId, sessionActions.onSubmitQuestionAnswers],
  );

  const threadPermissionContext = useMemo<AgentStudioThreadPermissionsContext>(
    () => ({
      isSubmittingPermissionByRequestId: permissions.isSubmittingPermissionByRequestId,
      permissionReplyErrorByRequestId: permissions.permissionReplyErrorByRequestId,
      onReplyPermission: permissions.onReplyPermission,
    }),
    [
      permissions.isSubmittingPermissionByRequestId,
      permissions.onReplyPermission,
      permissions.permissionReplyErrorByRequestId,
    ],
  );

  const threadTodoPanelContext = useMemo<AgentStudioThreadTodoPanelContext>(
    () => ({
      todoPanelCollapsed: activeTodoPanelCollapsed,
      onToggleTodoPanel: handleToggleTodoPanel,
      todoPanelBottomOffset,
    }),
    [activeTodoPanelCollapsed, handleToggleTodoPanel, todoPanelBottomOffset],
  );

  const threadScrollContext = useMemo<AgentStudioThreadScrollContext>(
    () => ({
      messagesContainerRef,
    }),
    [messagesContainerRef],
  );

  const agentChatThreadModel = useAgentStudioThreadModel({
    session: threadSessionContext,
    readiness: threadReadinessContext,
    kickoff: threadKickoffContext,
    questions: threadQuestionContext,
    permissions: threadPermissionContext,
    todoPanel: threadTodoPanelContext,
    scroll: threadScrollContext,
  });

  const composerSessionContext = useMemo<AgentStudioComposerSessionContext>(
    () => ({
      taskId: core.taskId,
      activeSession: core.activeSession,
      isSessionWorking: sessionActions.isSessionWorking,
      canStopSession: sessionActions.canStopSession,
      stopAgentSession: sessionActions.stopAgentSession,
    }),
    [
      core.activeSession,
      core.taskId,
      sessionActions.canStopSession,
      sessionActions.isSessionWorking,
      sessionActions.stopAgentSession,
    ],
  );

  const composerReadinessContext = useMemo<AgentStudioComposerReadinessContext>(
    () => ({
      agentStudioReady: readiness.agentStudioReady,
      workflow: {
        selectedRoleAvailable,
        selectedRoleReadOnlyReason,
      },
    }),
    [readiness.agentStudioReady, selectedRoleAvailable, selectedRoleReadOnlyReason],
  );

  const composerInteractionContext = useMemo<AgentStudioComposerInteractionContext>(
    () => ({
      input: composer.input,
      setInput: composer.setInput,
      onSend: sessionActions.onSend,
      isSending: sessionActions.isSending,
      isStarting: sessionActions.isStarting,
      chatContextUsage,
    }),
    [
      chatContextUsage,
      composer.input,
      composer.setInput,
      sessionActions.isSending,
      sessionActions.isStarting,
      sessionActions.onSend,
    ],
  );

  const composerSelectionContext = useMemo<AgentStudioComposerSelectionContext>(
    () => ({
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
    }),
    [
      modelSelection.activeSessionAgentColors,
      modelSelection.agentOptions,
      modelSelection.isSelectionCatalogLoading,
      modelSelection.modelGroups,
      modelSelection.modelOptions,
      modelSelection.onSelectAgent,
      modelSelection.onSelectModel,
      modelSelection.onSelectVariant,
      modelSelection.selectedModelSelection,
      modelSelection.variantOptions,
    ],
  );

  const composerLayoutContext = useMemo<AgentStudioComposerLayoutContext>(
    () => ({
      composerFormRef,
      composerTextareaRef,
      resizeComposerTextarea,
    }),
    [composerFormRef, composerTextareaRef, resizeComposerTextarea],
  );

  const agentChatComposerModel = useAgentStudioComposerModel({
    session: composerSessionContext,
    readiness: composerReadinessContext,
    interaction: composerInteractionContext,
    selection: composerSelectionContext,
    layout: composerLayoutContext,
  });

  const agentChatModel = useMemo(
    () => ({
      thread: agentChatThreadModel,
      composer: agentChatComposerModel,
    }),
    [agentChatComposerModel, agentChatThreadModel],
  );

  return {
    activeTabValue: core.activeTabValue,
    agentStudioTaskTabsModel,
    agentStudioHeaderModel,
    agentStudioWorkspaceSidebarModel,
    agentChatModel,
  };
}
