import {
  type GitCurrentBranch,
  type GitTargetBranch,
  UPSTREAM_TARGET_BRANCH,
} from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { errorMessage } from "../../lib/errors";
import { resolveTaskTargetBranchState } from "../../lib/target-branch";
import type { AppVisibility } from "../../platform/app-visibility";
import { checkoutReadIdentity, worktreeBranchQueryOptions } from "../../queries/git";
import type { DiffDataState } from "../contracts";
import { type GitPanelReads, useGitPanelReads } from "../reads/use-git-panel-reads";
import type { GitRefreshView } from "../refresh/git-refresh-coordinator";
import { type GitRefresh, type ManualRefresh, useGitRefresh } from "../refresh/use-git-refresh";
import { useComparisonView } from "../session-comparison-view";
import { useSessionComparison } from "../use-session-comparison";
import type { TaskGitContextMode } from "./task-worktree-paths";
import { type TaskWorktreeState, useTaskWorktree } from "./use-task-worktree";

/** The repository default target branch. Null until the repository settings load. */
export type TaskGitRepoSettings = { defaultTargetBranch?: GitTargetBranch | null | undefined };

export type TaskGitPanelInput = {
  /** The repository of the task, or null while the task or workspace is unknown. */
  repoPath: string | null;
  taskId: string | null;
  contextMode: TaskGitContextMode;
  /** A session directory outside the repository root. It replaces the task worktree read. */
  sessionWorktreePath: string | null;
  /** Identifies the view, so each task and session keeps its own comparison. */
  viewKey: string;
  /** The checkout key of the repository root. Null in a task worktree. */
  repositoryBranchKey: string | null;
  savedTarget: GitTargetBranch | undefined;
  savedTargetError: string | null;
  /** Changes when the task changes, so the task worktree reads again. */
  taskWorktreeVersion: string | null;
  repoSettings: TaskGitRepoSettings | null;
  repoSettingsError: Error | null;
  loadRepoSettings: () => Promise<TaskGitRepoSettings>;
  /** True while the Git view shows. Reads and refreshes run only then. */
  isEnabled: boolean;
  /** True while another view needs the task worktree path. */
  resolveWorktree: boolean;
  hasSelectedTask: boolean;
  refreshOnFocus: boolean;
  /** Reports each return to the app, so a scheduled refresh runs. */
  visibility: AppVisibility;
};

export type TaskGitPanel = {
  targetBranchState: ReturnType<typeof resolveTaskTargetBranchState>;
  worktree: TaskWorktreeState;
  /** The task worktree path that the host returned, before the session path replaces it. */
  queriedWorktreePath: string | null;
  currentBranch: GitCurrentBranch | null;
  diffData: DiffDataState;
  comparison: ReturnType<typeof useSessionComparison>;
  /** Refreshes the shown Git context. A caller can add its own file reads. */
  refresh: GitRefresh;
  /** The manual Refresh of the shown context. */
  manualRefresh: ManualRefresh;
  /** Shows the local changes that a Git change returned. */
  applyLocalChanges: GitPanelReads["applyLocalChanges"];
};

/**
 * The Git data of a task: the task worktree, the comparison with the task target or the
 * repository default, the local and branch changes, and their refresh.
 */
export function useTaskGitPanel(input: TaskGitPanelInput): TaskGitPanel {
  const { repoPath, taskId, contextMode, viewKey, savedTarget } = input;
  const targetBranchState = useMemo(
    () =>
      resolveTaskTargetBranchState({
        taskTargetBranch: savedTarget,
        taskTargetBranchError: input.savedTargetError,
        defaultTargetBranch: input.repoSettings?.defaultTargetBranch,
      }),
    [input.repoSettings?.defaultTargetBranch, input.savedTargetError, savedTarget],
  );
  const { worktree, queriedPath } = useTaskWorktree({
    repoPath,
    taskId,
    contextMode,
    sessionWorktreePath: input.sessionWorktreePath,
    isEnabled: input.isEnabled,
    resolveWorktree: input.resolveWorktree,
    hasSelectedTask: input.hasSelectedTask,
    taskWorktreeVersion: input.taskWorktreeVersion,
  });
  const directory = contextMode === "repository" ? repoPath : worktree.path;
  const { comparison, currentBranch, branchSettled, readBranch, retryDefault } =
    useTaskSessionComparison({
      repoPath,
      directory,
      viewKey,
      contextMode,
      savedTarget,
      repoSettings: input.repoSettings,
      repoSettingsError: input.repoSettingsError,
      loadRepoSettings: input.loadRepoSettings,
      targetState: targetBranchState,
      branchKey: input.repositoryBranchKey,
    });
  const reads = useGitPanelReads({
    repoPath,
    workingDir: worktree.path,
    comparisonReference: comparison.resolvedTarget,
    cacheKey: comparison.cacheKey,
    checkoutIdentity: checkoutReadIdentity(currentBranch),
    enabled: !worktree.shouldBlockDiffLoading,
  });
  const comparisonView = useComparisonView(reads, comparison, {
    repoPath,
    worktreePath: worktree.path,
    label: taskComparisonLabel(contextMode, comparison.target, targetBranchState),
    checkout: currentBranch,
  });
  const diffData = useMemo(
    () => ({
      ...comparisonView,
      isLoading: comparisonView.isLoading || worktree.isResolving,
    }),
    [comparisonView, worktree.isResolving],
  );
  // A Refresh, its pending state, and its failure belong to the session, directory, chosen
  // target, and checkout.
  const refreshView: GitRefreshView = {
    scopeKey: JSON.stringify([
      viewKey,
      directory,
      // The repository root compares with the upstream, so no chosen target applies there.
      contextMode === "repository" ? null : (savedTarget ?? null),
    ]),
    branchKey: JSON.stringify(currentBranch),
    visible: input.isEnabled,
    ready: !worktree.shouldBlockDiffLoading && branchSettled,
    prepare: worktree.error ? worktree.retry : retryDefault,
    steps: {
      readBranch,
      comparison: comparison.refreshStep,
      readLocal: reads.readLocal,
      readComparison: reads.readComparison,
      readInBackground: reads.readInBackground,
      markStale: reads.markStale,
    },
  };
  const gitRefresh = useGitRefresh({
    view: refreshView,
    refreshOnFocus: input.refreshOnFocus,
    visibility: input.visibility,
  });
  return useMemo(
    () => ({
      targetBranchState,
      worktree,
      queriedWorktreePath: queriedPath,
      currentBranch,
      diffData,
      comparison,
      refresh: gitRefresh.refresh,
      manualRefresh: gitRefresh.manual,
      applyLocalChanges: reads.applyLocalChanges,
    }),
    [
      comparison,
      currentBranch,
      diffData,
      gitRefresh.manual,
      gitRefresh.refresh,
      queriedPath,
      reads.applyLocalChanges,
      targetBranchState,
      worktree,
    ],
  );
}

function taskComparisonLabel(
  contextMode: TaskGitContextMode,
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
  contextMode: TaskGitContextMode;
  savedTarget: GitTargetBranch | undefined;
  repoSettings: TaskGitRepoSettings | null;
  repoSettingsError: Error | null;
  loadRepoSettings: () => Promise<TaskGitRepoSettings>;
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
    // A commit keeps the read keys, so the panel shows its data while it reads again.
    branchKey: JSON.stringify([input.branchKey, checkoutReadIdentity(branch.data)]),
    checkoutIdentity: checkoutReadIdentity(branch.data),
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
