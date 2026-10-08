import type { ChatFileLinkOwner } from "@/components/features/agents/agent-chat/agent-chat-file-link-context";
import type { AgentStudioHeaderModel } from "@/components/features/agents/agent-studio-header.types";
import { useMemo } from "react";
import { useSessionStartWorkflowRunner } from "@/features/session-start";
import { gitProviderReadError } from "@/lib/git-provider-health";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import {
  useAgentOperations,
  useAgentSessionSummaries,
  useTasksState,
  useWorkspaceBranchState,
} from "@/state/app-state-provider";
import { useAgentStudioTerminals } from "../terminals/use-agent-studio-terminals";
import type { useAgentStudioOrchestrationController } from "../use-agent-studio-orchestration-controller";
import { useAgentStudioRepoSettings } from "../use-agent-studio-repo-settings";
import { useAgentsPageBuildTools } from "./use-agents-page-build-tools";
import type { AgentsPageModalContentModel } from "./agents-page-modal-content";
import { useAgentStudioGitConflictHeaderModel } from "./use-agent-studio-git-conflict-header-model";
import {
  type AgentStudioRightPanelBridgeModel,
  type AgentStudioSelectedFileRefreshModel,
  useAgentStudioRightPanelBridge,
} from "./use-agent-studio-right-panel-bridge";
import { useAgentStudioShellTaskActions } from "./use-agent-studio-shell-task-actions";
import { useAgentsPageOrchestrationShellModel } from "./use-agents-page-orchestration-shell-model";
import { useAgentsPageRouteSessionModel } from "./use-agents-page-route-session-model";

