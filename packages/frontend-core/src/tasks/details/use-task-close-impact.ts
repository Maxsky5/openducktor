import type {
  TaskMergeStatus,
  TaskWorktreeCleanupImpact,
  TerminalListResponse,
} from "@openducktor/contracts";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import { errorMessage } from "../../lib/errors";
import { useMinimumLoader } from "../../lib/use-minimum-loader";
import { workspaceTaskMergeStatusQueryOptions } from "../../queries/task-merge-status";
import { taskWorktreeCleanupImpactQueryOptions } from "../../queries/task-worktree-cleanup-impact";
import { terminalListByFilterQueryOptions } from "../../queries/terminals";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useActiveWorkspaceContext } from "../../app-state/app-state-contexts";
import { useGlobalRemoveWorktreeOnClose } from "../../queries/use-global-remove-worktree-on-close";
import { useTaskStopImpact } from "../../queries/use-task-stop-impact";
import {
  describeTaskMergeStatus,
  findTaskMergeStatus,
  type TaskMergeStatusView,
} from "../presentation/task-merge-status";
import { runningTerminalCount } from "./task-cleanup-impact-model";
import { settingsReadErrorMessage } from "./task-close-copy";
import { stopImpactReadErrorMessage } from "./task-confirm-copy";

/**
 * The state of every read that blocks one confirmation. Each confirmation keeps one such state,
 * so one check decides whether Confirm works and one row shows a failed read.
 */
export type TaskReadState = {
  isLoading: boolean;
  /** The failure of a read that blocks Confirm. */
  error: string | null;
  /** Runs again every read that blocks Confirm. */
  retry: () => void;
};

/** What a worktree removal shows about the task worktree. */
export type TaskWorktreeImpact = TaskReadState & {
  /** Each read has its first result or error. A later read keeps the shown values. */
  isReady: boolean;
  /** The existing worktrees that a cleanup removes. */
  worktreePaths: string[];
  branchNames: string[];
  uncommittedFileCount: number;
  terminalCount: number;
};

/** What a close confirmation shows about the task, its worktree, and its merge status. */
export type TaskCloseImpact = TaskWorktreeImpact & {
  taskId: string;
  taskTitle: string;
  /** Null for a task that merge detection does not check. */
  mergeStatus: TaskMergeStatusView | null;
  activeSessionCount: number | null;
};

/** The reads of the approval modal: its close view and its merge views use the same reads. */
export type TaskApprovalImpact = { close: TaskCloseImpact; worktree: TaskWorktreeImpact };

/**
 * A confirmation shows one loader until each read has its first result and the default cleanup
 * choice is known. Its content then shows at once, and no part of it moves as the reads end.
 */
export const useTaskCloseReadsPending = (impact: Pick<TaskWorktreeImpact, "isReady">): boolean => {
  const settings = useGlobalRemoveWorktreeOnClose();
  return !impact.isReady || settings.isPending;
};

/** The loader of a close confirmation: it shows while the reads run, and at least 500 ms. */
export const useTaskCloseLoader = (impact: Pick<TaskWorktreeImpact, "isReady">): boolean =>
  useMinimumLoader(useTaskCloseReadsPending(impact));

/** The reads are pending or one failed, so the confirmation cannot run yet. */
export const isReadBlocked = (read: TaskReadState): boolean =>
  read.isLoading || read.error !== null;

/** A confirmation that closes the task also waits for its cleanup choice. */
export const isCloseBlocked = (read: TaskReadState, removeWorktree: boolean | null): boolean =>
  removeWorktree === null || isReadBlocked(read);

/**
 * The worktree reads of one confirmation. A confirmation enables them only while it shows. They
 * have a zero stale time, so each opening reads current data before Confirm works.
 */
export const useTaskWorktreeImpact = ({
  taskId,
  enabled,
}: {
  taskId: string;
  enabled: boolean;
}): TaskWorktreeImpact => useTaskWorktreeReads(taskId, enabled).impact;

/** The worktree, session, and merge status reads of one close confirmation, as above. */
export const useTaskCloseImpact = (args: {
  task: Pick<TaskCard, "id" | "title">;
  enabled: boolean;
}): TaskCloseImpact => useTaskApprovalImpact(args).close;

/**
 * The reads of the approval modal. One set of reads serves its close and its merge views, so a
 * change of view reads nothing again.
 */
export function useTaskApprovalImpact({
  task,
  enabled,
}: {
  task: Pick<TaskCard, "id" | "title">;
  enabled: boolean;
}): TaskApprovalImpact {
  const { repoPath, mergeCandidate, branchOid, impact } = useTaskWorktreeReads(task.id, enabled);
  const mergeStatusQuery = useQuery(workspaceTaskMergeStatusQueryOptions(repoPath));
  const stop = useTaskStopImpact({ taskIds: [task.id], operation: "close", enabled });
  const stopError = stop.error === null ? null : stopImpactReadErrorMessage(stop.error);
  const mergeStatusView = mergeStatusViewOf(
    findTaskMergeStatus(mergeStatusQuery.data, task.id),
    mergeStatusQuery.error,
    branchOid,
  );
  const stopReady = stop.stoppableSessionCount !== null || stop.error !== null;
  return {
    worktree: impact,
    close: {
      ...impact,
      taskId: task.id,
      taskTitle: task.title,
      mergeStatus: mergeCandidate ? mergeStatusView : null,
      activeSessionCount: stop.stoppableSessionCount,
      // The session read blocks the close too, so it shares the read state of the worktree reads.
      isLoading: impact.isLoading || stop.isLoading,
      isReady: impact.isReady && (!enabled || (stopReady && mergeStatusQuery.status !== "pending")),
      error: impact.error ?? stopError,
      retry: () => {
        impact.retry();
        stop.retry();
      },
    },
  };
}

