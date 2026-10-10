import { useMemo } from "react";
import type { AgentStudioOrchestrationSelectionContext } from "../use-agent-studio-orchestration-controller";
import type { UseAgentsPageRightPanelModelArgs } from "../use-agents-page-right-panel-model";

type AgentStudioRightPanelBridgeSelection = Pick<AgentStudioOrchestrationSelectionContext, "view">;

type UseAgentStudioRightPanelBridgeArgs = {
  activeWorkspace: UseAgentsPageRightPanelModelArgs["activeWorkspace"];
  buildTools: UseAgentsPageRightPanelModelArgs["buildTools"];
  selection: AgentStudioRightPanelBridgeSelection;
  panel: UseAgentsPageRightPanelModelArgs["panel"];
  pullRequestReviewUnavailableReason: string | null;
  documentsModel: UseAgentsPageRightPanelModelArgs["documentsModel"];
  selectedFile: UseAgentsPageRightPanelModelArgs["selectedFile"];
  onSelectFile: UseAgentsPageRightPanelModelArgs["onSelectFile"];
  setTaskTargetBranch: NonNullable<UseAgentsPageRightPanelModelArgs["setTaskTargetBranch"]>;
  detectingPullRequestTaskId: UseAgentsPageRightPanelModelArgs["detectingPullRequestTaskId"];
  onDetectPullRequest: UseAgentsPageRightPanelModelArgs["onDetectPullRequest"];
  gitProviderContext?: UseAgentsPageRightPanelModelArgs["gitProviderContext"];
  gitProviderReadError?: UseAgentsPageRightPanelModelArgs["gitProviderReadError"];
};

export type AgentStudioRightPanelRuntimeModel = {
  activeWorkspace: UseAgentsPageRightPanelModelArgs["activeWorkspace"];
  buildTools: UseAgentsPageRightPanelModelArgs["buildTools"];
  selectedView: UseAgentsPageRightPanelModelArgs["selectedView"];
  panel: UseAgentsPageRightPanelModelArgs["panel"];
  pullRequestReviewUnavailableReason: UseAgentsPageRightPanelModelArgs["pullRequestReviewUnavailableReason"];
  documentsModel: UseAgentsPageRightPanelModelArgs["documentsModel"];
  selectedFile: UseAgentsPageRightPanelModelArgs["selectedFile"];
  onSelectFile: UseAgentsPageRightPanelModelArgs["onSelectFile"];
  setTaskTargetBranch: NonNullable<UseAgentsPageRightPanelModelArgs["setTaskTargetBranch"]>;
  detectingPullRequestTaskId: UseAgentsPageRightPanelModelArgs["detectingPullRequestTaskId"];
  onDetectPullRequest: UseAgentsPageRightPanelModelArgs["onDetectPullRequest"];
  gitProviderContext?: UseAgentsPageRightPanelModelArgs["gitProviderContext"];
  gitProviderReadError: string | null;
};

export type AgentStudioBuildWorktreeRefreshModel = {
  isPanelOpen: boolean;
  selectedView: {
    role: AgentStudioOrchestrationSelectionContext["view"]["role"];
    loadedSession: AgentStudioOrchestrationSelectionContext["view"]["selectedSession"]["loadedSession"];
  };
};

export type AgentStudioSelectedFileRefreshModel = {
  selectedFile: NonNullable<UseAgentsPageRightPanelModelArgs["selectedFile"]>;
  selectedView: AgentStudioBuildWorktreeRefreshModel["selectedView"];
};

export type AgentStudioRightPanelBridgeModel = {
  buildWorktreeRefresh: AgentStudioBuildWorktreeRefreshModel;
  rightPanel: AgentStudioRightPanelRuntimeModel;
};

export type AgentStudioRightPanelShellModel = {
  rightPanelBridge: AgentStudioRightPanelBridgeModel | null;
  selectedFileRefresh: AgentStudioSelectedFileRefreshModel | null;
};

export function useAgentStudioRightPanelBridge({
  activeWorkspace,
  buildTools,
  selection,
  panel,
  pullRequestReviewUnavailableReason,
  documentsModel,
  selectedFile,
  onSelectFile,
  setTaskTargetBranch,
  detectingPullRequestTaskId,
  onDetectPullRequest,
  gitProviderContext,
  gitProviderReadError = null,
}: UseAgentStudioRightPanelBridgeArgs): AgentStudioRightPanelShellModel {
  const hasTask = Boolean(selection.view.taskId);
  const isPanelOpen = panel.isVisible;

  const rightPanelBridge = useMemo<AgentStudioRightPanelBridgeModel | null>(() => {
    if (!hasTask) {
      return null;
    }

    return {
      buildWorktreeRefresh: {
        isPanelOpen,
        selectedView: {
          role: selection.view.role,
          loadedSession: selection.view.selectedSession.loadedSession,
        },
      },
      rightPanel: {
        activeWorkspace,
        buildTools,
        selectedView: selection.view,
        panel,
        pullRequestReviewUnavailableReason,
        documentsModel,
        selectedFile,
        onSelectFile,
        setTaskTargetBranch,
        detectingPullRequestTaskId,
        onDetectPullRequest,
        gitProviderContext,
        gitProviderReadError,
      },
    };
  }, [
    activeWorkspace,
    buildTools,
    detectingPullRequestTaskId,
    documentsModel,
    gitProviderContext,
    gitProviderReadError,
    hasTask,
    isPanelOpen,
    onDetectPullRequest,
    onSelectFile,
    panel,
    pullRequestReviewUnavailableReason,
    selectedFile,
    selection.view,
    setTaskTargetBranch,
  ]);

  const selectedFileRefresh = useMemo<AgentStudioSelectedFileRefreshModel | null>(() => {
    if (isPanelOpen || !selectedFile) {
      return null;
    }

    return {
      selectedFile,
      selectedView: {
        role: selection.view.role,
        loadedSession: selection.view.selectedSession.loadedSession,
      },
    };
  }, [isPanelOpen, selectedFile, selection.view]);

  return {
    rightPanelBridge,
    selectedFileRefresh,
  };
}
