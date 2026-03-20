import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import type { RefObject } from "react";
import { useCallback, useMemo } from "react";
import type { AgentChatModel } from "@/components/features/agents/agent-chat/agent-chat.types";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import { getAgentSessionWaitingInputPlaceholder } from "@/lib/agent-session-waiting-input";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { ROLE_OPTIONS } from "./agents-page-constants";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import {
  buildAgentChatComposerModel,
  buildAgentChatThreadModel,
  buildAgentStudioHeaderModel,
} from "./agents-page-view-model";
import type {
  AgentStudioWorkflowStepSelect,
  WorkflowHeaderContext,
} from "./use-agent-studio-page-submodel-contracts";

type UseAgentStudioHeaderModelArgs = {
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
        workflowSessionByRole: workflow.workflowSessionByRole,
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
      workflow.selectedInteractionRole,
      workflow.sessionCreateOptions,
      workflow.sessionSelectorGroups,
      workflow.sessionSelectorValue,
      workflow.workflowSessionByRole,
      workflow.workflowStateByRole,
    ],
  );
};

type UseAgentStudioThreadModelArgs = {
  threadSession: AgentSessionState | null;
  showThinkingMessages: boolean;
  isContextSwitching: boolean;
  taskId: string;
  activeSessionAgentColors: Record<string, string>;
  agentStudioReady: boolean;
  agentStudioBlockedReason: string | null;
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
  canKickoffNewSession: boolean;
  selectedRoleAvailable: boolean;
  kickoffLabel: string;
  startScenarioKickoff: () => Promise<void>;
  isStarting: boolean;
  isSending: boolean;
  isSubmittingQuestionByRequestId: Record<string, boolean>;
  onSubmitQuestionAnswers: (requestId: string, answers: string[][]) => Promise<void>;
  isSubmittingPermissionByRequestId: Record<string, boolean>;
  permissionReplyErrorByRequestId: Record<string, string>;
  onReplyPermission: (requestId: string, reply: "once" | "always" | "reject") => Promise<void>;
  todoPanelCollapsed: boolean;
  onToggleTodoPanel: () => void;
  todoPanelBottomOffset: number;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
};

export const useAgentStudioThreadModel = ({
  threadSession,
  showThinkingMessages,
  isContextSwitching,
  taskId,
  activeSessionAgentColors,
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
  isSubmittingQuestionByRequestId,
  onSubmitQuestionAnswers,
  isSubmittingPermissionByRequestId,
  permissionReplyErrorByRequestId,
  onReplyPermission,
  todoPanelCollapsed,
  onToggleTodoPanel,
  todoPanelBottomOffset,
  messagesContainerRef,
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
        showThinkingMessages,
        isSessionViewLoading: isContextSwitching,
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
        messagesContainerRef,
      }),
    [
      activeSessionAgentColors,
      agentStudioBlockedReason,
      agentStudioReady,
      canKickoffNewSession,
      handleKickoff,
      handlePermissionReply,
      handleRefreshChecks,
      isContextSwitching,
      isLoadingChecks,
      isSending,
      isStarting,
      isSubmittingPermissionByRequestId,
      isSubmittingQuestionByRequestId,
      kickoffLabel,
      messagesContainerRef,
      onSubmitQuestionAnswers,
      permissionReplyErrorByRequestId,
      selectedRoleAvailable,
      showThinkingMessages,
      taskId,
      threadSession,
      todoPanelBottomOffset,
      todoPanelCollapsed,
      onToggleTodoPanel,
    ],
  );
};

type UseAgentStudioComposerModelArgs = {
  taskId: string;
  activeSession: AgentSessionState | null;
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  canStopSession: boolean;
  stopAgentSession: (sessionId: string) => Promise<void>;
  agentStudioReady: boolean;
  selectedRoleAvailable: boolean;
  selectedRoleReadOnlyReason: string | null;
  input: string;
  setInput: (value: string) => void;
  onSend: () => Promise<void>;
  isSending: boolean;
  isStarting: boolean;
  chatContextUsage: AgentChatModel["composer"]["contextUsage"];
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
  composerFormRef: RefObject<HTMLFormElement | null>;
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>;
  resizeComposerTextarea: () => void;
};

export const useAgentStudioComposerModel = ({
  taskId,
  activeSession,
  isSessionWorking,
  isWaitingInput,
  canStopSession,
  stopAgentSession,
  agentStudioReady,
  selectedRoleAvailable,
  selectedRoleReadOnlyReason,
  input,
  setInput,
  onSend,
  isSending,
  isStarting,
  chatContextUsage,
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
  composerFormRef,
  composerTextareaRef,
  resizeComposerTextarea,
}: UseAgentStudioComposerModelArgs): ReturnType<typeof buildAgentChatComposerModel> => {
  const isModelSelectionPending = Boolean(
    activeSession?.isLoadingModelCatalog && !activeSession?.selectedModel,
  );
  const activeSessionId = activeSession?.sessionId;
  const waitingInputPlaceholder = activeSession
    ? getAgentSessionWaitingInputPlaceholder(activeSession)
    : null;

  const handleSend = useCallback((): void => {
    void onSend();
  }, [onSend]);

  const handleStopSession = useCallback((): void => {
    if (!activeSessionId) {
      return;
    }
    void stopAgentSession(activeSessionId);
  }, [activeSessionId, stopAgentSession]);

  return useMemo(
    () =>
      buildAgentChatComposerModel({
        taskId,
        agentStudioReady,
        isReadOnly: !selectedRoleAvailable,
        readOnlyReason: selectedRoleReadOnlyReason,
        input,
        onInputChange: setInput,
        onSend: handleSend,
        isSending,
        isStarting,
        isSessionWorking,
        isWaitingInput,
        waitingInputPlaceholder,
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
      isWaitingInput,
      isStarting,
      waitingInputPlaceholder,
      modelGroups,
      modelOptions,
      onSelectAgent,
      onSelectModel,
      onSelectVariant,
      resizeComposerTextarea,
      selectedModelSelection,
      selectedRoleAvailable,
      selectedRoleReadOnlyReason,
      setInput,
      taskId,
      variantOptions,
    ],
  );
};
