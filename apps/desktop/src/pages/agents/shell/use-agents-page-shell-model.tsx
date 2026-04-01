import type { AgentRole, AgentScenario } from "@openducktor/core";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigationType, useSearchParams } from "react-router-dom";
import { SessionStartModal } from "@/components/features/agents";
import type {
  ActiveTaskSessionContextByTaskId,
  KanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import { MergedPullRequestConfirmDialog } from "@/components/features/pull-requests/merged-pull-request-confirm-dialog";
import {
  TaskDetailsSheetController,
  type TaskDetailsSheetControllerHandle,
} from "@/components/features/task-details/task-details-sheet-controller";
import { HumanReviewFeedbackModal } from "@/features/human-review-feedback/human-review-feedback-modal";
import { useAgentState, useChecksState, useTasksState, useWorkspaceState } from "@/state";
import {
  useChecksOperationsContext,
  useDelegationEventsContext,
  useRuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import type { AgentStudioQueryUpdate } from "../agent-studio-navigation";
import { useAgentStudioOrchestrationController } from "../use-agent-studio-orchestration-controller";
import { useAgentStudioQuerySessionSync } from "../use-agent-studio-query-session-sync";
import { useAgentStudioQuerySync } from "../use-agent-studio-query-sync";
import { useAgentStudioRebaseConflictResolution } from "../use-agent-studio-rebase-conflict-resolution";
import { useAgentStudioSelectionController } from "../use-agent-studio-selection-controller";
import {
  useAgentStudioReadiness,
  useRunCompletionRecoverySignal,
} from "../use-agents-page-readiness";
import { useAgentsPageRightPanelModel } from "../use-agents-page-right-panel-model";

type AgentsPageShellModel = {
  activeRepo: string | null;
  navigationPersistenceError: Error | null;
  chatSettingsLoadError: Error | null;
  activeTabValue: string;
  onRetryNavigationPersistence: () => void;
  onRetryChatSettingsLoad: () => void;
  onTabValueChange: (value: string) => void;
  taskTabsModel: ReturnType<
    typeof useAgentStudioOrchestrationController
  >["agentStudioTaskTabsModel"];
  rightPanelToggleModel: ReturnType<
    typeof useAgentStudioOrchestrationController
  >["rightPanel"]["rightPanelToggleModel"];
  hasSelectedTask: boolean;
  chatHeaderModel: ReturnType<
    typeof useAgentStudioOrchestrationController
  >["agentStudioHeaderModel"];
  chatModel: ReturnType<typeof useAgentStudioOrchestrationController>["agentChatModel"];
  isRightPanelVisible: boolean;
  rightPanelModel: ReturnType<typeof useAgentsPageRightPanelModel>["rightPanelModel"];
  mergedPullRequestModal: ReactElement | null;
  humanReviewFeedbackModal: ReactElement;
  sessionStartModal: ReactElement | null;
  taskDetailsSheet: ReactElement;
};

const EMPTY_TASK_SESSIONS_BY_TASK_ID = new Map<string, KanbanTaskSession[]>();
const EMPTY_ACTIVE_TASK_SESSION_CONTEXT_BY_TASK_ID: ActiveTaskSessionContextByTaskId = new Map();

const noopOpenSession = (
  _taskId: string,
  _role: AgentRole,
  _options?: { sessionId?: string | null; scenario?: AgentScenario | null },
): void => {};

export function useAgentsPageShellModel(): AgentsPageShellModel {
  const { activeRepo, activeBranch } = useWorkspaceState();
  const { runtimeDefinitions, isLoadingRuntimeDefinitions, runtimeDefinitionsError } =
    useRuntimeDefinitionsContext();
  const { refreshRepoRuntimeHealthForRepo, hasCachedRepoRuntimeHealth } =
    useChecksOperationsContext();
  const { runtimeHealthByRuntime, isLoadingChecks, refreshChecks } = useChecksState();
  const {
    isForegroundLoadingTasks,
    tasks,
    runs,
    syncPullRequests,
    linkMergedPullRequest,
    cancelLinkMergedPullRequest,
    unlinkPullRequest,
    humanRequestChangesTask,
    detectingPullRequestTaskId,
    linkingMergedPullRequestTaskId,
    pendingMergedPullRequest,
    unlinkingPullRequestTaskId,
  } = useTasksState();
  const {
    sessions,
    bootstrapTaskSessions,
    hydrateRequestedTaskSessionHistory,
    readSessionFileSearch,
    readSessionModelCatalog,
    readSessionSlashCommands,
    readSessionTodos,
    startAgentSession,
    sendAgentMessage,
    stopAgentSession,
    updateAgentSessionModel,
    replyAgentPermission,
    answerAgentQuestion,
  } = useAgentState();

  const [searchParams, setSearchParams] = useSearchParams();
  const navigationType = useNavigationType();
  const [contextSwitchVersion, setContextSwitchVersion] = useState(0);
  const taskDetailsSheetRef = useRef<TaskDetailsSheetControllerHandle | null>(null);
  const { runCompletionSignal } = useDelegationEventsContext();

  const {
    taskIdParam,
    sessionParam,
    hasExplicitRoleParam,
    roleFromQuery,
    scenarioFromQuery,
    isRepoNavigationBoundaryPending,
    navigationPersistenceError,
    retryNavigationPersistence,
    updateQuery,
  } = useAgentStudioQuerySync({
    activeRepo,
    navigationType,
    searchParams,
    setSearchParams,
  });

  const scheduleQueryUpdate = useCallback(
    (updates: AgentStudioQueryUpdate): void => {
      updateQuery(updates);
    },
    [updateQuery],
  );

  const signalContextSwitchIntent = useCallback((): void => {
    setContextSwitchVersion((current) => current + 1);
  }, []);

  const clearComposerInput = signalContextSwitchIntent;

  const readiness = useAgentStudioReadiness({
    activeRepo,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeHealthByRuntime,
    isLoadingChecks,
    refreshChecks,
  });

  const selection = useAgentStudioSelectionController({
    activeRepo,
    isRepoNavigationBoundaryPending,
    tasks,
    isLoadingTasks: isForegroundLoadingTasks,
    sessions,
    taskIdParam,
    sessionParam,
    hasExplicitRoleParam,
    roleFromQuery,
    scenarioFromQuery,
    updateQuery: scheduleQueryUpdate,
    agentStudioReadinessState: readiness.agentStudioReadinessState,
    hydrateRequestedTaskSessionHistory,
    readSessionModelCatalog,
    readSessionTodos,
    clearComposerInput,
    onContextSwitchIntent: signalContextSwitchIntent,
  });

  const openTaskDetails = useCallback((): void => {
    if (!selection.viewSelectedTask) {
      return;
    }
    taskDetailsSheetRef.current?.openTask(selection.viewSelectedTask.id);
  }, [selection.viewSelectedTask]);

  const handleDetectPullRequest = useCallback(
    (taskId: string): void => {
      void syncPullRequests(taskId);
    },
    [syncPullRequests],
  );

  const handleUnlinkPullRequest = useCallback(
    (taskId: string): void => {
      void unlinkPullRequest(taskId);
    },
    [unlinkPullRequest],
  );

  const handleLinkMergedPullRequest = useCallback((): Promise<void> => {
    return linkMergedPullRequest();
  }, [linkMergedPullRequest]);

  const handleCancelLinkMergedPullRequest = useCallback((): void => {
    cancelLinkMergedPullRequest();
  }, [cancelLinkMergedPullRequest]);

  const draftStateKey = useMemo(
    () =>
      [
        selection.viewTaskId,
        selection.viewRole,
        selection.viewActiveSession?.sessionId ?? "new",
        contextSwitchVersion,
      ].join(":"),
    [
      contextSwitchVersion,
      selection.viewActiveSession?.sessionId,
      selection.viewRole,
      selection.viewTaskId,
    ],
  );

  const runCompletionRecoverySignal = useRunCompletionRecoverySignal({
    activeSession: selection.viewActiveSession,
    runCompletionSignal,
  });

  useEffect(() => {
    if (!activeRepo || runtimeDefinitions.length === 0 || isLoadingChecks) {
      return;
    }
    const runtimeKinds = runtimeDefinitions.map((definition) => definition.kind);
    if (hasCachedRepoRuntimeHealth(activeRepo, runtimeKinds)) {
      return;
    }
    void refreshRepoRuntimeHealthForRepo(activeRepo, false);
  }, [
    activeRepo,
    hasCachedRepoRuntimeHealth,
    isLoadingChecks,
    refreshRepoRuntimeHealthForRepo,
    runtimeDefinitions,
  ]);

  useAgentStudioQuerySessionSync({
    isRepoNavigationBoundaryPending,
    isLoadingTasks: isForegroundLoadingTasks,
    tasks,
    taskIdParam,
    sessionParam,
    selectedSessionById: selection.selectedSessionById,
    taskId: selection.taskId,
    activeSession: selection.activeSession,
    roleFromQuery,
    isActiveTaskHydrated: selection.isActiveTaskHydrated,
    scheduleQueryUpdate,
  });

  const orchestration = useAgentStudioOrchestrationController({
    activeRepo,
    selection: {
      ...selection,
      contextSwitchVersion,
      isLoadingTasks: isForegroundLoadingTasks,
    },
    readiness,
    draftStateKey,
    actions: {
      updateQuery: scheduleQueryUpdate,
      onContextSwitchIntent: signalContextSwitchIntent,
      openTaskDetails,
      startAgentSession,
      sendAgentMessage,
      stopAgentSession,
      updateAgentSessionModel,
      readSessionFileSearch,
      readSessionSlashCommands,
      bootstrapTaskSessions,
      hydrateRequestedTaskSessionHistory,
      humanRequestChangesTask,
      replyAgentPermission,
      answerAgentQuestion,
    },
  });

  const { startSessionRequest } = orchestration;

  const { handleResolveRebaseConflict } = useAgentStudioRebaseConflictResolution({
    activeRepo,
    selection: {
      viewTaskId: selection.viewTaskId,
      viewSelectedTask: selection.viewSelectedTask,
      viewActiveSession: selection.viewActiveSession,
      activeSession: selection.activeSession,
      selectedSessionById: selection.selectedSessionById,
      viewSessionsForTask: selection.viewSessionsForTask,
      sessionsForTask: selection.sessionsForTask,
    },
    scheduleQueryUpdate,
    onContextSwitchIntent: signalContextSwitchIntent,
    startSessionRequest,
  });

  const { isRightPanelVisible, rightPanelModel } = useAgentsPageRightPanelModel({
    activeRepo,
    activeBranch,
    viewRole: selection.viewRole,
    viewActiveSession: selection.viewActiveSession,
    viewSelectedTask: selection.viewSelectedTask,
    panelKind: orchestration.rightPanel.panelKind,
    isPanelOpen: orchestration.rightPanel.isPanelOpen,
    isViewSessionHistoryHydrating: selection.isViewSessionHistoryHydrating,
    documentsModel: orchestration.agentStudioWorkspaceSidebarModel,
    repoSettings: orchestration.repoSettings,
    runCompletionRecoverySignal,
    runs,
    detectingPullRequestTaskId,
    onDetectPullRequest: handleDetectPullRequest,
    onResolveGitConflict: handleResolveRebaseConflict,
  });

  const sessionStartModal = orchestration.sessionStartModal ? (
    <SessionStartModal model={orchestration.sessionStartModal} />
  ) : null;

  const humanReviewFeedbackModal = (
    <HumanReviewFeedbackModal model={orchestration.humanReviewFeedbackModal} />
  );

  const mergedPullRequestModal = pendingMergedPullRequest ? (
    <MergedPullRequestConfirmDialog
      pullRequest={pendingMergedPullRequest.pullRequest}
      isLinking={pendingMergedPullRequest.taskId === linkingMergedPullRequestTaskId}
      onCancel={handleCancelLinkMergedPullRequest}
      onConfirm={() => void handleLinkMergedPullRequest()}
    />
  ) : null;

  const taskDetailsSheet = (
    <TaskDetailsSheetController
      ref={taskDetailsSheetRef}
      activeRepo={activeRepo}
      allTasks={tasks}
      taskSessionsByTaskId={EMPTY_TASK_SESSIONS_BY_TASK_ID}
      activeTaskSessionContextByTaskId={EMPTY_ACTIVE_TASK_SESSION_CONTEXT_BY_TASK_ID}
      runs={runs}
      workflowActionsEnabled={false}
      onOpenSession={noopOpenSession}
      onDetectPullRequest={handleDetectPullRequest}
      onUnlinkPullRequest={handleUnlinkPullRequest}
      detectingPullRequestTaskId={detectingPullRequestTaskId}
      unlinkingPullRequestTaskId={unlinkingPullRequestTaskId}
    />
  );

  return {
    activeRepo,
    navigationPersistenceError,
    chatSettingsLoadError: orchestration.chatSettingsLoadError,
    activeTabValue: orchestration.activeTabValue,
    onRetryNavigationPersistence: retryNavigationPersistence,
    onRetryChatSettingsLoad: orchestration.retryChatSettingsLoad,
    onTabValueChange: selection.handleSelectTab,
    taskTabsModel: orchestration.agentStudioTaskTabsModel,
    rightPanelToggleModel: orchestration.rightPanel.rightPanelToggleModel,
    hasSelectedTask: Boolean(selection.viewTaskId),
    chatHeaderModel: orchestration.agentStudioHeaderModel,
    chatModel: orchestration.agentChatModel,
    isRightPanelVisible,
    rightPanelModel,
    mergedPullRequestModal,
    humanReviewFeedbackModal,
    sessionStartModal,
    taskDetailsSheet,
  };
}
