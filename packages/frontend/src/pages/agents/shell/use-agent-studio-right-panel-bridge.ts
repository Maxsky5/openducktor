import { useMemo } from "react";
import type { AgentStudioOrchestrationSelectionContext } from "../use-agent-studio-orchestration-controller";
import type {
  AgentStudioGitConflictQuickActionContext,
  UseAgentsPageRightPanelModelArgs,
} from "../use-agents-page-right-panel-model";

type AgentStudioRightPanelBridgeSelection = Pick<AgentStudioOrchestrationSelectionContext, "view">;

type AgentStudioRightPanelPanelState = Pick<
  UseAgentsPageRightPanelModelArgs,
  "panelKind" | "isPanelOpen"
>;

type UseAgentStudioRightPanelBridgeArgs = {
  activeWorkspace: UseAgentsPageRightPanelModelArgs["activeWorkspace"];
  branches: NonNullable<UseAgentsPageRightPanelModelArgs["branches"]>;
  activeBranch: UseAgentsPageRightPanelModelArgs["activeBranch"];
  selection: AgentStudioRightPanelBridgeSelection;
  panel: AgentStudioRightPanelPanelState;
  documentsModel: UseAgentsPageRightPanelModelArgs["documentsModel"];
  repoSettings: UseAgentsPageRightPanelModelArgs["repoSettings"];
  worktreeRecoveryKey: string;
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
  panelKind: UseAgentsPageRightPanelModelArgs["panelKind"];
  isPanelOpen: UseAgentsPageRightPanelModelArgs["isPanelOpen"];
  documentsModel: UseAgentsPageRightPanelModelArgs["documentsModel"];
  repoSettings: UseAgentsPageRightPanelModelArgs["repoSettings"];
  worktreeRecoveryKey: UseAgentsPageRightPanelModelArgs["worktreeRecoveryKey"];
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
  "panelKind" | "isPanelOpen"
> & {
  selectedView: Pick<
    AgentStudioOrchestrationSelectionContext["view"],
    "role" | "activeSession" | "transcriptState"
  >;
};

export type AgentStudioRightPanelBridgeModel = {
  buildWorktreeRefresh: AgentStudioBuildWorktreeRefreshModel;
  rightPanel: AgentStudioRightPanelRuntimeModel;
};

export type AgentStudioRightPanelShellModel = {
  isRightPanelVisible: boolean;
  rightPanelBridge: AgentStudioRightPanelBridgeModel | null;
};

type BuildAgentStudioRightPanelBridgeModelArgs = Omit<
  UseAgentStudioRightPanelBridgeArgs,
  "panel"
> & {
  panelKind: NonNullable<AgentStudioRightPanelPanelState["panelKind"]>;
  isPanelOpen: AgentStudioRightPanelPanelState["isPanelOpen"];
};

function buildAgentStudioRightPanelBridgeModel({
  activeWorkspace,
  branches,
  activeBranch,
  selection,
  panelKind,
  isPanelOpen,
  documentsModel,
  repoSettings,
  worktreeRecoveryKey,
  setTaskTargetBranch,
  detectingPullRequestTaskId,
  onDetectPullRequest,
  onResolveGitConflict,
  onGitConflictQuickActionContextChange,
}: BuildAgentStudioRightPanelBridgeModelArgs): AgentStudioRightPanelBridgeModel {
  return {
    buildWorktreeRefresh: {
      panelKind,
      isPanelOpen,
      selectedView: {
        role: selection.view.role,
        activeSession: selection.view.activeSession,
        transcriptState: selection.view.transcriptState,
      },
    },
    rightPanel: {
      activeWorkspace,
      activeBranch,
      branches,
      selectedView: selection.view,
      panelKind,
      isPanelOpen,
      documentsModel,
      repoSettings,
      worktreeRecoveryKey,
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
  repoSettings,
  worktreeRecoveryKey,
  setTaskTargetBranch,
  detectingPullRequestTaskId,
  onDetectPullRequest,
  onResolveGitConflict,
  onGitConflictQuickActionContextChange,
}: UseAgentStudioRightPanelBridgeArgs): AgentStudioRightPanelShellModel {
  const panelKind = panel.panelKind;
  const isPanelOpen = panel.isPanelOpen;
  const isRightPanelVisible = Boolean(panelKind && isPanelOpen);

  const rightPanelBridge = useMemo<AgentStudioRightPanelBridgeModel | null>(() => {
    if (!isRightPanelVisible || !panelKind) {
      return null;
    }

    return buildAgentStudioRightPanelBridgeModel({
      activeWorkspace,
      branches,
      activeBranch,
      selection,
      panelKind,
      isPanelOpen,
      documentsModel,
      repoSettings,
      worktreeRecoveryKey,
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
    isPanelOpen,
    isRightPanelVisible,
    onDetectPullRequest,
    onGitConflictQuickActionContextChange,
    onResolveGitConflict,
    panelKind,
    repoSettings,
    selection,
    setTaskTargetBranch,
    worktreeRecoveryKey,
  ]);

  return {
    isRightPanelVisible,
    rightPanelBridge,
  };
}
