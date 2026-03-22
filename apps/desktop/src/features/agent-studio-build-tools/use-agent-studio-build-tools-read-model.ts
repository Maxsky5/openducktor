import { normalizeTargetBranch, UPSTREAM_TARGET_BRANCH } from "@/lib/target-branch";
import {
  buildAgentStudioGitPanelBranchIdentityKey,
  resolveAgentStudioGitPanelBranch,
} from "@/pages/agents/right-panel/agents-page-git-panel";
import { useAgentStudioDevServerPanel } from "@/pages/agents/right-panel/use-agent-studio-dev-server-panel";
import { useAgentStudioBuildWorktreeRefresh } from "@/pages/agents/use-agent-studio-build-worktree-refresh";
import type {
  AgentStudioOrchestrationSelectionContext,
  useAgentStudioOrchestrationController,
} from "@/pages/agents/use-agent-studio-orchestration-controller";
import type { useWorkspaceState } from "@/state";
import { useAgentStudioDiffData } from "../agent-studio-git";
import { useAgentStudioBuildToolsBootstrap } from "./use-agent-studio-build-tools-bootstrap";

type UseAgentStudioBuildToolsReadModelArgs = {
  activeRepo: string | null;
  activeBranch: ReturnType<typeof useWorkspaceState>["activeBranch"];
  viewRole: AgentStudioOrchestrationSelectionContext["viewRole"];
  viewActiveSession: AgentStudioOrchestrationSelectionContext["viewActiveSession"];
  viewSelectedTask: AgentStudioOrchestrationSelectionContext["viewSelectedTask"];
  panelKind: "documents" | "build_tools" | null;
  isPanelOpen: boolean;
  isViewSessionHistoryHydrating: boolean;
  repoSettings: ReturnType<typeof useAgentStudioOrchestrationController>["repoSettings"];
  runCompletionRecoverySignal: number;
};

export function useAgentStudioBuildToolsReadModel({
  activeRepo,
  activeBranch,
  viewRole,
  viewActiveSession,
  viewSelectedTask,
  panelKind,
  isPanelOpen,
  isViewSessionHistoryHydrating,
  repoSettings,
  runCompletionRecoverySignal,
}: UseAgentStudioBuildToolsReadModelArgs) {
  const gitPanelContextMode: "repository" | "worktree" =
    viewActiveSession?.role === "build" ? "worktree" : "repository";
  const repositoryBranchIdentityKey =
    gitPanelContextMode === "repository"
      ? buildAgentStudioGitPanelBranchIdentityKey(activeBranch)
      : null;
  const diffComparisonTarget =
    gitPanelContextMode === "repository"
      ? { branch: UPSTREAM_TARGET_BRANCH }
      : (repoSettings?.defaultTargetBranch ?? normalizeTargetBranch(null));
  const buildToolsBootstrap = useAgentStudioBuildToolsBootstrap({
    activeRepo,
    viewRole,
    viewActiveSession,
    viewSelectedTask,
    panelKind,
    isPanelOpen,
    isViewSessionHistoryHydrating,
  });

  const diffData = useAgentStudioDiffData({
    repoPath: buildToolsBootstrap.repoPath,
    sessionWorkingDirectory: buildToolsBootstrap.sessionWorkingDirectory,
    sessionRunId: buildToolsBootstrap.sessionRunId,
    runCompletionRecoverySignal,
    defaultTargetBranch: diffComparisonTarget,
    branchIdentityKey: repositoryBranchIdentityKey,
    enablePolling: buildToolsBootstrap.shouldEnableEventPolling,
  });

  useAgentStudioBuildWorktreeRefresh({
    viewRole,
    activeSession: viewActiveSession,
    isSessionHistoryHydrating: isViewSessionHistoryHydrating,
    refreshWorktree: diffData.refresh,
  });

  const devServerModel = useAgentStudioDevServerPanel({
    repoPath: buildToolsBootstrap.repoPath,
    taskId: buildToolsBootstrap.isEnabled ? (viewSelectedTask?.id ?? null) : null,
    repoSettings,
    enabled: buildToolsBootstrap.isEnabled,
  });

  return {
    diffData,
    devServerModel,
    gitPanelContextMode,
    resolvedGitPanelBranch: resolveAgentStudioGitPanelBranch({
      contextMode: gitPanelContextMode,
      workspaceActiveBranch: activeBranch,
      diffBranch: diffData.branch,
    }),
  };
}
