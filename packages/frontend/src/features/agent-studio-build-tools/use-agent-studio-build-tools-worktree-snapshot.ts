import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { hostClient } from "@/lib/host-client";
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
import {
  type TaskWorktreeQueryHost,
  taskWorktreeQueryOptions,
} from "@/state/queries/build-runtime";
import {
  type DiffDataState,
  type GitDiffRefresh,
  useAgentStudioDiffData,
} from "../agent-studio-git";
import {
  type AgentStudioGitPanelContextMode,
  type BuildToolsOpenInTarget,
  type BuildToolsWorktreeStatus,
  buildQueryWorktreeError,
  resolveBuildToolsOpenInTarget,
  resolveBuildToolsSelectedTaskId,
  resolveDirectBuildWorktreePath,
  resolveQueriedBuildWorktreePath,
} from "./agent-studio-build-tools-worktree-snapshot";
import {
  type BuildToolsSessionDescriptor,
  useAgentStudioBuildToolsBootstrap,
} from "./use-agent-studio-build-tools-bootstrap";

type UseAgentStudioBuildToolsWorktreeSnapshotArgs = {
  workspaceRepoPath: string | null;
  activeBranch: ReturnType<typeof useWorkspaceState>["activeBranch"];
  viewRole: AgentStudioOrchestrationSelectionContext["viewRole"];
  viewTaskId: AgentStudioOrchestrationSelectionContext["viewTaskId"];
  session: BuildToolsSessionDescriptor;
  viewSelectedTask: AgentStudioOrchestrationSelectionContext["viewSelectedTask"];
  panelKind: "documents" | "build_tools" | null;
  isPanelOpen: boolean;
  isViewSessionHistoryHydrating: boolean;
  repoSettings: ReturnType<typeof useAgentStudioOrchestrationController>["repoSettings"];
  worktreeRecoverySignal: number;
  taskWorktreeHost?: TaskWorktreeQueryHost;
  useDiffDataHook?: typeof useAgentStudioDiffData;
  useDevServerPanelHook?: typeof useAgentStudioDevServerPanel;
};

type BuildToolsWorktreeSnapshotState = {
  path: string | null;
  status: BuildToolsWorktreeStatus;
  error: string | null;
  retry: () => Promise<void>;
  isResolving: boolean;
  shouldBlockDiffLoading: boolean;
  resolutionTaskId: string | null;
};

export type AgentStudioBuildToolsWorktreeSnapshot = {
  isEnabled: boolean;
  context: {
    repoPath: string | null;
    taskId: string | null;
    selectedTaskId: string | null;
    viewRole: AgentStudioOrchestrationSelectionContext["viewRole"];
    sessionRole: BuildToolsSessionDescriptor["role"];
    sessionWorkingDirectory: string | null;
    isSessionContextStable: boolean;
    hasSelectedTask: boolean;
  };
  gitPanelContextMode: AgentStudioGitPanelContextMode;
  targetBranchState: ReturnType<typeof resolveTaskTargetBranchState>;
  resolvedGitPanelBranch: string | null;
  worktree: BuildToolsWorktreeSnapshotState;
  diffData: DiffDataState;
  devServerModel: ReturnType<typeof useAgentStudioDevServerPanel>;
  openInTarget: BuildToolsOpenInTarget;
  refreshWorktree: GitDiffRefresh;
};

const EMPTY_ASYNC_RETRY = async (): Promise<void> => {};

function useQueuedWorktreeRecoveryRefetch({
  contextKey,
  hasResolvedWorktree,
  isResolving,
  refetch,
  worktreeRecoverySignal,
}: {
  contextKey: string | null;
  hasResolvedWorktree: boolean;
  isResolving: boolean;
  refetch: () => void;
  worktreeRecoverySignal: number | undefined;
}): void {
  const lastHandledSignalRef = useRef<number | null>(null);
  const pendingSignalRef = useRef<number | null>(null);
  const lastContextKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastContextKeyRef.current !== contextKey) {
      lastContextKeyRef.current = contextKey;
      lastHandledSignalRef.current = null;
      pendingSignalRef.current = null;
    }

    if (worktreeRecoverySignal == null) {
      lastHandledSignalRef.current = null;
      pendingSignalRef.current = null;
      return;
    }

    const pendingSignal = pendingSignalRef.current;
    if (pendingSignal != null && !isResolving) {
      pendingSignalRef.current = null;
      lastHandledSignalRef.current = pendingSignal;
      if (contextKey != null && !hasResolvedWorktree) {
        refetch();
      }
      return;
    }

    if (lastHandledSignalRef.current === null) {
      lastHandledSignalRef.current = worktreeRecoverySignal;
      return;
    }

    if (
      worktreeRecoverySignal === lastHandledSignalRef.current ||
      worktreeRecoverySignal === pendingSignalRef.current
    ) {
      return;
    }

    if (contextKey == null || hasResolvedWorktree) {
      lastHandledSignalRef.current = worktreeRecoverySignal;
      return;
    }

    if (isResolving) {
      pendingSignalRef.current = worktreeRecoverySignal;
      return;
    }

    lastHandledSignalRef.current = worktreeRecoverySignal;
    refetch();
  }, [contextKey, hasResolvedWorktree, isResolving, refetch, worktreeRecoverySignal]);
}

