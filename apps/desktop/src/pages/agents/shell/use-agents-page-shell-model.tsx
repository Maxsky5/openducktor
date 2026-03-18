import { type ReactElement, startTransition, useCallback, useRef, useState } from "react";
import { useNavigationType, useSearchParams } from "react-router-dom";
import {
  TaskDetailsSheetController,
  type TaskDetailsSheetControllerHandle,
} from "@/components/features/task-details/task-details-sheet-controller";
import { HumanReviewFeedbackModal } from "@/features/human-review-feedback/human-review-feedback-modal";
import { useAgentState, useChecksState, useTasksState, useWorkspaceState } from "@/state";
import {
  useDelegationEventsContext,
  useRuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import type { AgentStudioQueryUpdate } from "../agent-studio-navigation";
import { RebaseConflictResolutionModal } from "../agents-page-rebase-conflict-modal";
import { AgentStudioSessionStartModalBridge } from "../agents-page-session-start-modal-bridge";
import { useAgentStudioOrchestrationController } from "../use-agent-studio-orchestration-controller";
import { useAgentStudioQuerySessionSync } from "../use-agent-studio-query-session-sync";
import { useAgentStudioQuerySync } from "../use-agent-studio-query-sync";
import { useAgentStudioRebaseConflictResolution } from "../use-agent-studio-rebase-conflict-resolution";
import { useAgentStudioSelectionController } from "../use-agent-studio-selection-controller";
import { useAgentStudioSessionStartRequest } from "../use-agent-studio-session-start-request";
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
  gitConflictResolutionModal: ReactElement | null;
  humanReviewFeedbackModal: ReactElement;
  sessionStartModal: ReactElement | null;
  taskDetailsSheet: ReactElement;
};

