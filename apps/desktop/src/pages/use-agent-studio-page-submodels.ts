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
  threadSession: AgentSessionState | null;
  taskId: string;
  agentStudioReady: boolean;
  agentStudioBlockedReason: string;
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
  canKickoffNewSession: boolean;
  selectedRoleAvailable: boolean;
  kickoffLabel: string;
  startScenarioKickoff: () => Promise<void>;
  isStarting: boolean;
  isSending: boolean;
  activeSessionAgentColors: Record<string, string>;
  isSubmittingQuestionByRequestId: Record<string, boolean>;
  onSubmitQuestionAnswers: (requestId: string, answers: string[][]) => Promise<void>;
  isSubmittingPermissionByRequestId: Record<string, boolean>;
  permissionReplyErrorByRequestId: Record<string, string>;
  onReplyPermission: (requestId: string, reply: "once" | "always" | "reject") => Promise<void>;
  todoPanelCollapsed: boolean;
  onToggleTodoPanel: () => void;
  todoPanelBottomOffset: number;
  isPinnedToBottom: boolean;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  onMessagesScroll: (event: UIEvent<HTMLDivElement>) => void;
};

export const useAgentStudioThreadModel = ({
  threadSession,
  taskId,
  agentStudioReady,
  agentStudioBlockedReason,
  isLoadingChecks,
  refreshChecks,
  canKickoffNewSession,
  selectedRoleAvailable,
  kickoffLabel,
  startScenarioKickoff,
  isStarting,
  isSending,
  activeSessionAgentColors,
  isSubmittingQuestionByRequestId,
  onSubmitQuestionAnswers,
  isSubmittingPermissionByRequestId,
  permissionReplyErrorByRequestId,
  onReplyPermission,
  todoPanelCollapsed,
  onToggleTodoPanel,
  todoPanelBottomOffset,
  isPinnedToBottom,
  messagesContainerRef,
  onMessagesScroll,
}: UseAgentStudioThreadModelArgs): ReturnType<typeof buildAgentChatThreadModel> => {
  const handleRefreshChecks = useCallback((): void => {
    void refreshChecks();
  }, [refreshChecks]);

  const handleKickoff = useCallback((): void => {
    void startScenarioKickoff();
  }, [startScenarioKickoff]);

  const handlePermissionReply = useCallback(
    (requestId: string, reply: "once" | "always" | "reject"): Promise<void> => {
      return onReplyPermission(requestId, reply);
    },
    [onReplyPermission],
  );

  return useMemo(
    () =>
      buildAgentChatThreadModel({
        activeSession: threadSession,
        roleOptions: ROLE_OPTIONS,
        agentStudioReady,
        agentStudioBlockedReason,
        isLoadingChecks,
        onRefreshChecks: handleRefreshChecks,
        taskId,
        canKickoffNewSession: canKickoffNewSession && selectedRoleAvailable,
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
        todoPanelCollapsed,
        onToggleTodoPanel,
        todoPanelBottomOffset,
        isPinnedToBottom,
        messagesContainerRef,
        onMessagesScroll,
      }),
    [
      activeSessionAgentColors,
      agentStudioBlockedReason,
      agentStudioReady,
      canKickoffNewSession,
      handleKickoff,
      handlePermissionReply,
      handleRefreshChecks,
      isLoadingChecks,
      isPinnedToBottom,
      isSending,
      isStarting,
      isSubmittingPermissionByRequestId,
      isSubmittingQuestionByRequestId,
      kickoffLabel,
      messagesContainerRef,
      onMessagesScroll,
      onSubmitQuestionAnswers,
      permissionReplyErrorByRequestId,
      selectedRoleAvailable,
      taskId,
      threadSession,
      todoPanelBottomOffset,
      todoPanelCollapsed,
      onToggleTodoPanel,
    ],
  );
};

export type UseAgentStudioComposerModelArgs = {
  taskId: string;
  activeSession: AgentSessionState | null;
  agentStudioReady: boolean;
  workflow: WorkflowComposerContext;
  input: string;
  setInput: (value: string) => void;
  onSend: () => Promise<void>;
  isSending: boolean;
  isStarting: boolean;
  isSessionWorking: boolean;
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
  chatContextUsage: AgentChatModel["composer"]["contextUsage"];
  canStopSession: boolean;
  stopAgentSession: (sessionId: string) => Promise<void>;
  composerFormRef: RefObject<HTMLFormElement | null>;
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>;
  resizeComposerTextarea: () => void;
};

export const useAgentStudioComposerModel = ({
  taskId,
  activeSession,
  agentStudioReady,
  workflow,
  input,
  setInput,
  onSend,
  isSending,
  isStarting,
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
  activeSessionAgentColors,
  chatContextUsage,
  canStopSession,
  stopAgentSession,
  composerFormRef,
  composerTextareaRef,
  resizeComposerTextarea,
}: UseAgentStudioComposerModelArgs): ReturnType<typeof buildAgentChatComposerModel> => {
  const isModelSelectionPending = Boolean(
    activeSession?.isLoadingModelCatalog && !activeSession?.selectedModel,
  );

  const handleSend = useCallback((): void => {
    void onSend();
  }, [onSend]);

  const handleStopSession = useCallback((): void => {
    if (!activeSession) {
      return;
    }
    void stopAgentSession(activeSession.sessionId);
  }, [activeSession, stopAgentSession]);

  return useMemo(
    () =>
      buildAgentChatComposerModel({
        taskId,
        agentStudioReady,
        isReadOnly: !workflow.selectedRoleAvailable,
        readOnlyReason: workflow.selectedRoleReadOnlyReason,
        input,
        onInputChange: setInput,
        onSend: handleSend,
        isSending,
        isStarting,
        isSessionWorking,
        isModelSelectionPending,
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
        contextUsage: chatContextUsage,
        canStopSession,
        onStopSession: handleStopSession,
        composerFormRef,
        composerTextareaRef,
        onComposerTextareaInput: resizeComposerTextarea,
      }),
    [
      activeSessionAgentColors,
      agentOptions,
      agentStudioReady,
      canStopSession,
      chatContextUsage,
      composerFormRef,
      composerTextareaRef,
      handleSend,
      handleStopSession,
      input,
      isModelSelectionPending,
      isSelectionCatalogLoading,
      isSending,
      isSessionWorking,
      isStarting,
      modelGroups,
      modelOptions,
      onSelectAgent,
      onSelectModel,
      onSelectVariant,
      resizeComposerTextarea,
      selectedModelSelection,
      setInput,
      taskId,
      variantOptions,
      workflow.selectedRoleAvailable,
      workflow.selectedRoleReadOnlyReason,
    ],
  );
};
