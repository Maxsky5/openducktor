import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { type RefObject, type UIEvent, useCallback, useMemo } from "react";
import type { AgentChatModel } from "@/components/features/agents";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { ROLE_OPTIONS } from "./agents-page-constants";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import {
  buildAgentChatComposerModel,
  buildAgentChatThreadModel,
  buildAgentStudioHeaderModel,
} from "./agents-page-view-model";
import type { WorkflowModelContext } from "./use-agent-studio-page-model-builders";

type WorkflowHeaderContext = Pick<
  WorkflowModelContext,
  | "workflowStateByRole"
  | "selectedInteractionRole"
  | "latestSessionByRole"
  | "sessionSelectorValue"
  | "sessionSelectorGroups"
  | "sessionCreateOptions"
  | "createSessionDisabled"
>;

type WorkflowComposerContext = Pick<
  WorkflowModelContext,
  "selectedRoleAvailable" | "selectedRoleReadOnlyReason"
>;

export type UseAgentStudioHeaderModelArgs = {
  selectedTask: TaskCard | null;
  activeSession: AgentSessionState | null;
  sessionsForTaskLength: number;
  contextSessionsLength: number;
  agentStudioReady: boolean;
  isStarting: boolean;
  onWorkflowStepSelect: (role: AgentRole, sessionId: string | null) => void;
  onSessionSelectionChange: (nextValue: string) => void;
  onCreateSession: (option: SessionCreateOption) => void;
  workflow: WorkflowHeaderContext;
};

export const useAgentStudioHeaderModel = ({
  selectedTask,
  activeSession,
  sessionsForTaskLength,
  contextSessionsLength,
  agentStudioReady,
  isStarting,
  onWorkflowStepSelect,
  onSessionSelectionChange,
  onCreateSession,
  workflow,
}: UseAgentStudioHeaderModelArgs): ReturnType<typeof buildAgentStudioHeaderModel> => {
  return useMemo(
    () =>
      buildAgentStudioHeaderModel({
        selectedTask,
        activeSession,
        roleOptions: ROLE_OPTIONS,
        workflowStateByRole: workflow.workflowStateByRole,
        selectedRole: workflow.selectedInteractionRole,
        latestSessionByRole: workflow.latestSessionByRole,
        onWorkflowStepSelect,
        onSessionSelectionChange,
        sessionSelectorValue: workflow.sessionSelectorValue,
        sessionSelectorGroups: workflow.sessionSelectorGroups,
        agentStudioReady,
        sessionsForTaskLength,
        sessionCreateOptions: workflow.sessionCreateOptions,
        onCreateSession,
        createSessionDisabled: workflow.createSessionDisabled,
        isStarting,
        contextSessionsLength,
      }),
    [
      activeSession,
      agentStudioReady,
      contextSessionsLength,
      isStarting,
      onCreateSession,
      onSessionSelectionChange,
      onWorkflowStepSelect,
      selectedTask,
      sessionsForTaskLength,
      workflow.createSessionDisabled,
      workflow.latestSessionByRole,
      workflow.selectedInteractionRole,
      workflow.sessionCreateOptions,
      workflow.sessionSelectorGroups,
      workflow.sessionSelectorValue,
      workflow.workflowStateByRole,
    ],
  );
};

export type UseAgentStudioThreadModelArgs = {
  session: {
    threadSession: AgentSessionState | null;
    taskId: string;
    activeSessionAgentColors: Record<string, string>;
  };
  readiness: {
    agentStudioReady: boolean;
    agentStudioBlockedReason: string;
    isLoadingChecks: boolean;
    refreshChecks: () => Promise<void>;
  };
  kickoff: {
    canKickoffNewSession: boolean;
    selectedRoleAvailable: boolean;
    kickoffLabel: string;
    startScenarioKickoff: () => Promise<void>;
    isStarting: boolean;
    isSending: boolean;
  };
  questions: {
    isSubmittingQuestionByRequestId: Record<string, boolean>;
    onSubmitQuestionAnswers: (requestId: string, answers: string[][]) => Promise<void>;
  };
  permissions: {
    isSubmittingPermissionByRequestId: Record<string, boolean>;
    permissionReplyErrorByRequestId: Record<string, string>;
    onReplyPermission: (requestId: string, reply: "once" | "always" | "reject") => Promise<void>;
  };
  todoPanel: {
    todoPanelCollapsed: boolean;
    onToggleTodoPanel: () => void;
    todoPanelBottomOffset: number;
  };
  scroll: {
    isPinnedToBottom: boolean;
    messagesContainerRef: RefObject<HTMLDivElement | null>;
    onMessagesScroll: (event: UIEvent<HTMLDivElement>) => void;
  };
};

