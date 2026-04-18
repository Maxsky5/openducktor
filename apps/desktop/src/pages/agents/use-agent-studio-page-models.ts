import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { useCallback, useMemo, useRef, useState } from "react";
import type { AgentChatModel } from "@/components/features/agents/agent-chat/agent-chat.types";
import type { AgentChatComposerDraft } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { useAgentChatLayout } from "@/components/features/agents/agent-chat/use-agent-chat-layout";
import type { AgentStudioTaskTabsModel } from "@/components/features/agents/agent-studio-task-tabs";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStudioReadinessState } from "./agent-studio-task-hydration-state";
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
  sessionsForTask: AgentSessionSummary[];
  contextSessionsLength: number;
  activeSession: AgentSessionState | null;
  isTaskHydrating: boolean;
  isSessionHistoryHydrating: boolean;
  isWaitingForRuntimeReadiness: boolean;
  isSessionHistoryHydrationFailed: boolean;
  contextSwitchVersion: number;
};

type AgentStudioTaskTabsContext = {
  taskTabs: AgentStudioTaskTabsModel["tabs"];
  availableTabTasks: TaskCard[];
  isLoadingTasks: boolean;
  onSelectTab: (taskId: string) => void;
  onCreateTab: (taskId: string) => void;
  onCloseTab: (taskId: string) => void;
  onReorderTab: (draggedTaskId: string, targetTaskId: string, position: "before" | "after") => void;
};

type AgentStudioSessionActionsContext = {
  handleWorkflowStepSelect: (role: AgentRole, sessionId: string | null) => void;
  handleSessionSelectionChange: (nextValue: string) => void;
  handleCreateSession: (option: SessionCreateOption) => void;
  openTaskDetails: () => void;
  isStarting: boolean;
  isSending: boolean;
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  busySendBlockedReason: string | null;
  canKickoffNewSession: boolean;
  kickoffLabel: string;
  canStopSession: boolean;
  startScenarioKickoff: () => Promise<void>;
  onSend: (draft: AgentChatComposerDraft) => Promise<boolean>;
  onSubmitQuestionAnswers: (requestId: string, answers: string[][]) => Promise<void>;
  isSubmittingQuestionByRequestId: Record<string, boolean>;
  stopAgentSession: (sessionId: string) => Promise<void>;
};

type AgentStudioReadinessContext = {
  agentStudioReadinessState: AgentStudioReadinessState;
  agentStudioReady: boolean;
  agentStudioBlockedReason: string | null;
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
};

