import type { WorkspaceRef } from "@openducktor/contracts";
import { skippedQueryOptions } from "@openducktor/frontend-core/queries/skipped-query";
import type { RepoTaskData } from "@openducktor/frontend-core/queries/tasks";
import { type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import {
  repoTaskDataQueryOptions,
  taskQueryKeys,
  unfilteredRepoTaskDataQueryOptions,
} from "@openducktor/frontend-core/queries/tasks";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

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
export const useRepoTask = (scope: WorkspaceRef | null, taskId: string | null): RepoTaskRead => {
  const enabled = scope !== null && taskId !== null;
  const board = useQuery({
    ...(scope
      ? repoTaskDataQueryOptions(scope)
      : skippedQueryOptions<RepoTaskData>({
          queryKey: taskQueryKeys.skippedBoard,
          staleTime: Infinity,
        })),
    enabled,
  });
  const boardTask = board.data?.tasks.find((entry) => entry.id === taskId) ?? null;
  const complete = useQuery({
    ...(scope
      ? unfilteredRepoTaskDataQueryOptions(scope)
      : skippedQueryOptions<RepoTaskData>({
          queryKey: taskQueryKeys.skippedComplete,
          staleTime: Infinity,
        })),
    enabled: enabled && board.isSuccess && boardTask === null,
  });
  const fromComplete = boardTask === null && board.isSuccess;
  const tasks = fromComplete ? complete.data?.tasks : board.data?.tasks;
  const task = boardTask ?? tasks?.find((entry) => entry.id === taskId) ?? null;
  const { refetch: refetchBoard } = board;
  const { refetch: refetchComplete } = complete;
  const refetch = useCallback(() => {
    if (!enabled) return;
    void refetchBoard();
    if (fromComplete) void refetchComplete();
  }, [enabled, fromComplete, refetchBoard, refetchComplete]);
  const error = board.error ?? (fromComplete ? complete.error : null);
  const isPending = board.isPending || (fromComplete && complete.isPending);
  return useMemo(
    () => ({ task, tasks, error, isPending, refetch }),
    [error, isPending, refetch, task, tasks],
  );
};
