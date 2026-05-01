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

type BuildAgentsPageDiffModelSnapshot = Pick<
  ReturnType<typeof useAgentStudioBuildToolsWorktreeSnapshot>,
  | "diffData"
  | "gitPanelContextMode"
  | "openInTarget"
  | "resolvedGitPanelBranch"
  | "targetBranchState"
>;

type BuildAgentsPageDiffModelArgs = {
  branches: GitBranch[];
  buildToolsSnapshot: BuildAgentsPageDiffModelSnapshot;
  gitActions: ReturnType<typeof useAgentStudioGitActions>;
  viewSelectedTask: AgentStudioOrchestrationSelectionContext["viewSelectedTask"];
  setTaskTargetBranch?: ReturnType<typeof useTasksState>["setTaskTargetBranch"];
  detectingPullRequestTaskId: string | null;
  onDetectPullRequest: (taskId: string) => void;
  openDirectoryInTool?: (path: string, toolId: SystemOpenInToolId) => Promise<void>;
};

export function buildAgentsPageDiffModel({
  branches,
  buildToolsSnapshot,
  gitActions,
  viewSelectedTask,
  setTaskTargetBranch,
  detectingPullRequestTaskId,
  onDetectPullRequest,
  openDirectoryInTool = hostClient.systemOpenDirectoryInTool,
}: BuildAgentsPageDiffModelArgs) {
  const { diffData, gitPanelContextMode, openInTarget, resolvedGitPanelBranch, targetBranchState } =
    buildToolsSnapshot;
  const configuredTargetBranch = canonicalTargetBranch(targetBranchState.effectiveTargetBranch);
  const targetBranchOptions = toBranchSelectorOptions(branches, {
    valueFormat: "full_ref",
    includeOptions: configuredTargetBranch
      ? [
          {
            value: targetBranchState.selectionValue,
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
    openInTargetPath: openInTarget.path,
    openInDisabledReason: openInTarget.disabledReason,
    ...(openInTarget.path
      ? {
          openDirectoryInTool: (toolId: SystemOpenInToolId) =>
            openDirectoryInTool(openInTarget.path as string, toolId),
        }
      : {}),
    ...(targetBranchState.validationError
      ? {
          targetBranch: targetBranchState.displayTargetBranch,
        }
      : {}),
    pullRequest: viewSelectedTask?.pullRequest ?? null,
    ...(viewSelectedTask && setTaskTargetBranch
      ? {
          targetBranchOptions,
          targetBranchSelectionValue: targetBranchState.selectionValue,
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
    ...(targetBranchState.validationError
      ? {
          isGitActionsLocked: true,
          gitActionsLockReason: targetBranchState.validationError,
          showLockReasonBanner: true,
        }
      : {}),
  };
}

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
  const { diffData, devServerModel, resolvedGitPanelBranch } = buildToolsSnapshot;

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
    return buildAgentsPageDiffModel({
      branches,
      buildToolsSnapshot,
      gitActions,
      viewSelectedTask,
      detectingPullRequestTaskId,
      onDetectPullRequest,
      ...(setTaskTargetBranch ? { setTaskTargetBranch } : {}),
    });
  }, [
    buildToolsSnapshot,
    branches,
    gitActions,
    onDetectPullRequest,
    detectingPullRequestTaskId,
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
