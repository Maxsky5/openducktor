import type { AgentRole, AgentScenario } from "@openducktor/core";
import {
  type MutableRefObject,
  memo,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigationType, useSearchParams } from "react-router-dom";
import { SessionStartModal } from "@/components/features/agents";
import { MemoizedAgentStudioRightPanel } from "@/components/features/agents/agent-studio-right-panel";
import type {
  ActiveTaskSessionContextByTaskId,
  KanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import { MergedPullRequestConfirmDialog } from "@/components/features/pull-requests/merged-pull-request-confirm-dialog";
import {
  TaskDetailsSheetController,
  type TaskDetailsSheetControllerHandle,
} from "@/components/features/task-details/task-details-sheet-controller";
import type { BuildToolsSessionDescriptor } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-bootstrap";
import { HumanReviewFeedbackModal } from "@/features/human-review-feedback/human-review-feedback-modal";
import { toAgentSessionSummary } from "@/state/agent-sessions-store";
import {
  useChecksOperationsContext,
  useDelegationEventsContext,
  useRuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import {
  useAgentOperations,
  useAgentSessionSummaries,
  useChecksState,
  useTasksState,
  useWorkspaceState,
} from "@/state/app-state-provider";
import type { AgentStudioQueryUpdate } from "../agent-studio-navigation";
import { useAgentStudioBuildWorktreeRefresh } from "../use-agent-studio-build-worktree-refresh";
import {
  type AgentStudioOrchestrationSelectionContext,
  useAgentStudioOrchestrationController,
} from "../use-agent-studio-orchestration-controller";
import { useAgentStudioQuerySessionSync } from "../use-agent-studio-query-session-sync";
import { useAgentStudioQuerySync } from "../use-agent-studio-query-sync";
import { useAgentStudioRebaseConflictResolution } from "../use-agent-studio-rebase-conflict-resolution";
import { useAgentStudioSelectionController } from "../use-agent-studio-selection-controller";
import {
  useAgentStudioReadiness,
  useRunCompletionRecoverySignal,
} from "../use-agents-page-readiness";
import {
  type UseAgentsPageRightPanelModelArgs,
  useAgentsPageRightPanelModel,
} from "../use-agents-page-right-panel-model";

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
  rightPanelContent: ReactElement | null;
  mergedPullRequestModal: ReactElement | null;
  humanReviewFeedbackModal: ReactElement;
  sessionStartModal: ReactElement | null;
  taskDetailsSheet: ReactElement;
};

const AgentsPageRightPanelRuntime = memo(function AgentsPageRightPanelRuntime({
  refreshWorktreeRef,
  ...args
}: UseAgentsPageRightPanelModelArgs & {
  refreshWorktreeRef: MutableRefObject<(() => void) | null>;
}): ReactElement | null {
  const { rightPanelModel, refreshWorktree } = useAgentsPageRightPanelModel(args);

  useEffect(() => {
    refreshWorktreeRef.current = refreshWorktree;
    return () => {
      if (refreshWorktreeRef.current === refreshWorktree) {
        refreshWorktreeRef.current = null;
      }
    };
  }, [refreshWorktree, refreshWorktreeRef]);

  return rightPanelModel ? <MemoizedAgentStudioRightPanel model={rightPanelModel} /> : null;
});

function AgentsPageBuildWorktreeRefreshRuntime({
  panelKind,
  isPanelOpen,
  viewRole,
  activeSession,
  isSessionHistoryHydrating,
  refreshWorktreeRef,
}: {
  panelKind: "documents" | "build_tools" | null;
  isPanelOpen: boolean;
  viewRole: UseAgentsPageRightPanelModelArgs["viewRole"];
  activeSession: AgentStudioOrchestrationSelectionContext["viewActiveSession"];
  isSessionHistoryHydrating: boolean;
  refreshWorktreeRef: MutableRefObject<(() => void) | null>;
}): null {
  const refreshWorktree = useCallback(() => {
    refreshWorktreeRef.current?.();
  }, [refreshWorktreeRef]);

  useAgentStudioBuildWorktreeRefresh({
    viewRole: panelKind === "build_tools" && isPanelOpen ? viewRole : null,
    activeSession,
    isSessionHistoryHydrating,
    refreshWorktree,
  });

  return null;
}

const EMPTY_TASK_SESSIONS_BY_TASK_ID = new Map<string, KanbanTaskSession[]>();
const EMPTY_ACTIVE_TASK_SESSION_CONTEXT_BY_TASK_ID: ActiveTaskSessionContextByTaskId = new Map();

const noopOpenSession = (
  _taskId: string,
  _role: AgentRole,
  _options?: { sessionId?: string | null; scenario?: AgentScenario | null },
): void => {};

export function useAgentsPageShellModel(): AgentsPageShellModel {
  const { activeRepo, activeBranch, branches } = useWorkspaceState();
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
    setTaskTargetBranch,
  } = useTasksState();
  const {
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
  } = useAgentOperations();
  const sessions = useAgentSessionSummaries();

  const [searchParams, setSearchParams] = useSearchParams();
  const navigationType = useNavigationType();
  const [contextSwitchVersion, setContextSwitchVersion] = useState(0);
  const taskDetailsSheetRef = useRef<TaskDetailsSheetControllerHandle | null>(null);
  const rightPanelRefreshWorktreeRef = useRef<(() => void) | null>(null);
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
    branches,
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
      setTaskTargetBranch,
      replyAgentPermission,
      answerAgentQuestion,
    },
  });

  const { startSessionRequest } = orchestration;
  const activeSessionSummary = selection.activeSession
    ? toAgentSessionSummary(selection.activeSession)
    : null;
  const viewActiveSessionSummary = selection.viewActiveSession
    ? toAgentSessionSummary(selection.viewActiveSession)
    : null;

  const { handleResolveRebaseConflict } = useAgentStudioRebaseConflictResolution({
    activeRepo,
    selection: {
      viewTaskId: selection.viewTaskId,
      viewSelectedTask: selection.viewSelectedTask,
      viewActiveSession: viewActiveSessionSummary,
      activeSession: activeSessionSummary,
      selectedSessionById: selection.selectedSessionById,
      viewSessionsForTask: selection.viewSessionsForTask,
      sessionsForTask: selection.sessionsForTask,
    },
    scheduleQueryUpdate,
    onContextSwitchIntent: signalContextSwitchIntent,
    startSessionRequest,
  });

  const isRightPanelVisible = Boolean(
    orchestration.rightPanel.panelKind && orchestration.rightPanel.isPanelOpen,
  );
  const rightPanelSessionRole = selection.viewActiveSession?.role ?? null;
  const rightPanelSessionStatus = selection.viewActiveSession?.status ?? null;
  const rightPanelSessionWorkingDirectory = selection.viewActiveSession?.workingDirectory ?? null;
  const rightPanelSessionRunId = selection.viewActiveSession?.runId ?? null;
  const rightPanelHasActiveSession = selection.viewActiveSession != null;
  const rightPanelSession = useMemo<BuildToolsSessionDescriptor>(
    () => ({
      role: rightPanelSessionRole,
      status: rightPanelSessionStatus,
      workingDirectory: rightPanelSessionWorkingDirectory,
      runId: rightPanelSessionRunId,
      hasActiveSession: rightPanelHasActiveSession,
    }),
    [
      rightPanelHasActiveSession,
      rightPanelSessionRole,
      rightPanelSessionRunId,
      rightPanelSessionStatus,
      rightPanelSessionWorkingDirectory,
    ],
  );
  const rightPanelContent = orchestration.rightPanel.panelKind ? (
    <>
      <AgentsPageBuildWorktreeRefreshRuntime
        panelKind={orchestration.rightPanel.panelKind}
        isPanelOpen={orchestration.rightPanel.isPanelOpen}
        viewRole={selection.viewRole}
        activeSession={selection.viewActiveSession}
        isSessionHistoryHydrating={selection.isViewSessionHistoryHydrating}
        refreshWorktreeRef={rightPanelRefreshWorktreeRef}
      />
      <AgentsPageRightPanelRuntime
        activeRepo={activeRepo}
        branches={branches}
        activeBranch={activeBranch}
        viewRole={selection.viewRole}
        session={rightPanelSession}
        viewSelectedTask={selection.viewSelectedTask}
        panelKind={orchestration.rightPanel.panelKind}
        isPanelOpen={orchestration.rightPanel.isPanelOpen}
        isViewSessionHistoryHydrating={selection.isViewSessionHistoryHydrating}
        documentsModel={orchestration.agentStudioWorkspaceSidebarModel}
        repoSettings={orchestration.repoSettings}
        runCompletionRecoverySignal={runCompletionRecoverySignal}
        runs={runs}
        setTaskTargetBranch={setTaskTargetBranch}
        detectingPullRequestTaskId={detectingPullRequestTaskId}
        onDetectPullRequest={handleDetectPullRequest}
        onResolveGitConflict={handleResolveRebaseConflict}
        refreshWorktreeRef={rightPanelRefreshWorktreeRef}
      />
    </>
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
    rightPanelContent,
    mergedPullRequestModal,
    humanReviewFeedbackModal,
    sessionStartModal,
    taskDetailsSheet,
  };
}