export const useAgentStudioThreadModel = ({
  session,
  readiness,
  kickoff,
  questions,
  permissions,
  todoPanel,
  scroll,
}: UseAgentStudioThreadModelArgs): ReturnType<typeof buildAgentChatThreadModel> => {
  const handleRefreshChecks = useCallback((): void => {
    void readiness.refreshChecks();
  }, [readiness.refreshChecks]);

  const handleKickoff = useCallback((): void => {
    void kickoff.startScenarioKickoff();
  }, [kickoff.startScenarioKickoff]);

  const handlePermissionReply = useCallback(
    (requestId: string, reply: "once" | "always" | "reject"): Promise<void> => {
      return permissions.onReplyPermission(requestId, reply);
    },
    [permissions.onReplyPermission],
  );

  return useMemo(
    () =>
      buildAgentChatThreadModel({
        activeSession: session.threadSession,
        roleOptions: ROLE_OPTIONS,
        agentStudioReady: readiness.agentStudioReady,
        agentStudioBlockedReason: readiness.agentStudioBlockedReason,
        isLoadingChecks: readiness.isLoadingChecks,
        onRefreshChecks: handleRefreshChecks,
        taskId: session.taskId,
        canKickoffNewSession: kickoff.canKickoffNewSession && kickoff.selectedRoleAvailable,
        kickoffLabel: kickoff.kickoffLabel,
        onKickoff: handleKickoff,
        isStarting: kickoff.isStarting,
        isSending: kickoff.isSending,
        activeSessionAgentColors: session.activeSessionAgentColors,
        isSubmittingQuestionByRequestId: questions.isSubmittingQuestionByRequestId,
        onSubmitQuestionAnswers: questions.onSubmitQuestionAnswers,
        isSubmittingPermissionByRequestId: permissions.isSubmittingPermissionByRequestId,
        permissionReplyErrorByRequestId: permissions.permissionReplyErrorByRequestId,
        onReplyPermission: handlePermissionReply,
        todoPanelCollapsed: todoPanel.todoPanelCollapsed,
        onToggleTodoPanel: todoPanel.onToggleTodoPanel,
        todoPanelBottomOffset: todoPanel.todoPanelBottomOffset,
        isPinnedToBottom: scroll.isPinnedToBottom,
        messagesContainerRef: scroll.messagesContainerRef,
        onMessagesScroll: scroll.onMessagesScroll,
      }),
    [
      handleKickoff,
      handlePermissionReply,
      handleRefreshChecks,
      kickoff,
      permissions,
      questions,
      readiness,
      scroll,
      session,
      todoPanel,
    ],
  );
};

export type UseAgentStudioComposerModelArgs = {
  session: {
    taskId: string;
    activeSession: AgentSessionState | null;
    isSessionWorking: boolean;
    canStopSession: boolean;
    stopAgentSession: (sessionId: string) => Promise<void>;
  };
  readiness: {
    agentStudioReady: boolean;
    workflow: WorkflowComposerContext;
  };
  interaction: {
    input: string;
    setInput: (value: string) => void;
    onSend: () => Promise<void>;
    isSending: boolean;
    isStarting: boolean;
    chatContextUsage: AgentChatModel["composer"]["contextUsage"];
  };
  selection: {
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
  };
  layout: {
    composerFormRef: RefObject<HTMLFormElement | null>;
    composerTextareaRef: RefObject<HTMLTextAreaElement | null>;
    resizeComposerTextarea: () => void;
  };
};

export const useAgentStudioComposerModel = ({
  session,
  readiness,
  interaction,
  selection,
  layout,
}: UseAgentStudioComposerModelArgs): ReturnType<typeof buildAgentChatComposerModel> => {
  const isModelSelectionPending = Boolean(
    session.activeSession?.isLoadingModelCatalog && !session.activeSession?.selectedModel,
  );

  const handleSend = useCallback((): void => {
    void interaction.onSend();
  }, [interaction.onSend]);

  const handleStopSession = useCallback((): void => {
    if (!session.activeSession) {
      return;
    }
    void session.stopAgentSession(session.activeSession.sessionId);
  }, [session.activeSession, session.stopAgentSession]);

  return useMemo(
    () =>
      buildAgentChatComposerModel({
        taskId: session.taskId,
        agentStudioReady: readiness.agentStudioReady,
        isReadOnly: !readiness.workflow.selectedRoleAvailable,
        readOnlyReason: readiness.workflow.selectedRoleReadOnlyReason,
        input: interaction.input,
        onInputChange: interaction.setInput,
        onSend: handleSend,
        isSending: interaction.isSending,
        isStarting: interaction.isStarting,
        isSessionWorking: session.isSessionWorking,
        isModelSelectionPending,
        selectedModelSelection: selection.selectedModelSelection,
        isSelectionCatalogLoading: selection.isSelectionCatalogLoading,
        agentOptions: selection.agentOptions,
        modelOptions: selection.modelOptions,
        modelGroups: selection.modelGroups,
        variantOptions: selection.variantOptions,
        onSelectAgent: selection.onSelectAgent,
        onSelectModel: selection.onSelectModel,
        onSelectVariant: selection.onSelectVariant,
        activeSessionAgentColors: selection.activeSessionAgentColors,
        contextUsage: interaction.chatContextUsage,
        canStopSession: session.canStopSession,
        onStopSession: handleStopSession,
        composerFormRef: layout.composerFormRef,
        composerTextareaRef: layout.composerTextareaRef,
        onComposerTextareaInput: layout.resizeComposerTextarea,
      }),
    [
      handleSend,
      handleStopSession,
      isModelSelectionPending,
      interaction,
      layout,
      readiness,
      selection,
      session,
    ],
  );
};
