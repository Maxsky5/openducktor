import type { DevServerOwner, GitTargetBranch } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
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
import type { useAgentStudioDevServerPanel } from "@/features/dev-servers/use-agent-studio-dev-server-panel";
import type { useAgentStudioRepoSettings } from "@/pages/agents/use-agent-studio-repo-settings";
import type { useWorkspaceState } from "@/state/app-state-provider";
import type { TaskWorktreeQueryHost } from "@/state/queries/build-runtime";
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

type AgentStudioBuildToolsWorktreeSnapshotDependencies = {
  taskWorktreeHost: TaskWorktreeQueryHost;
  useDiffData: typeof useAgentStudioDiffData;
};

type AgentStudioDevServerTarget = Parameters<typeof useAgentStudioDevServerPanel>[0];

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
  /** The right panel reads the dev server for this target. */
  devServerTarget: AgentStudioDevServerTarget;
  openInTarget: BuildToolsOpenInTarget;
  refreshWorktree: GitDiffRefresh;
};

export function useAgentStudioBuildToolsWorktreeSnapshot(
  args: UseAgentStudioBuildToolsWorktreeSnapshotArgs,
): AgentStudioBuildToolsWorktreeSnapshot {
  return useAgentStudioBuildToolsWorktreeSnapshotWithDependencies(
    args,
    DEFAULT_SNAPSHOT_DEPENDENCIES,
  );
}

const DEFAULT_SNAPSHOT_DEPENDENCIES: AgentStudioBuildToolsWorktreeSnapshotDependencies = {
  taskWorktreeHost: hostClient,
  useDiffData: useAgentStudioDiffData,
};

function useAgentStudioBuildToolsWorktreeSnapshotWithDependencies(
  {
    workspaceRepoPath,
    activeBranch,
    selectedView,
    isGitTabActive,
    isRightPanelOpen,
    repoSettings,
    repoSettingsError,
    loadRepoSettings,
  }: UseAgentStudioBuildToolsWorktreeSnapshotArgs,
  dependencies: AgentStudioBuildToolsWorktreeSnapshotDependencies,
): AgentStudioBuildToolsWorktreeSnapshot {
  const buildToolsBootstrap = useAgentStudioBuildToolsBootstrap({
    workspaceRepoPath,
    selectedView,
    isGitTabActive,
    isRightPanelOpen,
  });
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
  const isEnabled = buildToolsBootstrap.isEnabled && hasSelectedTask;
  const hasGitContext = buildToolsBootstrap.repoPath != null && hasSelectedTask;
  const repoPath = hasGitContext ? buildToolsBootstrap.repoPath : null;
  const taskId = hasGitContext ? selectedTaskId : null;
  const taskWorktreeVersion = selectedView.selectedTask?.updatedAt ?? null;
  const devServerTarget = useMemo(
    () =>
      buildDevServerTarget(
        buildToolsBootstrap.isDevServerEnabled,
        buildToolsBootstrap.repoPath,
        hasSelectedTask,
        selectedView.selectedTask?.id ?? null,
      ),
    [
      buildToolsBootstrap.isDevServerEnabled,
      buildToolsBootstrap.repoPath,
      hasSelectedTask,
      selectedView.selectedTask?.id,
    ],
  );
  const { worktree, queriedPath, diffResolutionTaskId } = useBuildToolsWorktree({
    host: dependencies.taskWorktreeHost,
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
  const { comparison, refreshBranch, retryDefault } = useTaskSessionComparison({
    repoPath,
    directory,
    viewKey: JSON.stringify([repoPath, taskId, selectedView.selectedSession.identity]),
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
    enableScheduledRefresh: false,
  };
  const reads = dependencies.useDiffData(diffDataInput);
  const diffData = buildComparisonView(
    reads,
    comparison,
    taskComparisonLabel(gitPanelContextMode, comparison.target, taskTargetBranchState),
  );
  const resolvedGitPanelBranch = resolveAgentStudioGitPanelBranch({
    contextMode: gitPanelContextMode,
    workspaceActiveBranch: activeBranch,
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
    refreshBranch,
    refreshReads: reads.refreshAllScopes,
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
      devServerTarget,
      openInTarget,
      refreshWorktree,
    }),
    [
      comparison,
      refreshWorktree,
      buildToolsBootstrap.sessionWorkingDirectory,
      devServerTarget,
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

function useTaskComparisonRefresh({
  comparison,
  refreshBranch,
  refreshReads,
  retryDefault,
  enableScheduledRefresh,
  repoPath,
  shouldBlockDiffLoading,
}: {
  comparison: ReturnType<typeof useSessionComparison>;
  refreshBranch: ReturnType<typeof useTaskSessionComparison>["refreshBranch"];
  refreshReads: ReturnType<typeof useAgentStudioDiffData>["refreshAllScopes"];
  retryDefault: ReturnType<typeof useAgentStudioRepoSettings>["loadRepoSettings"] | null;
  enableScheduledRefresh: boolean;
  repoPath: string | null;
  shouldBlockDiffLoading: boolean;
}) {
  useEffect(() => {
    if (comparison.resolvedTarget) void refreshReads();
  }, [comparison.resolvedTarget, refreshReads]);
  const refreshComparison = comparison.refreshComparison;
  const refreshWorktree = useCallback<GitDiffRefresh>(
    async (mode = "hard") => {
      // Keep uncommitted reads available when the comparison check fails.
      try {
        if (mode === "hard" && retryDefault) {
          await retryDefault();
          // The settings Query starts a new comparison with the loaded default.
        } else {
          await refreshComparison(mode);
        }
        // Reading the branch changes the comparison context. Fetch its captured target first.
        const branch = await refreshBranch();
        if (branch.isError) throw branch.error;
      } finally {
        await refreshReads(mode === "scheduled" ? "summary" : "full");
      }
    },
    [refreshBranch, refreshComparison, refreshReads, retryDefault],
  );
  useAgentStudioDiffVisibilityRefresh({
    enableScheduledRefresh,
    repoPath,
    shouldBlockDiffLoading,
    refresh: () => {
      void refreshWorktree("scheduled").catch((error) =>
        toast.error("Could not refresh Git changes", { description: errorMessage(error) }),
      );
    },
  });
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
  return {
    comparison,
    refreshBranch: branch.refetch,
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

function buildDevServerTarget(
  enabled: boolean,
  repoPath: string | null,
  hasSelectedTask: boolean,
  taskId: string | null,
): AgentStudioDevServerTarget {
  const path = enabled ? repoPath : null;
  const owner: DevServerOwner | null =
    enabled && hasSelectedTask && taskId ? { kind: "task", taskId } : null;
  return { repoPath: path, owner, enabled: path !== null && owner !== null };
}

/** @internal Test-only dependency seam; production callers should use the default hook above. */
export const createAgentStudioBuildToolsWorktreeSnapshotHookForTest = (
  overrides: Partial<AgentStudioBuildToolsWorktreeSnapshotDependencies>,
) => {
  const dependencies = {
    ...DEFAULT_SNAPSHOT_DEPENDENCIES,
    ...overrides,
  };

  return (args: UseAgentStudioBuildToolsWorktreeSnapshotArgs) =>
    useAgentStudioBuildToolsWorktreeSnapshotWithDependencies(args, dependencies);
};
