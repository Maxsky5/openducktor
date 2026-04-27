import type { TaskCard } from "@openducktor/contracts";
import type {
  AgentModelSelection,
  AgentRole,
  LiveAgentSessionPendingInputBySession,
} from "@openducktor/core";
import { useMemo, useRef } from "react";
import type { AgentChatModel } from "@/components/features/agents/agent-chat/agent-chat.types";
import type { AgentChatComposerDraft } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { useAgentChatSurfaceModel } from "@/components/features/agents/agent-chat/use-agent-chat-surface-model";
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
import { useAgentStudioHeaderModel } from "./use-agent-studio-page-submodels";

type AgentStudioCoreContext = {
  activeTabValue: string;
  taskId: string;
  role: AgentRole;
  selectedTask: TaskCard | null;
  allSessionSummaries: AgentSessionSummary[];
  livePendingInputBySession: LiveAgentSessionPendingInputBySession | null;
  sessionsForTask: AgentSessionSummary[];
  contextSessionsLength: number;
  activeSession: AgentSessionState | null;
  sessionRuntimeDataError: string | null;
  isTaskHydrating: boolean;
  isSessionHistoryHydrating: boolean;
  isWaitingForRuntimeReadiness: boolean;
  isSessionHistoryHydrationFailed: boolean;
  contextSwitchVersion: number;
};

const EMPTY_SUBAGENT_PENDING_PERMISSION_COUNTS: Record<string, number> = Object.freeze({});

const arePermissionCountMapsEqual = (
  left: Record<string, number>,
  right: Record<string, number>,
): boolean => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => left[key] === right[key]);
};

