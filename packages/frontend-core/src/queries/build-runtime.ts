import type { TaskWorktreeSummary } from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";
import { scheduleTask, type ScheduleTask } from "../lib/scheduling";
import type { HostClient } from "@openducktor/host-client";
import { connectionHost } from "../connection/client-connection";

export type TaskWorktreeQueryHost = Pick<HostClient, "taskWorktreeGet">;
type TaskWorktreeQueryInput = {
  repoPath: string;
  taskId: string;
  taskVersion?: string | null;
};
type TaskWorktreeQueryOptionsInput = TaskWorktreeQueryInput & {
  scheduleTask?: ScheduleTask;
};

const TASK_WORKTREE_STALE_TIME_MS = 30_000;
export const TASK_WORKTREE_TIMEOUT_MS = 5_000;

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  scheduler: ScheduleTask,
): Promise<T> => {
  const { promise: timeoutPromise, reject: rejectTimeout } = Promise.withResolvers<never>();
  const cancelTimeout = scheduler(() => {
    rejectTimeout(new Error(timeoutMessage));
  }, timeoutMs);

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    cancelTimeout();
  }
};

export const taskWorktreeQueryKeys = {
  all: ["task-worktree"] as const,
  taskWorktree: ({ repoPath, taskId, taskVersion = null }: TaskWorktreeQueryInput) =>
    taskVersion == null
      ? ([...taskWorktreeQueryKeys.all, repoPath, taskId] as const)
      : ([...taskWorktreeQueryKeys.all, repoPath, taskId, taskVersion] as const),
};

export const taskWorktreeQueryOptions = ({
  repoPath,
  taskId,
  scheduleTask: scheduler = scheduleTask,
  taskVersion = null,
}: TaskWorktreeQueryOptionsInput) =>
  queryOptions({
    queryKey: taskWorktreeQueryKeys.taskWorktree({ repoPath, taskId, taskVersion }),
    queryFn: ({ client }): Promise<TaskWorktreeSummary | null> =>
      withTimeout(
        connectionHost(client).taskWorktreeGet(repoPath, taskId),
        TASK_WORKTREE_TIMEOUT_MS,
        `Timed out after ${TASK_WORKTREE_TIMEOUT_MS}ms while loading task worktree.`,
        scheduler,
      ),
    retry: false,
    staleTime: TASK_WORKTREE_STALE_TIME_MS,
  });
