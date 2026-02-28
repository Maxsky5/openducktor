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
  buildAgentChatComposerModel,
  buildAgentChatThreadModel,
  buildAgentStudioHeaderModel,
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
  agentStudioHeaderModel: ReturnType<typeof buildAgentStudioHeaderModel>;
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

  const agentStudioHeaderModel = useMemo(
    () =>
      buildAgentStudioHeaderModel({
        selectedTask: core.selectedTask,
        activeSession: core.activeSession,
        roleOptions: ROLE_OPTIONS,
        workflowStateByRole: workflowModelContext.workflowStateByRole,
        selectedRole: workflowModelContext.selectedInteractionRole,
        latestSessionByRole: workflowModelContext.latestSessionByRole,
        onWorkflowStepSelect: sessionActions.handleWorkflowStepSelect,
        onSessionSelectionChange: sessionActions.handleSessionSelectionChange,
        sessionSelectorValue: workflowModelContext.sessionSelectorValue,
        sessionSelectorGroups: workflowModelContext.sessionSelectorGroups,
        agentStudioReady: readiness.agentStudioReady,
        sessionsForTaskLength: core.sessionsForTask.length,
        sessionCreateOptions: workflowModelContext.sessionCreateOptions,
        onCreateSession: sessionActions.handleCreateSession,
        createSessionDisabled: workflowModelContext.createSessionDisabled,
        isStarting: sessionActions.isStarting,
        contextSessionsLength: core.contextSessionsLength,
      }),
    [
      core.activeSession,
      core.contextSessionsLength,
      core.selectedTask,
      core.sessionsForTask.length,
      readiness.agentStudioReady,
      sessionActions.handleCreateSession,
      sessionActions.handleSessionSelectionChange,
      sessionActions.handleWorkflowStepSelect,
      sessionActions.isStarting,
      workflowModelContext,
    ],
  );

  const handlePermissionReply = useCallback(
    (requestId: string, reply: "once" | "always" | "reject"): Promise<void> => {
      return permissions.onReplyPermission(requestId, reply);
    },
    [permissions.onReplyPermission],
  );

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

  const handleRefreshChecks = useCallback((): void => {
    void readiness.refreshChecks();
  }, [readiness.refreshChecks]);

  const handleKickoff = useCallback((): void => {
    void sessionActions.startScenarioKickoff();
  }, [sessionActions.startScenarioKickoff]);

  const isModelSelectionPending = Boolean(
    core.activeSession?.isLoadingModelCatalog && !core.activeSession?.selectedModel,
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

  const handleSend = useCallback((): void => {
    void sessionActions.onSend();
  }, [sessionActions.onSend]);

  const handleStopSession = useCallback((): void => {
    if (!core.activeSession) {
      return;
    }
    void sessionActions.stopAgentSession(core.activeSession.sessionId);
  }, [core.activeSession, sessionActions.stopAgentSession]);

  const agentChatThreadModel = useMemo(
    () =>
      buildAgentChatThreadModel({
        activeSession: threadSession,
        roleOptions: ROLE_OPTIONS,
        agentStudioReady: readiness.agentStudioReady,
        agentStudioBlockedReason: readiness.agentStudioBlockedReason,
        isLoadingChecks: readiness.isLoadingChecks,
        onRefreshChecks: handleRefreshChecks,
        taskId: core.taskId,
        canKickoffNewSession:
          sessionActions.canKickoffNewSession && workflowModelContext.selectedRoleAvailable,
        kickoffLabel: sessionActions.kickoffLabel,
        onKickoff: handleKickoff,
        isStarting: sessionActions.isStarting,
        isSending: sessionActions.isSending,
        activeSessionAgentColors: modelSelection.activeSessionAgentColors,
        isSubmittingQuestionByRequestId: sessionActions.isSubmittingQuestionByRequestId,
        onSubmitQuestionAnswers: sessionActions.onSubmitQuestionAnswers,
        isSubmittingPermissionByRequestId: permissions.isSubmittingPermissionByRequestId,
        permissionReplyErrorByRequestId: permissions.permissionReplyErrorByRequestId,
        onReplyPermission: handlePermissionReply,
        todoPanelCollapsed: activeTodoPanelCollapsed,
        onToggleTodoPanel: handleToggleTodoPanel,
        todoPanelBottomOffset,
        isPinnedToBottom,
        messagesContainerRef,
        onMessagesScroll: handleMessagesScroll,
      }),
    [
      activeTodoPanelCollapsed,
      core.taskId,
      handleKickoff,
      handleMessagesScroll,
      handlePermissionReply,
      handleRefreshChecks,
      handleToggleTodoPanel,
      isPinnedToBottom,
      messagesContainerRef,
      modelSelection.activeSessionAgentColors,
      permissions.isSubmittingPermissionByRequestId,
      permissions.permissionReplyErrorByRequestId,
      readiness.agentStudioBlockedReason,
      readiness.agentStudioReady,
      readiness.isLoadingChecks,
      sessionActions.canKickoffNewSession,
      sessionActions.isSending,
      sessionActions.isStarting,
      sessionActions.isSubmittingQuestionByRequestId,
      sessionActions.kickoffLabel,
      sessionActions.onSubmitQuestionAnswers,
      threadSession,
      todoPanelBottomOffset,
      workflowModelContext.selectedRoleAvailable,
    ],
  );

  const agentChatComposerModel = useMemo(
    () =>
      buildAgentChatComposerModel({
        taskId: core.taskId,
        agentStudioReady: readiness.agentStudioReady,
        isReadOnly: !workflowModelContext.selectedRoleAvailable,
        readOnlyReason: workflowModelContext.selectedRoleReadOnlyReason,
        input: composer.input,
        onInputChange: composer.setInput,
        onSend: handleSend,
        isSending: sessionActions.isSending,
        isStarting: sessionActions.isStarting,
        isSessionWorking: sessionActions.isSessionWorking,
        isModelSelectionPending,
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
        contextUsage: chatContextUsage,
        canStopSession: sessionActions.canStopSession,
        onStopSession: handleStopSession,
        composerFormRef,
        composerTextareaRef,
        onComposerTextareaInput: resizeComposerTextarea,
      }),
    [
      chatContextUsage,
      composer.input,
      composer.setInput,
      composerFormRef,
      composerTextareaRef,
      core.taskId,
      handleSend,
      handleStopSession,
      isModelSelectionPending,
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
      readiness.agentStudioReady,
      resizeComposerTextarea,
      sessionActions.canStopSession,
      sessionActions.isSending,
      sessionActions.isSessionWorking,
      sessionActions.isStarting,
      workflowModelContext.selectedRoleAvailable,
      workflowModelContext.selectedRoleReadOnlyReason,
    ],
  );

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
