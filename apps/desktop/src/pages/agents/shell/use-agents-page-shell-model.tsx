import {
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigationType, useSearchParams } from "react-router-dom";
import { MergedPullRequestConfirmDialog } from "@/components/features/pull-requests/merged-pull-request-confirm-dialog";
import { SessionStartModal } from "@/components/features/agents";
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
import { RebaseConflictResolutionModal } from "../agents-page-rebase-conflict-modal";
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
  gitConflictResolutionModal: ReactElement | null;
  mergedPullRequestModal: ReactElement | null;
  humanReviewFeedbackModal: ReactElement;
  sessionStartModal: ReactElement | null;
  taskDetailsSheet: ReactElement;
};

export function useAgentsPageShellModel(): AgentsPageShellModel {
  const { activeRepo, activeBranch } = useWorkspaceState();
  const { runtimeDefinitions, isLoadingRuntimeDefinitions, runtimeDefinitionsError } =
    useRuntimeDefinitionsContext();
  const { refreshRepoRuntimeHealthForRepo, hasCachedRepoRuntimeHealth } =
    useChecksOperationsContext();
  const { runtimeHealthByRuntime, isLoadingChecks, refreshChecks } = useChecksState();
  const {
    isLoadingTasks,
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
    readSessionModelCatalog,
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
  const [input, setInput] = useState("");
  const [contextSwitchVersion, setContextSwitchVersion] = useState(0);
  const taskDetailsSheetRef = useRef<TaskDetailsSheetControllerHandle | null>(null);
  const { runCompletionSignal } = useDelegationEventsContext();

  const {
    taskIdParam,
    sessionParam,
    hasExplicitRoleParam,
    roleFromQuery,
    scenarioFromQuery,
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
    scenarioFromQuery,
    updateQuery: scheduleQueryUpdate,
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
    activeRepo,
    selection: {
      ...selection,
      contextSwitchVersion,
    },
    readiness,
    input,
    setInput,
    actions: {
      updateQuery: scheduleQueryUpdate,
      onContextSwitchIntent: signalContextSwitchIntent,
      openTaskDetails,
      startAgentSession,
      sendAgentMessage,
      stopAgentSession,
      updateAgentSessionModel,
      bootstrapTaskSessions,
      hydrateRequestedTaskSessionHistory,
      humanRequestChangesTask,
      replyAgentPermission,
      answerAgentQuestion,
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
    isViewSessionHistoryHydrating: selection.isViewSessionHistoryHydrating,
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
    mergedPullRequestModal,
    humanReviewFeedbackModal,
    sessionStartModal,
    taskDetailsSheet,
  };
}
