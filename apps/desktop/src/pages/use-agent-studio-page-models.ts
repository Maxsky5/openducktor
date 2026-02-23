import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { type UIEvent, useCallback, useMemo, useState } from "react";
import {
  type AgentStudioTaskTabsModel,
  isNearBottom,
  useAgentChatLayout,
} from "@/components/features/agents";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { ROLE_OPTIONS, SCENARIO_LABELS } from "./agents-page-constants";
import {
  buildLatestSessionByRoleMap,
  buildRoleEnabledMapForTask,
  buildSessionCreateOptions,
  buildSessionSelectorGroups,
  buildWorkflowStateByRole,
  type SessionCreateOption,
} from "./agents-page-session-tabs";
import {
  buildAgentChatModel,
  buildAgentStudioHeaderModel,
  buildAgentStudioTaskTabsModel,
  buildAgentStudioWorkspaceSidebarModel,
  buildRoleLabelByRole,
} from "./agents-page-view-model";

type UseAgentStudioPageModelsArgs = {
  taskId: string;
  role: AgentRole;
  selectedTask: TaskCard | null;
  sessionsForTask: AgentSessionState[];
  contextSessionsLength: number;
  activeSession: AgentSessionState | null;
  taskTabs: AgentStudioTaskTabsModel["tabs"];
  availableTabTasks: TaskCard[];
  isLoadingTasks: boolean;
  onCreateTab: (taskId: string) => void;
  onCloseTab: (taskId: string) => void;
  handleWorkflowStepSelect: (role: AgentRole, sessionId: string | null) => void;
  handleSessionSelectionChange: (nextValue: string) => void;
  handleCreateSession: (option: SessionCreateOption) => void;
  specDoc: TaskDocumentState;
  planDoc: TaskDocumentState;
  qaDoc: TaskDocumentState;
  agentStudioReady: boolean;
  agentStudioBlockedReason: string;
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
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
  activeSessionContextUsage: {
    totalTokens: number;
    contextWindow: number;
    outputLimit?: number;
  } | null;
  isSubmittingPermissionByRequestId: Record<string, boolean>;
  permissionReplyErrorByRequestId: Record<string, string>;
  onReplyPermission: (requestId: string, reply: "once" | "always" | "reject") => Promise<void>;
  input: string;
  setInput: (value: string) => void;
  stopAgentSession: (sessionId: string) => Promise<void>;
};

