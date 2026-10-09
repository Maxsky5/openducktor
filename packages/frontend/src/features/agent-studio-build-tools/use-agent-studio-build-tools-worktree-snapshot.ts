import type { GitTargetBranch } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { useAgentStudioDiffVisibilityRefresh } from "../agent-studio-git/refresh/use-diff-visibility-refresh";
import { worktreeBranchQueryOptions } from "@/state/queries/git";
import { useSessionComparison } from "../agent-studio-git/use-session-comparison";
import { buildComparisonView } from "../agent-studio-git/session-comparison-view";
import { hostClient } from "@/lib/host-client";
import { resolveTaskTargetBranchState, UPSTREAM_TARGET_BRANCH } from "@/lib/target-branch";
import {
  buildAgentStudioGitPanelBranchIdentityKey,
  resolveAgentStudioGitPanelBranch,
} from "@/pages/agents/right-panel/agents-page-git-panel";
import type { useAgentStudioRepoSettings } from "@/pages/agents/use-agent-studio-repo-settings";
import type { useWorkspaceState } from "@/state/app-state-provider";
import type {
  DiffDataState,
  GitDiffRefresh,
  UseAgentStudioDiffDataInput,
} from "../agent-studio-git/contracts";
import { useAgentStudioDiffData } from "../agent-studio-git/use-agent-studio-diff-data";
import {
  type AgentStudioGitPanelContextMode,
  type BuildToolsOpenInTarget,
  resolveBuildToolsOpenInTarget,
  resolveBuildToolsSelectedTaskId,
  resolveDirectBuildWorktreePath,
} from "./agent-studio-build-tools-worktree-snapshot";
import {
  type BuildToolsWorktreeSnapshotState,
  useBuildToolsWorktree,
} from "./use-build-tools-worktree";
import {
  type BuildToolsSelectedView,
  useAgentStudioBuildToolsBootstrap,
} from "./use-agent-studio-build-tools-bootstrap";

type UseAgentStudioBuildToolsWorktreeSnapshotArgs = {
  workspaceRepoPath: string | null;
  activeBranch: ReturnType<typeof useWorkspaceState>["activeBranch"];
  selectedView: BuildToolsSelectedView;
  isGitTabActive: boolean;
  isRightPanelOpen: boolean;
  repoSettings: ReturnType<typeof useAgentStudioRepoSettings>["repoSettings"];
  repoSettingsError: ReturnType<typeof useAgentStudioRepoSettings>["repoSettingsError"];
  loadRepoSettings: ReturnType<typeof useAgentStudioRepoSettings>["loadRepoSettings"];
};

export type AgentStudioBuildToolsWorktreeSnapshot = {
  isEnabled: boolean;
  context: {
    repoPath: string | null;
    taskId: string | null;
    selectedTaskId: string | null;
    viewRole: BuildToolsSelectedView["role"];
    sessionWorkingDirectory: string | null;
    hasSelectedTask: boolean;
  };
  gitPanelContextMode: AgentStudioGitPanelContextMode;
  targetBranchState: ReturnType<typeof resolveTaskTargetBranchState>;
  resolvedGitPanelBranch: string | null;
  repositoryBranchIdentityKey: string | null;
  worktree: BuildToolsWorktreeSnapshotState;
  diffData: DiffDataState & {
    comparisonUnavailableReason?: string | null;
    comparisonReference?: string | null;
  };
  comparison?: ReturnType<typeof useSessionComparison>;
  openInTarget: BuildToolsOpenInTarget;
  refreshWorktree: GitDiffRefresh;
};

