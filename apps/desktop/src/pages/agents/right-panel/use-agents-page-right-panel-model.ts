import type { GitBranch } from "@openducktor/contracts";
import { useMemo } from "react";
import { toBranchSelectorOptions } from "@/components/features/repository/branch-selector-model";
import type { BuildToolsSessionDescriptor } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-bootstrap";
import { useAgentStudioBuildToolsReadModel } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-read-model";
import {
  canonicalTargetBranch,
  resolveTaskTargetBranchState,
  targetBranchFromSelection,
} from "@/lib/target-branch";
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
  branches?: GitBranch[];
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
  setTaskTargetBranch?: ReturnType<typeof useTasksState>["setTaskTargetBranch"];
  detectingPullRequestTaskId: string | null;
  onDetectPullRequest: (taskId: string) => void;
  onResolveGitConflict: Parameters<typeof useAgentStudioGitActions>[0]["onResolveGitConflict"];
};

export function useAgentsPageRightPanelModel({
  activeRepo,
  branches = [],
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
  setTaskTargetBranch,
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
  const diffModel = useMemo(() => {
    const taskTargetBranchState = resolveTaskTargetBranchState({
      taskTargetBranch: viewSelectedTask?.targetBranch,
      taskTargetBranchError: viewSelectedTask?.targetBranchError ?? null,
      defaultTargetBranch: repoSettings?.defaultTargetBranch,
    });
    const configuredTargetBranch = canonicalTargetBranch(
      taskTargetBranchState.effectiveTargetBranch,
    );
    const targetBranchOptions = toBranchSelectorOptions(branches, {
      valueFormat: "full_ref",
      includeOptions: configuredTargetBranch
        ? [
            {
              value: taskTargetBranchState.selectionValue,
              label: configuredTargetBranch,
              secondaryLabel: "configured",
              searchKeywords: configuredTargetBranch.split("/").filter(Boolean),
            },
          ]
        : [],
    });

    return {
      ...diffData,
      contextMode: gitPanelContextMode,
      branch: resolvedGitPanelBranch,
      ...(taskTargetBranchState.validationError
        ? {
            targetBranch: taskTargetBranchState.displayTargetBranch,
          }
        : {}),
      pullRequest: viewSelectedTask?.pullRequest ?? null,
      ...(viewSelectedTask && setTaskTargetBranch
        ? {
            targetBranchOptions,
            targetBranchSelectionValue: taskTargetBranchState.selectionValue,
            onUpdateTargetBranch: async (selection: string) => {
              await setTaskTargetBranch(viewSelectedTask.id, targetBranchFromSelection(selection));
            },
          }
        : {}),
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
      ...(taskTargetBranchState.validationError
        ? {
            isGitActionsLocked: true,
            gitActionsLockReason: taskTargetBranchState.validationError,
            showLockReasonBanner: true,
          }
        : {}),
    };
  }, [
    branches,
    diffData,
    gitActions,
    gitPanelContextMode,
    onDetectPullRequest,
    detectingPullRequestTaskId,
    repoSettings?.defaultTargetBranch,
    resolvedGitPanelBranch,
    runs,
    setTaskTargetBranch,
    viewSelectedTask,
  ]);

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
