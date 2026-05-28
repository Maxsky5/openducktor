import { useCallback, useRef, useState } from "react";
import {
  useChecksOperationsContext,
  useRuntimeAvailabilityContext,
} from "@/state/app-state-contexts";
import {
  useAgentOperations,
  useAgentSessionSummaries,
  useChecksState,
  useTasksState,
  useWorkspaceState,
} from "@/state/app-state-provider";
import type { useAgentStudioOrchestrationController } from "../use-agent-studio-orchestration-controller";
import type { AgentStudioGitConflictQuickActionContext } from "../use-agents-page-right-panel-model";
import { gitConflictQuickActionContextsEqual } from "./git-conflict-quick-action-context";
import {
  type AgentStudioPullRequestModalModel,
  useAgentStudioPullRequestModalModel,
} from "./use-agent-studio-pull-request-modal-model";
import {
  type AgentStudioRightPanelBridgeModel,
  useAgentStudioRightPanelBridge,
} from "./use-agent-studio-right-panel-bridge";
import {
  type AgentStudioTaskDetailsLauncherModel,
  useAgentStudioTaskDetailsLauncher,
} from "./use-agent-studio-task-details-launcher";
import { useAgentsPageOrchestrationShellModel } from "./use-agents-page-orchestration-shell-model";
import { useAgentsPageRouteSessionModel } from "./use-agents-page-route-session-model";

type AgentsPageShellModel = {
  activeWorkspace: ReturnType<typeof useWorkspaceState>["activeWorkspace"];
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
  rightPanelBridge: AgentStudioRightPanelBridgeModel | null;
  mergedPullRequestModal: AgentStudioPullRequestModalModel | null;
  humanReviewFeedbackModal: ReturnType<
    typeof useAgentStudioOrchestrationController
  >["humanReviewFeedbackModal"];
  sessionStartModal: ReturnType<typeof useAgentStudioOrchestrationController>["sessionStartModal"];
  taskDetailsLauncher: AgentStudioTaskDetailsLauncherModel;
};

export function useAgentsPageShellModel(): AgentsPageShellModel {
  const { activeBranch, branches, activeWorkspace } = useWorkspaceState();
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const {
    availableRuntimeDefinitions: runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
  } = useRuntimeAvailabilityContext();
  const { refreshRepoRuntimeHealthForRepo, hasCachedRepoRuntimeHealth } =
    useChecksOperationsContext();
  const { runtimeHealthByRuntime, isLoadingChecks, refreshChecks } = useChecksState();
  const {
    isForegroundLoadingTasks,
    tasks,
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
    ensureSessionReadyForView,
    readSessionFileSearch,
    readSessionModelCatalog,
    readSessionSlashCommands,
    readSessionSkills,
    readSessionTodos,
    startAgentSession,
    settleStartedAgentSession,
    sendAgentMessage,
    stopAgentSession,
    updateAgentSessionModel,
    replyAgentApproval,
    answerAgentQuestion,
  } = useAgentOperations();
  const sessions = useAgentSessionSummaries();

  const [gitConflictQuickActionContext, setGitConflictQuickActionContext] =
    useState<AgentStudioGitConflictQuickActionContext | null>(null);
  const gitConflictQuickActionContextRef = useRef<AgentStudioGitConflictQuickActionContext | null>(
    null,
  );
  const routeSession = useAgentsPageRouteSessionModel({
    activeWorkspace,
    workspaceRepoPath,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeHealthByRuntime,
    isLoadingChecks,
    refreshChecks,
    refreshRepoRuntimeHealthForRepo,
    hasCachedRepoRuntimeHealth,
    tasks,
    isForegroundLoadingTasks,
    sessions,
    hydrateRequestedTaskSessionHistory,
    ensureSessionReadyForView,
    readSessionModelCatalog,
    readSessionTodos,
  });
  const {
    navigationPersistenceError,
    retryNavigationPersistence,
    selection,
    worktreeRecoverySignal,
  } = routeSession;

  const handleGitConflictQuickActionContextChange = useCallback(
    (context: AgentStudioGitConflictQuickActionContext | null): void => {
      gitConflictQuickActionContextRef.current = context;
      setGitConflictQuickActionContext((current) =>
        gitConflictQuickActionContextsEqual(current, context) ? current : context,
      );
    },
    [],
  );

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

  const taskDetailsLauncher = useAgentStudioTaskDetailsLauncher({
    activeWorkspace,
    tasks,
    selectedTaskId: selection.viewSelectedTask?.id ?? null,
    detectingPullRequestTaskId,
    unlinkingPullRequestTaskId,
    onDetectPullRequest: handleDetectPullRequest,
    onUnlinkPullRequest: handleUnlinkPullRequest,
  });

  const mergedPullRequestModal = useAgentStudioPullRequestModalModel({
    pendingMergedPullRequest,
    linkingMergedPullRequestTaskId,
    onLinkMergedPullRequest: handleLinkMergedPullRequest,
    onCancelLinkMergedPullRequest: handleCancelLinkMergedPullRequest,
  });

  const {
    orchestration,
    orchestrationSelection,
    handleResolveRebaseConflict,
    agentStudioHeaderModel,
  } = useAgentsPageOrchestrationShellModel({
    activeWorkspace,
    branches: branches ?? [],
    runtimeDefinitions,
    isForegroundLoadingTasks,
    routeSession,
    hasActiveGitConflict: gitConflictQuickActionContext !== null,
    gitConflictQuickActionContext,
    gitConflictQuickActionContextRef,
    openTaskDetails: taskDetailsLauncher.openTaskDetails,
    agentOperations: {
      bootstrapTaskSessions,
      hydrateRequestedTaskSessionHistory,
      readSessionFileSearch,
      readSessionSlashCommands,
      ...(readSessionSkills ? { readSessionSkills } : {}),
      startAgentSession,
      settleStartedAgentSession,
      sendAgentMessage,
      stopAgentSession,
      updateAgentSessionModel,
      replyAgentApproval,
      answerAgentQuestion,
    },
    humanRequestChangesTask,
    setTaskTargetBranch,
  });

  const { isRightPanelVisible, rightPanelBridge } = useAgentStudioRightPanelBridge({
    activeWorkspace,
    branches: branches ?? [],
    activeBranch,
    selection: orchestrationSelection,
    orchestration,
    worktreeRecoverySignal,
    setTaskTargetBranch,
    detectingPullRequestTaskId,
    onDetectPullRequest: handleDetectPullRequest,
    onResolveGitConflict: handleResolveRebaseConflict,
    onGitConflictQuickActionContextChange: handleGitConflictQuickActionContextChange,
  });

  return {
    activeWorkspace,
    navigationPersistenceError,
    chatSettingsLoadError: orchestration.chatSettingsLoadError,
    activeTabValue: orchestration.activeTabValue,
    onRetryNavigationPersistence: retryNavigationPersistence,
    onRetryChatSettingsLoad: orchestration.retryChatSettingsLoad,
    onTabValueChange: selection.handleSelectTab,
    taskTabsModel: orchestration.agentStudioTaskTabsModel,
    rightPanelToggleModel: orchestration.rightPanel.rightPanelToggleModel,
    hasSelectedTask: Boolean(selection.viewTaskId),
    chatHeaderModel: agentStudioHeaderModel,
    chatModel: orchestration.agentChatModel,
    isRightPanelVisible,
    rightPanelBridge,
    mergedPullRequestModal,
    humanReviewFeedbackModal: orchestration.humanReviewFeedbackModal,
    sessionStartModal: orchestration.sessionStartModal,
    taskDetailsLauncher,
  };
}
