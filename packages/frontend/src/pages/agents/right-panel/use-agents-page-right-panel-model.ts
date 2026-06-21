import type { GitBranch, SystemOpenInToolId } from "@openducktor/contracts";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toBranchSelectorOptions } from "@/components/features/repository/branch-selector-model";
import type { BuildToolsSelectedView } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-bootstrap";
import { useAgentStudioBuildToolsWorktreeSnapshot } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-worktree-snapshot";
import type { GitConflict } from "@/features/agent-studio-git";
import { hostClient } from "@/lib/host-client";
import { canonicalTargetBranch, targetBranchFromSelection } from "@/lib/target-branch";
import { canDetectTaskPullRequest } from "@/lib/task-display";
import type { useTasksState, useWorkspaceState } from "@/state";
import type { ActiveWorkspace } from "@/types/state-slices";
import { useAgentStudioGitActions } from "../use-agent-studio-git-actions";
import type { useAgentStudioOrchestrationController } from "../use-agent-studio-orchestration-controller";
import { buildAgentStudioRightPanelModel } from "./use-agent-studio-right-panel";

export type AgentStudioGitConflictQuickActionContext = {
  conflict: GitConflict;
  resolveWithBuilder: () => Promise<void>;
  isHandling: boolean;
};

export type UseAgentsPageRightPanelModelArgs = {
  activeWorkspace: ActiveWorkspace | null;
  branches?: GitBranch[];
  activeBranch: ReturnType<typeof useWorkspaceState>["activeBranch"];
  selectedView: BuildToolsSelectedView;
  panelKind: Parameters<typeof buildAgentStudioRightPanelModel>[0]["panelKind"];
  isPanelOpen: boolean;
  documentsModel: Parameters<typeof buildAgentStudioRightPanelModel>[0]["documentsModel"];
  repoSettings: ReturnType<typeof useAgentStudioOrchestrationController>["repoSettings"];
  setTaskTargetBranch?: ReturnType<typeof useTasksState>["setTaskTargetBranch"];
  detectingPullRequestTaskId: string | null;
  onDetectPullRequest: (taskId: string) => void;
  onResolveGitConflict: Parameters<typeof useAgentStudioGitActions>[0]["onResolveGitConflict"];
  onGitConflictQuickActionContextChange?: (
    context: AgentStudioGitConflictQuickActionContext | null,
  ) => void;
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
  selectedTask: BuildToolsSelectedView["selectedTask"];
  setTaskTargetBranch?: ReturnType<typeof useTasksState>["setTaskTargetBranch"];
  detectingPullRequestTaskId: string | null;
  onDetectPullRequest: (taskId: string) => void;
  openDirectoryInTool?: (path: string, toolId: SystemOpenInToolId) => Promise<void>;
};

function collectUnmergedFilePaths(
  fileStatuses: BuildAgentsPageDiffModelSnapshot["diffData"]["fileStatuses"],
): string[] {
  const paths: string[] = [];
  for (const status of fileStatuses) {
    if (status.status === "unmerged") {
      paths.push(status.path);
    }
  }
  return paths;
}

export function buildAgentsPageDiffModel({
  branches,
  buildToolsSnapshot,
  gitActions,
  selectedTask,
  setTaskTargetBranch,
  detectingPullRequestTaskId,
  onDetectPullRequest,
  openDirectoryInTool = hostClient.systemOpenDirectoryInTool,
}: BuildAgentsPageDiffModelArgs) {
  const { diffData, gitPanelContextMode, openInTarget, resolvedGitPanelBranch, targetBranchState } =
    buildToolsSnapshot;
  const targetBranchValidationError = targetBranchState.validationError;
  const pullRequestDetectionTask =
    selectedTask && !selectedTask.pullRequest && canDetectTaskPullRequest(selectedTask)
      ? selectedTask
      : null;
  let targetBranchUpdateModel = {};
  if (gitPanelContextMode === "worktree" && selectedTask && setTaskTargetBranch) {
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
    targetBranchUpdateModel = {
      targetBranchOptions,
      targetBranchSelectionValue: targetBranchState.selectionValue,
      onUpdateTargetBranch: async (selection: string) => {
        await setTaskTargetBranch(selectedTask.id, targetBranchFromSelection(selection));
      },
    };
  }

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
    ...(targetBranchValidationError
      ? {
          targetBranch: targetBranchState.displayTargetBranch,
        }
      : {}),
    pullRequest: selectedTask?.pullRequest ?? null,
    ...targetBranchUpdateModel,
    ...(selectedTask && detectingPullRequestTaskId === selectedTask.id
      ? { isDetectingPullRequest: true }
      : {}),
    ...(pullRequestDetectionTask
      ? {
          onDetectPullRequest: () => onDetectPullRequest(pullRequestDetectionTask.id),
        }
      : {}),
    ...gitActions,
    ...(targetBranchValidationError
      ? {
          isGitActionsLocked: true,
          gitActionsLockReason: targetBranchValidationError,
          showLockReasonBanner: true,
        }
      : {}),
  };
}

