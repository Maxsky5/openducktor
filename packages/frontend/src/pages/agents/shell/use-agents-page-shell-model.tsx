import { useMemo } from "react";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import {
  useAgentOperations,
  useAgentSessionReadModelState,
  useAgentSessionSummaries,
  useChecksState,
  useTasksState,
  useWorkspaceState,
} from "@/state/app-state-provider";
import type { useAgentStudioOrchestrationController } from "../use-agent-studio-orchestration-controller";
import { useAgentStudioRepoSettings } from "../use-agent-studio-repo-settings";
import type { AgentsPageModalContentModel } from "./agents-page-modal-content";
import { useAgentStudioGitConflictQuickActionState } from "./use-agent-studio-git-conflict-quick-action-state";
import {
  type AgentStudioRightPanelBridgeModel,
  useAgentStudioRightPanelBridge,
} from "./use-agent-studio-right-panel-bridge";
import { useAgentStudioShellTaskActions } from "./use-agent-studio-shell-task-actions";
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
  modalContent: AgentsPageModalContentModel;
};

export function useAgentsPageShellModel(): AgentsPageShellModel {
  const { activeBranch, branches, activeWorkspace } = useWorkspaceState();
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const {
    availableRuntimeDefinitions: runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
  } = useRuntimeAvailabilityContext();
  const { runtimeHealthByRuntime, isLoadingChecks, refreshChecks } = useChecksState();
  const { repoSettings, isLoadingRepoSettings } = useAgentStudioRepoSettings({
    activeWorkspaceId,
  });
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
  const { sessionReadModelLoadState } = useAgentSessionReadModelState();
  const {
    loadAgentSessionHistory,
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

  const {
    gitConflictQuickActionContext,
    gitConflictQuickActionContextRef,
    onGitConflictQuickActionContextChange,
  } = useAgentStudioGitConflictQuickActionState();
  const routeSession = useAgentsPageRouteSessionModel({
    activeWorkspaceId,
    workspaceRepoPath,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeHealthByRuntime,
    isLoadingChecks,
    refreshChecks,
    tasks,
    isForegroundLoadingTasks,
    sessions,
    sessionReadModelLoadState,
    repoSettings,
    isLoadingRepoSettings,
    loadAgentSessionHistory,
    readSessionModelCatalog,
    readSessionTodos,
  });
  const { navigationPersistenceError, retryNavigationPersistence, selection, worktreeRecoveryKey } =
    routeSession;

  const taskActions = useAgentStudioShellTaskActions({
    activeWorkspace,
    tasks,
    selectedTaskId: selection.view.selectedTask?.id ?? null,
    detectingPullRequestTaskId,
    linkingMergedPullRequestTaskId,
    pendingMergedPullRequest,
    unlinkingPullRequestTaskId,
    syncPullRequests,
    linkMergedPullRequest,
    cancelLinkMergedPullRequest,
    unlinkPullRequest,
  });

  const {
    orchestration,
    orchestrationSelection,
    handleResolveRebaseConflict,
    agentStudioHeaderModel,
  } = useAgentsPageOrchestrationShellModel({
    activeWorkspaceId,
    branches: branches ?? [],
    runtimeDefinitions,
    repoSettings,
    workspaceRepoPath,
    isForegroundLoadingTasks,
    routeSession,
    hasActiveGitConflict: gitConflictQuickActionContext !== null,
    gitConflictQuickActionContext,
    gitConflictQuickActionContextRef,
    openTaskDetails: taskActions.taskDetailsLauncher.openTaskDetails,
    agentOperations: {
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
    panel: orchestration.rightPanel,
    documentsModel: orchestration.agentStudioWorkspaceSidebarModel,
    repoSettings: orchestration.repoSettings,
    worktreeRecoveryKey,
    setTaskTargetBranch,
    detectingPullRequestTaskId,
    onDetectPullRequest: taskActions.onDetectPullRequest,
    onResolveGitConflict: handleResolveRebaseConflict,
    onGitConflictQuickActionContextChange,
  });

  const modalContent = useMemo<AgentsPageModalContentModel>(
    () => ({
      mergedPullRequestModal: taskActions.mergedPullRequestModal,
      humanReviewFeedbackModal: orchestration.humanReviewFeedbackModal,
      sessionStartModal: orchestration.sessionStartModal,
      taskDetailsLauncher: taskActions.taskDetailsLauncher,
    }),
    [
      orchestration.humanReviewFeedbackModal,
      orchestration.sessionStartModal,
      taskActions.mergedPullRequestModal,
      taskActions.taskDetailsLauncher,
    ],
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
    hasSelectedTask: Boolean(selection.view.taskId),
    chatHeaderModel: agentStudioHeaderModel,
    chatModel: orchestration.agentChatModel,
    isRightPanelVisible,
    rightPanelBridge,
    modalContent,
  };
}
