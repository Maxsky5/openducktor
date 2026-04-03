import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import type { RefObject } from "react";
import { useCallback, useMemo } from "react";
import type { AgentChatModel } from "@/components/features/agents/agent-chat/agent-chat.types";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import { getAgentSessionWaitingInputPlaceholder } from "@/lib/agent-session-waiting-input";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStudioReadinessState } from "./agent-studio-task-hydration-state";
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
  activeSession: Pick<AgentSessionState, "status"> | null;
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
  const activeSessionStatus = activeSession?.status ?? null;

  return useMemo(
    () =>
      buildAgentStudioHeaderModel({
        selectedTask,
        onOpenTaskDetails,
        activeSession: activeSessionStatus ? { status: activeSessionStatus } : null,
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
      activeSessionStatus,
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
  isSessionWorking: boolean;
  showThinkingMessages: boolean;
  isContextSwitching: boolean;
  isSessionHistoryLoading: boolean;
  isWaitingForRuntimeReadiness: boolean;
  taskId: string;
  activeSessionAgentColors: Record<string, string>;
  agentStudioReadinessState: AgentStudioReadinessState;
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
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  scrollToBottomOnSendRef: React.MutableRefObject<(() => void) | null>;
  syncBottomAfterComposerLayoutRef: React.MutableRefObject<(() => void) | null>;
};

export const useAgentStudioThreadModel = ({
  threadSession,
  isSessionWorking,
  showThinkingMessages,
  isContextSwitching,
  isSessionHistoryLoading,
  isWaitingForRuntimeReadiness,
  taskId,
  activeSessionAgentColors,
  agentStudioReadinessState,
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
  messagesContainerRef,
  scrollToBottomOnSendRef,
  syncBottomAfterComposerLayoutRef,
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
        isSessionWorking,
        showThinkingMessages,
        isSessionViewLoading: isContextSwitching,
        isSessionHistoryLoading,
        isWaitingForRuntimeReadiness,
        roleOptions: ROLE_OPTIONS,
        agentStudioReadinessState,
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
        messagesContainerRef,
        scrollToBottomOnSendRef,
        syncBottomAfterComposerLayoutRef,
      }),
    [
      activeSessionAgentColors,
      agentStudioReadinessState,
      agentStudioBlockedReason,
      agentStudioReady,
      canKickoffNewSession,
      handleKickoff,
      handlePermissionReply,
      handleRefreshChecks,
      isContextSwitching,
      isSessionHistoryLoading,
      isWaitingForRuntimeReadiness,
      isLoadingChecks,
      isSessionWorking,
      isSending,
      isStarting,
      isSubmittingPermissionByRequestId,
      isSubmittingQuestionByRequestId,
      kickoffLabel,
      messagesContainerRef,
      onSubmitQuestionAnswers,
      permissionReplyErrorByRequestId,
      scrollToBottomOnSendRef,
      selectedRoleAvailable,
      showThinkingMessages,
      taskId,
      threadSession,
      todoPanelCollapsed,
      onToggleTodoPanel,
      syncBottomAfterComposerLayoutRef,
    ],
  );
};

type UseAgentStudioComposerModelArgs = {
  taskId: string;
  activeSession: Pick<
    AgentSessionState,
    | "sessionId"
    | "selectedModel"
    | "isLoadingModelCatalog"
    | "pendingPermissions"
    | "pendingQuestions"
  > | null;
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  busySendBlockedReason: string | null;
  canStopSession: boolean;
  stopAgentSession: (sessionId: string) => Promise<void>;
  agentStudioReady: boolean;
  selectedRoleAvailable: boolean;
  selectedRoleReadOnlyReason: string | null;
  draftStateKey: string;
  onSend: AgentChatModel["composer"]["onSend"];
  isSending: boolean;
  isStarting: boolean;
  chatContextUsage: AgentChatModel["composer"]["contextUsage"];
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
  composerFormRef: RefObject<HTMLFormElement | null>;
  composerEditorRef: RefObject<HTMLDivElement | null>;
  resizeComposerEditor: () => void;
  scrollToBottomOnSendRef: AgentChatModel["composer"]["scrollToBottomOnSendRef"];
};

export const useAgentStudioComposerModel = ({
  taskId,
  activeSession,
  isSessionWorking,
  isWaitingInput,
  busySendBlockedReason,
  canStopSession,
  stopAgentSession,
  agentStudioReady,
  selectedRoleAvailable,
  selectedRoleReadOnlyReason,
  draftStateKey,
  onSend,
  isSending,
  isStarting,
  chatContextUsage,
  selectedModelSelection,
  selectedModelDescriptor,
  isSelectionCatalogLoading,
  supportsSlashCommands,
  supportsFileSearch,
  slashCommandCatalog,
  slashCommands,
  slashCommandsError,
  isSlashCommandsLoading,
  searchFiles,
  agentOptions,
  modelOptions,
  modelGroups,
  variantOptions,
  onSelectAgent,
  onSelectModel,
  onSelectVariant,
  activeSessionAgentColors,
  composerFormRef,
  composerEditorRef,
  resizeComposerEditor,
  scrollToBottomOnSendRef,
}: UseAgentStudioComposerModelArgs): ReturnType<typeof buildAgentChatComposerModel> => {
  const isModelSelectionPending = Boolean(
    activeSession?.isLoadingModelCatalog && !activeSession?.selectedModel,
  );
  const activeSessionId = activeSession?.sessionId;
  const waitingInputPlaceholder = activeSession
    ? getAgentSessionWaitingInputPlaceholder(activeSession)
    : null;

  const handleSend = useCallback<AgentChatModel["composer"]["onSend"]>(
    async (draft) => {
      const didSend = await onSend(draft);
      if (didSend) {
        scrollToBottomOnSendRef.current?.();
      }
      return didSend;
    },
    [onSend, scrollToBottomOnSendRef],
  );

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
        busySendBlockedReason,
        draftStateKey,
        onSend: handleSend,
        isSending,
        isStarting,
        isSessionWorking,
        isWaitingInput,
        waitingInputPlaceholder,
        isModelSelectionPending,
        selectedModelSelection,
        ...(selectedModelDescriptor !== undefined ? { selectedModelDescriptor } : {}),
        isSelectionCatalogLoading,
        supportsSlashCommands,
        supportsFileSearch,
        slashCommandCatalog,
        slashCommands,
        slashCommandsError,
        isSlashCommandsLoading,
        searchFiles,
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
        composerEditorRef,
        onComposerEditorInput: resizeComposerEditor,
        scrollToBottomOnSendRef,
      }),
    [
      activeSessionAgentColors,
      agentOptions,
      agentStudioReady,
      canStopSession,
      chatContextUsage,
      composerFormRef,
      composerEditorRef,
      draftStateKey,
      handleSend,
      handleStopSession,
      isModelSelectionPending,
      isSelectionCatalogLoading,
      isSlashCommandsLoading,
      isSending,
      isSessionWorking,
      isWaitingInput,
      busySendBlockedReason,
      isStarting,
      waitingInputPlaceholder,
      modelGroups,
      modelOptions,
      onSelectAgent,
      onSelectModel,
      onSelectVariant,
      resizeComposerEditor,
      scrollToBottomOnSendRef,
      selectedModelSelection,
      selectedModelDescriptor,
      selectedRoleAvailable,
      selectedRoleReadOnlyReason,
      slashCommandCatalog,
      slashCommands,
      slashCommandsError,
      supportsSlashCommands,
      supportsFileSearch,
      taskId,
      variantOptions,
      searchFiles,
    ],
  );
};
