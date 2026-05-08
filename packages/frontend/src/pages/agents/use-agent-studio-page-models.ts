import type { RuntimeDescriptor, TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { useMemo, useRef } from "react";
import type { AgentChatModel } from "@/components/features/agents/agent-chat/agent-chat.types";
import type { AgentChatComposerDraft } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { useAgentChatSurfaceModel } from "@/components/features/agents/agent-chat/use-agent-chat-surface-model";
import type { AgentStudioTaskTabsModel } from "@/components/features/agents/agent-studio-task-tabs";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStudioQuickActionOption } from "./agent-studio-quick-actions";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import {
  buildAgentStudioTaskTabsModel,
  buildAgentStudioWorkspaceSidebarModel,
} from "./agents-page-view-model";
import type { AgentStudioSelectedSessionContext } from "./selected-session/selected-session-context";
import { keepStablePendingInputCounts } from "./selected-session/selected-session-context";
import type { AgentStudioSessionContextUsage } from "./use-agent-studio-page-model-builders";
import { useAgentStudioHeaderModel } from "./use-agent-studio-page-submodels";

type AgentStudioCoreContext = {
  activeTabValue: string;
  taskId: string;
  role: AgentRole;
  selectedTask: TaskCard | null;
  allSessionSummaries: AgentSessionSummary[];
  sessionsForTask: AgentSessionSummary[];
  contextSessionsLength: number;
  activeSession: AgentSessionState | null;
  runtimeDefinitions: RuntimeDescriptor[];
  sessionRuntimeDataError: string | null;
  hasActiveGitConflict: boolean;
  isTaskHydrating: boolean;
  isSessionHistoryHydrated: boolean;
  isSessionHistoryHydrating: boolean;
  isSessionSelectionResolving: boolean;
  isWaitingForRuntimeReadiness: boolean;
  isSessionHistoryHydrationFailed: boolean;
  contextSwitchVersion: number;
};

