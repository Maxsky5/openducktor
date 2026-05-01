import type { TaskWorktreeSummary } from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";
import { host } from "../operations/host";

export type TaskWorktreeQueryHost = Pick<typeof host, "taskWorktreeGet">;

const TASK_WORKTREE_STALE_TIME_MS = 30_000;
export const TASK_WORKTREE_TIMEOUT_MS = 5_000;

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> => {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
};

export const taskWorktreeQueryKeys = {
  all: ["task-worktree"] as const,
  taskWorktree: (repoPath: string, taskId: string) =>
    [...taskWorktreeQueryKeys.all, repoPath, taskId] as const,
};

export const taskWorktreeQueryOptions = (
  repoPath: string,
  taskId: string,
  hostClient: TaskWorktreeQueryHost = host,
) =>
  queryOptions({
    queryKey: taskWorktreeQueryKeys.taskWorktree(repoPath, taskId),
    queryFn: (): Promise<TaskWorktreeSummary | null> =>
      withTimeout(
        hostClient.taskWorktreeGet(repoPath, taskId),
        TASK_WORKTREE_TIMEOUT_MS,
        `Timed out after ${TASK_WORKTREE_TIMEOUT_MS}ms while loading task worktree.`,
      ),
    retry: false,
    staleTime: TASK_WORKTREE_STALE_TIME_MS,
  });
