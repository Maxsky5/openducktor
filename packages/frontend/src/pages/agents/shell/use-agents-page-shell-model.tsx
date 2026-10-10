import type { SessionNavigationRecovery } from "@/features/session-navigation/use-session-navigation-recovery";
import type { ChatFileLinkOwner } from "@/components/features/agents/agent-chat/agent-chat-file-link-context";
import type { AgentStudioHeaderModel } from "@/components/features/agents/agent-studio-header.types";
import { useMemo } from "react";
import {
  type SessionPanelOwner,
  type SessionPanelsModel,
  type ToolTabKind,
  useSessionPanels,
} from "@/features/session-panels";
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
  navigationPersistenceOperation: SessionNavigationRecovery["navigationPersistenceOperation"];
  isRetryingNavigationPersistence?: boolean;
  chatSettingsLoadError: Error | null;
  gitProviderContextLoadError: Error | null;
  onRetryNavigationPersistence: () => void;
  onRetryChatSettingsLoad: () => void;
  onRetryGitProviderContext: () => void;
  hasSelectedTask: boolean;
  unavailableTaskId: string | null;
  chatHeaderModel: AgentStudioHeaderModel;
  chatModel: ReturnType<typeof useAgentStudioOrchestrationController>["agentChatModel"];
  taskExecutionSelectedFilePreviewModel: ReturnType<
    typeof useAgentStudioOrchestrationController
  >["taskExecutionSelectedFilePreviewModel"];
  rightPanelBridge: AgentStudioRightPanelBridgeModel | null;
  selectedFileRefresh: AgentStudioSelectedFileRefreshModel | null;
  modalContent: AgentsPageModalContentModel;
  panels: SessionPanelsModel;
};

export function useAgentsPageShellModel(): AgentsPageShellModel {
  const { activeBranch, branches, activeWorkspace } = useWorkspaceBranchState();
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const { allRuntimeDefinitions: runtimeDefinitions } = useRuntimeAvailabilityContext();
  const { repoSettings, repoSettingsError, loadRepoSettings, gitProvider, isLoadingRepoSettings } =
    useAgentStudioRepoSettings({
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
    detectingPullRequestTaskId,
    linkingMergedPullRequestTaskId,
    pendingMergedPullRequest,
    setTaskTargetBranch,
  } = useTasksState();
  const {
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
    });
  const mountedTaskIds = useMemo(
    () => (selection.view.taskId ? [selection.view.taskId] : []),
    [selection.view.taskId],
  );
  const terminals = useAgentStudioTerminals({
    workspaceId: activeWorkspaceId,
    repoPath: workspaceRepoPath,
    taskId: selection.view.taskId || null,
    taskVersion: selection.view.selectedTask?.updatedAt ?? null,
    mountedTaskIds,
  });
  const panelOwner = useMemo<SessionPanelOwner | null>(
    () =>
      activeWorkspaceId && selection.view.taskId
        ? { kind: "task", workspaceId: activeWorkspaceId, taskId: selection.view.taskId }
        : null,
    [activeWorkspaceId, selection.view.taskId],
  );
  const { canShowPullRequestReview, hasLinkedPullRequest } = orchestration.pullRequestReview;
  const panels = useSessionPanels({
    owner: panelOwner,
    selectionKey: orchestrationSelection.view.role,
    // CI Checks needs a linked pull request that the provider can review.
    unavailableKinds:
      canShowPullRequestReview && hasLinkedPullRequest ? NO_KINDS : WITHOUT_CI_CHECKS,
    terminals,
  });
  const buildTools = useAgentsPageBuildTools({
    activeWorkspace,
    activeBranch,
    selectedView: orchestrationSelection.view,
    isDiffsActive: panels.right.activeKind === "diffs",
    isPanelOpen: panels.right.isVisible,
    repoSettings: orchestration.repoSettings,
    repoSettingsError,
    loadRepoSettings,
    onResolveGitConflict: handleResolveRebaseConflict,
  });
  const agentStudioHeaderModel = useAgentStudioGitConflictHeaderModel({
    headerModel: orchestration.agentStudioHeaderModel,
    gitConflictQuickAction: orchestration.gitConflictQuickAction,
    gitConflict: buildTools.gitActions.gitConflict,
    resolveGitConflict: buildTools.gitActions.askBuilderToResolveGitConflict,
    isPanelOpen: panels.right.isVisible,
  });

  const { rightPanelBridge, selectedFileRefresh } = useAgentStudioRightPanelBridge({
    activeWorkspace,
    buildTools,
    selection: orchestrationSelection,
    panel: panels.right,
    pullRequestReviewUnavailableReason: orchestration.pullRequestReview.unavailableReason,
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
      workingDirectory:
        orchestrationSelection.view.selectedSession.identity?.workingDirectory ?? null,
      ownerKey: orchestration.agentChatModel.thread.transcript.displayedSessionKey ?? "",
      onSelectFile: orchestration.onSelectTaskExecutionFile,
    }),
    [
      workspaceRepoPath,
      selection.view.taskId,
      orchestrationSelection.view.selectedSession.identity?.workingDirectory,
      orchestration.agentChatModel.thread.transcript.displayedSessionKey,
      orchestration.onSelectTaskExecutionFile,
    ],
  );

  return {
    activeWorkspace,
    navigationPersistenceError,
    navigationPersistenceOperation: routeSession.navigationPersistenceOperation,
    isRetryingNavigationPersistence: routeSession.isRetryingNavigationPersistence,
    chatSettingsLoadError: orchestration.chatSettingsLoadError,
    gitProviderContextLoadError: gitProvider.error,
    onRetryNavigationPersistence: retryNavigationPersistence,
    onRetryChatSettingsLoad: orchestration.retryChatSettingsLoad,
    onRetryGitProviderContext: gitProvider.retry,
    hasSelectedTask: Boolean(selection.view.taskId),
    unavailableTaskId:
      tasksAreCurrent && !isForegroundLoadingTasks && !selection.view.selectedTask
        ? selection.view.taskId || null
        : null,
    chatHeaderModel: agentStudioHeaderModel,
    chatModel: orchestration.agentChatModel,
    chatFileLinkOwner,
    taskExecutionSelectedFilePreviewModel: orchestration.taskExecutionSelectedFilePreviewModel,
    rightPanelBridge,
    selectedFileRefresh,
    modalContent,
    panels,
  };
}

const NO_KINDS: ReadonlySet<ToolTabKind> = new Set();
const WITHOUT_CI_CHECKS: ReadonlySet<ToolTabKind> = new Set(["ci_checks"]);
