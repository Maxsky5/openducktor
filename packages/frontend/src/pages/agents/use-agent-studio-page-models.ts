import type { ChatSettings, TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { useEffect, useMemo, useRef } from "react";
import type { AgentChatModel } from "@/components/features/agents/agent-chat/agent-chat.types";
import type { AgentChatComposerDraft } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { useAgentChatSurfaceModel } from "@/components/features/agents/agent-chat/use-agent-chat-surface-model";
import type { AgentStudioTaskTabsModel } from "@/components/features/agents/agent-studio-task-tabs";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";
import type { AgentStudioQuickActionOption } from "./agent-studio-quick-actions";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import {
  buildAgentStudioTaskTabsModel,
  buildAgentStudioWorkspaceSidebarModel,
} from "./agents-page-view-model";
import type { AgentStudioSelectedSessionContext } from "./selected-session/selected-session-context";
import { keepStablePendingInputCounts } from "./selected-session/selected-session-context";
import { useAgentStudioHeaderModel } from "./use-agent-studio-page-submodels";

const EMPTY_ACTIVE_COMPOSER_PENDING_APPROVALS = Object.freeze(
  [],
) as unknown as AgentSessionState["pendingApprovals"];
const EMPTY_ACTIVE_COMPOSER_PENDING_QUESTIONS = Object.freeze(
  [],
) as unknown as AgentSessionState["pendingQuestions"];

const useStablePendingInputCounts = (
  nextCounts: Record<string, number>,
): Record<string, number> => {
  const previousRef = useRef<Record<string, number>>(nextCounts);
  const stableCounts = useMemo(
    () => keepStablePendingInputCounts(previousRef.current, nextCounts),
    [nextCounts],
  );

  useEffect(() => {
    previousRef.current = stableCounts;
  }, [stableCounts]);

  return stableCounts;
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
  handleWorkflowStepSelect: (role: AgentRole, sessionValue: string | null) => void;
  handleSessionSelectionChange: (nextValue: string) => void;
  handlePrepareMessageFirstSession: (option: SessionCreateOption) => void;
  handleQuickAction: (option: AgentStudioQuickActionOption) => void;
  openTaskDetails: () => void;
  isStarting: boolean;
  isSending: boolean;
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  busySendBlockedReason: string | null;
  canStopSession: boolean;
  onSend: (draft: AgentChatComposerDraft) => Promise<boolean>;
  stopAgentSession: AgentStateContextValue["stopAgentSession"];
};

type AgentStudioModelSelectionContext = {
  selectedModelSelection: AgentModelSelection | null;
  selectedModelDescriptor?: AgentChatModel["composer"]["selectedModelDescriptor"];
  isSelectionCatalogLoading: boolean;
  supportsProfiles?: boolean;
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  supportsSkillReferences: boolean;
  slashCommandCatalog: AgentChatModel["composer"]["slashCommandCatalog"];
  slashCommands: AgentChatModel["composer"]["slashCommands"];
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
  skillCatalog: AgentChatModel["composer"]["skillCatalog"];
  skills: AgentChatModel["composer"]["skills"];
  skillsError: string | null;
  isSkillsLoading: boolean;
  searchFiles: AgentChatModel["composer"]["searchFiles"];
  agentOptions: ComboboxOption[];
  modelOptions: ComboboxOption[];
  modelGroups: ComboboxGroup[];
  variantOptions: ComboboxOption[];
  onSelectAgent: (agent: string) => void;
  onSelectModel: (model: string) => void;
  onSelectVariant: (variant: string) => void;
  activeSessionAgentColors: Record<string, string>;
};

type AgentStudioComposerContext = {
  draftStateKey: string;
};

type AgentStudioChatSettingsContext = ChatSettings;

type UseAgentStudioPageModelsArgs = {
  activeTabValue: string;
  selectedSession: AgentStudioSelectedSessionContext;
  taskTabs: AgentStudioTaskTabsContext;
  sessionActions: AgentStudioSessionActionsContext;
  modelSelection: AgentStudioModelSelectionContext;
  chatSettings: AgentStudioChatSettingsContext;
  composer: AgentStudioComposerContext;
};

export function useAgentStudioPageModels({
  activeTabValue,
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
  const activeComposerRuntimeKind = selectedActiveComposerSession?.runtimeKind;
  const activeComposerWorkingDirectory = selectedActiveComposerSession?.workingDirectory;
  const activeComposerSelectedModel = selectedActiveComposerSession?.selectedModel ?? null;
  const activeComposerIsLoadingModelCatalog =
    selectedActiveComposerSession?.isLoadingModelCatalog ?? false;
  const activeComposerPendingApprovals =
    selectedActiveComposerSession?.pendingApprovals &&
    selectedActiveComposerSession.pendingApprovals.length > 0
      ? selectedActiveComposerSession.pendingApprovals
      : EMPTY_ACTIVE_COMPOSER_PENDING_APPROVALS;
  const activeComposerPendingQuestions =
    selectedActiveComposerSession?.pendingQuestions &&
    selectedActiveComposerSession.pendingQuestions.length > 0
      ? selectedActiveComposerSession.pendingQuestions
      : EMPTY_ACTIVE_COMPOSER_PENDING_QUESTIONS;
  const activeComposerSession = useMemo(() => {
    if (
      !activeComposerExternalSessionId ||
      !activeComposerRuntimeKind ||
      activeComposerWorkingDirectory === undefined
    ) {
      return null;
    }

    return {
      externalSessionId: activeComposerExternalSessionId,
      runtimeKind: activeComposerRuntimeKind,
      workingDirectory: activeComposerWorkingDirectory,
      selectedModel: activeComposerSelectedModel,
      isLoadingModelCatalog: activeComposerIsLoadingModelCatalog,
      pendingApprovals: activeComposerPendingApprovals,
      pendingQuestions: activeComposerPendingQuestions,
    };
  }, [
    activeComposerExternalSessionId,
    activeComposerIsLoadingModelCatalog,
    activeComposerPendingApprovals,
    activeComposerPendingQuestions,
    activeComposerRuntimeKind,
    activeComposerSelectedModel,
    activeComposerWorkingDirectory,
  ]);
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
  const selectedRuntimeReadiness = selectedSession.runtime.runtimeReadiness;
  const selectedRuntimeLifecycle = selectedSession.runtime.lifecycle;
  const selectedSessionLifecycle = selectedRuntimeLifecycle;
  const runtimeReadiness = useMemo(
    () => ({
      readinessState: selectedRuntimeReadiness.readinessState,
      isReady: selectedRuntimeReadiness.isReady,
      isRuntimeStarting: selectedRuntimeReadiness.isRuntimeStarting,
      blockedReason: selectedRuntimeReadiness.blockedReason,
      isLoadingChecks: selectedRuntimeReadiness.isLoadingChecks,
      refreshChecks: selectedRuntimeReadiness.refreshChecks,
    }),
    [
      selectedRuntimeReadiness.blockedReason,
      selectedRuntimeReadiness.isLoadingChecks,
      selectedRuntimeReadiness.isReady,
      selectedRuntimeReadiness.isRuntimeStarting,
      selectedRuntimeReadiness.readinessState,
      selectedRuntimeReadiness.refreshChecks,
    ],
  );
  const selectedPendingQuestions = selectedSession.pendingInput.pendingQuestions;
  const pendingQuestions = useMemo(
    () => ({
      canSubmit: selectedPendingQuestions.canSubmit,
      isSubmittingByRequestId: selectedPendingQuestions.isSubmittingByRequestId,
      onSubmit: selectedPendingQuestions.onSubmit,
    }),
    [
      selectedPendingQuestions.canSubmit,
      selectedPendingQuestions.isSubmittingByRequestId,
      selectedPendingQuestions.onSubmit,
    ],
  );
  const selectedApprovals = selectedSession.pendingInput.approvals;
  const approvals = useMemo(
    () => ({
      canReply: selectedApprovals.canReply,
      isSubmittingByRequestId: selectedApprovals.isSubmittingByRequestId,
      errorByRequestId: selectedApprovals.errorByRequestId,
      onReply: selectedApprovals.onReply,
    }),
    [
      selectedApprovals.canReply,
      selectedApprovals.errorByRequestId,
      selectedApprovals.isSubmittingByRequestId,
      selectedApprovals.onReply,
    ],
  );
  const selectedEmptyState = selectedSession.chat.emptyState;
  const emptyStateTitle = selectedEmptyState?.title ?? null;
  const emptyStateActionLabel = selectedEmptyState?.actionLabel;
  const emptyStateOnAction = selectedEmptyState?.onAction;
  const emptyStateIsActionPending = selectedEmptyState?.isActionPending;
  const emptyState = useMemo(
    () =>
      emptyStateTitle
        ? {
            title: emptyStateTitle,
            ...(typeof emptyStateActionLabel === "string"
              ? { actionLabel: emptyStateActionLabel }
              : {}),
            ...(emptyStateOnAction ? { onAction: emptyStateOnAction } : {}),
            ...(typeof emptyStateIsActionPending === "boolean"
              ? { isActionPending: emptyStateIsActionPending }
              : {}),
          }
        : null,
    [emptyStateActionLabel, emptyStateIsActionPending, emptyStateOnAction, emptyStateTitle],
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
      supportsProfiles: modelSelection.supportsProfiles ?? true,
      supportsSlashCommands: modelSelection.supportsSlashCommands,
      supportsFileSearch: modelSelection.supportsFileSearch,
      supportsSkillReferences: modelSelection.supportsSkillReferences,
      slashCommandCatalog: modelSelection.slashCommandCatalog,
      slashCommands: modelSelection.slashCommands,
      slashCommandsError: modelSelection.slashCommandsError,
      isSlashCommandsLoading: modelSelection.isSlashCommandsLoading,
      skillCatalog: modelSelection.skillCatalog,
      skills: modelSelection.skills,
      skillsError: modelSelection.skillsError,
      isSkillsLoading: modelSelection.isSkillsLoading,
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
      modelSelection.isSkillsLoading,
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
      modelSelection.skillCatalog,
      modelSelection.skills,
      modelSelection.skillsError,
      modelSelection.supportsFileSearch,
      modelSelection.supportsSkillReferences,
      modelSelection.supportsProfiles,
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
    sessionLifecycle: selectedSessionLifecycle,
    chatSettings,
    isSessionWorking: sessionActions.isSessionWorking,
    runtimeDefinitions: selectedSession.runtime.runtimeDefinitions,
    sessionRuntimeDataError: selectedSession.runtime.sessionRuntimeDataError,
    runtimeReadiness,
    emptyState,
    pendingQuestions,
    approvals,
    composer: composerConfig,
    sessionAgentColors: modelSelection.activeSessionAgentColors,
    subagentPendingApprovalCountByExternalSessionId,
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
    activeTabValue,
    agentStudioTaskTabsModel,
    agentStudioHeaderModel,
    agentStudioWorkspaceSidebarModel,
    agentChatModel,
  };
}
