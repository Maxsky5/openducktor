import { memo, type ReactElement, useEffect, useMemo, useRef } from "react";
import { MemoizedAgentStudioRightPanel } from "@/components/features/agents/agent-studio-right-panel";
import type { BuildToolsSessionDescriptor } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-bootstrap";
import { useAgentStudioBuildWorktreeRefresh } from "@/features/agent-studio-build-tools/use-agent-studio-build-worktree-refresh";
import type { GitDiffRefresh } from "@/features/agent-studio-git";
import type {
  AgentStudioOrchestrationSelectionContext,
  useAgentStudioOrchestrationController,
} from "../use-agent-studio-orchestration-controller";
import {
  type AgentStudioGitConflictQuickActionContext,
  type UseAgentsPageRightPanelModelArgs,
  useAgentsPageRightPanelModel,
} from "../use-agents-page-right-panel-model";
import {
  useForwardedWorktreeRefresh,
  type WorktreeRefreshRef,
} from "./use-forwarded-worktree-refresh";

type UseAgentsPageRightPanelShellModelArgs = {
  activeWorkspace: UseAgentsPageRightPanelModelArgs["activeWorkspace"];
  branches: NonNullable<UseAgentsPageRightPanelModelArgs["branches"]>;
  activeBranch: UseAgentsPageRightPanelModelArgs["activeBranch"];
  selection: AgentStudioOrchestrationSelectionContext;
  orchestration: ReturnType<typeof useAgentStudioOrchestrationController>;
  worktreeRecoverySignal: number;
  setTaskTargetBranch: NonNullable<UseAgentsPageRightPanelModelArgs["setTaskTargetBranch"]>;
  detectingPullRequestTaskId: UseAgentsPageRightPanelModelArgs["detectingPullRequestTaskId"];
  onDetectPullRequest: UseAgentsPageRightPanelModelArgs["onDetectPullRequest"];
  onResolveGitConflict: UseAgentsPageRightPanelModelArgs["onResolveGitConflict"];
  onGitConflictQuickActionContextChange: (
    context: AgentStudioGitConflictQuickActionContext | null,
  ) => void;
};

export type AgentsPageRightPanelShellModel = {
  isRightPanelVisible: boolean;
  rightPanelContent: ReactElement | null;
};

const AgentsPageRightPanelRuntime = memo(function AgentsPageRightPanelRuntime({
  refreshWorktreeRef,
  ...args
}: UseAgentsPageRightPanelModelArgs & {
  refreshWorktreeRef: WorktreeRefreshRef;
}): ReactElement | null {
  const { rightPanelModel, refreshWorktree } = useAgentsPageRightPanelModel(args);

  useEffect(() => {
    refreshWorktreeRef.current = refreshWorktree;
    return () => {
      if (refreshWorktreeRef.current === refreshWorktree) {
        refreshWorktreeRef.current = null;
      }
    };
  }, [refreshWorktree, refreshWorktreeRef]);

  return rightPanelModel ? <MemoizedAgentStudioRightPanel model={rightPanelModel} /> : null;
});

function AgentsPageBuildWorktreeRefreshRuntime({
  panelKind,
  isPanelOpen,
  viewRole,
  activeSession,
  isSessionHistoryHydrating,
  refreshWorktreeRef,
}: {
  panelKind: "documents" | "build_tools" | null;
  isPanelOpen: boolean;
  viewRole: UseAgentsPageRightPanelModelArgs["viewRole"];
  activeSession: AgentStudioOrchestrationSelectionContext["viewActiveSession"];
  isSessionHistoryHydrating: boolean;
  refreshWorktreeRef: WorktreeRefreshRef;
}): null {
  const refreshWorktree = useForwardedWorktreeRefresh(refreshWorktreeRef);

  useAgentStudioBuildWorktreeRefresh({
    viewRole: panelKind === "build_tools" && isPanelOpen ? viewRole : null,
    activeSession,
    isSessionHistoryHydrating,
    refreshWorktree,
  });

  return null;
}

export function useAgentsPageRightPanelShellModel({
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
}: UseAgentsPageRightPanelShellModelArgs): AgentsPageRightPanelShellModel {
  const rightPanelRefreshWorktreeRef = useRef<GitDiffRefresh | null>(null);

  const isRightPanelVisible = Boolean(
    orchestration.rightPanel.panelKind && orchestration.rightPanel.isPanelOpen,
  );
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

  const rightPanelContent = orchestration.rightPanel.panelKind ? (
    <>
      <AgentsPageBuildWorktreeRefreshRuntime
        panelKind={orchestration.rightPanel.panelKind}
        isPanelOpen={orchestration.rightPanel.isPanelOpen}
        viewRole={selection.viewRole}
        activeSession={selection.viewActiveSession}
        isSessionHistoryHydrating={selection.isViewSessionHistoryHydrating}
        refreshWorktreeRef={rightPanelRefreshWorktreeRef}
      />
      <AgentsPageRightPanelRuntime
        activeWorkspace={activeWorkspace}
        branches={branches}
        activeBranch={activeBranch}
        viewRole={selection.viewRole}
        viewTaskId={selection.viewTaskId}
        session={rightPanelSession}
        viewSelectedTask={selection.viewSelectedTask}
        panelKind={orchestration.rightPanel.panelKind}
        isPanelOpen={orchestration.rightPanel.isPanelOpen}
        isViewSessionHistoryHydrating={selection.isViewSessionHistoryHydrating}
        documentsModel={orchestration.agentStudioWorkspaceSidebarModel}
        repoSettings={orchestration.repoSettings}
        worktreeRecoverySignal={worktreeRecoverySignal}
        setTaskTargetBranch={setTaskTargetBranch}
        detectingPullRequestTaskId={detectingPullRequestTaskId}
        onDetectPullRequest={onDetectPullRequest}
        onResolveGitConflict={onResolveGitConflict}
        onGitConflictQuickActionContextChange={onGitConflictQuickActionContextChange}
        refreshWorktreeRef={rightPanelRefreshWorktreeRef}
      />
    </>
  ) : null;

  return {
    isRightPanelVisible,
    rightPanelContent,
  };
}
