import {
  type ReactElement,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  AgentChat,
  AgentStudioHeader,
  AgentStudioRightPanel,
  AgentStudioTaskTabs,
} from "@/components/features/agents";
import {
  TaskDetailsSheetController,
  type TaskDetailsSheetControllerHandle,
} from "@/components/features/task-details";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { DiffWorkerProvider } from "@/contexts/DiffWorkerProvider";
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
import { useAgentStudioDiffData } from "./use-agent-studio-diff-data";
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

export function AgentsPage(): ReactElement {
  const { activeRepo, activeBranch, loadRepoSettings, loadSettingsSnapshot } = useWorkspaceState();
  const { runtimeDefinitions, isLoadingRuntimeDefinitions, runtimeDefinitionsError } =
    useRuntimeDefinitionsContext();
  const { runtimeHealthByRuntime, isLoadingChecks, refreshChecks } = useChecksState();
  const {
    isLoadingTasks,
    tasks,
    runs,
    syncPullRequests,
    unlinkPullRequest,
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
  const [runCompletionRecoverySignal, setRunCompletionRecoverySignal] = useState(0);
  const latestRunCompletionSignalVersionRef = useRef<number | null>(null);
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
    updateQuery,
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
      void syncPullRequests(taskId).catch(() => undefined);
    },
    [syncPullRequests],
  );
  const handleUnlinkPullRequest = useCallback(
    (taskId: string): void => {
      void unlinkPullRequest(taskId).catch(() => undefined);
    },
    [unlinkPullRequest],
  );

  useEffect(() => {
    const activeBuildRunId =
      selection.viewActiveSession?.role === "build" ? selection.viewActiveSession.runId : null;

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
  }, [runCompletionSignal, selection.viewActiveSession?.runId, selection.viewActiveSession?.role]);

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
  const agentStudioBlockedReason = !activeRepo
    ? "Select a repository to use Agent Studio."
    : runtimeDefinitionsError
      ? runtimeDefinitionsError
      : isLoadingRuntimeDefinitions
        ? "Loading runtime definitions..."
        : isLoadingChecks
          ? "Checking runtime and OpenDucktor MCP health..."
          : (blockedRuntimeHealth?.runtimeError ??
            blockedRuntimeHealth?.mcpError ??
            (runtimeDefinitions.length === 0
              ? "No agent runtimes are available."
              : "No configured runtime is ready for Agent Studio."));

  const orchestrationWorkspace = {
    activeRepo,
    loadSettingsSnapshot,
    loadRepoSettings,
  } satisfies AgentStudioOrchestrationWorkspaceContext;

  const orchestrationSelection = {
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
    isViewSessionHistoryHydrating: selection.isViewSessionHistoryHydrating,
    onCreateTab: selection.handleCreateTab,
    onCloseTab: selection.handleCloseTab,
  } satisfies AgentStudioOrchestrationSelectionContext;

  const orchestrationReadiness = {
    agentStudioReady,
    agentStudioBlockedReason,
    isLoadingChecks,
    refreshChecks,
  } satisfies AgentStudioOrchestrationReadinessContext;

  const orchestrationComposer = {
    input,
    setInput,
  } satisfies AgentStudioOrchestrationComposerContext;

  const orchestrationActions = {
    updateQuery,
    onContextSwitchIntent: signalContextSwitchIntent,
    startAgentSession,
    sendAgentMessage,
    stopAgentSession,
    updateAgentSessionModel,
    replyAgentPermission,
    answerAgentQuestion,
    requestNewSessionStart,
    openTaskDetails,
  } satisfies AgentStudioOrchestrationActionsContext;

  const orchestration = useAgentStudioOrchestrationController({
    workspace: orchestrationWorkspace,
    selection: orchestrationSelection,
    readiness: orchestrationReadiness,
    composer: orchestrationComposer,
    actions: orchestrationActions,
  });

  const gitPanelContextMode: "repository" | "worktree" =
    selection.viewActiveSession?.role === "build" ? "worktree" : "repository";
  const repositoryBranchIdentityKey =
    gitPanelContextMode === "repository"
      ? buildAgentStudioGitPanelBranchIdentityKey(activeBranch)
      : null;
  const diffComparisonTarget =
    gitPanelContextMode === "repository"
      ? { branch: UPSTREAM_TARGET_BRANCH }
      : (orchestration.repoSettings?.defaultTargetBranch ?? normalizeTargetBranch(null));

  const diffData = useAgentStudioDiffData({
    repoPath: activeRepo,
    sessionWorkingDirectory: selection.viewActiveSession?.workingDirectory ?? null,
    sessionRunId: selection.viewActiveSession?.runId ?? null,
    runCompletionRecoverySignal,
    defaultTargetBranch: diffComparisonTarget,
    branchIdentityKey: repositoryBranchIdentityKey,
    enablePolling:
      selection.viewRole === "build" &&
      Boolean(selection.viewActiveSession) &&
      orchestration.rightPanel.isPanelOpen,
  });
  const resolvedGitPanelBranch = resolveAgentStudioGitPanelBranch({
    contextMode: gitPanelContextMode,
    workspaceActiveBranch: activeBranch,
    diffBranch: diffData.branch,
  });
  useAgentStudioBuildWorktreeRefresh({
    viewRole: selection.viewRole,
    activeSession: selection.viewActiveSession,
    refreshWorktree: diffData.refresh,
  });
  const isActiveBuilderWorking =
    selection.viewActiveSession?.role === "build" &&
    (selection.viewActiveSession.status === "running" ||
      selection.viewActiveSession.status === "starting");
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
    onResolveRebaseConflict: handleResolveRebaseConflict,
  });
  const selectedTask = selection.viewSelectedTask;
  const diffModel = useMemo(
    () => ({
      ...diffData,
      contextMode: gitPanelContextMode,
      branch: resolvedGitPanelBranch,
      pullRequest: selectedTask?.pullRequest ?? null,
      ...(selectedTask && detectingPullRequestTaskId === selectedTask.id
        ? { isDetectingPullRequest: true }
        : {}),
      ...(selectedTask && !selectedTask.pullRequest && canDetectTaskPullRequest(selectedTask, runs)
        ? {
            onDetectPullRequest: () => handleDetectPullRequest(selectedTask.id),
          }
        : {}),
      ...gitActions,
    }),
    [
      diffData,
      gitActions,
      gitPanelContextMode,
      handleDetectPullRequest,
      detectingPullRequestTaskId,
      resolvedGitPanelBranch,
      runs,
      selectedTask,
    ],
  );
  const rightPanelModel = useMemo(
    () =>
      buildAgentStudioRightPanelModel({
        panelKind: orchestration.rightPanel.panelKind,
        documentsModel: orchestration.agentStudioWorkspaceSidebarModel,
        diffModel,
      }),
    [diffModel, orchestration.agentStudioWorkspaceSidebarModel, orchestration.rightPanel.panelKind],
  );
  const content = (
    <AgentsPageShell
      activeRepo={activeRepo}
      navigationPersistenceError={navigationPersistenceError}
      chatSettingsLoadError={orchestration.chatSettingsLoadError}
      activeTabValue={orchestration.activeTabValue}
      onRetryNavigationPersistence={retryNavigationPersistence}
      onRetryChatSettingsLoad={orchestration.retryChatSettingsLoad}
      onTabValueChange={selection.handleSelectTab}
      taskTabs={
        <AgentStudioTaskTabs
          model={orchestration.agentStudioTaskTabsModel}
          rightPanelToggleModel={orchestration.rightPanel.rightPanelToggleModel}
        />
      }
      workspace={
        selection.viewTaskId ? (
          <ResizablePanelGroup direction="horizontal" className="h-full min-h-0 overflow-hidden">
            <ResizablePanel defaultSize={63} minSize={35}>
              <AgentChat
                header={<AgentStudioHeader model={orchestration.agentStudioHeaderModel} />}
                model={orchestration.agentChatModel}
              />
            </ResizablePanel>
            {orchestration.rightPanel.panelKind && orchestration.rightPanel.isPanelOpen ? (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={37} minSize={30}>
                  {rightPanelModel ? <AgentStudioRightPanel model={rightPanelModel} /> : null}
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        ) : (
          <div className="flex h-full min-h-0 items-center justify-center border border-dashed border-input bg-card text-sm text-muted-foreground">
            Open a task tab to start a workspace.
          </div>
        )
      }
      modalContent={
        <>
          {pendingRebaseConflictResolutionRequest ? (
            <RebaseConflictResolutionModal
              key={pendingRebaseConflictResolutionRequest.requestId}
              request={pendingRebaseConflictResolutionRequest}
              onResolve={resolvePendingRebaseConflictResolution}
            />
          ) : null}
          {pendingSessionStartRequest ? (
            <AgentStudioSessionStartModalBridge
              key={pendingSessionStartRequest.requestId}
              request={pendingSessionStartRequest}
              activeRepo={activeRepo}
              repoSettings={orchestration.repoSettings}
              onResolve={resolvePendingSessionStart}
            />
          ) : null}
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
        </>
      }
    />
  );

  return <DiffWorkerProvider>{content}</DiffWorkerProvider>;
}