export function useAgentStudioBuildToolsWorktreeSnapshot({
  workspaceRepoPath,
  activeBranch,
  selectedView,
  isGitTabActive,
  isRightPanelOpen,
  repoSettings,
  repoSettingsError,
  loadRepoSettings,
}: UseAgentStudioBuildToolsWorktreeSnapshotArgs): AgentStudioBuildToolsWorktreeSnapshot {
  const buildToolsBootstrap = useAgentStudioBuildToolsBootstrap({
    workspaceRepoPath,
    selectedView,
    isGitTabActive,
  });
  const {
    sessionWorktreePath,
    gitPanelContextMode,
    repositoryBranchIdentityKey,
    selectedTaskId,
    hasSelectedTask,
    isEnabled,
    repoPath,
    taskId,
    taskWorktreeVersion,
  } = taskGitContext(workspaceRepoPath, activeBranch, selectedView, buildToolsBootstrap);
  const taskTargetBranchState = useMemo(
    () =>
      resolveTaskTargetBranchState({
        taskTargetBranch: selectedView.selectedTask?.targetBranch,
        taskTargetBranchError: selectedView.selectedTask?.targetBranchError ?? null,
        defaultTargetBranch: repoSettings?.defaultTargetBranch,
      }),
    [
      repoSettings?.defaultTargetBranch,
      selectedView.selectedTask?.targetBranch,
      selectedView.selectedTask?.targetBranchError,
    ],
  );
  const { worktree, queriedPath, diffResolutionTaskId } = useBuildToolsWorktree({
    host: hostClient,
    repoPath,
    taskId,
    contextMode: gitPanelContextMode,
    sessionWorktreePath,
    isEnabled,
    isRightPanelOpen,
    hasSelectedTask,
    taskWorktreeVersion,
  });

  const directory = gitPanelContextMode === "repository" ? repoPath : worktree.path;
  const viewKey = JSON.stringify([repoPath, taskId, selectedView.selectedSession.identity]);
  const { comparison, currentBranch, refreshBranch, retryDefault } = useTaskSessionComparison({
    repoPath,
    directory,
    viewKey,
    contextMode: gitPanelContextMode,
    savedTarget: selectedView.selectedTask?.targetBranch,
    repoSettings,
    repoSettingsError,
    loadRepoSettings,
    targetState: taskTargetBranchState,
    branchKey: repositoryBranchIdentityKey,
  });
  const diffDataInput: UseAgentStudioDiffDataInput = {
    repoPath,
    worktreePath: worktree.path,
    worktreeResolutionTaskId: diffResolutionTaskId,
    shouldBlockDiffLoading: worktree.shouldBlockDiffLoading,
    isWorktreeResolutionResolving: worktree.isResolving,
    worktreeResolutionError: worktree.error,
    retryWorktreeResolution: worktree.retry,
    comparisonReference: comparison.resolvedTarget ?? "HEAD",
    defaultTargetBranch: { branch: comparison.resolvedTarget ?? "HEAD" },
    branchIdentityKey: comparison.contextKey,
    cacheKey: comparison.cacheKey,
    enableScheduledRefresh: false,
  };
  const reads = useAgentStudioDiffData(diffDataInput);
  const diffData = buildComparisonView(
    reads,
    comparison,
    taskComparisonLabel(gitPanelContextMode, comparison.target, taskTargetBranchState),
    currentBranch,
  );
  const resolvedGitPanelBranch = resolveAgentStudioGitPanelBranch({
    contextMode: gitPanelContextMode,
    workspaceActiveBranch: currentBranch ?? activeBranch,
    diffBranch: diffData.branch,
  });
  const openInTarget = useMemo(
    () =>
      resolveBuildToolsOpenInTarget({
        contextMode: gitPanelContextMode,
        repoPath: workspaceRepoPath,
        worktreePath: diffData.worktreePath,
        queriedWorktreePath: queriedPath,
        sessionWorkingDirectory: buildToolsBootstrap.sessionWorkingDirectory,
        isWorktreeResolving: worktree.isResolving,
      }),
    [
      buildToolsBootstrap.sessionWorkingDirectory,
      diffData.worktreePath,
      gitPanelContextMode,
      worktree.isResolving,
      queriedPath,
      workspaceRepoPath,
    ],
  );

  const refreshWorktree = useTaskComparisonRefresh({
    comparison,
    scopeKey: JSON.stringify([viewKey, directory, comparison.target]),
    branchKey: JSON.stringify(currentBranch),
    refreshBranch,
    refreshReads: reads.refreshAllScopes,
    loadReads: reads.loadAllScopes,
    retryDefault,
    enableScheduledRefresh: buildToolsBootstrap.shouldEnableScheduledRefresh && isEnabled,
    repoPath,
    shouldBlockDiffLoading: worktree.shouldBlockDiffLoading,
  });

  return useMemo(
    () => ({
      isEnabled,
      context: {
        repoPath,
        taskId,
        selectedTaskId,
        viewRole: selectedView.role,
        sessionWorkingDirectory: buildToolsBootstrap.sessionWorkingDirectory,
        hasSelectedTask,
      },
      gitPanelContextMode,
      targetBranchState: taskTargetBranchState,
      resolvedGitPanelBranch,
      repositoryBranchIdentityKey,
      worktree,
      diffData,
      comparison,
      openInTarget,
      refreshWorktree,
    }),
    [
      comparison,
      refreshWorktree,
      buildToolsBootstrap.sessionWorkingDirectory,
      diffData,
      gitPanelContextMode,
      hasSelectedTask,
      isEnabled,
      openInTarget,
      repoPath,
      resolvedGitPanelBranch,
      repositoryBranchIdentityKey,
      selectedTaskId,
      selectedView.role,
      taskTargetBranchState,
      taskId,
      worktree,
    ],
  );
}

