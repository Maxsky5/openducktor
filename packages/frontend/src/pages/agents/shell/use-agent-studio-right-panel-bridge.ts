import { useMemo } from "react";
import type { AgentStudioOrchestrationSelectionContext } from "../use-agent-studio-orchestration-controller";
import type { UseAgentsPageRightPanelModelArgs } from "../use-agents-page-right-panel-model";

type AgentStudioRightPanelBridgeSelection = Pick<AgentStudioOrchestrationSelectionContext, "view">;

type AgentStudioRightPanelPanelState = Pick<
  UseAgentsPageRightPanelModelArgs,
  | "tabs"
  | "activeTabId"
  | "isPanelOpen"
  | "onActiveTabChange"
  | "pullRequestReviewUnavailableReason"
>;

type UseAgentStudioRightPanelBridgeArgs = {
  activeWorkspace: UseAgentsPageRightPanelModelArgs["activeWorkspace"];
  buildTools: UseAgentsPageRightPanelModelArgs["buildTools"];
  selection: AgentStudioRightPanelBridgeSelection;
  panel: AgentStudioRightPanelPanelState;
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
  tabs: UseAgentsPageRightPanelModelArgs["tabs"];
  activeTabId: UseAgentsPageRightPanelModelArgs["activeTabId"];
  onActiveTabChange: UseAgentsPageRightPanelModelArgs["onActiveTabChange"];
  pullRequestReviewUnavailableReason: UseAgentsPageRightPanelModelArgs["pullRequestReviewUnavailableReason"];
  isPanelOpen: UseAgentsPageRightPanelModelArgs["isPanelOpen"];
  documentsModel: UseAgentsPageRightPanelModelArgs["documentsModel"];
  selectedFile: UseAgentsPageRightPanelModelArgs["selectedFile"];
  onSelectFile: UseAgentsPageRightPanelModelArgs["onSelectFile"];
  setTaskTargetBranch: NonNullable<UseAgentsPageRightPanelModelArgs["setTaskTargetBranch"]>;
  detectingPullRequestTaskId: UseAgentsPageRightPanelModelArgs["detectingPullRequestTaskId"];
  onDetectPullRequest: UseAgentsPageRightPanelModelArgs["onDetectPullRequest"];
  gitProviderContext?: UseAgentsPageRightPanelModelArgs["gitProviderContext"];
  gitProviderReadError: string | null;
};

export type AgentStudioBuildWorktreeRefreshModel = Pick<
  AgentStudioRightPanelRuntimeModel,
  "activeTabId" | "isPanelOpen"
> & {
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
  isRightPanelVisible: boolean;
  rightPanelBridge: AgentStudioRightPanelBridgeModel | null;
  selectedFileRefresh: AgentStudioSelectedFileRefreshModel | null;
};

type BuildAgentStudioRightPanelBridgeModelArgs = Omit<
  UseAgentStudioRightPanelBridgeArgs,
  "panel"
> & {
  activeTabId: NonNullable<AgentStudioRightPanelPanelState["activeTabId"]>;
  tabs: AgentStudioRightPanelPanelState["tabs"];
  isPanelOpen: AgentStudioRightPanelPanelState["isPanelOpen"];
  onActiveTabChange: AgentStudioRightPanelPanelState["onActiveTabChange"];
  pullRequestReviewUnavailableReason: AgentStudioRightPanelPanelState["pullRequestReviewUnavailableReason"];
  gitProviderReadError: string | null;
};

function buildAgentStudioRightPanelBridgeModel({
  activeWorkspace,
  buildTools,
  selection,
  activeTabId,
  tabs,
  isPanelOpen,
  onActiveTabChange,
  pullRequestReviewUnavailableReason,
  documentsModel,
  selectedFile,
  onSelectFile,
  setTaskTargetBranch,
  detectingPullRequestTaskId,
  onDetectPullRequest,
  gitProviderContext,
  gitProviderReadError,
}: BuildAgentStudioRightPanelBridgeModelArgs): AgentStudioRightPanelBridgeModel {
  return {
    buildWorktreeRefresh: {
      activeTabId,
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
      tabs,
      activeTabId,
      onActiveTabChange,
      pullRequestReviewUnavailableReason,
      isPanelOpen,
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
}

export function useAgentStudioRightPanelBridge({
  activeWorkspace,
  buildTools,
  selection,
  panel,
  documentsModel,
  selectedFile,
  onSelectFile,
  setTaskTargetBranch,
  detectingPullRequestTaskId,
  onDetectPullRequest,
  gitProviderContext,
  gitProviderReadError = null,
}: UseAgentStudioRightPanelBridgeArgs): AgentStudioRightPanelShellModel {
  const activeTabId = panel.activeTabId;
  const tabs = panel.tabs;
  const isPanelOpen = panel.isPanelOpen;
  const onActiveTabChange = panel.onActiveTabChange;
  const pullRequestReviewUnavailableReason = panel.pullRequestReviewUnavailableReason;
  const isRightPanelVisible = Boolean(activeTabId && isPanelOpen);

  const rightPanelBridge = useMemo<AgentStudioRightPanelBridgeModel | null>(() => {
    if (!activeTabId) {
      return null;
    }

    return buildAgentStudioRightPanelBridgeModel({
      activeWorkspace,
      buildTools,
      selection,
      activeTabId,
      tabs,
      isPanelOpen,
      onActiveTabChange,
      pullRequestReviewUnavailableReason,
      documentsModel,
      selectedFile,
      onSelectFile,
      setTaskTargetBranch,
      detectingPullRequestTaskId,
      onDetectPullRequest,
      gitProviderContext,
      gitProviderReadError,
    });
  }, [
    activeWorkspace,
    detectingPullRequestTaskId,
    documentsModel,
    activeTabId,
    buildTools,
    isPanelOpen,
    onDetectPullRequest,
    gitProviderContext,
    gitProviderReadError,
    onSelectFile,
    onActiveTabChange,
    pullRequestReviewUnavailableReason,
    selectedFile,
    selection,
    setTaskTargetBranch,
    tabs,
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
    isRightPanelVisible,
    rightPanelBridge,
    selectedFileRefresh,
  };
}
