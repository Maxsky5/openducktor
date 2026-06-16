import { useMemo } from "react";
import type { BuildToolsSessionDescriptor } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-bootstrap";
import { getAgentSessionActivityStateFromSession } from "@/lib/agent-session-activity-state";
import type { AgentStudioOrchestrationSelectionContext } from "../use-agent-studio-orchestration-controller";
import type {
  AgentStudioGitConflictQuickActionContext,
  UseAgentsPageRightPanelModelArgs,
} from "../use-agents-page-right-panel-model";

type AgentStudioRightPanelBridgeSelection = Pick<
  AgentStudioOrchestrationSelectionContext,
  "viewActiveSession" | "viewRole" | "viewTaskId" | "viewSelectedTask" | "viewTranscriptState"
>;

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
  viewRole: UseAgentsPageRightPanelModelArgs["viewRole"];
  viewTaskId: UseAgentsPageRightPanelModelArgs["viewTaskId"];
  session: UseAgentsPageRightPanelModelArgs["session"];
  viewSelectedTask: UseAgentsPageRightPanelModelArgs["viewSelectedTask"];
  panelKind: UseAgentsPageRightPanelModelArgs["panelKind"];
  isPanelOpen: UseAgentsPageRightPanelModelArgs["isPanelOpen"];
  transcriptState: UseAgentsPageRightPanelModelArgs["transcriptState"];
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
  "panelKind" | "isPanelOpen" | "viewRole"
> & {
  activeSession: AgentStudioOrchestrationSelectionContext["viewActiveSession"];
  transcriptState: AgentStudioRightPanelRuntimeModel["transcriptState"];
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
  session: BuildToolsSessionDescriptor;
};

function useRightPanelSessionDescriptor(
  activeSession: AgentStudioRightPanelBridgeSelection["viewActiveSession"],
): BuildToolsSessionDescriptor {
  const role = activeSession?.role ?? null;
  const activityState = activeSession
    ? getAgentSessionActivityStateFromSession(activeSession)
    : null;
  const workingDirectory = activeSession?.workingDirectory ?? null;
  const hasActiveSession = activeSession != null;

  return useMemo(
    () => ({
      role,
      activityState,
      workingDirectory,
      hasActiveSession,
    }),
    [activityState, hasActiveSession, role, workingDirectory],
  );
}

function buildAgentStudioRightPanelBridgeModel({
  activeWorkspace,
  branches,
  activeBranch,
  selection,
  panelKind,
  isPanelOpen,
  session,
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
      viewRole: selection.viewRole,
      activeSession: selection.viewActiveSession,
      transcriptState: selection.viewTranscriptState,
    },
    rightPanel: {
      activeWorkspace,
      activeBranch,
      branches,
      viewRole: selection.viewRole,
      viewTaskId: selection.viewTaskId,
      session,
      viewSelectedTask: selection.viewSelectedTask,
      panelKind,
      isPanelOpen,
      transcriptState: selection.viewTranscriptState,
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
  const session = useRightPanelSessionDescriptor(selection.viewActiveSession);

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
      session,
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
    session,
    setTaskTargetBranch,
    worktreeRecoveryKey,
  ]);

  return {
    isRightPanelVisible,
    rightPanelBridge,
  };
}
