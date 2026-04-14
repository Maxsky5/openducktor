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
import { buildContinuationTargetQueryOptions } from "@/state/queries/build-runtime";
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
  viewTaskId: AgentStudioOrchestrationSelectionContext["viewTaskId"];
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

export const resolveBuildContinuationTargetTaskId = ({
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
  activeRepo,
  worktreePath,
  runWorktreePath,
  sessionWorkingDirectory,
  continuationTargetWorkingDirectory,
  isContinuationTargetResolving,
}: {
  contextMode: "repository" | "worktree";
  activeRepo: string | null;
  worktreePath: string | null;
  runWorktreePath: string | null;
  sessionWorkingDirectory: string | null;
  continuationTargetWorkingDirectory: string | null;
  isContinuationTargetResolving: boolean;
}): { path: string | null; disabledReason: string | null } => {
  const repoPath = activeRepo ?? "";
  const resolvedContextWorkingDirectory = firstNonRepoWorktreePath(repoPath, [
    worktreePath,
    runWorktreePath,
    continuationTargetWorkingDirectory,
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

  if (isContinuationTargetResolving) {
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
  activeRepo,
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

  const buildContinuationTargetRepoPath = activeRepo ?? "";
  const buildContinuationTargetTaskId = resolveBuildContinuationTargetTaskId({
    viewTaskId,
    viewSelectedTask,
  });
  const matchingRunWorktreePath =
    session.runId == null
      ? null
      : (runs.find((run) => run.runId === session.runId)?.worktreePath ?? null);
  const shouldResolveBuildContinuationTarget =
    panelKind === "build_tools" &&
    isPanelOpen &&
    gitPanelContextMode === "worktree" &&
    buildContinuationTargetRepoPath.length > 0 &&
    buildContinuationTargetTaskId.length > 0;

  const isActiveBuilderWorking =
    sessionRole === "build" && (sessionStatus === "running" || sessionStatus === "starting");
  const continuationTargetQuery = useQuery({
    ...buildContinuationTargetQueryOptions(
      buildContinuationTargetRepoPath,
      buildContinuationTargetTaskId,
      hostClient,
    ),
    enabled: shouldResolveBuildContinuationTarget,
  });
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

    const openInTarget = resolveAgentStudioGitPanelOpenInTarget({
      contextMode: gitPanelContextMode,
      activeRepo,
      worktreePath: diffData.worktreePath,
      runWorktreePath: matchingRunWorktreePath,
      sessionWorkingDirectory: session.workingDirectory,
      continuationTargetWorkingDirectory: continuationTargetQuery.data?.workingDirectory ?? null,
      isContinuationTargetResolving: continuationTargetQuery.isPending,
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
    activeRepo,
    diffData,
    gitActions,
    gitPanelContextMode,
    onDetectPullRequest,
    detectingPullRequestTaskId,
    repoSettings?.defaultTargetBranch,
    resolvedGitPanelBranch,
    runs,
    setTaskTargetBranch,
    continuationTargetQuery.data?.workingDirectory,
    continuationTargetQuery.isPending,
    matchingRunWorktreePath,
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
