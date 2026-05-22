import { type ReactElement, useCallback, useRef, useState } from "react";
import { SessionStartModal } from "@/components/features/agents";
import { HumanReviewFeedbackModal } from "@/features/human-review-feedback/human-review-feedback-modal";
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
import { useAgentsPageOrchestrationShellModel } from "./use-agents-page-orchestration-shell-model";
import { useAgentsPageRightPanelShellModel } from "./use-agents-page-right-panel-shell-model";
import { useAgentsPageRouteSessionModel } from "./use-agents-page-route-session-model";
import { useAgentsPageShellOverlays } from "./use-agents-page-shell-overlays";

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
  rightPanelContent: ReactElement | null;
  mergedPullRequestModal: ReactElement | null;
  humanReviewFeedbackModal: ReactElement;
  sessionStartModal: ReactElement | null;
  taskDetailsSheet: ReactElement;
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
  const agentOperations = useAgentOperations();
  const {
    hydrateRequestedTaskSessionHistory,
    ensureSessionReadyForView,
    readSessionModelCatalog,
    readSessionTodos,
  } = agentOperations;
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

  const { openTaskDetails, mergedPullRequestModal, taskDetailsSheet } = useAgentsPageShellOverlays({
    activeWorkspace,
    tasks,
    selectedTaskId: selection.viewSelectedTask?.id ?? null,
    pendingMergedPullRequest,
    linkingMergedPullRequestTaskId,
    detectingPullRequestTaskId,
    unlinkingPullRequestTaskId,
    onDetectPullRequest: handleDetectPullRequest,
    onUnlinkPullRequest: handleUnlinkPullRequest,
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
    branches,
    runtimeDefinitions,
    isForegroundLoadingTasks,
    routeSession,
    hasActiveGitConflict: gitConflictQuickActionContext !== null,
    gitConflictQuickActionContext,
    gitConflictQuickActionContextRef,
    openTaskDetails,
    agentOperations,
    humanRequestChangesTask,
    setTaskTargetBranch,
  });

  const { isRightPanelVisible, rightPanelContent } = useAgentsPageRightPanelShellModel({
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

  const sessionStartModal = orchestration.sessionStartModal ? (
    <SessionStartModal model={orchestration.sessionStartModal} />
  ) : null;

  const humanReviewFeedbackModal = (
    <HumanReviewFeedbackModal model={orchestration.humanReviewFeedbackModal} />
  );

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
    rightPanelContent,
    mergedPullRequestModal,
    humanReviewFeedbackModal,
    sessionStartModal,
    taskDetailsSheet,
  };
}