function taskGitContext(
  workspaceRepoPath: string | null,
  activeBranch: UseAgentStudioBuildToolsWorktreeSnapshotArgs["activeBranch"],
  selectedView: BuildToolsSelectedView,
  buildToolsBootstrap: ReturnType<typeof useAgentStudioBuildToolsBootstrap>,
) {
  const sessionWorktreePath = resolveDirectBuildWorktreePath({
    repoPath: workspaceRepoPath,
    sessionWorkingDirectory: buildToolsBootstrap.sessionWorkingDirectory,
  });
  const usesTaskWorktree =
    selectedView.role === "build" || selectedView.role === "qa" || sessionWorktreePath != null;
  const gitPanelContextMode: AgentStudioGitPanelContextMode = usesTaskWorktree
    ? "worktree"
    : "repository";
  const repositoryBranchIdentityKey =
    gitPanelContextMode === "repository"
      ? buildAgentStudioGitPanelBranchIdentityKey(activeBranch)
      : null;
  const selectedTaskId = resolveBuildToolsSelectedTaskId({
    viewTaskId: selectedView.taskId,
    viewSelectedTaskId: selectedView.selectedTask?.id ?? null,
  });
  const hasSelectedTask = selectedTaskId != null;
  const isEnabled = buildToolsBootstrap.isEnabled && hasSelectedTask;
  const hasGitContext = buildToolsBootstrap.repoPath != null && hasSelectedTask;
  const repoPath = hasGitContext ? buildToolsBootstrap.repoPath : null;
  const taskId = hasGitContext ? selectedTaskId : null;
  const taskWorktreeVersion = selectedView.selectedTask?.updatedAt ?? null;
  return {
    sessionWorktreePath,
    gitPanelContextMode,
    repositoryBranchIdentityKey,
    selectedTaskId,
    hasSelectedTask,
    isEnabled,
    repoPath,
    taskId,
    taskWorktreeVersion,
  };
}

function useTaskComparisonRefresh({
  comparison,
  scopeKey,
  branchKey,
  refreshBranch,
  refreshReads,
  loadReads,
  retryDefault,
  enableScheduledRefresh,
  repoPath,
  shouldBlockDiffLoading,
}: {
  comparison: ReturnType<typeof useSessionComparison>;
  scopeKey: string;
  branchKey: string;
  refreshBranch: ReturnType<typeof useTaskSessionComparison>["refreshBranch"];
  refreshReads: ReturnType<typeof useAgentStudioDiffData>["refreshAllScopes"];
  loadReads: ReturnType<typeof useAgentStudioDiffData>["loadAllScopes"];
  retryDefault: ReturnType<typeof useAgentStudioRepoSettings>["loadRepoSettings"] | null;
  enableScheduledRefresh: boolean;
  repoPath: string | null;
  shouldBlockDiffLoading: boolean;
}) {
  useEffect(() => {
    if (comparison.resolvedTarget) void loadReads();
  }, [comparison.resolvedTarget, loadReads]);
  const refreshComparison = comparison.refreshComparison;
  const contextKey = comparison.contextKey;
  const currentContext = useRef(contextKey);
  useLayoutEffect(() => {
    currentContext.current = contextKey;
  }, [contextKey]);
  const refreshSnapshot = useCallback<GitDiffRefresh>(
    async (mode = "hard") => {
      // Keep uncommitted reads available when the comparison check fails.
      try {
        if (mode === "hard" && retryDefault) {
          await retryDefault();
          // The settings Query starts a new comparison with the loaded default.
        } else {
          await refreshComparison(mode);
        }
        if (mode !== "scheduled" && currentContext.current === contextKey) {
          await refreshBranch();
        }
      } catch (error) {
        if (currentContext.current === contextKey) {
          toast.error("Could not refresh Git changes", { description: errorMessage(error) });
        }
        throw error;
      } finally {
        await refreshReads(mode === "scheduled" ? "summary" : "full");
      }
    },
    [contextKey, refreshBranch, refreshComparison, refreshReads, retryDefault],
  );
  const refreshWorktree = useTaskBranchRefresh({
    enabled: enableScheduledRefresh,
    scopeKey,
    cacheKey: branchKey,
    refreshBranch,
    refreshSnapshot,
    refreshReads,
  });
  useAgentStudioDiffVisibilityRefresh({
    enableScheduledRefresh,
    repoPath,
    shouldBlockDiffLoading,
    refresh: () => {
      void refreshWorktree("scheduled").catch(() => {});
    },
  });
  return refreshWorktree;
}

