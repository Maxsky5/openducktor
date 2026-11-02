import { workspaceScopeValue } from "./workspace-scope";
import type { WorkspaceRef } from "@openducktor/contracts";
import type { TaskWorktreeCleanupImpact } from "@openducktor/contracts";
import { type QueryClient, type QueryKey, queryOptions } from "@tanstack/react-query";
import { connectionHost } from "../connection/client-connection";
import { SKIPPED_QUERY_KEY_SEGMENT, skippedQueryOptions } from "./skipped-query";

export const taskWorktreeCleanupImpactQueryKeys = {
  all: ["task-worktree-cleanup-impact"] as const,
  get: (repoPath: WorkspaceRef, taskId: string) =>
    [
      ...taskWorktreeCleanupImpactQueryKeys.all,
      "get",
      workspaceScopeValue(repoPath),
      taskId,
    ] as const,
  skipped: ["task-worktree-cleanup-impact", SKIPPED_QUERY_KEY_SEGMENT] as const,
};

/**
 * The worktree cleanup impact that a close or a worktree removal shows. Without a task, it skips
 * the read.
 */
export const taskWorktreeCleanupImpactQueryOptions = (
  target: (WorkspaceRef & { taskId: string }) | null,
) =>
  target === null
    ? skippedQueryOptions<TaskWorktreeCleanupImpact, QueryKey>({
        queryKey: taskWorktreeCleanupImpactQueryKeys.skipped,
        staleTime: 0,
      })
    : queryOptions<TaskWorktreeCleanupImpact, Error, TaskWorktreeCleanupImpact, QueryKey>({
        queryKey: taskWorktreeCleanupImpactQueryKeys.get(target, target.taskId),
        queryFn: ({ client }) =>
          connectionHost(client).taskWorktreeCleanupImpactGet(target, target.taskId),
        // A confirmation reads the current worktree each time it opens.
        staleTime: 0,
        gcTime: 0,
        retry: false,
      });

/** A close or a worktree removal changes the worktree, so the next confirmation reads it again. */
export const invalidateTaskWorktreeCleanupImpact = (
  queryClient: QueryClient,
  repoPath: WorkspaceRef,
  taskId: string,
): Promise<void> =>
  queryClient.invalidateQueries({
    queryKey: taskWorktreeCleanupImpactQueryKeys.get(repoPath, taskId),
  });
