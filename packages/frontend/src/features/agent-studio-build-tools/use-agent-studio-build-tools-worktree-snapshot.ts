import type { GitTargetBranch } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { errorMessage } from "@/lib/errors";
import { worktreeBranchQueryOptions } from "@/state/queries/git";
import { useSessionComparison } from "../agent-studio-git/use-session-comparison";
import { useComparisonView } from "../agent-studio-git/session-comparison-view";
import { hostClient } from "@/lib/host-client";
import { resolveTaskTargetBranchState, UPSTREAM_TARGET_BRANCH } from "@/lib/target-branch";
import {
  buildAgentStudioGitPanelBranchIdentityKey,
  resolveAgentStudioGitPanelBranch,
} from "@/pages/agents/right-panel/agents-page-git-panel";
import type { useAgentStudioRepoSettings } from "@/pages/agents/use-agent-studio-repo-settings";
import type { useWorkspaceState } from "@/state/app-state-provider";
import type { DiffDataState } from "../agent-studio-git/contracts";
import {
  type GitPanelReads,
  useGitPanelReads,
} from "../agent-studio-git/reads/use-git-panel-reads";
import type { GitRefreshView } from "../agent-studio-git/refresh/git-refresh-coordinator";
import {
  type GitRefresh,
  type ManualRefresh,
  useGitRefresh,
} from "../agent-studio-git/refresh/use-git-refresh";
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
  diffData: DiffDataState;
  comparison?: ReturnType<typeof useSessionComparison>;
  openInTarget: BuildToolsOpenInTarget;
  /** Refreshes the shown Git context. A caller can add its own file reads. */
  refreshWorktree: GitRefresh;
  /** Shows the local changes that a Git change returned. */
  applyLocalChanges: GitPanelReads["applyLocalChanges"];
  /** The manual Refresh of the shown context. */
  manualRefresh: ManualRefresh;
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
  const { worktree, queriedPath } = useBuildToolsWorktree({
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
  const { comparison, currentBranch, branchSettled, readBranch, retryDefault } =
    useTaskSessionComparison({
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
  const reads = useGitPanelReads({
    repoPath,
    workingDir: worktree.path,
    comparisonReference: comparison.resolvedTarget,
    cacheKey: comparison.cacheKey,
    enabled: !worktree.shouldBlockDiffLoading,
  });
  const comparisonView = useComparisonView(reads, comparison, {
    repoPath,
    worktreePath: worktree.path,
    label: taskComparisonLabel(gitPanelContextMode, comparison.target, taskTargetBranchState),
    checkout: currentBranch,
  });
  const diffData = useMemo(
    () => ({
      ...comparisonView,
      isLoading: comparisonView.isLoading || worktree.isResolving,
    }),
    [comparisonView, worktree.isResolving],
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
  // A Refresh, its pending state, and its failure belong to the session, directory, chosen
  // target, and checkout.
  const refreshView: GitRefreshView = {
    scopeKey: JSON.stringify([
      viewKey,
      directory,
      gitPanelContextMode === "repository"
        ? "upstream"
        : (selectedView.selectedTask?.targetBranch ?? "default"),
    ]),
    branchKey: JSON.stringify(currentBranch),
    visible: isEnabled,
    ready: !worktree.shouldBlockDiffLoading && branchSettled,
    prepare: worktree.error ? worktree.retry : retryDefault,
    steps: {
      readBranch,
      comparison: comparison.refreshStep,
      readLocal: reads.readLocal,
      readComparison: reads.readComparison,
      readInBackground: reads.readInBackground,
    },
  };
  const gitRefresh = useGitRefresh({
    view: refreshView,
    refreshOnFocus: buildToolsBootstrap.shouldEnableScheduledRefresh && isEnabled,
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
      refreshWorktree: gitRefresh.refresh,
      applyLocalChanges: reads.applyLocalChanges,
      manualRefresh: gitRefresh.manual,
    }),
    [
      reads.applyLocalChanges,
      comparison,
      gitRefresh.manual,
      gitRefresh.refresh,
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
  const repoPath = input.repoPath ?? "__no_repo__";
  const directory = input.directory ?? "__no_directory__";
  const branch = useQuery({
    ...worktreeBranchQueryOptions(repoPath, directory),
    enabled: input.directory !== null,
    staleTime: Infinity,
    refetchOnMount: false,
  });
  const { target, targetError, needsDefault } = taskComparisonTarget(input);
  const { loadRepoSettings } = input;
  const loadDefault = useCallback(async () => {
    await loadRepoSettings();
  }, [loadRepoSettings]);
  const comparison = useSessionComparison({
    enabled: true,
    viewKey: input.viewKey,
    repoPath,
    workingDirectory: input.directory,
    target,
    targetError,
    branchError: branch.isError ? errorMessage(branch.error) : null,
    branchKey: JSON.stringify([input.branchKey, branch.data]),
    branchReady: branch.data !== undefined && !branch.isError,
  });
  const queryClient = useQueryClient();
  // The read uses this render's directory, so a late result cannot enter another task.
  const readBranch = useCallback(async () => {
    const data = await queryClient.fetchQuery({
      ...worktreeBranchQueryOptions(repoPath, directory),
      staleTime: 0,
    });
    return JSON.stringify(data);
  }, [directory, queryClient, repoPath]);
  return {
    comparison,
    currentBranch: branch.isError ? null : (branch.data ?? null),
    branchSettled: branch.data !== undefined || branch.isError,
    readBranch,
    /** Reads the settings again when the default target failed to load. */
    retryDefault: needsDefault ? loadDefault : null,
  };
}

/** One object for the upstream target, so the comparison inputs stay stable across renders. */
const UPSTREAM_TARGET: GitTargetBranch = { branch: UPSTREAM_TARGET_BRANCH };

function taskComparisonTarget(input: TaskComparisonInput) {
  if (input.contextMode === "repository") {
    return { target: UPSTREAM_TARGET, targetError: null, needsDefault: false };
  }
  if (input.savedTarget || input.repoSettings !== null) {
    return {
      target: input.targetState.effectiveTargetBranch,
      targetError: input.targetState.validationError,
      needsDefault: false,
    };
  }
  return {
    target: null,
    targetError:
      input.targetState.validationError ??
      (input.repoSettingsError ? errorMessage(input.repoSettingsError) : null),
    needsDefault: true,
  };
}
