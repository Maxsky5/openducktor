import type { GitBranch, SystemOpenInToolId } from "@openducktor/contracts";
import { useMemo } from "react";
import { toBranchSelectorOptions } from "@/components/features/repository/branch-selector-model";
import type { BuildToolsSessionDescriptor } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-bootstrap";
import { useAgentStudioBuildToolsWorktreeSnapshot } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-worktree-snapshot";
import { hostClient } from "@/lib/host-client";
import { canonicalTargetBranch, targetBranchFromSelection } from "@/lib/target-branch";
import { canDetectTaskPullRequest } from "@/lib/task-display";
import type { useTasksState, useWorkspaceState } from "@/state";
import type { ActiveWorkspace } from "@/types/state-slices";
import { useAgentStudioGitActions } from "../use-agent-studio-git-actions";
import type {
  AgentStudioOrchestrationSelectionContext,
  useAgentStudioOrchestrationController,
} from "../use-agent-studio-orchestration-controller";
import { buildAgentStudioRightPanelModel } from "./use-agent-studio-right-panel";

export type UseAgentsPageRightPanelModelArgs = {
  activeWorkspace: ActiveWorkspace | null;
  branches?: GitBranch[];
  activeBranch: ReturnType<typeof useWorkspaceState>["activeBranch"];
  viewRole: AgentStudioOrchestrationSelectionContext["viewRole"];
  viewTaskId: AgentStudioOrchestrationSelectionContext["viewTaskId"];
  session: BuildToolsSessionDescriptor;
  viewSelectedTask: AgentStudioOrchestrationSelectionContext["viewSelectedTask"];
  panelKind: Parameters<typeof buildAgentStudioRightPanelModel>[0]["panelKind"];
  isPanelOpen: boolean;
  isViewSessionHistoryHydrating: boolean;
  documentsModel: Parameters<typeof buildAgentStudioRightPanelModel>[0]["documentsModel"];
  repoSettings: ReturnType<typeof useAgentStudioOrchestrationController>["repoSettings"];
  worktreeRecoverySignal: number;
  setTaskTargetBranch?: ReturnType<typeof useTasksState>["setTaskTargetBranch"];
  detectingPullRequestTaskId: string | null;
  onDetectPullRequest: (taskId: string) => void;
  onResolveGitConflict: Parameters<typeof useAgentStudioGitActions>[0]["onResolveGitConflict"];
};

export function useAgentsPageRightPanelModel({
  activeWorkspace,
  branches = [],
  activeBranch,
  viewRole,
  viewTaskId,
  session,
  viewSelectedTask,
  panelKind,
  isPanelOpen,
  isViewSessionHistoryHydrating,
  documentsModel,
  repoSettings,
  worktreeRecoverySignal,
  setTaskTargetBranch,
  detectingPullRequestTaskId,
  onDetectPullRequest,
  onResolveGitConflict,
}: UseAgentsPageRightPanelModelArgs) {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const sessionRole = session.role;
  const sessionStatus = session.status;

  const buildToolsSnapshot = useAgentStudioBuildToolsWorktreeSnapshot({
    workspaceRepoPath,
    activeBranch,
    viewRole,
    viewTaskId,
    session,
    viewSelectedTask,
    panelKind,
    isPanelOpen,
    isViewSessionHistoryHydrating,
    repoSettings,
    worktreeRecoverySignal,
  });
  const { diffData, devServerModel, gitPanelContextMode, resolvedGitPanelBranch } =
    buildToolsSnapshot;

  const isActiveBuilderWorking =
    sessionRole === "build" && (sessionStatus === "running" || sessionStatus === "starting");
  const gitActions = useAgentStudioGitActions({
    repoPath: workspaceRepoPath,
    workingDir: diffData.worktreePath,
    branch: resolvedGitPanelBranch,
    targetBranch: diffData.targetBranch,
    detectedConflict: diffData.gitConflict ?? null,
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
    const taskTargetBranchState = buildToolsSnapshot.targetBranchState;
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

    const openInTarget = buildToolsSnapshot.openInTarget;

    return {
      ...diffData,
      contextMode: gitPanelContextMode,
      branch: resolvedGitPanelBranch,
      openInTargetPath: openInTarget.path,
      openInDisabledReason: openInTarget.disabledReason,
      ...(openInTarget.path
        ? {
            openDirectoryInTool: (toolId: SystemOpenInToolId) =>
              hostClient.systemOpenDirectoryInTool(openInTarget.path as string, toolId),
          }
        : {}),
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
      canDetectTaskPullRequest(viewSelectedTask)
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
    buildToolsSnapshot.openInTarget,
    buildToolsSnapshot.targetBranchState,
    branches,
    diffData,
    gitActions,
    gitPanelContextMode,
    onDetectPullRequest,
    detectingPullRequestTaskId,
    resolvedGitPanelBranch,
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
    refreshWorktree: buildToolsSnapshot.refreshWorktree,
  };
}
