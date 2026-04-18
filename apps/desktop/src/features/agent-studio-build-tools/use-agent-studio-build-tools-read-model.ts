import { resolveTaskTargetBranchState, UPSTREAM_TARGET_BRANCH } from "@/lib/target-branch";
import {
  buildAgentStudioGitPanelBranchIdentityKey,
  resolveAgentStudioGitPanelBranch,
} from "@/pages/agents/right-panel/agents-page-git-panel";
import { useAgentStudioDevServerPanel } from "@/pages/agents/right-panel/use-agent-studio-dev-server-panel";
import type {
  AgentStudioOrchestrationSelectionContext,
  useAgentStudioOrchestrationController,
} from "@/pages/agents/use-agent-studio-orchestration-controller";
import type { useWorkspaceState } from "@/state";
import { useAgentStudioDiffData } from "../agent-studio-git";
import {
  type BuildToolsSessionDescriptor,
  useAgentStudioBuildToolsBootstrap,
} from "./use-agent-studio-build-tools-bootstrap";

type UseAgentStudioBuildToolsReadModelArgs = {
  workspaceRepoPath: string | null;
  activeBranch: ReturnType<typeof useWorkspaceState>["activeBranch"];
  viewRole: AgentStudioOrchestrationSelectionContext["viewRole"];
  session: BuildToolsSessionDescriptor;
  viewSelectedTask: AgentStudioOrchestrationSelectionContext["viewSelectedTask"];
  panelKind: "documents" | "build_tools" | null;
  isPanelOpen: boolean;
  isViewSessionHistoryHydrating: boolean;
  repoSettings: ReturnType<typeof useAgentStudioOrchestrationController>["repoSettings"];
  runCompletionRecoverySignal: number;
};

export function useAgentStudioBuildToolsReadModel({
  workspaceRepoPath,
  activeBranch,
  viewRole,
  session,
  viewSelectedTask,
  panelKind,
  isPanelOpen,
  isViewSessionHistoryHydrating,
  repoSettings,
  runCompletionRecoverySignal,
}: UseAgentStudioBuildToolsReadModelArgs) {
  const sessionRole = session.role;
  const gitPanelContextMode: "repository" | "worktree" =
    sessionRole === "build" ? "worktree" : "repository";
  const repositoryBranchIdentityKey =
    gitPanelContextMode === "repository"
      ? buildAgentStudioGitPanelBranchIdentityKey(activeBranch)
      : null;
  const taskTargetBranchError =
    gitPanelContextMode === "worktree" ? (viewSelectedTask?.targetBranchError ?? null) : null;
  const taskTargetBranchState = resolveTaskTargetBranchState({
    taskTargetBranch: viewSelectedTask?.targetBranch,
    taskTargetBranchError,
    defaultTargetBranch: repoSettings?.defaultTargetBranch,
  });
  const diffComparisonTarget =
    gitPanelContextMode === "repository"
      ? { branch: UPSTREAM_TARGET_BRANCH }
      : taskTargetBranchState.effectiveTargetBranch;
  const buildToolsBootstrap = useAgentStudioBuildToolsBootstrap({
    workspaceRepoPath,
    viewRole,
    session,
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
    ...(taskTargetBranchState.validationError
      ? { preconditionError: taskTargetBranchState.validationError }
      : {}),
    branchIdentityKey: repositoryBranchIdentityKey,
    enablePolling: buildToolsBootstrap.shouldEnableEventPolling,
  });

  const devServerModel = useAgentStudioDevServerPanel({
    repoPath: buildToolsBootstrap.repoPath,
    taskId: buildToolsBootstrap.isEnabled ? (viewSelectedTask?.id ?? null) : null,
    repoSettings,
    enabled: buildToolsBootstrap.isEnabled,
  });

  return {
    diffData,
    refreshWorktree: diffData.refresh,
    devServerModel,
    gitPanelContextMode,
    resolvedGitPanelBranch: resolveAgentStudioGitPanelBranch({
      contextMode: gitPanelContextMode,
      workspaceActiveBranch: activeBranch,
      diffBranch: diffData.branch,
    }),
  };
}