type AgentsPageShellModel = {
  chatFileLinkOwner: ChatFileLinkOwner;
  activeWorkspace: ReturnType<typeof useWorkspaceBranchState>["activeWorkspace"];
  navigationPersistenceError: Error | null;
  isRetryingNavigationPersistence?: boolean;
  chatSettingsLoadError: Error | null;
  gitProviderContextLoadError: Error | null;
  onRetryNavigationPersistence: () => void;
  onRetryChatSettingsLoad: () => void;
  onRetryGitProviderContext: () => void;
  rightPanelToggleModel: ReturnType<
    typeof useAgentStudioOrchestrationController
  >["rightPanel"]["rightPanelToggleModel"];
  hasSelectedTask: boolean;
  unavailableTaskId: string | null;
  chatHeaderModel: AgentStudioHeaderModel;
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
  const { activeBranch, branches, activeWorkspace } = useWorkspaceBranchState();
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const { allRuntimeDefinitions: runtimeDefinitions } = useRuntimeAvailabilityContext();
  const { repoSettings, gitProvider, isLoadingRepoSettings } = useAgentStudioRepoSettings({
    activeRepoPath: workspaceRepoPath,
    activeWorkspaceId,
  });
  const providerReadError = gitProviderReadError(gitProvider.error);
  const {
    tasksAreCurrent,
    isForegroundLoadingTasks,
    tasks,
    syncPullRequests,
    linkMergedPullRequest,
    cancelLinkMergedPullRequest,
    humanRequestChangesTask,
    detectingPullRequestTaskId,
    linkingMergedPullRequestTaskId,
    pendingMergedPullRequest,
    setTaskTargetBranch,
  } = useTasksState();
  const {
    startAgentSession,
    sendAgentMessage,
    continueInterruptedTurn,
    stopAgentSession,
    loadAgentSessionHistory,
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

  const routeSession = useAgentsPageRouteSessionModel({
    activeWorkspaceId,
    workspaceRepoPath,
    tasks,
    tasksAreCurrent,
    isForegroundLoadingTasks,
    sessions,
    repoSettings,
    isLoadingRepoSettings,
  });
  const { navigationPersistenceError, retryNavigationPersistence, selection } = routeSession;

  const taskActions = useAgentStudioShellTaskActions({
    activeWorkspace,
    tasks,
    selectedTaskId: selection.view.selectedTask?.id ?? null,
    linkingMergedPullRequestTaskId,
    pendingMergedPullRequest,
    syncPullRequests,
    linkMergedPullRequest,
    cancelLinkMergedPullRequest,
  });

  const { orchestration, orchestrationSelection, handleResolveRebaseConflict } =
    useAgentsPageOrchestrationShellModel({
      activeWorkspaceId,
      branches: branches ?? [],
      runtimeDefinitions,
      repoSettings,
      gitProviderContext: gitProvider.context,
      gitProviderReadError: providerReadError,
      workspaceRepoPath,
      isForegroundLoadingTasks,
      routeSession,
      openTaskDetails: taskActions.taskDetailsLauncher.openTaskDetails,
      runSessionStartWorkflow,
      agentOperations: {
        sendAgentMessage,
        continueInterruptedTurn,
        stopAgentSession,
        loadAgentSessionHistory,
        updateAgentSessionModel,
        replyAgentApproval,
        answerAgentQuestion,
      },
      humanRequestChangesTask,
      setTaskTargetBranch,
    });
  const buildTools = useAgentsPageBuildTools({
    activeWorkspace,
    activeBranch,
    selectedView: orchestrationSelection.view,
    activeTabId: orchestration.rightPanel.activeTabId,
    isPanelOpen: orchestration.rightPanel.isPanelOpen,
    repoSettings: orchestration.repoSettings,
    onResolveGitConflict: handleResolveRebaseConflict,
  });
  const agentStudioHeaderModel = useAgentStudioGitConflictHeaderModel({
    headerModel: orchestration.agentStudioHeaderModel,
    gitConflictQuickAction: orchestration.gitConflictQuickAction,
    gitConflict: buildTools.gitActions.gitConflict,
    resolveGitConflict: buildTools.gitActions.askBuilderToResolveGitConflict,
    isPanelOpen: orchestration.rightPanel.isPanelOpen,
  });
  const mountedTaskIds = useMemo(
    () => (selection.view.taskId ? [selection.view.taskId] : []),
    [selection.view.taskId],
  );
  const terminalPanel = useAgentStudioTerminals({
    workspaceId: activeWorkspaceId,
    repoPath: workspaceRepoPath,
    taskId: selection.view.taskId || null,
    taskVersion: selection.view.selectedTask?.updatedAt ?? null,
    mountedTaskIds,
  });

  const { isRightPanelVisible, rightPanelBridge, selectedFileRefresh } =
    useAgentStudioRightPanelBridge({
      activeWorkspace,
      branches: branches ?? [],
      buildTools,
      selection: orchestrationSelection,
      panel: orchestration.rightPanel,
      documentsModel: orchestration.taskExecutionDocumentPanelModel,
      selectedFile: orchestration.taskExecutionSelectedFilePreviewModel.selectedFile,
      onSelectFile: orchestration.onSelectTaskExecutionFile,
      setTaskTargetBranch,
      detectingPullRequestTaskId,
      onDetectPullRequest: taskActions.onDetectPullRequest,
      gitProviderContext: gitProvider.context,
      gitProviderReadError: providerReadError,
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

  const chatFileLinkOwner = useMemo<ChatFileLinkOwner>(
    () => ({
      repoPath: workspaceRepoPath,
      taskId: selection.view.taskId || null,
      ownerKey: orchestration.agentChatModel.thread.transcript.displayedSessionKey ?? "",
      onSelectFile: orchestration.onSelectTaskExecutionFile,
    }),
    [
      workspaceRepoPath,
      selection.view.taskId,
      orchestration.agentChatModel.thread.transcript.displayedSessionKey,
      orchestration.onSelectTaskExecutionFile,
    ],
  );

  return {
    activeWorkspace,
    navigationPersistenceError,
    isRetryingNavigationPersistence: routeSession.isRetryingNavigationPersistence,
    chatSettingsLoadError: orchestration.chatSettingsLoadError,
    gitProviderContextLoadError: gitProvider.error,
    onRetryNavigationPersistence: retryNavigationPersistence,
    onRetryChatSettingsLoad: orchestration.retryChatSettingsLoad,
    onRetryGitProviderContext: gitProvider.retry,
    rightPanelToggleModel: orchestration.rightPanel.rightPanelToggleModel,
    hasSelectedTask: Boolean(selection.view.taskId),
    unavailableTaskId:
      tasksAreCurrent && !isForegroundLoadingTasks && !selection.view.selectedTask
        ? selection.view.taskId || null
        : null,
    chatHeaderModel: agentStudioHeaderModel,
    chatModel: orchestration.agentChatModel,
    chatFileLinkOwner,
    taskExecutionSelectedFilePreviewModel: orchestration.taskExecutionSelectedFilePreviewModel,
    isRightPanelVisible,
    rightPanelBridge,
    selectedFileRefresh,
    modalContent,
    terminalPanel,
  };
}
