import type { TaskApprovalContextLoadResult } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { host } from "../operations/host";

export const taskApprovalQueryKeys = {
  all: ["task-approval"] as const,
  context: (repoPath: string, taskId: string) =>
    [...taskApprovalQueryKeys.all, "context", repoPath, taskId] as const,
};

const taskApprovalContextQueryOptions = (repoPath: string, taskId: string) =>
  queryOptions({
    queryKey: taskApprovalQueryKeys.context(repoPath, taskId),
    queryFn: (): Promise<TaskApprovalContextLoadResult> =>
      host.taskApprovalContextGet(repoPath, taskId),
    staleTime: 0,
  });

export const loadTaskApprovalContextFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
): Promise<TaskApprovalContextLoadResult> =>
  queryClient.fetchQuery(taskApprovalContextQueryOptions(repoPath, taskId));

export const invalidateTaskApprovalContextQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
): Promise<void> =>
  queryClient.invalidateQueries({
    queryKey: taskApprovalQueryKeys.context(repoPath, taskId),
  });