const useStablePendingInputCounts = (
  nextCounts: Record<string, number>,
): Record<string, number> => {
  const previousRef = useRef<Record<string, number>>(nextCounts);
  return useMemo(() => {
    const stableCounts = keepStablePendingInputCounts(previousRef.current, nextCounts);
    previousRef.current = stableCounts;
    return stableCounts;
  }, [nextCounts]);
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
  handleWorkflowStepSelect: (role: AgentRole, externalSessionId: string | null) => void;
  handleSessionSelectionChange: (nextValue: string) => void;
  handleCreateSession: (option: SessionCreateOption) => void;
  handlePrepareMessageFirstSession: (option: SessionCreateOption) => void;
  handleQuickAction: (option: AgentStudioQuickActionOption) => void;
  openTaskDetails: () => void;
  isStarting: boolean;
  isSending: boolean;
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  busySendBlockedReason: string | null;
  canKickoffNewSession: boolean;
  kickoffLabel: string;
  canStopSession: boolean;
  startLaunchKickoff: () => Promise<void>;
  onSend: (draft: AgentChatComposerDraft) => Promise<boolean>;
  onSubmitQuestionAnswers: (requestId: string, answers: string[][]) => Promise<void>;
  isSubmittingQuestionByRequestId: Record<string, boolean>;
  stopAgentSession: (externalSessionId: string) => Promise<void>;
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

type AgentStudioComposerContext = {
  draftStateKey: string;
};

type AgentStudioChatSettingsContext = {
  showThinkingMessages: boolean;
};

type UseAgentStudioPageModelsArgs = {
  core: AgentStudioCoreContext;
  selectedSession: AgentStudioSelectedSessionContext;
  taskTabs: AgentStudioTaskTabsContext;
  sessionActions: AgentStudioSessionActionsContext;
  modelSelection: AgentStudioModelSelectionContext;
  chatSettings: AgentStudioChatSettingsContext;
  composer: AgentStudioComposerContext;
};

export function useAgentStudioPageModels({
  core,
  selectedSession,
  taskTabs,
  sessionActions,
  modelSelection,
  chatSettings,
  composer,
}: UseAgentStudioPageModelsArgs): {
  activeTabValue: string;
  agentStudioTaskTabsModel: AgentStudioTaskTabsModel;
  agentStudioHeaderModel: ReturnType<typeof useAgentStudioHeaderModel>;
  agentStudioWorkspaceSidebarModel: ReturnType<typeof buildAgentStudioWorkspaceSidebarModel>;
  agentChatModel: AgentChatModel;
} {
  const subagentPendingApprovalCountByExternalSessionId = useStablePendingInputCounts(
    selectedSession.pendingInput.subagentPendingApprovalCountByExternalSessionId,
  );
  const subagentPendingQuestionCountByExternalSessionId = useStablePendingInputCounts(
    selectedSession.pendingInput.subagentPendingQuestionCountByExternalSessionId,
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
        agentStudioReady: selectedSession.runtime.runtimeReadiness.isReady,
      }),
    [
      selectedSession.runtime.runtimeReadiness.isReady,
      taskTabs.availableTabTasks,
      taskTabs.isLoadingTasks,
      taskTabs.onCloseTab,
      taskTabs.onCreateTab,
      taskTabs.onReorderTab,
      taskTabs.onSelectTab,
      taskTabs.taskTabs,
    ],
  );

  const {
    workflowSessionByRole,
    workflowStateByRole,
    sessionSelectorGroups,
    sessionSelectorAutofocusByValue,
    sessionSelectorValue,
    sessionCreateOptions,
    quickActions,
    primaryQuickAction,
    selectedInteractionRole,
  } = selectedSession.workflow;

  const agentStudioHeaderModel = useAgentStudioHeaderModel({
    selectedTask: selectedSession.selectedTask,
    onOpenTaskDetails: selectedSession.selectedTask ? sessionActions.openTaskDetails : null,
    activeSession: selectedSession.activeSession,
    sessionsForTaskLength: selectedSession.sessionsForTask.length,
    contextSessionsLength: selectedSession.contextSessionsLength,
    agentStudioReady: selectedSession.runtime.runtimeReadiness.isReady,
    isStarting: sessionActions.isStarting,
    onWorkflowStepSelect: sessionActions.handleWorkflowStepSelect,
    onSessionSelectionChange: sessionActions.handleSessionSelectionChange,
    onPrepareMessageFirstSession: sessionActions.handlePrepareMessageFirstSession,
    onQuickAction: sessionActions.handleQuickAction,
    onResolveGitConflictQuickAction: null,
    workflow: {
      workflowStateByRole,
      selectedInteractionRole,
      workflowSessionByRole,
      sessionSelectorAutofocusByValue,
      sessionSelectorValue,
      sessionSelectorGroups,
      sessionCreateOptions,
      quickActions,
      primaryQuickAction,
    },
  });

  const agentStudioWorkspaceSidebarModel = useMemo(
    () =>
      buildAgentStudioWorkspaceSidebarModel({
        activeDocument: selectedSession.documents.activeDocument,
      }),
    [selectedSession.documents.activeDocument],
  );

  const selectedActiveComposerSession = selectedSession.chat.activeComposerSession;
  const activeComposerExternalSessionId = selectedActiveComposerSession?.externalSessionId ?? null;
  const activeComposerSelectedModel = selectedActiveComposerSession?.selectedModel ?? null;
  const activeComposerIsLoadingModelCatalog =
    selectedActiveComposerSession?.isLoadingModelCatalog ?? false;
  const activeComposerPendingApprovals = selectedActiveComposerSession?.pendingApprovals ?? [];
  const activeComposerPendingQuestions = selectedActiveComposerSession?.pendingQuestions ?? [];
  const activeComposerSession = useMemo(
    () =>
      activeComposerExternalSessionId
        ? {
            externalSessionId: activeComposerExternalSessionId,
            selectedModel: activeComposerSelectedModel,
            isLoadingModelCatalog: activeComposerIsLoadingModelCatalog,
            pendingApprovals: activeComposerPendingApprovals,
            pendingQuestions: activeComposerPendingQuestions,
          }
        : null,
    [
      activeComposerExternalSessionId,
      activeComposerIsLoadingModelCatalog,
      activeComposerPendingApprovals,
      activeComposerPendingQuestions,
      activeComposerSelectedModel,
    ],
  );
  const selectedChatContextUsage = selectedSession.chat.contextUsage;
  const contextUsageTotalTokens = selectedChatContextUsage?.totalTokens ?? null;
  const contextUsageContextWindow = selectedChatContextUsage?.contextWindow ?? null;
  const contextUsageOutputLimit = selectedChatContextUsage?.outputLimit;
  const chatContextUsage = useMemo(
    () =>
      contextUsageTotalTokens !== null && contextUsageContextWindow !== null
        ? {
            totalTokens: contextUsageTotalTokens,
            contextWindow: contextUsageContextWindow,
            ...(typeof contextUsageOutputLimit === "number"
              ? { outputLimit: contextUsageOutputLimit }
              : {}),
          }
        : null,
    [contextUsageContextWindow, contextUsageOutputLimit, contextUsageTotalTokens],
  );

  const composerConfig = useMemo(
    () => ({
      taskId: selectedSession.taskId,
      activeSession: activeComposerSession,
      isSessionWorking: sessionActions.isSessionWorking,
      isWaitingInput: sessionActions.isWaitingInput,
      busySendBlockedReason: sessionActions.busySendBlockedReason,
      canStopSession: sessionActions.canStopSession,
      stopAgentSession: sessionActions.stopAgentSession,
      isReadOnly: selectedSession.chat.composerReadOnly,
      readOnlyReason: selectedSession.chat.composerReadOnlyReason,
      draftStateKey: composer.draftStateKey,
      onSend: sessionActions.onSend,
      isSending: sessionActions.isSending,
      isStarting: sessionActions.isStarting,
      contextUsage: chatContextUsage,
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
    }),
    [
      composer.draftStateKey,
      modelSelection.agentOptions,
      modelSelection.isSelectionCatalogLoading,
      modelSelection.isSlashCommandsLoading,
      modelSelection.modelGroups,
      modelSelection.modelOptions,
      modelSelection.onSelectAgent,
      modelSelection.onSelectModel,
      modelSelection.onSelectVariant,
      modelSelection.searchFiles,
      modelSelection.selectedModelDescriptor,
      modelSelection.selectedModelSelection,
      modelSelection.slashCommandCatalog,
      modelSelection.slashCommands,
      modelSelection.slashCommandsError,
      modelSelection.supportsFileSearch,
      modelSelection.supportsSlashCommands,
      modelSelection.variantOptions,
      activeComposerSession,
      selectedSession.chat.composerReadOnly,
      selectedSession.chat.composerReadOnlyReason,
      chatContextUsage,
      selectedSession.taskId,
      sessionActions.busySendBlockedReason,
      sessionActions.canStopSession,
      sessionActions.isSending,
      sessionActions.isSessionWorking,
      sessionActions.isStarting,
      sessionActions.isWaitingInput,
      sessionActions.onSend,
      sessionActions.stopAgentSession,
    ],
  );

  const surfaceModel = useAgentChatSurfaceModel({
    mode: "interactive",
    session: selectedSession.activeSession,
    isTaskHydrating: selectedSession.runtime.isTaskHydrating,
    isSessionSelectionResolving: selectedSession.runtime.isSessionSelectionResolving,
    showThinkingMessages: chatSettings.showThinkingMessages,
    isSessionWorking: sessionActions.isSessionWorking,
    isSessionHistoryLoading: selectedSession.runtime.isSessionHistoryHydrating,
    isWaitingForRuntimeReadiness: selectedSession.runtime.isWaitingForRuntimeReadiness,
    runtimeDefinitions: selectedSession.runtime.runtimeDefinitions,
    sessionRuntimeDataError: selectedSession.runtime.sessionRuntimeDataError,
    runtimeReadiness: selectedSession.runtime.runtimeReadiness,
    emptyState: selectedSession.chat.emptyState,
    pendingQuestions: selectedSession.pendingInput.pendingQuestions,
    approvals: selectedSession.pendingInput.approvals,
    composer: composerConfig,
    sessionAgentColors: modelSelection.activeSessionAgentColors,
    subagentPendingApprovalsByExternalSessionId:
      selectedSession.pendingInput.subagentPendingApprovalsByExternalSessionId,
    subagentPendingApprovalCountByExternalSessionId,
    subagentPendingQuestionsByExternalSessionId:
      selectedSession.pendingInput.subagentPendingQuestionsByExternalSessionId,
    subagentPendingQuestionCountByExternalSessionId,
  });
  const composerModel = surfaceModel.composer;

  if (!composerModel) {
    throw new Error("Interactive Agent Studio chat is missing a composer model.");
  }

  const agentChatModel = useMemo(
    () =>
      ({
        ...surfaceModel,
        mode: "interactive",
        composer: composerModel,
      }) as AgentChatModel,
    [composerModel, surfaceModel],
  );

  return {
    activeTabValue: core.activeTabValue,
    agentStudioTaskTabsModel,
    agentStudioHeaderModel,
    agentStudioWorkspaceSidebarModel,
    agentChatModel,
  };
}
