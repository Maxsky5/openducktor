import { useMemo } from "react";
import type { AgentStudioOrchestrationSelectionContext } from "../use-agent-studio-orchestration-controller";
import type {
  AgentStudioGitConflictQuickActionContext,
  UseAgentsPageRightPanelModelArgs,
} from "../use-agents-page-right-panel-model";

type AgentStudioRightPanelBridgeSelection = Pick<AgentStudioOrchestrationSelectionContext, "view">;

type AgentStudioRightPanelPanelState = Pick<
  UseAgentsPageRightPanelModelArgs,
  "tabs" | "activeTabId" | "isPanelOpen" | "onActiveTabChange"
>;

type UseAgentStudioRightPanelBridgeArgs = {
  activeWorkspace: UseAgentsPageRightPanelModelArgs["activeWorkspace"];
  branches: NonNullable<UseAgentsPageRightPanelModelArgs["branches"]>;
  activeBranch: UseAgentsPageRightPanelModelArgs["activeBranch"];
  selection: AgentStudioRightPanelBridgeSelection;
  panel: AgentStudioRightPanelPanelState;
  documentsModel: UseAgentsPageRightPanelModelArgs["documentsModel"];
  selectedFile: UseAgentsPageRightPanelModelArgs["selectedFile"];
  onSelectFile: UseAgentsPageRightPanelModelArgs["onSelectFile"];
  onClearSelectedFile: UseAgentsPageRightPanelModelArgs["onClearSelectedFile"];
  repoSettings: UseAgentsPageRightPanelModelArgs["repoSettings"];
  setTaskTargetBranch: NonNullable<UseAgentsPageRightPanelModelArgs["setTaskTargetBranch"]>;
  detectingPullRequestTaskId: UseAgentsPageRightPanelModelArgs["detectingPullRequestTaskId"];
  onDetectPullRequest: UseAgentsPageRightPanelModelArgs["onDetectPullRequest"];
  onResolveGitConflict: UseAgentsPageRightPanelModelArgs["onResolveGitConflict"];
  onGitConflictQuickActionContextChange: (
    context: AgentStudioGitConflictQuickActionContext | null,
  ) => void;
};

export type AgentStudioRightPanelRuntimeModel = {
  activeWorkspace: UseAgentsPageRightPanelModelArgs["activeWorkspace"];
  branches: NonNullable<UseAgentsPageRightPanelModelArgs["branches"]>;
  activeBranch: UseAgentsPageRightPanelModelArgs["activeBranch"];
  selectedView: UseAgentsPageRightPanelModelArgs["selectedView"];
  tabs: UseAgentsPageRightPanelModelArgs["tabs"];
  activeTabId: UseAgentsPageRightPanelModelArgs["activeTabId"];
  onActiveTabChange: UseAgentsPageRightPanelModelArgs["onActiveTabChange"];
  isPanelOpen: UseAgentsPageRightPanelModelArgs["isPanelOpen"];
  documentsModel: UseAgentsPageRightPanelModelArgs["documentsModel"];
  selectedFile: UseAgentsPageRightPanelModelArgs["selectedFile"];
  onSelectFile: UseAgentsPageRightPanelModelArgs["onSelectFile"];
  onClearSelectedFile: UseAgentsPageRightPanelModelArgs["onClearSelectedFile"];
  repoSettings: UseAgentsPageRightPanelModelArgs["repoSettings"];
  setTaskTargetBranch: NonNullable<UseAgentsPageRightPanelModelArgs["setTaskTargetBranch"]>;
  detectingPullRequestTaskId: UseAgentsPageRightPanelModelArgs["detectingPullRequestTaskId"];
  onDetectPullRequest: UseAgentsPageRightPanelModelArgs["onDetectPullRequest"];
  onResolveGitConflict: UseAgentsPageRightPanelModelArgs["onResolveGitConflict"];
  onGitConflictQuickActionContextChange: NonNullable<
    UseAgentsPageRightPanelModelArgs["onGitConflictQuickActionContextChange"]
  >;
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
};

function buildAgentStudioRightPanelBridgeModel({
  activeWorkspace,
  branches,
  activeBranch,
  selection,
  activeTabId,
  tabs,
  isPanelOpen,
  onActiveTabChange,
  documentsModel,
  selectedFile,
  onSelectFile,
  onClearSelectedFile,
  repoSettings,
  setTaskTargetBranch,
  detectingPullRequestTaskId,
  onDetectPullRequest,
  onResolveGitConflict,
  onGitConflictQuickActionContextChange,
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
      activeBranch,
      branches,
      selectedView: selection.view,
      tabs,
      activeTabId,
      onActiveTabChange,
      isPanelOpen,
      documentsModel,
      selectedFile,
      onSelectFile,
      onClearSelectedFile,
      repoSettings,
      setTaskTargetBranch,
      detectingPullRequestTaskId,
      onDetectPullRequest,
      onResolveGitConflict,
      onGitConflictQuickActionContextChange,
    },
  };
}

export function useAgentStudioRightPanelBridge({
  activeWorkspace,
  branches,
  activeBranch,
  selection,
  panel,
  documentsModel,
  selectedFile,
  onSelectFile,
  onClearSelectedFile,
  repoSettings,
  setTaskTargetBranch,
  detectingPullRequestTaskId,
  onDetectPullRequest,
  onResolveGitConflict,
  onGitConflictQuickActionContextChange,
}: UseAgentStudioRightPanelBridgeArgs): AgentStudioRightPanelShellModel {
  const activeTabId = panel.activeTabId;
  const tabs = panel.tabs;
  const isPanelOpen = panel.isPanelOpen;
  const onActiveTabChange = panel.onActiveTabChange;
  const isRightPanelVisible = Boolean(activeTabId && isPanelOpen);

  const rightPanelBridge = useMemo<AgentStudioRightPanelBridgeModel | null>(() => {
    if (!isRightPanelVisible || !activeTabId) {
      return null;
    }

    return buildAgentStudioRightPanelBridgeModel({
      activeWorkspace,
      branches,
      activeBranch,
      selection,
      activeTabId,
      tabs,
      isPanelOpen,
      onActiveTabChange,
      documentsModel,
      selectedFile,
      onSelectFile,
      onClearSelectedFile,
      repoSettings,
      setTaskTargetBranch,
      detectingPullRequestTaskId,
      onDetectPullRequest,
      onResolveGitConflict,
      onGitConflictQuickActionContextChange,
    });
  }, [
    activeBranch,
    activeWorkspace,
    branches,
    detectingPullRequestTaskId,
    documentsModel,
    activeTabId,
    isPanelOpen,
    isRightPanelVisible,
    onClearSelectedFile,
    onDetectPullRequest,
    onSelectFile,
    onActiveTabChange,
    onGitConflictQuickActionContextChange,
    onResolveGitConflict,
    repoSettings,
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
