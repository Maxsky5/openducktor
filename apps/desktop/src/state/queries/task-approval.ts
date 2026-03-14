import type { TaskApprovalContext } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { host } from "../operations/host";

const TASK_APPROVAL_CONTEXT_STALE_TIME_MS = 60_000;

export const taskApprovalQueryKeys = {
  all: ["task-approval"] as const,
  context: (repoPath: string, taskId: string) =>
    [...taskApprovalQueryKeys.all, "context", repoPath, taskId] as const,
};

export const taskApprovalContextQueryOptions = (repoPath: string, taskId: string) =>
  queryOptions({
    queryKey: taskApprovalQueryKeys.context(repoPath, taskId),
    queryFn: (): Promise<TaskApprovalContext> => host.taskApprovalContextGet(repoPath, taskId),
    staleTime: TASK_APPROVAL_CONTEXT_STALE_TIME_MS,
  });

export const loadTaskApprovalContextFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
): Promise<TaskApprovalContext> =>
  queryClient.fetchQuery(taskApprovalContextQueryOptions(repoPath, taskId));
