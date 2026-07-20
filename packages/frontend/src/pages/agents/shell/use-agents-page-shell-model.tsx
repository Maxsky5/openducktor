import { useMemo } from "react";
import { useSessionStartWorkflowRunner } from "@/features/session-start";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import {
  useAgentOperations,
  useAgentSessionSummaries,
  useTasksState,
  useWorkspaceState,
} from "@/state/app-state-provider";
import { useAgentStudioTerminals } from "../terminals/use-agent-studio-terminals";
import type { useAgentStudioOrchestrationController } from "../use-agent-studio-orchestration-controller";
import { useAgentStudioRepoSettings } from "../use-agent-studio-repo-settings";
import type { AgentsPageModalContentModel } from "./agents-page-modal-content";
import { useAgentStudioGitConflictQuickActionState } from "./use-agent-studio-git-conflict-quick-action-state";
import {
  type AgentStudioRightPanelBridgeModel,
  type AgentStudioSelectedFileRefreshModel,
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
  taskExecutionSelectedFilePreviewModel: ReturnType<
    typeof useAgentStudioOrchestrationController
  >["taskExecutionSelectedFilePreviewModel"];
  isRightPanelVisible: boolean;
  rightPanelBridge: AgentStudioRightPanelBridgeModel | null;
  selectedFileRefresh: AgentStudioSelectedFileRefreshModel | null;
  modalContent: AgentsPageModalContentModel;
  terminalPanel: ReturnType<typeof useAgentStudioTerminals>;
};

export function useAgentsPageShellModel(): AgentsPageShellModel {
  const { activeBranch, branches, activeWorkspace } = useWorkspaceState();
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const { allRuntimeDefinitions: runtimeDefinitions } = useRuntimeAvailabilityContext();
  const { repoSettings, githubIntegrationEnabled, isLoadingRepoSettings } =
    useAgentStudioRepoSettings({
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
  const {
    startAgentSession,
    sendAgentMessage,
    stopAgentSession,
    updateAgentSessionModel,
    replyAgentApproval,
    answerAgentQuestion,
  } = useAgentOperations();
  const runSessionStartWorkflow = useSessionStartWorkflowRunner({
    workspaceId: activeWorkspaceId,
    startAgentSession,
    sendAgentMessage,
  });
  const sessions = useAgentSessionSummaries();

  const {
    gitConflictQuickActionContext,
    gitConflictQuickActionContextRef,
    onGitConflictQuickActionContextChange,
  } = useAgentStudioGitConflictQuickActionState();
  const routeSession = useAgentsPageRouteSessionModel({
    activeWorkspaceId,
    workspaceRepoPath,
    tasks,
    isForegroundLoadingTasks,
    sessions,
    repoSettings,
    isLoadingRepoSettings,
  });
  const { navigationPersistenceError, retryNavigationPersistence, selection } = routeSession;
  const terminalPanel = useAgentStudioTerminals({
    repoPath: workspaceRepoPath,
    taskId: selection.view.selectedTask?.id ?? null,
    taskVersion: selection.view.selectedTask?.updatedAt ?? null,
  });

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
    githubIntegrationEnabled,
    workspaceRepoPath,
    isForegroundLoadingTasks,
    routeSession,
    hasActiveGitConflict: gitConflictQuickActionContext !== null,
    gitConflictQuickActionContext,
    gitConflictQuickActionContextRef,
    openTaskDetails: taskActions.taskDetailsLauncher.openTaskDetails,
    runSessionStartWorkflow,
    agentOperations: {
      sendAgentMessage,
      stopAgentSession,
      updateAgentSessionModel,
      replyAgentApproval,
      answerAgentQuestion,
    },
    humanRequestChangesTask,
    setTaskTargetBranch,
  });

  const { isRightPanelVisible, rightPanelBridge, selectedFileRefresh } =
    useAgentStudioRightPanelBridge({
      activeWorkspace,
      branches: branches ?? [],
      activeBranch,
      selection: orchestrationSelection,
      panel: orchestration.rightPanel,
      documentsModel: orchestration.taskExecutionDocumentPanelModel,
      selectedFile: orchestration.taskExecutionSelectedFilePreviewModel.selectedFile,
      onSelectFile: orchestration.onSelectTaskExecutionFile,
      onClearSelectedFile: orchestration.taskExecutionSelectedFilePreviewModel.onClose,
      repoSettings: orchestration.repoSettings,
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
    taskExecutionSelectedFilePreviewModel: orchestration.taskExecutionSelectedFilePreviewModel,
    isRightPanelVisible,
    rightPanelBridge,
    selectedFileRefresh,
    modalContent,
    terminalPanel,
  };
}
