import { type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import {
  repoTaskDataQueryOptions,
  unfilteredRepoTaskDataQueryOptions,
} from "@openducktor/frontend-core/queries/tasks";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

const NO_REPO = "__no_workspace__";

export type RepoTaskRead = {
  /** The task, or null while it loads, when it does not exist, or without a task. */
  task: TaskCard | null;
  /** The list that holds the task. */
  tasks: TaskCard[] | undefined;
  error: Error | null;
  isPending: boolean;
  refetch: () => void;
};

/**
 * One task of a workspace, as the desktop task details read it. The retained board list holds
 * open tasks and recent Done tasks. A task outside it, such as an older closed task, comes from
 * the complete list, which loads only then (`docs/tanstack-query-cache-strategy.md`). The task
 * stream keeps both lists current.
 */
export const useRepoTask = (repoPath: string | null, taskId: string | null): RepoTaskRead => {
  const enabled = repoPath !== null && taskId !== null;
  const board = useQuery({ ...repoTaskDataQueryOptions(repoPath ?? NO_REPO), enabled });
  const boardTask = board.data?.tasks.find((entry) => entry.id === taskId) ?? null;
  const complete = useQuery({
    ...unfilteredRepoTaskDataQueryOptions(repoPath ?? NO_REPO),
    enabled: enabled && board.isSuccess && boardTask === null,
  });
  const fromComplete = boardTask === null && board.isSuccess;
  const tasks = fromComplete ? complete.data?.tasks : board.data?.tasks;
  const task = boardTask ?? tasks?.find((entry) => entry.id === taskId) ?? null;
  const { refetch: refetchBoard } = board;
  const { refetch: refetchComplete } = complete;
  const refetch = useCallback(() => {
    void refetchBoard();
    if (fromComplete) void refetchComplete();
  }, [fromComplete, refetchBoard, refetchComplete]);
  const error = board.error ?? (fromComplete ? complete.error : null);
  const isPending = board.isPending || (fromComplete && complete.isPending);
  return useMemo(
    () => ({ task, tasks, error, isPending, refetch }),
    [error, isPending, refetch, task, tasks],
  );
};