type AgentStudioModelSelectionContext = {
  selectedModelSelection: AgentModelSelection | null;
  selectedModelDescriptor?: AgentChatModel["composer"]["selectedModelDescriptor"];
  isSelectionCatalogLoading: boolean;
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  slashCommandCatalog: AgentChatModel["composer"]["slashCommandCatalog"];
  slashCommands: AgentChatModel["composer"]["slashCommands"];
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
  searchFiles: AgentChatModel["composer"]["searchFiles"];
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
  draftStateKey: string;
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
  const syncBottomAfterComposerLayoutRef = useRef<(() => void) | null>(null);
  const { messagesContainerRef, composerFormRef, composerEditorRef, resizeComposerEditor } =
    useAgentChatLayout({
      activeSessionId: threadSession?.sessionId ?? null,
      syncBottomAfterComposerLayoutRef,
    });

  const scrollToBottomOnSendRef = useRef<(() => void) | null>(null);
  const workflowSessionsForTask = core.sessionsForTask;
  const workflowActiveSessionId = core.activeSession?.sessionId ?? null;
  const workflowActiveSessionRole = core.activeSession?.role ?? null;
  const workflowActiveSession = useMemo(
    () =>
      workflowActiveSessionId && workflowActiveSessionRole
        ? {
            sessionId: workflowActiveSessionId,
            role: workflowActiveSessionRole,
          }
        : null,
    [workflowActiveSessionId, workflowActiveSessionRole],
  );

  const agentStudioTaskTabsModel = useMemo(
    () =>
      buildAgentStudioTaskTabsModel({
        taskTabs: taskTabs.taskTabs,
        availableTabTasks: taskTabs.availableTabTasks,
        isLoadingTasks: taskTabs.isLoadingTasks,
        onSelectTab: taskTabs.onSelectTab,
        onCreateTab: taskTabs.onCreateTab,
        onCloseTab: taskTabs.onCloseTab,
        onReorderTab: taskTabs.onReorderTab,
        agentStudioReady: readiness.agentStudioReady,
      }),
    [
      readiness.agentStudioReady,
      taskTabs.availableTabTasks,
      taskTabs.isLoadingTasks,
      taskTabs.onCloseTab,
      taskTabs.onCreateTab,
      taskTabs.onReorderTab,
      taskTabs.onSelectTab,
      taskTabs.taskTabs,
    ],
  );

  const roleLabelByRole = useMemo(() => buildRoleLabelByRole(ROLE_OPTIONS), []);
  const workflowModelContext = useMemo(
    () =>
      buildWorkflowModelContext({
        selectedTask: core.selectedTask,
        sessionsForTask: workflowSessionsForTask,
        activeSession: workflowActiveSession,
        role: core.role,
        isSessionWorking: sessionActions.isSessionWorking,
        roleLabelByRole,
      }),
    [
      core.role,
      core.selectedTask,
      roleLabelByRole,
      sessionActions.isSessionWorking,
      workflowActiveSession,
      workflowSessionsForTask,
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
    ? (todoPanelCollapsedBySession[activeSessionId] ?? true)
    : true;
  const composerSessionId = core.activeSession?.sessionId ?? null;
  const composerSelectedModel = core.activeSession?.selectedModel ?? null;
  const composerIsLoadingModelCatalog = core.activeSession?.isLoadingModelCatalog ?? false;
  const composerPendingPermissions = core.activeSession?.pendingPermissions ?? [];
  const composerPendingQuestions = core.activeSession?.pendingQuestions ?? [];
  const composerSession = useMemo(
    () =>
      composerSessionId
        ? {
            sessionId: composerSessionId,
            selectedModel: composerSelectedModel,
            isLoadingModelCatalog: composerIsLoadingModelCatalog,
            pendingPermissions: composerPendingPermissions,
            pendingQuestions: composerPendingQuestions,
          }
        : null,
    [
      composerIsLoadingModelCatalog,
      composerPendingPermissions,
      composerPendingQuestions,
      composerSelectedModel,
      composerSessionId,
    ],
  );

  const handleToggleTodoPanel = useCallback((): void => {
    if (!activeSessionId) {
      return;
    }
    setTodoPanelCollapsedBySession((current) => ({
      ...current,
      [activeSessionId]: !(current[activeSessionId] ?? true),
    }));
  }, [activeSessionId]);

  const agentChatThreadModel = useAgentStudioThreadModel({
    threadSession,
    isSessionWorking: sessionActions.isSessionWorking,
    showThinkingMessages: chatSettings.showThinkingMessages,
    isContextSwitching,
    isSessionHistoryLoading: core.isSessionHistoryHydrating,
    isWaitingForRuntimeReadiness: core.isWaitingForRuntimeReadiness,
    taskId: core.taskId,
    activeSessionAgentColors: modelSelection.activeSessionAgentColors,
    agentStudioReadinessState: readiness.agentStudioReadinessState,
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
    isSubmittingQuestionByRequestId: sessionActions.isSubmittingQuestionByRequestId,
    onSubmitQuestionAnswers: sessionActions.onSubmitQuestionAnswers,
    isSubmittingPermissionByRequestId: permissions.isSubmittingPermissionByRequestId,
    permissionReplyErrorByRequestId: permissions.permissionReplyErrorByRequestId,
    onReplyPermission: permissions.onReplyPermission,
    todoPanelCollapsed: activeTodoPanelCollapsed,
    onToggleTodoPanel: handleToggleTodoPanel,
    messagesContainerRef,
    scrollToBottomOnSendRef,
    syncBottomAfterComposerLayoutRef,
  });

  const agentChatComposerModel = useAgentStudioComposerModel({
    taskId: core.taskId,
    activeSession: composerSession,
    isSessionWorking: sessionActions.isSessionWorking,
    isWaitingInput: sessionActions.isWaitingInput,
    busySendBlockedReason: sessionActions.busySendBlockedReason,
    canStopSession: sessionActions.canStopSession,
    stopAgentSession: sessionActions.stopAgentSession,
    agentStudioReady: readiness.agentStudioReady,
    selectedRoleAvailable,
    selectedRoleReadOnlyReason,
    draftStateKey: composer.draftStateKey,
    onSend: sessionActions.onSend,
    isSending: sessionActions.isSending,
    isStarting: sessionActions.isStarting,
    chatContextUsage,
    selectedModelSelection: modelSelection.selectedModelSelection,
    selectedModelDescriptor: modelSelection.selectedModelDescriptor,
    isSelectionCatalogLoading: modelSelection.isSelectionCatalogLoading,
    supportsSlashCommands: modelSelection.supportsSlashCommands,
    supportsFileSearch: modelSelection.supportsFileSearch,
    slashCommandCatalog: modelSelection.slashCommandCatalog,
    slashCommands: modelSelection.slashCommands,
    slashCommandsError: modelSelection.slashCommandsError,
    isSlashCommandsLoading: modelSelection.isSlashCommandsLoading,
    searchFiles: modelSelection.searchFiles,
    agentOptions: modelSelection.agentOptions,
    modelOptions: modelSelection.modelOptions,
    modelGroups: modelSelection.modelGroups,
    variantOptions: modelSelection.variantOptions,
    onSelectAgent: modelSelection.onSelectAgent,
    onSelectModel: modelSelection.onSelectModel,
    onSelectVariant: modelSelection.onSelectVariant,
    activeSessionAgentColors: modelSelection.activeSessionAgentColors,
    composerFormRef,
    composerEditorRef,
    resizeComposerEditor,
    scrollToBottomOnSendRef,
    syncBottomAfterComposerLayoutRef,
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