export function useAgentsPageShellModel(): AgentsPageShellModel {
  const { activeRepo, activeBranch } = useWorkspaceState();
  const { runtimeDefinitions, isLoadingRuntimeDefinitions, runtimeDefinitionsError } =
    useRuntimeDefinitionsContext();
  const { runtimeHealthByRuntime, isLoadingChecks, refreshChecks } = useChecksState();
  const {
    isLoadingTasks,
    tasks,
    runs,
    syncPullRequests,
    unlinkPullRequest,
    humanRequestChangesTask,
    detectingPullRequestTaskId,
    unlinkingPullRequestTaskId,
  } = useTasksState();
  const {
    sessions,
    loadAgentSessions,
    startAgentSession,
    sendAgentMessage,
    stopAgentSession,
    updateAgentSessionModel,
    replyAgentPermission,
    answerAgentQuestion,
  } = useAgentState();

  const [searchParams, setSearchParams] = useSearchParams();
  const navigationType = useNavigationType();
  const [input, setInput] = useState("");
  const [contextSwitchVersion, setContextSwitchVersion] = useState(0);
  const taskDetailsSheetRef = useRef<TaskDetailsSheetControllerHandle | null>(null);
  const { runCompletionSignal } = useDelegationEventsContext();
  const { pendingSessionStartRequest, requestNewSessionStart, resolvePendingSessionStart } =
    useAgentStudioSessionStartRequest();

  const {
    taskIdParam,
    sessionParam,
    hasExplicitRoleParam,
    roleFromQuery,
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
      startTransition(() => {
        updateQuery(updates);
      });
    },
    [updateQuery],
  );

  const clearComposerInput = useCallback((): void => {
    setInput("");
  }, []);

  const signalContextSwitchIntent = useCallback((): void => {
    setContextSwitchVersion((current) => current + 1);
  }, []);

  const selection = useAgentStudioSelectionController({
    activeRepo,
    tasks,
    isLoadingTasks,
    sessions,
    taskIdParam,
    sessionParam,
    hasExplicitRoleParam,
    roleFromQuery,
    updateQuery: scheduleQueryUpdate,
    loadAgentSessions,
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

  const runCompletionRecoverySignal = useRunCompletionRecoverySignal({
    activeSession: selection.viewActiveSession,
    runCompletionSignal,
  });

  useAgentStudioQuerySessionSync({
    isLoadingTasks,
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

  const readiness = useAgentStudioReadiness({
    activeRepo,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeHealthByRuntime,
    isLoadingChecks,
    refreshChecks,
  });

  const orchestration = useAgentStudioOrchestrationController({
    workspace: {
      activeRepo,
    },
    selection: {
      viewTaskId: selection.viewTaskId,
      viewRole: selection.viewRole,
      viewScenario: selection.viewScenario,
      viewSelectedTask: selection.viewSelectedTask,
      viewSessionsForTask: selection.viewSessionsForTask,
      viewActiveSession: selection.viewActiveSession,
      activeTaskTabId: selection.activeTaskTabId,
      taskTabs: selection.taskTabs,
      availableTabTasks: selection.availableTabTasks,
      contextSwitchVersion,
      isLoadingTasks,
      isActiveTaskHydrated: selection.isActiveTaskHydrated,
      isActiveTaskHydrationFailed: selection.isActiveTaskHydrationFailed,
      isViewSessionHistoryHydrationFailed: selection.isViewSessionHistoryHydrationFailed,
      isViewSessionHistoryHydrating: selection.isViewSessionHistoryHydrating,
      onCreateTab: selection.handleCreateTab,
      onCloseTab: selection.handleCloseTab,
    },
    readiness,
    composer: {
      input,
      setInput,
    },
    actions: {
      updateQuery: scheduleQueryUpdate,
      onContextSwitchIntent: signalContextSwitchIntent,
      openTaskDetails,
      startAgentSession,
      sendAgentMessage,
      stopAgentSession,
      updateAgentSessionModel,
      loadAgentSessions,
      humanRequestChangesTask,
      replyAgentPermission,
      answerAgentQuestion,
      requestNewSessionStart,
    },
  });

  const {
    pendingRebaseConflictResolutionRequest,
    resolvePendingRebaseConflictResolution,
    handleResolveRebaseConflict,
  } = useAgentStudioRebaseConflictResolution({
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
    startAgentSession,
    sendAgentMessage,
  });

  const { isRightPanelVisible, rightPanelModel } = useAgentsPageRightPanelModel({
    activeRepo,
    activeBranch,
    viewRole: selection.viewRole,
    viewActiveSession: selection.viewActiveSession,
    viewSelectedTask: selection.viewSelectedTask,
    panelKind: orchestration.rightPanel.panelKind,
    isPanelOpen: orchestration.rightPanel.isPanelOpen,
    documentsModel: orchestration.agentStudioWorkspaceSidebarModel,
    repoSettings: orchestration.repoSettings,
    runCompletionRecoverySignal,
    runs,
    detectingPullRequestTaskId,
    onDetectPullRequest: handleDetectPullRequest,
    onResolveGitConflict: handleResolveRebaseConflict,
  });

  const gitConflictResolutionModal = pendingRebaseConflictResolutionRequest ? (
    <RebaseConflictResolutionModal
      key={pendingRebaseConflictResolutionRequest.requestId}
      request={pendingRebaseConflictResolutionRequest}
      onResolve={resolvePendingRebaseConflictResolution}
    />
  ) : null;

  const sessionStartModal = pendingSessionStartRequest ? (
    <AgentStudioSessionStartModalBridge
      key={pendingSessionStartRequest.requestId}
      request={pendingSessionStartRequest}
      activeRepo={activeRepo}
      repoSettings={orchestration.repoSettings}
      onResolve={resolvePendingSessionStart}
    />
  ) : null;

  const humanReviewFeedbackModal = (
    <HumanReviewFeedbackModal model={orchestration.humanReviewFeedbackModal} />
  );

  const taskDetailsSheet = (
    <TaskDetailsSheetController
      ref={taskDetailsSheetRef}
      allTasks={tasks}
      runs={runs}
      workflowActionsEnabled={false}
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
    gitConflictResolutionModal,
    humanReviewFeedbackModal,
    sessionStartModal,
    taskDetailsSheet,
  };
}
