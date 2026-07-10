import type { GitBranch, SystemOpenInToolId } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { TaskExecutionSelectedFile } from "@/components/features/agents";
import { toBranchSelectorOptions } from "@/components/features/repository/branch-selector-model";
import type { BuildToolsSelectedView } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-bootstrap";
import { useAgentStudioBuildToolsWorktreeSnapshot } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-worktree-snapshot";
import type { GitConflict } from "@/features/agent-studio-git";
import { hostClient } from "@/lib/host-client";
import { canonicalTargetBranch, targetBranchFromSelection } from "@/lib/target-branch";
import { canDetectTaskPullRequest } from "@/lib/task-display";
import type { useTasksState, useWorkspaceState } from "@/state";
import {
  type PullRequestReviewContextQueryInput,
  prefetchPullRequestReviewContextFromQuery,
} from "@/state/queries/pull-request-review";
import type { ActiveWorkspace } from "@/types/state-slices";
import { useAgentStudioGitActions } from "../use-agent-studio-git-actions";
import type { useAgentStudioOrchestrationController } from "../use-agent-studio-orchestration-controller";
import { buildTaskExecutionPanelModel } from "./use-agent-studio-right-panel";

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
  tabs: Parameters<typeof buildTaskExecutionPanelModel>[0]["tabs"];
  activeTabId: Parameters<typeof buildTaskExecutionPanelModel>[0]["activeTabId"];
  onActiveTabChange: Parameters<typeof buildTaskExecutionPanelModel>[0]["onActiveTabChange"];
  isPanelOpen: boolean;
  documentsModel: Parameters<typeof buildTaskExecutionPanelModel>[0]["documentModel"];
  selectedFile: TaskExecutionSelectedFile | null;
  onSelectFile: (file: TaskExecutionSelectedFile) => void;
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

