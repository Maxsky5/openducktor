import type { TaskWorktreeSummary } from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";
import { host } from "../operations/host";

type TaskWorktreeQueryHost = Pick<typeof host, "taskWorktreeGet">;

const TASK_WORKTREE_STALE_TIME_MS = 30_000;

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
      hostClient.taskWorktreeGet(repoPath, taskId),
    staleTime: TASK_WORKTREE_STALE_TIME_MS,
  });