/**
 * The failed read of the global setting that the cleanup choice starts from, or null. Only a
 * choice that still waits for the setting shows it.
 */
export const useRemoveWorktreeSettingsRead = (
  removeWorktree: boolean | null,
): TaskReadState | null => {
  const settings = useGlobalRemoveWorktreeOnClose();
  if (removeWorktree !== null || !settings.error) return null;
  return {
    isLoading: settings.isFetching,
    error: settingsReadErrorMessage(errorMessage(settings.error)),
    retry: () => {
      void settings.refetch();
    },
  };
};

/**
 * The cleanup choice that a close starts with: the task value, else the global setting. Null while
 * a task without its own value waits for the global setting.
 */
export const useDefaultRemoveWorktree = (
  taskRemoveWorktreeOnClose: TaskCard["removeWorktreeOnClose"],
): boolean | null => {
  const globalRemoveWorktreeOnClose = useGlobalRemoveWorktreeOnClose().data;
  return taskRemoveWorktreeOnClose ?? globalRemoveWorktreeOnClose ?? null;
};

/** The cleanup choice of one close. It starts from the default until the user changes it. */
export const useTaskCloseChoice = (
  taskRemoveWorktreeOnClose: TaskCard["removeWorktreeOnClose"],
) => {
  const [choice, setChoice] = useState<boolean | null>(null);
  const defaultRemoveWorktree = useDefaultRemoveWorktree(taskRemoveWorktreeOnClose);
  return {
    /** Null while the default choice loads. */
    removeWorktree: choice ?? defaultRemoveWorktree,
    onRemoveWorktreeChange: setChoice,
    /** A choice applies to one close only. The next close starts from the default again. */
    resetChoice: useCallback(() => setChoice(null), []),
  };
};

const useTaskWorktreeReads = (taskId: string, enabled: boolean) => {
  const { activeWorkspace } = useActiveWorkspaceContext();
  const repoPath = activeWorkspace?.repoPath ?? null;
  const target = enabled && repoPath !== null ? { repoPath, taskId } : null;
  // A closing confirmation keeps the data that it shows, so its exit shows no change. A new
  // opening reads again, and the old data counts as no data until the new read ends.
  const cleanupQuery = useQuery({
    ...taskWorktreeCleanupImpactQueryOptions(target),
    placeholderData: keepPreviousData,
  });
  const terminalQuery = useQuery({
    ...terminalListByFilterQueryOptions({
      filter: target ? { kind: "task", repoPath: target.repoPath, taskId } : null,
    }),
    placeholderData: keepPreviousData,
  });
  const cleanup = cleanupQuery.data;
  const impact = worktreeImpactOf(cleanup, terminalQuery.data, {
    isLoading: enabled && (isReading(cleanupQuery) || isReading(terminalQuery)),
    isReady: !enabled || (hasCurrentData(cleanupQuery) && hasCurrentData(terminalQuery)),
    readError: cleanupQuery.error ?? terminalQuery.error,
    retry: () => {
      void cleanupQuery.refetch();
      void terminalQuery.refetch();
    },
  });
  return {
    repoPath,
    mergeCandidate: cleanup?.mergeCandidate === true,
    branchOid: cleanup?.branchOid ?? null,
    impact,
  };
};

const worktreeImpactOf = (
  cleanup: TaskWorktreeCleanupImpact | undefined,
  terminals: TerminalListResponse | undefined,
  read: { isLoading: boolean; isReady: boolean; readError: Error | null; retry: () => void },
): TaskWorktreeImpact => ({
  worktreePaths: cleanup?.worktreePaths ?? [],
  branchNames: cleanup?.branchNames ?? [],
  uncommittedFileCount: cleanup?.uncommittedFileCount ?? 0,
  terminalCount: runningTerminalCount(terminals),
  isLoading: read.isLoading,
  isReady: read.isReady,
  error: read.readError ? errorMessage(read.readError) : null,
  retry: read.retry,
});

/** A read with cached data can still run. A confirmation waits until it ends. */
const isReading = (query: { isPending: boolean; isFetching: boolean }): boolean =>
  query.isPending || query.isFetching;

/** The read has its own result or error, not the data of an earlier opening. */
const hasCurrentData = (query: { status: string; isPlaceholderData: boolean }): boolean =>
  query.status !== "pending" && !query.isPlaceholderData;

/** The merge status that a close shows for the current branch tip. */
const mergeStatusViewOf = (
  mergeStatus: TaskMergeStatus | undefined,
  readError: Error | null,
  branchOid: string | null,
): TaskMergeStatusView => {
  // A failed merge status read shows in place of the status. It does not block the close.
  if (readError) {
    return { kind: "failed", text: `Unable to read the merge status: ${errorMessage(readError)}` };
  }
  const view = describeTaskMergeStatus(mergeStatus);
  const result = mergeStatus?.result;
  // A result applies to the branch tip that it checked. A new commit needs a new check.
  const branchMoved =
    result !== undefined && result.kind !== "not_checked" && result.branchOid !== branchOid;
  if (!branchMoved) return view;
  if (view.kind === "failed") {
    // The failure stays visible. Its last successful result belongs to an older branch tip.
    const detail = `${view.detail ?? ""} The task branch changed after that check.`;
    return { ...view, detail: detail.trim() };
  }
  return {
    kind: "not_checked",
    text: "The task branch changed after the last check. Merge status not checked yet.",
  };
};