export function useAgentStudioBuildToolsWorktreeSnapshot({
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
  taskWorktreeHost,
  useDiffDataHook = useAgentStudioDiffData,
  useDevServerPanelHook = useAgentStudioDevServerPanel,
}: UseAgentStudioBuildToolsWorktreeSnapshotArgs): AgentStudioBuildToolsWorktreeSnapshot {
  const sessionRole = session.role;
  const gitPanelContextMode: AgentStudioGitPanelContextMode =
    sessionRole === "build" ? "worktree" : "repository";
  const repositoryBranchIdentityKey =
    gitPanelContextMode === "repository"
      ? buildAgentStudioGitPanelBranchIdentityKey(activeBranch)
      : null;
  const selectedTaskId = resolveBuildToolsSelectedTaskId({
    viewTaskId,
    viewSelectedTaskId: viewSelectedTask?.id ?? null,
  });
  const isSessionContextStable = sessionRole !== "build" || !isViewSessionHistoryHydrating;
  const hasSelectedTask = selectedTaskId != null;
  const taskTargetBranchError =
    gitPanelContextMode === "worktree" ? (viewSelectedTask?.targetBranchError ?? null) : null;
  const targetBranchState = resolveTaskTargetBranchState({
    taskTargetBranch: viewSelectedTask?.targetBranch,
    taskTargetBranchError,
    defaultTargetBranch: repoSettings?.defaultTargetBranch,
  });
  const diffComparisonTarget =
    gitPanelContextMode === "repository"
      ? { branch: UPSTREAM_TARGET_BRANCH }
      : targetBranchState.effectiveTargetBranch;
  const buildToolsBootstrap = useAgentStudioBuildToolsBootstrap({
    workspaceRepoPath,
    viewRole,
    session,
    viewSelectedTask,
    panelKind,
    isPanelOpen,
    isViewSessionHistoryHydrating,
  });
  const isEnabled = buildToolsBootstrap.isEnabled && hasSelectedTask;
  const repoPath = isEnabled ? buildToolsBootstrap.repoPath : null;
  const taskId = isEnabled ? selectedTaskId : null;
  const directWorktreePath = resolveDirectBuildWorktreePath({
    repoPath,
    sessionWorkingDirectory: buildToolsBootstrap.sessionWorkingDirectory,
  });
  const shouldQueryTaskWorktree =
    isEnabled &&
    gitPanelContextMode === "worktree" &&
    repoPath != null &&
    taskId != null &&
    directWorktreePath == null;
  const taskWorktreeQuery = useQuery({
    ...taskWorktreeQueryOptions(repoPath ?? "", taskId ?? "", taskWorktreeHost ?? hostClient),
    enabled: shouldQueryTaskWorktree,
  });
  const queriedWorktree =
    shouldQueryTaskWorktree && repoPath != null && taskId != null && taskWorktreeQuery.isSuccess
      ? resolveQueriedBuildWorktreePath({
          repoPath,
          taskId,
          queriedWorkingDirectory: taskWorktreeQuery.data?.workingDirectory ?? null,
        })
      : { path: null, error: null };
  const queryError =
    shouldQueryTaskWorktree && taskId != null && taskWorktreeQuery.error
      ? buildQueryWorktreeError(taskId, taskWorktreeQuery.error)
      : null;
  const worktreeError = queryError ?? queriedWorktree.error;
  const worktreePath =
    gitPanelContextMode === "worktree" ? (directWorktreePath ?? queriedWorktree.path) : null;
  const hasResolvedWorktree = gitPanelContextMode === "repository" || worktreePath != null;
  const isWorktreeResolving = shouldQueryTaskWorktree && taskWorktreeQuery.isFetching;
  const retryWorktreeResolution = useCallback(async (): Promise<void> => {
    if (!shouldQueryTaskWorktree) {
      return;
    }

    await taskWorktreeQuery.refetch();
  }, [shouldQueryTaskWorktree, taskWorktreeQuery]);
  const recoveryContextKey =
    shouldQueryTaskWorktree && repoPath != null && taskId != null ? `${repoPath}::${taskId}` : null;
  useQueuedWorktreeRecoveryRefetch({
    contextKey: recoveryContextKey,
    hasResolvedWorktree,
    isResolving: isWorktreeResolving,
    refetch: () => {
      void retryWorktreeResolution();
    },
    worktreeRecoverySignal,
  });

  const worktreeStatus: BuildToolsWorktreeStatus = (() => {
    if (!isEnabled || gitPanelContextMode === "repository") {
      return "idle";
    }
    if (worktreePath != null) {
      return "resolved";
    }
    if (isWorktreeResolving) {
      return "resolving";
    }
    if (worktreeError != null) {
      return "failed";
    }
    return "idle";
  })();
  const shouldBlockDiffLoading =
    gitPanelContextMode === "worktree" &&
    shouldQueryTaskWorktree &&
    (isWorktreeResolving || worktreeError != null || worktreePath == null);

  const diffData = useDiffDataHook({
    repoPath,
    worktreePath,
    worktreeResolutionTaskId: shouldQueryTaskWorktree ? taskId : null,
    shouldBlockDiffLoading,
    isWorktreeResolutionResolving: isWorktreeResolving,
    worktreeResolutionError: worktreeError,
    retryWorktreeResolution,
    defaultTargetBranch: diffComparisonTarget,
    ...(targetBranchState.validationError
      ? { preconditionError: targetBranchState.validationError }
      : {}),
    branchIdentityKey: repositoryBranchIdentityKey,
    enablePolling: buildToolsBootstrap.shouldEnableEventPolling && isEnabled,
  });
  const devServerModel = useDevServerPanelHook({
    repoPath,
    taskId,
    repoSettings,
    enabled: isEnabled,
  });
  const resolvedGitPanelBranch = resolveAgentStudioGitPanelBranch({
    contextMode: gitPanelContextMode,
    workspaceActiveBranch: activeBranch,
    diffBranch: diffData.branch,
  });
  const openInTarget = resolveBuildToolsOpenInTarget({
    contextMode: gitPanelContextMode,
    repoPath: workspaceRepoPath,
    worktreePath: diffData.worktreePath,
    queriedWorktreePath: queriedWorktree.path,
    sessionWorkingDirectory: buildToolsBootstrap.sessionWorkingDirectory,
    isWorktreeResolving,
  });

  const worktree = useMemo<BuildToolsWorktreeSnapshotState>(
    () => ({
      path: worktreePath,
      status: worktreeStatus,
      error: worktreeError,
      retry: shouldQueryTaskWorktree ? retryWorktreeResolution : EMPTY_ASYNC_RETRY,
      isResolving: isWorktreeResolving,
      shouldBlockDiffLoading,
      resolutionTaskId: shouldQueryTaskWorktree ? taskId : null,
    }),
    [
      isWorktreeResolving,
      retryWorktreeResolution,
      shouldBlockDiffLoading,
      shouldQueryTaskWorktree,
      taskId,
      worktreeError,
      worktreePath,
      worktreeStatus,
    ],
  );

  return useMemo(
    () => ({
      isEnabled,
      context: {
        repoPath,
        taskId,
        selectedTaskId,
        viewRole,
        sessionRole,
        sessionWorkingDirectory: buildToolsBootstrap.sessionWorkingDirectory,
        isSessionContextStable,
        hasSelectedTask,
      },
      gitPanelContextMode,
      targetBranchState,
      resolvedGitPanelBranch,
      worktree,
      diffData,
      devServerModel,
      openInTarget,
      refreshWorktree: diffData.refresh,
    }),
    [
      buildToolsBootstrap.sessionWorkingDirectory,
      devServerModel,
      diffData,
      gitPanelContextMode,
      hasSelectedTask,
      isEnabled,
      isSessionContextStable,
      openInTarget,
      repoPath,
      resolvedGitPanelBranch,
      selectedTaskId,
      sessionRole,
      targetBranchState,
      taskId,
      viewRole,
      worktree,
    ],
  );
}
