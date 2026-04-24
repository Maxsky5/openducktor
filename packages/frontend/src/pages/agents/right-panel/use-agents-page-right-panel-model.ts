import type { GitBranch, SystemOpenInToolId } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { toBranchSelectorOptions } from "@/components/features/repository/branch-selector-model";
import type { BuildToolsSessionDescriptor } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-bootstrap";
import { useAgentStudioBuildToolsReadModel } from "@/features/agent-studio-build-tools/use-agent-studio-build-tools-read-model";
import { hostClient } from "@/lib/host-client";
import {
  canonicalTargetBranch,
  resolveTaskTargetBranchState,
  targetBranchFromSelection,
} from "@/lib/target-branch";
import { canDetectTaskPullRequest } from "@/lib/task-display";
import type { useTasksState, useWorkspaceState } from "@/state";
import { taskWorktreeQueryOptions } from "@/state/queries/build-runtime";
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

export const resolveTaskWorktreeTaskId = ({
  viewTaskId,
  viewSelectedTask,
}: {
  viewTaskId: AgentStudioOrchestrationSelectionContext["viewTaskId"];
  viewSelectedTask: AgentStudioOrchestrationSelectionContext["viewSelectedTask"];
}): string => viewSelectedTask?.id ?? viewTaskId;

function firstNonRepoWorktreePath(repoPath: string, paths: Array<string | null>): string | null {
  for (const candidate of paths) {
    if (!candidate || candidate.trim().length === 0) {
      continue;
    }

    if (repoPath.trim().length > 0 && candidate === repoPath) {
      continue;
    }

    return candidate;
  }

  return null;
}

export const resolveAgentStudioGitPanelOpenInTarget = ({
  contextMode,
  activeWorkspace,
  worktreePath,
  fallbackWorktreePath,
  sessionWorkingDirectory,
  taskWorktreeWorkingDirectory,
  isTaskWorktreeResolving,
}: {
  contextMode: "repository" | "worktree";
  activeWorkspace: ActiveWorkspace | null;
  worktreePath: string | null;
  fallbackWorktreePath: string | null;
  sessionWorkingDirectory: string | null;
  taskWorktreeWorkingDirectory: string | null;
  isTaskWorktreeResolving: boolean;
}): { path: string | null; disabledReason: string | null } => {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const repoPath = workspaceRepoPath ?? "";
  const resolvedContextWorkingDirectory = firstNonRepoWorktreePath(repoPath, [
    worktreePath,
    fallbackWorktreePath,
    taskWorktreeWorkingDirectory,
    sessionWorkingDirectory,
  ]);

  if (contextMode === "repository") {
    if (repoPath.trim().length > 0) {
      return {
        path: repoPath,
        disabledReason: null,
      };
    }

    return {
      path: null,
      disabledReason: "Repository path is unavailable. Select a repository and try again.",
    };
  }

  if (resolvedContextWorkingDirectory) {
    return {
      path: resolvedContextWorkingDirectory,
      disabledReason: null,
    };
  }

  if (isTaskWorktreeResolving) {
    return {
      path: null,
      disabledReason: "Resolving builder worktree path...",
    };
  }

  return {
    path: null,
    disabledReason: "Builder worktree path is unavailable. Refresh the Git panel and try again.",
  };
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

  const { diffData, devServerModel, gitPanelContextMode, resolvedGitPanelBranch } =
    useAgentStudioBuildToolsReadModel({
      workspaceRepoPath,
      activeBranch,
      viewRole,
      session,
      viewSelectedTask,
      panelKind,
      isPanelOpen,
      isViewSessionHistoryHydrating,
      repoSettings,
      worktreeRecoverySignal,
    });

  const taskWorktreeRepoPath = workspaceRepoPath ?? "";
  const taskWorktreeTaskId = resolveTaskWorktreeTaskId({
    viewTaskId,
    viewSelectedTask,
  });
  const shouldResolveTaskWorktree =
    panelKind === "build_tools" &&
    isPanelOpen &&
    gitPanelContextMode === "worktree" &&
    taskWorktreeRepoPath.length > 0 &&
    taskWorktreeTaskId.length > 0;

  const isActiveBuilderWorking =
    sessionRole === "build" && (sessionStatus === "running" || sessionStatus === "starting");
  const taskWorktreeQuery = useQuery({
    ...taskWorktreeQueryOptions(taskWorktreeRepoPath, taskWorktreeTaskId, hostClient),
    enabled: shouldResolveTaskWorktree,
  });
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

    const openInTarget = resolveAgentStudioGitPanelOpenInTarget({
      contextMode: gitPanelContextMode,
      activeWorkspace,
      worktreePath: diffData.worktreePath,
      fallbackWorktreePath: null,
      sessionWorkingDirectory: session.workingDirectory,
      taskWorktreeWorkingDirectory: taskWorktreeQuery.data?.workingDirectory ?? null,
      isTaskWorktreeResolving: taskWorktreeQuery.isPending,
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
    activeWorkspace,
    branches,
    diffData,
    gitActions,
    gitPanelContextMode,
    onDetectPullRequest,
    detectingPullRequestTaskId,
    repoSettings?.defaultTargetBranch,
    resolvedGitPanelBranch,
    setTaskTargetBranch,
    taskWorktreeQuery.data?.workingDirectory,
    taskWorktreeQuery.isPending,
    session.workingDirectory,
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
