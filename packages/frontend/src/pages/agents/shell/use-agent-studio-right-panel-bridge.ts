import { useMemo } from "react";
import type { BuildToolsSessionDescriptor } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-bootstrap";
import type {
  AgentStudioOrchestrationSelectionContext,
  useAgentStudioOrchestrationController,
} from "../use-agent-studio-orchestration-controller";
import type {
  AgentStudioGitConflictQuickActionContext,
  UseAgentsPageRightPanelModelArgs,
} from "../use-agents-page-right-panel-model";

type AgentStudioRightPanelBridgeSelection = Pick<
  AgentStudioOrchestrationSelectionContext,
  | "viewActiveSession"
  | "viewRole"
  | "viewTaskId"
  | "viewSelectedTask"
  | "isViewSessionHistoryHydrating"
>;

type AgentStudioRightPanelBridgeOrchestration = Pick<
  ReturnType<typeof useAgentStudioOrchestrationController>,
  "agentStudioWorkspaceSidebarModel" | "repoSettings"
> & {
  rightPanel: Pick<
    ReturnType<typeof useAgentStudioOrchestrationController>["rightPanel"],
    "panelKind" | "isPanelOpen"
  >;
};

type UseAgentStudioRightPanelBridgeArgs = {
  activeWorkspace: UseAgentsPageRightPanelModelArgs["activeWorkspace"];
  branches: NonNullable<UseAgentsPageRightPanelModelArgs["branches"]>;
  activeBranch: UseAgentsPageRightPanelModelArgs["activeBranch"];
  selection: AgentStudioRightPanelBridgeSelection;
  orchestration: AgentStudioRightPanelBridgeOrchestration;
  worktreeRecoverySignal: number;
  setTaskTargetBranch: NonNullable<UseAgentsPageRightPanelModelArgs["setTaskTargetBranch"]>;
  detectingPullRequestTaskId: UseAgentsPageRightPanelModelArgs["detectingPullRequestTaskId"];
  onDetectPullRequest: UseAgentsPageRightPanelModelArgs["onDetectPullRequest"];
  onResolveGitConflict: UseAgentsPageRightPanelModelArgs["onResolveGitConflict"];
  onGitConflictQuickActionContextChange: (
    context: AgentStudioGitConflictQuickActionContext | null,
  ) => void;
};

export type AgentStudioRightPanelBridgeModel = UseAgentsPageRightPanelModelArgs & {
  activeSession: AgentStudioOrchestrationSelectionContext["viewActiveSession"];
};

export type AgentStudioRightPanelShellModel = {
  isRightPanelVisible: boolean;
  rightPanelBridge: AgentStudioRightPanelBridgeModel | null;
};

export function useAgentStudioRightPanelBridge({
  activeWorkspace,
  branches,
  activeBranch,
  selection,
  orchestration,
  worktreeRecoverySignal,
  setTaskTargetBranch,
  detectingPullRequestTaskId,
  onDetectPullRequest,
  onResolveGitConflict,
  onGitConflictQuickActionContextChange,
}: UseAgentStudioRightPanelBridgeArgs): AgentStudioRightPanelShellModel {
  const panelKind = orchestration.rightPanel.panelKind;
  const isPanelOpen = orchestration.rightPanel.isPanelOpen;
  const isRightPanelVisible = Boolean(panelKind && isPanelOpen);
  const rightPanelSessionRole = selection.viewActiveSession?.role ?? null;
  const rightPanelSessionStatus = selection.viewActiveSession?.status ?? null;
  const rightPanelSessionWorkingDirectory = selection.viewActiveSession?.workingDirectory ?? null;
  const rightPanelHasActiveSession = selection.viewActiveSession != null;
  const rightPanelSession = useMemo<BuildToolsSessionDescriptor>(
    () => ({
      role: rightPanelSessionRole,
      status: rightPanelSessionStatus,
      workingDirectory: rightPanelSessionWorkingDirectory,
      hasActiveSession: rightPanelHasActiveSession,
    }),
    [
      rightPanelHasActiveSession,
      rightPanelSessionRole,
      rightPanelSessionStatus,
      rightPanelSessionWorkingDirectory,
    ],
  );

  const rightPanelBridge = useMemo<AgentStudioRightPanelBridgeModel | null>(() => {
    if (!panelKind) {
      return null;
    }

    return {
      activeWorkspace,
      activeBranch,
      viewRole: selection.viewRole,
      viewTaskId: selection.viewTaskId,
      session: rightPanelSession,
      viewSelectedTask: selection.viewSelectedTask,
      panelKind,
      isPanelOpen,
      isViewSessionHistoryHydrating: selection.isViewSessionHistoryHydrating,
      documentsModel: orchestration.agentStudioWorkspaceSidebarModel,
      repoSettings: orchestration.repoSettings,
      worktreeRecoverySignal,
      setTaskTargetBranch,
      detectingPullRequestTaskId,
      onDetectPullRequest,
      onResolveGitConflict,
      onGitConflictQuickActionContextChange,
      branches,
      activeSession: selection.viewActiveSession,
    };
  }, [
    activeBranch,
    activeWorkspace,
    branches,
    detectingPullRequestTaskId,
    isPanelOpen,
    onDetectPullRequest,
    onGitConflictQuickActionContextChange,
    onResolveGitConflict,
    orchestration.agentStudioWorkspaceSidebarModel,
    orchestration.repoSettings,
    panelKind,
    rightPanelSession,
    selection.isViewSessionHistoryHydrating,
    selection.viewActiveSession,
    selection.viewRole,
    selection.viewSelectedTask,
    selection.viewTaskId,
    setTaskTargetBranch,
    worktreeRecoverySignal,
  ]);

  return {
    isRightPanelVisible,
    rightPanelBridge,
  };
}