export function useAgentsPageRightPanelModel({
  activeWorkspace,
  branches = [],
  activeBranch,
  selectedView,
  panelKind,
  isPanelOpen,
  documentsModel,
  repoSettings,
  setTaskTargetBranch,
  detectingPullRequestTaskId,
  onDetectPullRequest,
  onResolveGitConflict,
  onGitConflictQuickActionContextChange,
}: UseAgentsPageRightPanelModelArgs) {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const buildToolsSnapshot = useAgentStudioBuildToolsWorktreeSnapshot({
    workspaceRepoPath,
    activeBranch,
    selectedView,
    panelKind,
    isPanelOpen,
    repoSettings,
  });
  const { diffData, devServerModel, resolvedGitPanelBranch } = buildToolsSnapshot;

  const detectedConflictedFiles = useMemo(
    () => collectUnmergedFilePaths(diffData.fileStatuses),
    [diffData.fileStatuses],
  );
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
    detectedConflictedFiles,
    worktreeStatusSnapshotKey: diffData.statusSnapshotKey ?? null,
    refreshDiffData: diffData.refresh,
    isDiffDataLoading: diffData.isLoading,
    isBuilderSessionWorking: buildToolsSnapshot.context.isSelectedBuilderWorking,
    ...(onResolveGitConflict ? { onResolveGitConflict } : {}),
  });
  const gitConflictQuickActionContext = useMemo<AgentStudioGitConflictQuickActionContext | null>(
    () =>
      gitActions.gitConflict
        ? {
            conflict: gitActions.gitConflict,
            resolveWithBuilder: gitActions.askBuilderToResolveGitConflict,
            isHandling: gitActions.isHandlingGitConflict,
          }
        : null,
    [
      gitActions.gitConflict,
      gitActions.askBuilderToResolveGitConflict,
      gitActions.isHandlingGitConflict,
    ],
  );
  const onGitConflictQuickActionContextChangeRef = useRef(onGitConflictQuickActionContextChange);

  useEffect(() => {
    onGitConflictQuickActionContextChangeRef.current = onGitConflictQuickActionContextChange;
  }, [onGitConflictQuickActionContextChange]);

  const clearGitConflictQuickActionContext = useCallback(() => {
    onGitConflictQuickActionContextChangeRef.current?.(null);
  }, []);

  const publishGitConflictQuickActionContext = useCallback(() => {
    onGitConflictQuickActionContextChange?.(gitConflictQuickActionContext);
  }, [gitConflictQuickActionContext, onGitConflictQuickActionContextChange]);
  useEffect(publishGitConflictQuickActionContext, [publishGitConflictQuickActionContext]);

  useEffect(() => clearGitConflictQuickActionContext, [clearGitConflictQuickActionContext]);
  const diffModel = useMemo(
    () =>
      buildAgentsPageDiffModel({
        branches,
        buildToolsSnapshot,
        gitActions,
        selectedTask: selectedView.selectedTask,
        detectingPullRequestTaskId,
        onDetectPullRequest,
        ...(setTaskTargetBranch ? { setTaskTargetBranch } : {}),
      }),
    [
      buildToolsSnapshot,
      branches,
      gitActions,
      onDetectPullRequest,
      detectingPullRequestTaskId,
      setTaskTargetBranch,
      selectedView.selectedTask,
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
    refreshWorktree: buildToolsSnapshot.refreshWorktree,
  };
}
