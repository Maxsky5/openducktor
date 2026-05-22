import { type ReactElement, useMemo, useRef } from "react";
import type { BuildToolsSessionDescriptor } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-bootstrap";
import type { GitDiffRefresh } from "@/features/agent-studio-git";
import type {
  AgentStudioOrchestrationSelectionContext,
  useAgentStudioOrchestrationController,
} from "../use-agent-studio-orchestration-controller";
import type {
  AgentStudioGitConflictQuickActionContext,
  UseAgentsPageRightPanelModelArgs,
} from "../use-agents-page-right-panel-model";
import {
  AgentsPageBuildWorktreeRefreshRuntime,
  AgentsPageRightPanelRuntime,
} from "./agents-page-right-panel-runtime";

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
        branches={branches}
      />
    </>
  ) : null;

  return {
    isRightPanelVisible,
    rightPanelContent,
  };
}