const useStablePendingPermissionCounts = (
  sessions: AgentSessionSummary[],
  livePendingInputBySession: LiveAgentSessionPendingInputBySession | null,
): Record<string, number> => {
  const previousRef = useRef<Record<string, number>>(EMPTY_SUBAGENT_PENDING_PERMISSION_COUNTS);
  return useMemo(() => {
    const next: Record<string, number> = {};
    for (const session of sessions) {
      const pendingPermissionCount = session.pendingPermissions.length;
      if (pendingPermissionCount > 0) {
        next[session.sessionId] = pendingPermissionCount;
        if (session.externalSessionId !== session.sessionId) {
          next[session.externalSessionId] = pendingPermissionCount;
        }
      }
    }

    if (livePendingInputBySession) {
      for (const [sessionId, pendingInput] of Object.entries(livePendingInputBySession)) {
        const pendingPermissionCount = pendingInput.permissions.length;
        if (pendingPermissionCount > 0) {
          next[sessionId] = pendingPermissionCount;
        }
      }
    }

    const nextCounts =
      Object.keys(next).length > 0 ? next : EMPTY_SUBAGENT_PENDING_PERMISSION_COUNTS;
    const previous = previousRef.current;
    if (arePermissionCountMapsEqual(previous, nextCounts)) {
      return previous;
    }

    previousRef.current = nextCounts;
    return nextCounts;
  }, [sessions, livePendingInputBySession]);
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
  const workflowSessionsForTask = core.sessionsForTask;
  const subagentPendingPermissionCountBySessionId = useStablePendingPermissionCounts(
    core.allSessionSummaries,
    core.livePendingInputBySession,
  );
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
    sessionSelectorAutofocusByValue,
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
      sessionSelectorAutofocusByValue,
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
  const canKickoff = sessionActions.canKickoffNewSession && selectedRoleAvailable;
  const activeComposerSessionId = core.activeSession?.sessionId ?? null;
  const activeComposerSelectedModel = core.activeSession?.selectedModel ?? null;
  const activeComposerIsLoadingModelCatalog = core.activeSession?.isLoadingModelCatalog ?? false;
  const activeComposerPendingPermissions = core.activeSession?.pendingPermissions ?? [];
  const activeComposerPendingQuestions = core.activeSession?.pendingQuestions ?? [];
  const activeComposerSession = useMemo(
    () =>
      activeComposerSessionId
        ? {
            sessionId: activeComposerSessionId,
            selectedModel: activeComposerSelectedModel,
            isLoadingModelCatalog: activeComposerIsLoadingModelCatalog,
            pendingPermissions: activeComposerPendingPermissions,
            pendingQuestions: activeComposerPendingQuestions,
          }
        : null,
    [
      activeComposerIsLoadingModelCatalog,
      activeComposerPendingPermissions,
      activeComposerPendingQuestions,
      activeComposerSelectedModel,
      activeComposerSessionId,
    ],
  );

  const chatEmptyState = useMemo(() => {
    if (!core.taskId) {
      return {
        title: "Select a task to begin.",
      };
    }

    if (sessionActions.isStarting) {
      return {
        title: "Initializing session...",
      };
    }

    if (canKickoff) {
      return {
        title: "Send a message to start a new session automatically.",
        actionLabel: sessionActions.kickoffLabel,
        onAction: (): void => {
          void sessionActions.startScenarioKickoff();
        },
        isActionPending: sessionActions.isStarting,
      };
    }

    return {
      title: "Send a message to start a new session automatically.",
    };
  }, [
    canKickoff,
    core.taskId,
    sessionActions.isStarting,
    sessionActions.kickoffLabel,
    sessionActions.startScenarioKickoff,
  ]);

  const runtimeReadiness = useMemo(
    () => ({
      readinessState: readiness.agentStudioReadinessState,
      isReady: readiness.agentStudioReady,
      blockedReason: readiness.agentStudioBlockedReason,
      isLoadingChecks: readiness.isLoadingChecks,
      refreshChecks: readiness.refreshChecks,
    }),
    [
      readiness.agentStudioBlockedReason,
      readiness.agentStudioReadinessState,
      readiness.agentStudioReady,
      readiness.isLoadingChecks,
      readiness.refreshChecks,
    ],
  );

  const pendingQuestions = useMemo(
    () => ({
      canSubmit: true,
      isSubmittingByRequestId: sessionActions.isSubmittingQuestionByRequestId,
      onSubmit: sessionActions.onSubmitQuestionAnswers,
    }),
    [sessionActions.isSubmittingQuestionByRequestId, sessionActions.onSubmitQuestionAnswers],
  );

  const permissionsModel = useMemo(
    () => ({
      canReply: true,
      isSubmittingByRequestId: permissions.isSubmittingPermissionByRequestId,
      errorByRequestId: permissions.permissionReplyErrorByRequestId,
      onReply: permissions.onReplyPermission,
    }),
    [
      permissions.isSubmittingPermissionByRequestId,
      permissions.onReplyPermission,
      permissions.permissionReplyErrorByRequestId,
    ],
  );

  const composerConfig = useMemo(
    () => ({
      taskId: core.taskId,
      activeSession: activeComposerSession,
      isSessionWorking: sessionActions.isSessionWorking,
      isWaitingInput: sessionActions.isWaitingInput,
      busySendBlockedReason: sessionActions.busySendBlockedReason,
      canStopSession: sessionActions.canStopSession,
      stopAgentSession: sessionActions.stopAgentSession,
      isReadOnly: !selectedRoleAvailable,
      readOnlyReason: selectedRoleReadOnlyReason,
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
      chatContextUsage,
      composer.draftStateKey,
      core.taskId,
      activeComposerSession,
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
      selectedRoleAvailable,
      selectedRoleReadOnlyReason,
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
    session: core.activeSession,
    isTaskHydrating: core.isTaskHydrating,
    contextSwitchVersion: core.contextSwitchVersion,
    showThinkingMessages: chatSettings.showThinkingMessages,
    isSessionWorking: sessionActions.isSessionWorking,
    isSessionHistoryLoading: core.isSessionHistoryHydrating,
    isWaitingForRuntimeReadiness: core.isWaitingForRuntimeReadiness,
    sessionRuntimeDataError: core.sessionRuntimeDataError,
    runtimeReadiness,
    emptyState: chatEmptyState,
    pendingQuestions,
    permissions: permissionsModel,
    composer: composerConfig,
    sessionAgentColors: modelSelection.activeSessionAgentColors,
    subagentPendingPermissionCountBySessionId,
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