/** A changed branch must render its comparison before a scheduled fetch starts. */
function useTaskBranchRefresh({
  enabled,
  scopeKey,
  cacheKey,
  refreshBranch,
  refreshSnapshot,
  refreshReads,
}: {
  enabled: boolean;
  scopeKey: string;
  cacheKey: string;
  refreshBranch: ReturnType<typeof useTaskSessionComparison>["refreshBranch"];
  refreshSnapshot: GitDiffRefresh;
  refreshReads: ReturnType<typeof useAgentStudioDiffData>["refreshAllScopes"];
}) {
  const owner = useMemo(() => ({ scopeKey, enabled }), [scopeKey, enabled]);
  const [pending, setPending] = useState<{ owner: typeof owner; cacheKey: string } | null>(null);
  const currentOwner = useRef<typeof owner | null>(owner);
  const handled = useRef<typeof pending>(null);
  const lastBranch = useRef(cacheKey);
  useLayoutEffect(() => {
    currentOwner.current = enabled ? owner : null;
    return () => {
      currentOwner.current = null;
    };
  }, [enabled, owner]);
  const refreshWorktree = useCallback<GitDiffRefresh>(
    async (mode = "hard") => {
      if (mode === "scheduled") {
        if (currentOwner.current !== owner) return;
        let nextKey: string;
        try {
          nextKey = await refreshBranch();
        } catch (error) {
          if (currentOwner.current === owner) {
            toast.error("Could not refresh Git changes", { description: errorMessage(error) });
            await refreshReads("summary");
          }
          throw error;
        }
        if (currentOwner.current !== owner) return;
        if (nextKey !== cacheKey) {
          setPending({ owner, cacheKey: nextKey });
          return;
        }
      }
      await refreshSnapshot(mode);
    },
    [owner, cacheKey, refreshBranch, refreshSnapshot, refreshReads],
  );
  useEffect(() => {
    const branchChanged = lastBranch.current !== cacheKey;
    lastBranch.current = cacheKey;
    if (!pending || handled.current === pending) return;
    if (!enabled || pending.owner !== owner || (branchChanged && pending.cacheKey !== cacheKey)) {
      handled.current = pending;
      return;
    }
    if (pending.cacheKey !== cacheKey) return;
    handled.current = pending;
    void refreshSnapshot("scheduled").catch(() => {});
  }, [enabled, owner, cacheKey, pending, refreshSnapshot]);
  return refreshWorktree;
}

function taskComparisonLabel(
  contextMode: AgentStudioGitPanelContextMode,
  target: GitTargetBranch | null,
  targetState: ReturnType<typeof resolveTaskTargetBranchState>,
) {
  if (contextMode === "repository") return UPSTREAM_TARGET_BRANCH;
  return target || targetState.validationError
    ? targetState.displayTargetBranch
    : "Repository default";
}

type TaskComparisonInput = {
  repoPath: string | null;
  directory: string | null;
  viewKey: string;
  contextMode: AgentStudioGitPanelContextMode;
  savedTarget: GitTargetBranch | undefined;
  repoSettings: UseAgentStudioBuildToolsWorktreeSnapshotArgs["repoSettings"];
  repoSettingsError: UseAgentStudioBuildToolsWorktreeSnapshotArgs["repoSettingsError"];
  loadRepoSettings: UseAgentStudioBuildToolsWorktreeSnapshotArgs["loadRepoSettings"];
  targetState: ReturnType<typeof resolveTaskTargetBranchState>;
  branchKey: string | null;
};

function useTaskSessionComparison(input: TaskComparisonInput) {
  const branch = useQuery({
    ...worktreeBranchQueryOptions(
      input.repoPath ?? "__no_repo__",
      input.directory ?? "__no_directory__",
    ),
    enabled: input.directory !== null,
    staleTime: Infinity,
    refetchOnMount: false,
  });
  const { target, targetError, retryDefault } = taskComparisonTarget(input);
  const comparison = useSessionComparison({
    enabled: true,
    viewKey: input.viewKey,
    repoPath: input.repoPath ?? "__no_repo__",
    workingDirectory: input.directory,
    target,
    targetError,
    branchError: branch.isError ? errorMessage(branch.error) : null,
    branchKey: JSON.stringify([input.branchKey, branch.data]),
    branchReady: branch.data !== undefined && !branch.isError,
  });
  const refetchBranch = branch.refetch;
  const refreshBranch = useCallback(async () => {
    const result = await refetchBranch();
    if (result.isError) throw result.error;
    return JSON.stringify(result.data);
  }, [refetchBranch]);
  return {
    comparison,
    currentBranch: branch.isError ? null : (branch.data ?? null),
    refreshBranch,
    retryDefault,
  };
}

function taskComparisonTarget(input: TaskComparisonInput) {
  if (input.contextMode === "repository") {
    return { target: { branch: UPSTREAM_TARGET_BRANCH }, targetError: null, retryDefault: null };
  }
  if (input.savedTarget || input.repoSettings !== null) {
    return {
      target: input.targetState.effectiveTargetBranch,
      targetError: input.targetState.validationError,
      retryDefault: null,
    };
  }
  return {
    target: null,
    targetError:
      input.targetState.validationError ??
      (input.repoSettingsError ? errorMessage(input.repoSettingsError) : null),
    retryDefault: input.loadRepoSettings,
  };
}
