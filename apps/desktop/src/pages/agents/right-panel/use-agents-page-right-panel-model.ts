import { useMemo } from "react";
import type { BuildToolsSessionDescriptor } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-bootstrap";
import { useAgentStudioBuildToolsReadModel } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-read-model";
import { canDetectTaskPullRequest } from "@/lib/task-display";
import type { useTasksState, useWorkspaceState } from "@/state";
import { useAgentStudioGitActions } from "../use-agent-studio-git-actions";
import type {
  AgentStudioOrchestrationSelectionContext,
  useAgentStudioOrchestrationController,
} from "../use-agent-studio-orchestration-controller";
import { buildAgentStudioRightPanelModel } from "./use-agent-studio-right-panel";

export type UseAgentsPageRightPanelModelArgs = {
  activeRepo: string | null;
  activeBranch: ReturnType<typeof useWorkspaceState>["activeBranch"];
  viewRole: AgentStudioOrchestrationSelectionContext["viewRole"];
  session: BuildToolsSessionDescriptor;
  viewSelectedTask: AgentStudioOrchestrationSelectionContext["viewSelectedTask"];
  panelKind: Parameters<typeof buildAgentStudioRightPanelModel>[0]["panelKind"];
  isPanelOpen: boolean;
  isViewSessionHistoryHydrating: boolean;
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
  session,
  viewSelectedTask,
  panelKind,
  isPanelOpen,
  isViewSessionHistoryHydrating,
  documentsModel,
  repoSettings,
  runCompletionRecoverySignal,
  runs,
  detectingPullRequestTaskId,
  onDetectPullRequest,
  onResolveGitConflict,
}: UseAgentsPageRightPanelModelArgs) {
  const sessionRole = session.role;
  const sessionStatus = session.status;

  const { diffData, devServerModel, gitPanelContextMode, resolvedGitPanelBranch } =
    useAgentStudioBuildToolsReadModel({
      activeRepo,
      activeBranch,
      viewRole,
      session,
      viewSelectedTask,
      panelKind,
      isPanelOpen,
      isViewSessionHistoryHydrating,
      repoSettings,
      runCompletionRecoverySignal,
    });

  const isActiveBuilderWorking =
    sessionRole === "build" && (sessionStatus === "running" || sessionStatus === "starting");
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

  const rightPanelModel = useMemo(
    () =>
      buildAgentStudioRightPanelModel({
        panelKind,
        documentsModel,
        diffModel,
        devServerModel,
      }),
    [panelKind, documentsModel, diffModel, devServerModel],
  );

  return {
    isRightPanelVisible: Boolean(panelKind && isPanelOpen),
    rightPanelModel,
    refreshWorktree: diffData.refresh,
  };
}
