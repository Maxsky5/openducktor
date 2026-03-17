import {
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { AgentChat } from "@/components/features/agents/agent-chat/agent-chat";
import { AgentStudioHeader } from "@/components/features/agents/agent-studio-header";
import { AgentStudioRightPanel } from "@/components/features/agents/agent-studio-right-panel";
import { AgentStudioTaskTabs } from "@/components/features/agents/agent-studio-task-tabs";
import {
  TaskDetailsSheetController,
  type TaskDetailsSheetControllerHandle,
} from "@/components/features/task-details/task-details-sheet-controller";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { DiffWorkerProvider } from "@/contexts/DiffWorkerProvider";
import { useAgentStudioDiffData } from "@/features/agent-studio-git";
import { HumanReviewFeedbackModal } from "@/features/human-review-feedback/human-review-feedback-modal";
import { normalizeTargetBranch, UPSTREAM_TARGET_BRANCH } from "@/lib/target-branch";
import { canDetectTaskPullRequest } from "@/lib/task-display";
import { useAgentState, useChecksState, useTasksState, useWorkspaceState } from "@/state";
import {
  useDelegationEventsContext,
  useRuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import type { AgentStudioQueryUpdate } from "./agent-studio-navigation";
import {
  buildAgentStudioGitPanelBranchIdentityKey,
  resolveAgentStudioGitPanelBranch,
} from "./agents-page-git-panel";
import { RebaseConflictResolutionModal } from "./agents-page-rebase-conflict-modal";
import { AgentStudioSessionStartModalBridge } from "./agents-page-session-start-modal-bridge";
import { AgentsPageShell } from "./agents-page-shell";
import { useAgentStudioBuildWorktreeRefresh } from "./use-agent-studio-build-worktree-refresh";
import { useAgentStudioGitActions } from "./use-agent-studio-git-actions";
import {
  type AgentStudioOrchestrationActionsContext,
  type AgentStudioOrchestrationComposerContext,
  type AgentStudioOrchestrationReadinessContext,
  type AgentStudioOrchestrationSelectionContext,
  type AgentStudioOrchestrationWorkspaceContext,
  useAgentStudioOrchestrationController,
} from "./use-agent-studio-orchestration-controller";
import { useAgentStudioQuerySessionSync } from "./use-agent-studio-query-session-sync";
import { useAgentStudioQuerySync } from "./use-agent-studio-query-sync";
import { useAgentStudioRebaseConflictResolution } from "./use-agent-studio-rebase-conflict-resolution";
import { buildAgentStudioRightPanelModel } from "./use-agent-studio-right-panel";
import { useAgentStudioSelectionController } from "./use-agent-studio-selection-controller";
import { useAgentStudioSessionStartRequest } from "./use-agent-studio-session-start-request";

type AgentsPageWorkspaceProps = {
  hasSelectedTask: boolean;
  chatContent: ReactElement;
  isRightPanelVisible: boolean;
  rightPanelContent: ReactNode;
};

function AgentsPageWorkspace({
  hasSelectedTask,
  chatContent,
  isRightPanelVisible,
  rightPanelContent,
}: AgentsPageWorkspaceProps): ReactElement {
  if (!hasSelectedTask) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center border border-dashed border-input bg-card text-sm text-muted-foreground">
        Open a task tab to start a workspace.
      </div>
    );
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full min-h-0 overflow-hidden">
      <ResizablePanel defaultSize={63} minSize={35}>
        {chatContent}
      </ResizablePanel>
      {isRightPanelVisible ? (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={37} minSize={30}>
            {rightPanelContent}
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  );
}

type AgentsPageModalContentProps = {
  gitConflictResolutionModal: ReactNode;
  humanReviewFeedbackModal: ReactNode;
  sessionStartModal: ReactNode;
  taskDetailsSheet: ReactElement;
};

function AgentsPageModalContent({
  gitConflictResolutionModal,
  humanReviewFeedbackModal,
  sessionStartModal,
  taskDetailsSheet,
}: AgentsPageModalContentProps): ReactElement {
  return (
    <>
      {gitConflictResolutionModal}
      {humanReviewFeedbackModal}
      {sessionStartModal}
      {taskDetailsSheet}
    </>
  );
}

type AgentsPageContentProps = {
  activeRepo: string | null;
  navigationPersistenceError: Error | null;
  chatSettingsLoadError: Error | null;
  activeTabValue: string;
  onRetryNavigationPersistence: () => void;
  onRetryChatSettingsLoad: () => void;
  onTabValueChange: (value: string) => void;
  taskTabsModel: ComponentProps<typeof AgentStudioTaskTabs>["model"];
  rightPanelToggleModel: ComponentProps<typeof AgentStudioTaskTabs>["rightPanelToggleModel"];
  hasSelectedTask: boolean;
  chatHeaderModel: ComponentProps<typeof AgentStudioHeader>["model"];
  chatModel: ComponentProps<typeof AgentChat>["model"];
  isRightPanelVisible: boolean;
  rightPanelModel: ComponentProps<typeof AgentStudioRightPanel>["model"] | null;
  gitConflictResolutionModal: ReactNode;
  humanReviewFeedbackModal: ReactNode;
  sessionStartModal: ReactNode;
  taskDetailsSheet: ReactElement;
};

function AgentsPageContent({
  activeRepo,
  navigationPersistenceError,
  chatSettingsLoadError,
  activeTabValue,
  onRetryNavigationPersistence,
  onRetryChatSettingsLoad,
  onTabValueChange,
  taskTabsModel,
  rightPanelToggleModel,
  hasSelectedTask,
  chatHeaderModel,
  chatModel,
  isRightPanelVisible,
  rightPanelModel,
  gitConflictResolutionModal,
  humanReviewFeedbackModal,
  sessionStartModal,
  taskDetailsSheet,
}: AgentsPageContentProps): ReactElement {
  return (
    <AgentsPageShell
      activeRepo={activeRepo}
      navigationPersistenceError={navigationPersistenceError}
      chatSettingsLoadError={chatSettingsLoadError}
      activeTabValue={activeTabValue}
      onRetryNavigationPersistence={onRetryNavigationPersistence}
      onRetryChatSettingsLoad={onRetryChatSettingsLoad}
      onTabValueChange={onTabValueChange}
      taskTabs={
        <AgentStudioTaskTabs
          model={taskTabsModel}
          {...(rightPanelToggleModel !== undefined ? { rightPanelToggleModel } : {})}
        />
      }
      workspace={
        <AgentsPageWorkspace
          hasSelectedTask={hasSelectedTask}
          chatContent={
            <AgentChat header={<AgentStudioHeader model={chatHeaderModel} />} model={chatModel} />
          }
          isRightPanelVisible={isRightPanelVisible}
          rightPanelContent={
            rightPanelModel ? <AgentStudioRightPanel model={rightPanelModel} /> : null
          }
        />
      }
      modalContent={
        <AgentsPageModalContent
          gitConflictResolutionModal={gitConflictResolutionModal}
          humanReviewFeedbackModal={humanReviewFeedbackModal}
          sessionStartModal={sessionStartModal}
          taskDetailsSheet={taskDetailsSheet}
        />
      }
    />
  );
}

type UseRunCompletionRecoverySignalArgs = {
  activeSession: AgentStudioOrchestrationSelectionContext["viewActiveSession"];
  runCompletionSignal: ReturnType<typeof useDelegationEventsContext>["runCompletionSignal"];
};

function useRunCompletionRecoverySignal({
  activeSession,
  runCompletionSignal,
}: UseRunCompletionRecoverySignalArgs): number {
  const [runCompletionRecoverySignal, setRunCompletionRecoverySignal] = useState(0);
  const latestRunCompletionSignalVersionRef = useRef<number | null>(null);

  useEffect(() => {
    const activeBuildRunId = activeSession?.role === "build" ? activeSession.runId : null;

    if (!runCompletionSignal || !activeBuildRunId) {
      return;
    }

    if (runCompletionSignal.runId !== activeBuildRunId) {
      return;
    }

    if (runCompletionSignal.version === latestRunCompletionSignalVersionRef.current) {
      return;
    }

    latestRunCompletionSignalVersionRef.current = runCompletionSignal.version;
    setRunCompletionRecoverySignal((current) => current + 1);
  }, [activeSession, runCompletionSignal]);

  return runCompletionRecoverySignal;
}

type UseAgentStudioReadinessArgs = {
  activeRepo: string | null;
  runtimeDefinitions: ReturnType<typeof useRuntimeDefinitionsContext>["runtimeDefinitions"];
  isLoadingRuntimeDefinitions: ReturnType<
    typeof useRuntimeDefinitionsContext
  >["isLoadingRuntimeDefinitions"];
  runtimeDefinitionsError: ReturnType<
    typeof useRuntimeDefinitionsContext
  >["runtimeDefinitionsError"];
  runtimeHealthByRuntime: ReturnType<typeof useChecksState>["runtimeHealthByRuntime"];
  isLoadingChecks: boolean;
};

function useAgentStudioReadiness({
  activeRepo,
  runtimeDefinitions,
  isLoadingRuntimeDefinitions,
  runtimeDefinitionsError,
  runtimeHealthByRuntime,
  isLoadingChecks,
}: UseAgentStudioReadinessArgs) {
  const healthyRuntimeDefinition = useMemo(
    () =>
      runtimeDefinitions.find((definition) => {
        const runtimeHealth = runtimeHealthByRuntime[definition.kind];
        return Boolean(
          runtimeHealth?.runtimeOk &&
            (!definition.capabilities.supportsMcpStatus || runtimeHealth.mcpOk),
        );
      }) ?? null,
    [runtimeDefinitions, runtimeHealthByRuntime],
  );
  const blockedRuntimeDefinition = useMemo(
    () =>
      runtimeDefinitions.find((definition) => {
        const runtimeHealth = runtimeHealthByRuntime[definition.kind];
        return Boolean(
          runtimeHealth &&
            (!runtimeHealth.runtimeOk ||
              (definition.capabilities.supportsMcpStatus && !runtimeHealth.mcpOk)),
        );
      }) ?? null,
    [runtimeDefinitions, runtimeHealthByRuntime],
  );
  const blockedRuntimeHealth = blockedRuntimeDefinition
    ? (runtimeHealthByRuntime[blockedRuntimeDefinition.kind] ?? null)
    : null;

  const agentStudioReady = Boolean(activeRepo && healthyRuntimeDefinition);
  const agentStudioBlockedReason = (() => {
    if (agentStudioReady) {
      return null;
    }
    if (!activeRepo) {
      return "Select a repository to use Agent Studio.";
    }
    if (runtimeDefinitionsError) {
      return runtimeDefinitionsError;
    }
    if (isLoadingRuntimeDefinitions) {
      return "Loading runtime definitions...";
    }
    if (isLoadingChecks) {
      return "Checking runtime and OpenDucktor MCP health...";
    }

    return (
      blockedRuntimeHealth?.runtimeError ??
      blockedRuntimeHealth?.mcpError ??
      (runtimeDefinitions.length === 0
        ? "No agent runtimes are available."
        : "No configured runtime is ready for Agent Studio.")
    );
  })();

  return {
    agentStudioReady,
    agentStudioBlockedReason,
  };
}

type UseAgentsPageRightPanelModelArgs = {
  activeRepo: string | null;
  activeBranch: ReturnType<typeof useWorkspaceState>["activeBranch"];
  viewRole: AgentStudioOrchestrationSelectionContext["viewRole"];
  viewActiveSession: AgentStudioOrchestrationSelectionContext["viewActiveSession"];
  viewSelectedTask: AgentStudioOrchestrationSelectionContext["viewSelectedTask"];
  panelKind: Parameters<typeof buildAgentStudioRightPanelModel>[0]["panelKind"];
  isPanelOpen: boolean;
  documentsModel: Parameters<typeof buildAgentStudioRightPanelModel>[0]["documentsModel"];
  repoSettings: ReturnType<typeof useAgentStudioOrchestrationController>["repoSettings"];
  runCompletionRecoverySignal: number;
  runs: ReturnType<typeof useTasksState>["runs"];
  detectingPullRequestTaskId: string | null;
  onDetectPullRequest: (taskId: string) => void;
  onResolveGitConflict: Parameters<typeof useAgentStudioGitActions>[0]["onResolveGitConflict"];
};

function useAgentsPageRightPanelModel({
  activeRepo,
  activeBranch,
  viewRole,
  viewActiveSession,
  viewSelectedTask,
  panelKind,
  isPanelOpen,
  documentsModel,
  repoSettings,
  runCompletionRecoverySignal,
  runs,
  detectingPullRequestTaskId,
  onDetectPullRequest,
  onResolveGitConflict,
}: UseAgentsPageRightPanelModelArgs) {
  const gitPanelContextMode: "repository" | "worktree" =
    viewActiveSession?.role === "build" ? "worktree" : "repository";
  const repositoryBranchIdentityKey =
    gitPanelContextMode === "repository"
      ? buildAgentStudioGitPanelBranchIdentityKey(activeBranch)
      : null;
  const diffComparisonTarget =
    gitPanelContextMode === "repository"
      ? { branch: UPSTREAM_TARGET_BRANCH }
      : (repoSettings?.defaultTargetBranch ?? normalizeTargetBranch(null));
  const shouldLoadVisibleDiffPanel = viewRole === "build" && panelKind === "diff" && isPanelOpen;
  const diffData = useAgentStudioDiffData({
    repoPath: shouldLoadVisibleDiffPanel ? activeRepo : null,
    sessionWorkingDirectory: shouldLoadVisibleDiffPanel
      ? (viewActiveSession?.workingDirectory ?? null)
      : null,
    sessionRunId: shouldLoadVisibleDiffPanel ? (viewActiveSession?.runId ?? null) : null,
    runCompletionRecoverySignal,
    defaultTargetBranch: diffComparisonTarget,
    branchIdentityKey: repositoryBranchIdentityKey,
    enablePolling: shouldLoadVisibleDiffPanel && Boolean(viewActiveSession),
  });
  const resolvedGitPanelBranch = resolveAgentStudioGitPanelBranch({
    contextMode: gitPanelContextMode,
    workspaceActiveBranch: activeBranch,
    diffBranch: diffData.branch,
  });

  useAgentStudioBuildWorktreeRefresh({
    viewRole,
    activeSession: viewActiveSession,
    refreshWorktree: diffData.refresh,
  });

  const isActiveBuilderWorking =
    viewActiveSession?.role === "build" &&
    (viewActiveSession.status === "running" || viewActiveSession.status === "starting");
  const gitActions = useAgentStudioGitActions({
    repoPath: activeRepo,
    workingDir: diffData.worktreePath,
    branch: resolvedGitPanelBranch,
    targetBranch: diffData.targetBranch,
    upstreamAheadBehind: diffData.upstreamAheadBehind ?? null,
    detectedConflictedFiles: diffData.fileStatuses
      .filter((status) => status.status === "unmerged")
      .map((status) => status.path),
    worktreeStatusSnapshotKey: diffData.statusSnapshotKey ?? null,
    refreshDiffData: diffData.refresh,
    isBuilderSessionWorking: isActiveBuilderWorking,
    ...(onResolveGitConflict ? { onResolveGitConflict } : {}),
  });
  const diffModel = useMemo(
    () => ({
      ...diffData,
      contextMode: gitPanelContextMode,
      branch: resolvedGitPanelBranch,
      pullRequest: viewSelectedTask?.pullRequest ?? null,
      ...(viewSelectedTask && detectingPullRequestTaskId === viewSelectedTask.id
        ? { isDetectingPullRequest: true }
        : {}),
      ...(viewSelectedTask &&
      !viewSelectedTask.pullRequest &&
      canDetectTaskPullRequest(viewSelectedTask, runs)
        ? {
            onDetectPullRequest: () => onDetectPullRequest(viewSelectedTask.id),
          }
        : {}),
      ...gitActions,
    }),
    [
      diffData,
      gitActions,
      gitPanelContextMode,
      onDetectPullRequest,
      detectingPullRequestTaskId,
      resolvedGitPanelBranch,
      runs,
      viewSelectedTask,
    ],
  );

  return {
    isRightPanelVisible: Boolean(panelKind && isPanelOpen),
    rightPanelModel: buildAgentStudioRightPanelModel({
      panelKind,
      documentsModel,
      diffModel,
    }),
  };
}

type BuildAgentsPageOrchestrationContextsArgs = {
  activeRepo: string | null;
  viewTaskId: AgentStudioOrchestrationSelectionContext["viewTaskId"];
  viewRole: AgentStudioOrchestrationSelectionContext["viewRole"];
  viewScenario: AgentStudioOrchestrationSelectionContext["viewScenario"];
  viewSelectedTask: AgentStudioOrchestrationSelectionContext["viewSelectedTask"];
  viewSessionsForTask: AgentStudioOrchestrationSelectionContext["viewSessionsForTask"];
  viewActiveSession: AgentStudioOrchestrationSelectionContext["viewActiveSession"];
  activeTaskTabId: AgentStudioOrchestrationSelectionContext["activeTaskTabId"];
  taskTabs: AgentStudioOrchestrationSelectionContext["taskTabs"];
  availableTabTasks: AgentStudioOrchestrationSelectionContext["availableTabTasks"];
  contextSwitchVersion: AgentStudioOrchestrationSelectionContext["contextSwitchVersion"];
  isLoadingTasks: AgentStudioOrchestrationSelectionContext["isLoadingTasks"];
  isActiveTaskHydrated: AgentStudioOrchestrationSelectionContext["isActiveTaskHydrated"];
  isActiveTaskHydrationFailed: AgentStudioOrchestrationSelectionContext["isActiveTaskHydrationFailed"];
  isViewSessionHistoryHydrationFailed: AgentStudioOrchestrationSelectionContext["isViewSessionHistoryHydrationFailed"];
  isViewSessionHistoryHydrating: AgentStudioOrchestrationSelectionContext["isViewSessionHistoryHydrating"];
  onCreateTab: AgentStudioOrchestrationSelectionContext["onCreateTab"];
  onCloseTab: AgentStudioOrchestrationSelectionContext["onCloseTab"];
  agentStudioReady: AgentStudioOrchestrationReadinessContext["agentStudioReady"];
  agentStudioBlockedReason: AgentStudioOrchestrationReadinessContext["agentStudioBlockedReason"];
  isLoadingChecks: AgentStudioOrchestrationReadinessContext["isLoadingChecks"];
  refreshChecks: AgentStudioOrchestrationReadinessContext["refreshChecks"];
  input: AgentStudioOrchestrationComposerContext["input"];
  setInput: AgentStudioOrchestrationComposerContext["setInput"];
  updateQuery: AgentStudioOrchestrationActionsContext["updateQuery"];
  onContextSwitchIntent: AgentStudioOrchestrationActionsContext["onContextSwitchIntent"];
  startAgentSession: AgentStudioOrchestrationActionsContext["startAgentSession"];
  sendAgentMessage: AgentStudioOrchestrationActionsContext["sendAgentMessage"];
  stopAgentSession: AgentStudioOrchestrationActionsContext["stopAgentSession"];
  updateAgentSessionModel: AgentStudioOrchestrationActionsContext["updateAgentSessionModel"];
  loadAgentSessions: AgentStudioOrchestrationActionsContext["loadAgentSessions"];
  humanRequestChangesTask: AgentStudioOrchestrationActionsContext["humanRequestChangesTask"];
  replyAgentPermission: AgentStudioOrchestrationActionsContext["replyAgentPermission"];
  answerAgentQuestion: AgentStudioOrchestrationActionsContext["answerAgentQuestion"];
  requestNewSessionStart: AgentStudioOrchestrationActionsContext["requestNewSessionStart"];
  openTaskDetails: AgentStudioOrchestrationActionsContext["openTaskDetails"];
};

function buildAgentsPageOrchestrationContexts({
  activeRepo,
  viewTaskId,
  viewRole,
  viewScenario,
  viewSelectedTask,
  viewSessionsForTask,
  viewActiveSession,
  activeTaskTabId,
  taskTabs,
  availableTabTasks,
  contextSwitchVersion,
  isLoadingTasks,
  isActiveTaskHydrated,
  isActiveTaskHydrationFailed,
  isViewSessionHistoryHydrationFailed,
  isViewSessionHistoryHydrating,
  onCreateTab,
  onCloseTab,
  agentStudioReady,
  agentStudioBlockedReason,
  isLoadingChecks,
  refreshChecks,
  input,
  setInput,
  updateQuery,
  onContextSwitchIntent,
  startAgentSession,
  sendAgentMessage,
  stopAgentSession,
  updateAgentSessionModel,
  loadAgentSessions,
  humanRequestChangesTask,
  replyAgentPermission,
  answerAgentQuestion,
  requestNewSessionStart,
  openTaskDetails,
}: BuildAgentsPageOrchestrationContextsArgs) {
  return {
    workspace: {
      activeRepo,
    } satisfies AgentStudioOrchestrationWorkspaceContext,
    selection: {
      viewTaskId,
      viewRole,
      viewScenario,
      viewSelectedTask,
      viewSessionsForTask,
      viewActiveSession,
      activeTaskTabId,
      taskTabs,
      availableTabTasks,
      contextSwitchVersion,
      isLoadingTasks,
      isActiveTaskHydrated,
      isActiveTaskHydrationFailed,
      isViewSessionHistoryHydrationFailed,
      isViewSessionHistoryHydrating,
      onCreateTab,
      onCloseTab,
    } satisfies AgentStudioOrchestrationSelectionContext,
    readiness: {
      agentStudioReady,
      agentStudioBlockedReason,
      isLoadingChecks,
      refreshChecks,
    } satisfies AgentStudioOrchestrationReadinessContext,
    composer: {
      input,
      setInput,
    } satisfies AgentStudioOrchestrationComposerContext,
    actions: {
      updateQuery,
      onContextSwitchIntent,
      startAgentSession,
      sendAgentMessage,
      stopAgentSession,
      updateAgentSessionModel,
      loadAgentSessions,
      humanRequestChangesTask,
      replyAgentPermission,
      answerAgentQuestion,
      ...(requestNewSessionStart ? { requestNewSessionStart } : {}),
      openTaskDetails,
    } satisfies AgentStudioOrchestrationActionsContext,
  };
}

export function AgentsPage(): ReactElement {
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

  const { agentStudioReady, agentStudioBlockedReason } = useAgentStudioReadiness({
    activeRepo,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeHealthByRuntime,
    isLoadingChecks,
  });

  const orchestration = useAgentStudioOrchestrationController(
    buildAgentsPageOrchestrationContexts({
      activeRepo,
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
      agentStudioReady,
      agentStudioBlockedReason,
      isLoadingChecks,
      refreshChecks,
      input,
      setInput,
      updateQuery: scheduleQueryUpdate,
      onContextSwitchIntent: signalContextSwitchIntent,
      startAgentSession,
      sendAgentMessage,
      stopAgentSession,
      updateAgentSessionModel,
      loadAgentSessions,
      humanRequestChangesTask,
      replyAgentPermission,
      answerAgentQuestion,
      requestNewSessionStart,
      openTaskDetails,
    }),
  );

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
  return (
    <DiffWorkerProvider>
      <AgentsPageContent
        activeRepo={activeRepo}
        navigationPersistenceError={navigationPersistenceError}
        chatSettingsLoadError={orchestration.chatSettingsLoadError}
        activeTabValue={orchestration.activeTabValue}
        onRetryNavigationPersistence={retryNavigationPersistence}
        onRetryChatSettingsLoad={orchestration.retryChatSettingsLoad}
        onTabValueChange={selection.handleSelectTab}
        taskTabsModel={orchestration.agentStudioTaskTabsModel}
        rightPanelToggleModel={orchestration.rightPanel.rightPanelToggleModel}
        hasSelectedTask={Boolean(selection.viewTaskId)}
        chatHeaderModel={orchestration.agentStudioHeaderModel}
        chatModel={orchestration.agentChatModel}
        isRightPanelVisible={isRightPanelVisible}
        rightPanelModel={rightPanelModel}
        gitConflictResolutionModal={gitConflictResolutionModal}
        humanReviewFeedbackModal={humanReviewFeedbackModal}
        sessionStartModal={sessionStartModal}
        taskDetailsSheet={taskDetailsSheet}
      />
    </DiffWorkerProvider>
  );
}