export function useAgentStudioPageModels({
  taskId,
  role,
  selectedTask,
  sessionsForTask,
  contextSessionsLength,
  activeSession,
  taskTabs,
  availableTabTasks,
  isLoadingTasks,
  onCreateTab,
  onCloseTab,
  handleWorkflowStepSelect,
  handleSessionSelectionChange,
  handleCreateSession,
  specDoc,
  planDoc,
  qaDoc,
  agentStudioReady,
  agentStudioBlockedReason,
  isLoadingChecks,
  refreshChecks,
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
  selectedModelSelection,
  isSelectionCatalogLoading,
  agentOptions,
  modelOptions,
  modelGroups,
  variantOptions,
  onSelectAgent,
  onSelectModel,
  onSelectVariant,
  activeSessionAgentColors,
  activeSessionContextUsage,
  isSubmittingPermissionByRequestId,
  permissionReplyErrorByRequestId,
  onReplyPermission,
  input,
  setInput,
  stopAgentSession,
}: UseAgentStudioPageModelsArgs): {
  activeTabValue: string;
  agentStudioTaskTabsModel: AgentStudioTaskTabsModel;
  agentStudioHeaderModel: ReturnType<typeof buildAgentStudioHeaderModel>;
  agentStudioWorkspaceSidebarModel: ReturnType<typeof buildAgentStudioWorkspaceSidebarModel>;
  agentChatModel: ReturnType<typeof buildAgentChatModel>;
} {
  const [todoPanelCollapsedBySession, setTodoPanelCollapsedBySession] = useState<
    Record<string, boolean>
  >({});

  const activeMessageCount = activeSession?.messages.length ?? 0;
  const activeDraftText = activeSession?.draftAssistantText ?? "";
  const activeSessionStatus = activeSession?.status ?? "stopped";
  const scrollTrigger = `${activeSessionStatus}:${activeMessageCount}:${activeDraftText.length}:${
    activeSession?.pendingQuestions.length ?? 0
  }:${activeSession?.pendingPermissions.length ?? 0}`;

  const {
    messagesContainerRef,
    composerFormRef,
    composerTextareaRef,
    setIsPinnedToBottom,
    todoPanelBottomOffset,
    resizeComposerTextarea,
  } = useAgentChatLayout({
    input,
    scrollTrigger,
    activeSessionId: activeSession?.sessionId ?? null,
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
        taskTabs,
        availableTabTasks,
        isLoadingTasks,
        onCreateTab,
        onCloseTab,
        agentStudioReady,
      }),
    [agentStudioReady, availableTabTasks, isLoadingTasks, onCloseTab, onCreateTab, taskTabs],
  );

  const activeTabValue = taskId || "__agent_studio_empty__";

  const roleEnabledByTask = useMemo(() => buildRoleEnabledMapForTask(selectedTask), [selectedTask]);
  const latestSessionByRole = useMemo(
    () => buildLatestSessionByRoleMap(sessionsForTask),
    [sessionsForTask],
  );
  const workflowStateByRole = useMemo(
    () =>
      buildWorkflowStateByRole({
        roleEnabledByTask,
        sessionsForTask,
        activeSessionRole: activeSession?.role ?? null,
        activeSessionStatus: activeSession?.status ?? null,
      }),
    [activeSession?.role, activeSession?.status, roleEnabledByTask, sessionsForTask],
  );
  const roleLabelByRole = useMemo(() => buildRoleLabelByRole(ROLE_OPTIONS), []);
  const sessionSelectorGroups = useMemo(
    () =>
      buildSessionSelectorGroups({
        sessionsForTask,
        scenarioLabels: SCENARIO_LABELS,
        roleLabelByRole,
      }),
    [roleLabelByRole, sessionsForTask],
  );
  const sessionSelectorValue = activeSession?.sessionId ?? sessionsForTask[0]?.sessionId ?? "";
  const createSessionDisabled = Boolean(activeSession && isSessionWorking);
  const hasQaFeedback = qaDoc.markdown.trim().length > 0;
  const hasHumanFeedback = Boolean(
    selectedTask &&
      (selectedTask.status === "human_review" ||
        selectedTask.availableActions.includes("human_request_changes") ||
        selectedTask.availableActions.includes("human_approve")),
  );
  const activeDocumentRole = activeSession?.role ?? role;

  const activeDocument = useMemo(() => {
    if (activeDocumentRole === "spec") {
      return {
        title: "Specification",
        description: "Current spec document for this task.",
        emptyState: "No spec document yet.",
        document: specDoc,
      };
    }

    if (activeDocumentRole === "planner") {
      return {
        title: "Implementation Plan",
        description: "Current implementation plan for this task.",
        emptyState: "No implementation plan yet.",
        document: planDoc,
      };
    }

    if (activeDocumentRole === "qa") {
      return {
        title: "QA Report",
        description: "Latest QA report for this task.",
        emptyState: "No QA report yet.",
        document: qaDoc,
      };
    }

    return null;
  }, [activeDocumentRole, qaDoc, planDoc, specDoc]);

  const sessionCreateOptions = useMemo(
    () =>
      buildSessionCreateOptions({
        roleEnabledByTask,
        latestSessionByRole,
        hasQaFeedback,
        hasHumanFeedback,
        createSessionDisabled,
        roleLabelByRole,
        scenarioLabels: SCENARIO_LABELS,
      }),
    [
      createSessionDisabled,
      hasHumanFeedback,
      hasQaFeedback,
      latestSessionByRole,
      roleEnabledByTask,
      roleLabelByRole,
    ],
  );

  const agentStudioHeaderModel = useMemo(
    () =>
      buildAgentStudioHeaderModel({
        selectedTask,
        activeSession,
        roleOptions: ROLE_OPTIONS,
        workflowStateByRole,
        selectedRole: activeSession?.role ?? role,
        latestSessionByRole,
        onWorkflowStepSelect: handleWorkflowStepSelect,
        onSessionSelectionChange: handleSessionSelectionChange,
        sessionSelectorValue,
        sessionSelectorGroups,
        agentStudioReady,
        sessionsForTaskLength: sessionsForTask.length,
        sessionCreateOptions,
        onCreateSession: handleCreateSession,
        createSessionDisabled,
        isStarting,
        contextSessionsLength,
      }),
    [
      activeSession,
      agentStudioReady,
      contextSessionsLength,
      createSessionDisabled,
      handleCreateSession,
      handleSessionSelectionChange,
      handleWorkflowStepSelect,
      isStarting,
      latestSessionByRole,
      role,
      selectedTask,
      sessionCreateOptions,
      sessionSelectorGroups,
      sessionSelectorValue,
      sessionsForTask.length,
      workflowStateByRole,
    ],
  );

  const handlePermissionReply = useCallback(
    async (requestId: string, reply: "once" | "always" | "reject"): Promise<void> => {
      void onReplyPermission(requestId, reply);
    },
    [onReplyPermission],
  );

  const agentStudioWorkspaceSidebarModel = useMemo(
    () =>
      buildAgentStudioWorkspaceSidebarModel({
        activeDocument,
      }),
    [activeDocument],
  );

  const chatContextUsage = useMemo(
    () =>
      activeSessionContextUsage === null
        ? null
        : {
            totalTokens: activeSessionContextUsage.totalTokens,
            contextWindow: activeSessionContextUsage.contextWindow,
            ...(typeof activeSessionContextUsage.outputLimit === "number"
              ? { outputLimit: activeSessionContextUsage.outputLimit }
              : {}),
          },
    [activeSessionContextUsage],
  );

  const handleRefreshChecks = useCallback((): void => {
    void refreshChecks();
  }, [refreshChecks]);

  const handleKickoff = useCallback((): void => {
    void startScenarioKickoff();
  }, [startScenarioKickoff]);

  const activeSessionId = activeSession?.sessionId ?? null;
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
    void onSend();
  }, [onSend]);

  const handleStopSession = useCallback((): void => {
    if (!activeSession) {
      return;
    }
    void stopAgentSession(activeSession.sessionId);
  }, [activeSession, stopAgentSession]);

  const agentChatModel = useMemo(
    () =>
      buildAgentChatModel({
        activeSession,
        roleOptions: ROLE_OPTIONS,
        agentStudioReady,
        agentStudioBlockedReason,
        isLoadingChecks,
        onRefreshChecks: handleRefreshChecks,
        taskId,
        canKickoffNewSession,
        kickoffLabel,
        onKickoff: handleKickoff,
        isStarting,
        isSending,
        activeSessionAgentColors,
        isSubmittingQuestionByRequestId,
        onSubmitQuestionAnswers,
        isSubmittingPermissionByRequestId,
        permissionReplyErrorByRequestId,
        onReplyPermission: handlePermissionReply,
        todoPanelCollapsed: activeTodoPanelCollapsed,
        onToggleTodoPanel: handleToggleTodoPanel,
        todoPanelBottomOffset,
        messagesContainerRef,
        onMessagesScroll: handleMessagesScroll,
        input,
        onInputChange: setInput,
        onSend: handleSend,
        isSessionWorking,
        selectedModelSelection,
        isSelectionCatalogLoading,
        agentOptions,
        modelOptions,
        modelGroups,
        variantOptions,
        onSelectAgent,
        onSelectModel,
        onSelectVariant,
        contextUsage: chatContextUsage,
        canStopSession,
        onStopSession: handleStopSession,
        composerFormRef,
        composerTextareaRef,
        onComposerTextareaInput: resizeComposerTextarea,
      }),
    [
      activeSession,
      activeSessionAgentColors,
      activeTodoPanelCollapsed,
      agentOptions,
      agentStudioBlockedReason,
      agentStudioReady,
      canKickoffNewSession,
      canStopSession,
      chatContextUsage,
      composerFormRef,
      composerTextareaRef,
      handleKickoff,
      handleMessagesScroll,
      handleRefreshChecks,
      onSelectAgent,
      onSelectModel,
      onSelectVariant,
      handleSend,
      handleStopSession,
      handleToggleTodoPanel,
      input,
      isLoadingChecks,
      isSelectionCatalogLoading,
      isSending,
      isSessionWorking,
      isStarting,
      isSubmittingQuestionByRequestId,
      isSubmittingPermissionByRequestId,
      handlePermissionReply,
      kickoffLabel,
      permissionReplyErrorByRequestId,
      messagesContainerRef,
      modelGroups,
      modelOptions,
      onSubmitQuestionAnswers,
      resizeComposerTextarea,
      selectedModelSelection,
      setInput,
      taskId,
      todoPanelBottomOffset,
      variantOptions,
    ],
  );

  return {
    activeTabValue,
    agentStudioTaskTabsModel,
    agentStudioHeaderModel,
    agentStudioWorkspaceSidebarModel,
    agentChatModel,
  };
}