type FileExplorerRoot = {
  rootPath: string | null;
  unavailableReason: string | null;
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

export const resolveTaskExecutionFileExplorerRoot = ({
  workspaceRepoPath,
  contextMode,
  worktreePath,
  isWorktreeResolving,
  worktreeError,
}: {
  workspaceRepoPath: string | null;
  contextMode: ReturnType<typeof useAgentStudioBuildToolsWorktreeSnapshot>["gitPanelContextMode"];
  worktreePath: string | null;
  isWorktreeResolving: boolean;
  worktreeError: string | null;
}): FileExplorerRoot => {
  if (contextMode === "worktree") {
    if (worktreePath) {
      return { rootPath: worktreePath, unavailableReason: null };
    }
    if (isWorktreeResolving) {
      return { rootPath: null, unavailableReason: "Resolving task worktree..." };
    }
    return {
      rootPath: null,
      unavailableReason: worktreeError ?? "Task worktree is unavailable.",
    };
  }

  if (workspaceRepoPath) {
    return {
      rootPath: workspaceRepoPath,
      unavailableReason: null,
    };
  }

  return {
    rootPath: null,
    unavailableReason: "No repository is selected.",
  };
};

export const resolveTaskExecutionFileExplorerTargetBranch = ({
  contextMode,
  targetBranch,
  upstreamStatus,
}: {
  contextMode: ReturnType<typeof useAgentStudioBuildToolsWorktreeSnapshot>["gitPanelContextMode"];
  targetBranch: string | null;
  upstreamStatus: ReturnType<
    typeof useAgentStudioBuildToolsWorktreeSnapshot
  >["diffData"]["upstreamStatus"];
}): string | null => {
  if (contextMode === "repository" && upstreamStatus !== "tracking") {
    return null;
  }
  return targetBranch;
};

export function useAgentsPageRightPanelModel({
  activeWorkspace,
  branches = [],
  activeBranch,
  selectedView,
  tabs,
  activeTabId,
  onActiveTabChange,
  isPanelOpen,
  documentsModel,
  selectedFile,
  onSelectFile,
  repoSettings,
  setTaskTargetBranch,
  detectingPullRequestTaskId,
  onDetectPullRequest,
  onResolveGitConflict,
  onGitConflictQuickActionContextChange,
}: UseAgentsPageRightPanelModelArgs) {
  const queryClient = useQueryClient();
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const isGitTabActive = activeTabId === "git" && isPanelOpen;
  const buildToolsSnapshot = useAgentStudioBuildToolsWorktreeSnapshot({
    workspaceRepoPath,
    activeBranch,
    selectedView,
    isGitTabActive,
    isRightPanelOpen: isPanelOpen,
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

  const fileExplorerRoot = useMemo(
    () =>
      resolveTaskExecutionFileExplorerRoot({
        workspaceRepoPath,
        contextMode: buildToolsSnapshot.gitPanelContextMode,
        worktreePath: buildToolsSnapshot.worktree.path,
        isWorktreeResolving: buildToolsSnapshot.worktree.isResolving,
        worktreeError: buildToolsSnapshot.worktree.error,
      }),
    [
      buildToolsSnapshot.gitPanelContextMode,
      buildToolsSnapshot.worktree.error,
      buildToolsSnapshot.worktree.isResolving,
      buildToolsSnapshot.worktree.path,
      workspaceRepoPath,
    ],
  );
  const fileExplorerTargetBranch = resolveTaskExecutionFileExplorerTargetBranch({
    contextMode: buildToolsSnapshot.gitPanelContextMode,
    targetBranch: diffData.targetBranch ?? null,
    upstreamStatus: diffData.upstreamStatus,
  });
  const fileExplorerModel = useMemo(
    () => ({
      ...fileExplorerRoot,
      targetBranch: fileExplorerTargetBranch,
      isActive: activeTabId === "file_explorer" && isPanelOpen,
      selectedFile,
      onSelectFile,
    }),
    [
      activeTabId,
      fileExplorerRoot,
      fileExplorerTargetBranch,
      isPanelOpen,
      onSelectFile,
      selectedFile,
    ],
  );
  const visibleDevServerModel = selectedView.role === "build" ? devServerModel : null;
  const hasCiChecksTab = tabs.some((tab) => tab.id === "ci_checks");
  const linkedPullRequestProviderId = selectedView.selectedTask?.pullRequest?.providerId ?? null;
  const linkedPullRequestNumber = selectedView.selectedTask?.pullRequest?.number ?? null;
  const ciReviewQueryInput = useMemo<PullRequestReviewContextQueryInput | null>(
    () =>
      workspaceRepoPath
        ? {
            repoPath: workspaceRepoPath,
            ...(selectedView.taskId ? { taskId: selectedView.taskId } : {}),
            ...(selectedView.selectedSession.identity?.workingDirectory
              ? {
                  workingDirectory: selectedView.selectedSession.identity.workingDirectory,
                }
              : {}),
            ...(linkedPullRequestProviderId && linkedPullRequestNumber
              ? {
                  pullRequest: {
                    providerId: linkedPullRequestProviderId,
                    number: linkedPullRequestNumber,
                  },
                }
              : {}),
          }
        : null,
    [
      linkedPullRequestNumber,
      linkedPullRequestProviderId,
      selectedView.selectedSession.identity?.workingDirectory,
      selectedView.taskId,
      workspaceRepoPath,
    ],
  );
  const hasLinkedPullRequest =
    linkedPullRequestProviderId !== null && linkedPullRequestNumber !== null;
  useEffect(() => {
    if (!hasCiChecksTab || !hasLinkedPullRequest || !ciReviewQueryInput) {
      return;
    }

    void prefetchPullRequestReviewContextFromQuery(queryClient, ciReviewQueryInput);
  }, [ciReviewQueryInput, hasCiChecksTab, hasLinkedPullRequest, queryClient]);

  const ciChecksModel = useMemo(
    () =>
      hasCiChecksTab
        ? {
            isActive: activeTabId === "ci_checks" && isPanelOpen,
            queryInput: ciReviewQueryInput,
          }
        : null,
    [activeTabId, ciReviewQueryInput, hasCiChecksTab, isPanelOpen],
  );
  const rightPanelModel = useMemo(
    () =>
      buildTaskExecutionPanelModel({
        tabs,
        activeTabId,
        documentModel: documentsModel,
        diffModel,
        fileExplorerModel,
        ciChecksModel,
        devServerModel: visibleDevServerModel,
        onActiveTabChange,
      }),
    [
      activeTabId,
      ciChecksModel,
      diffModel,
      documentsModel,
      fileExplorerModel,
      onActiveTabChange,
      tabs,
      visibleDevServerModel,
    ],
  );

  return {
    isRightPanelVisible: Boolean(activeTabId && isPanelOpen),
    rightPanelModel,
    refreshWorktree: buildToolsSnapshot.refreshWorktree,
  };
}
