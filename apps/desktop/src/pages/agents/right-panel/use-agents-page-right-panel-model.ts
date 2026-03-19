import { useMemo } from "react";
import { useAgentStudioDiffData } from "@/features/agent-studio-git";
import { normalizeTargetBranch, UPSTREAM_TARGET_BRANCH } from "@/lib/target-branch";
import { canDetectTaskPullRequest } from "@/lib/task-display";
import type { useTasksState, useWorkspaceState } from "@/state";
import { useAgentStudioBuildWorktreeRefresh } from "../use-agent-studio-build-worktree-refresh";
import { useAgentStudioGitActions } from "../use-agent-studio-git-actions";
import type {
  AgentStudioOrchestrationSelectionContext,
  useAgentStudioOrchestrationController,
} from "../use-agent-studio-orchestration-controller";
import {
  buildAgentStudioGitPanelBranchIdentityKey,
  resolveAgentStudioGitPanelBranch,
} from "./agents-page-git-panel";
import { buildAgentStudioRightPanelModel } from "./use-agent-studio-right-panel";

type UseAgentsPageRightPanelModelArgs = {
  activeRepo: string | null;
  activeBranch: ReturnType<typeof useWorkspaceState>["activeBranch"];
  viewRole: AgentStudioOrchestrationSelectionContext["viewRole"];
  viewActiveSession: AgentStudioOrchestrationSelectionContext["viewActiveSession"];
  viewSelectedTask: AgentStudioOrchestrationSelectionContext["viewSelectedTask"];
  panelKind: Parameters<typeof buildAgentStudioRightPanelModel>[0]["panelKind"];
  isPanelOpen: boolean;
  documentsModel: Parameters<typeof buildAgentStudioRightPanelModel>[0]["documentsModel"];
  repoSettings: ReturnType<typeof useAgentStudioOrchestrationController>["repoSettings"];
  runCompletionRecoverySignal: number;
  runs: ReturnType<typeof useTasksState>["runs"];
  detectingPullRequestTaskId: string | null;
  onDetectPullRequest: (taskId: string) => void;
  onResolveGitConflict: Parameters<typeof useAgentStudioGitActions>[0]["onResolveGitConflict"];
};

export function useAgentsPageRightPanelModel({
  activeRepo,
  activeBranch,
  viewRole,
  viewActiveSession,
  viewSelectedTask,
  panelKind,
  isPanelOpen,
  documentsModel,
  repoSettings,
  runCompletionRecoverySignal,
  runs,
  detectingPullRequestTaskId,
  onDetectPullRequest,
  onResolveGitConflict,
}: UseAgentsPageRightPanelModelArgs) {
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
  const shouldLoadVisibleDiffPanel = viewRole === "build" && panelKind === "diff" && isPanelOpen;
  const diffData = useAgentStudioDiffData({
    repoPath: shouldLoadVisibleDiffPanel ? activeRepo : null,
    sessionWorkingDirectory: shouldLoadVisibleDiffPanel
      ? (viewActiveSession?.workingDirectory ?? null)
      : null,
    sessionRunId: shouldLoadVisibleDiffPanel ? (viewActiveSession?.runId ?? null) : null,
    runCompletionRecoverySignal,
    defaultTargetBranch: diffComparisonTarget,
    branchIdentityKey: repositoryBranchIdentityKey,
    enablePolling: shouldLoadVisibleDiffPanel && Boolean(viewActiveSession),
  });
  const resolvedGitPanelBranch = resolveAgentStudioGitPanelBranch({
    contextMode: gitPanelContextMode,
    workspaceActiveBranch: activeBranch,
    diffBranch: diffData.branch,
  });

  useAgentStudioBuildWorktreeRefresh({
    viewRole,
    activeSession: viewActiveSession,
    refreshWorktree: diffData.refresh,
  });

  const isActiveBuilderWorking =
    viewActiveSession?.role === "build" &&
    (viewActiveSession.status === "running" || viewActiveSession.status === "starting");
  const gitActions = useAgentStudioGitActions({
    repoPath: activeRepo,
    workingDir: diffData.worktreePath,
    branch: resolvedGitPanelBranch,
    targetBranch: diffData.targetBranch,
    hashVersion: diffData.hashVersion,
    statusHash: diffData.statusHash,
    diffHash: diffData.diffHash,
    upstreamAheadBehind: diffData.upstreamAheadBehind ?? null,
    detectedConflictedFiles: diffData.fileStatuses
      .filter((status) => status.status === "unmerged")
      .map((status) => status.path),
    worktreeStatusSnapshotKey: diffData.statusSnapshotKey ?? null,
    refreshDiffData: diffData.refresh,
    isDiffDataLoading: diffData.isLoading,
    isBuilderSessionWorking: isActiveBuilderWorking,
    ...(onResolveGitConflict ? { onResolveGitConflict } : {}),
  });
  const diffModel = useMemo(
    () => ({
      ...diffData,
      contextMode: gitPanelContextMode,
      branch: resolvedGitPanelBranch,
      pullRequest: viewSelectedTask?.pullRequest ?? null,
      ...(viewSelectedTask && detectingPullRequestTaskId === viewSelectedTask.id
        ? { isDetectingPullRequest: true }
        : {}),
      ...(viewSelectedTask &&
      !viewSelectedTask.pullRequest &&
      canDetectTaskPullRequest(viewSelectedTask, runs)
        ? {
            onDetectPullRequest: () => onDetectPullRequest(viewSelectedTask.id),
          }
        : {}),
      ...gitActions,
    }),
    [
      diffData,
      gitActions,
      gitPanelContextMode,
      onDetectPullRequest,
      detectingPullRequestTaskId,
      resolvedGitPanelBranch,
      runs,
      viewSelectedTask,
    ],
  );

  return {
    isRightPanelVisible: Boolean(panelKind && isPanelOpen),
    rightPanelModel: buildAgentStudioRightPanelModel({
      panelKind,
      documentsModel,
      diffModel,
    }),
  };
}
