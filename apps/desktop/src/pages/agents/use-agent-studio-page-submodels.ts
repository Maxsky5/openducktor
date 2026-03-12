import type { TaskCard } from "@openducktor/contracts";
import { useCallback, useMemo } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { ROLE_OPTIONS } from "./agents-page-constants";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import {
  buildAgentChatComposerModel,
  buildAgentChatThreadModel,
  buildAgentStudioHeaderModel,
} from "./agents-page-view-model";
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
  AgentStudioWorkflowStepSelect,
  WorkflowHeaderContext,
} from "./use-agent-studio-page-submodel-contracts";

export type UseAgentStudioHeaderModelArgs = {
  selectedTask: TaskCard | null;
  onOpenTaskDetails: (() => void) | null;
  activeSession: AgentSessionState | null;
  sessionsForTaskLength: number;
  contextSessionsLength: number;
  agentStudioReady: boolean;
  isStarting: boolean;
  onWorkflowStepSelect: AgentStudioWorkflowStepSelect;
  onSessionSelectionChange: (nextValue: string) => void;
  onCreateSession: (option: SessionCreateOption) => void;
  workflow: WorkflowHeaderContext;
};

export const useAgentStudioHeaderModel = ({
  selectedTask,
  onOpenTaskDetails,
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
        onOpenTaskDetails,
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
      onOpenTaskDetails,
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
  session: AgentStudioThreadSessionContext;
  readiness: AgentStudioThreadReadinessContext;
  kickoff: AgentStudioThreadKickoffContext;
  questions: AgentStudioThreadQuestionsContext;
  permissions: AgentStudioThreadPermissionsContext;
  todoPanel: AgentStudioThreadTodoPanelContext;
  scroll: AgentStudioThreadScrollContext;
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
        isSessionViewLoading: session.isContextSwitching,
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
      kickoff.canKickoffNewSession,
      kickoff.isSending,
      kickoff.isStarting,
      kickoff.kickoffLabel,
      kickoff.selectedRoleAvailable,
      permissions.isSubmittingPermissionByRequestId,
      permissions.permissionReplyErrorByRequestId,
      questions.isSubmittingQuestionByRequestId,
      questions.onSubmitQuestionAnswers,
      readiness.agentStudioBlockedReason,
      readiness.agentStudioReady,
      readiness.isLoadingChecks,
      scroll.isPinnedToBottom,
      scroll.messagesContainerRef,
      scroll.onMessagesScroll,
      session.activeSessionAgentColors,
      session.isContextSwitching,
      session.taskId,
      session.threadSession,
      todoPanel.onToggleTodoPanel,
      todoPanel.todoPanelBottomOffset,
      todoPanel.todoPanelCollapsed,
    ],
  );
};

export type UseAgentStudioComposerModelArgs = {
  session: AgentStudioComposerSessionContext;
  readiness: AgentStudioComposerReadinessContext;
  interaction: AgentStudioComposerInteractionContext;
  selection: AgentStudioComposerSelectionContext;
  layout: AgentStudioComposerLayoutContext;
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
  const activeSessionId = session.activeSession?.sessionId;

  const handleSend = useCallback((): void => {
    void interaction.onSend();
  }, [interaction.onSend]);

  const handleStopSession = useCallback((): void => {
    if (!activeSessionId) {
      return;
    }
    void session.stopAgentSession(activeSessionId);
  }, [activeSessionId, session.stopAgentSession]);

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
      interaction.chatContextUsage,
      interaction.input,
      interaction.isSending,
      interaction.isStarting,
      interaction.setInput,
      layout.composerFormRef,
      layout.composerTextareaRef,
      layout.resizeComposerTextarea,
      readiness.agentStudioReady,
      readiness.workflow.selectedRoleAvailable,
      readiness.workflow.selectedRoleReadOnlyReason,
      selection.activeSessionAgentColors,
      selection.agentOptions,
      selection.isSelectionCatalogLoading,
      selection.modelGroups,
      selection.modelOptions,
      selection.onSelectAgent,
      selection.onSelectModel,
      selection.onSelectVariant,
      selection.selectedModelSelection,
      selection.variantOptions,
      session.canStopSession,
      session.isSessionWorking,
      session.taskId,
    ],
  );
};
