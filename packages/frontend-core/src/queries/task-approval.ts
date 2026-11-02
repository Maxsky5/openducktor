import { workspaceScopeValue } from "./workspace-scope";
import type { WorkspaceRef } from "@openducktor/contracts";
import type { TaskApprovalContextLoadResult } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { connectionHost } from "../connection/client-connection";

export const taskApprovalQueryKeys = {
  all: ["task-approval"] as const,
  context: (repoPath: WorkspaceRef, taskId: string) =>
    [...taskApprovalQueryKeys.all, "context", workspaceScopeValue(repoPath), taskId] as const,
};

const taskApprovalContextQueryOptions = (repoPath: WorkspaceRef, taskId: string) =>
  queryOptions({
    queryKey: taskApprovalQueryKeys.context(repoPath, taskId),
    queryFn: ({ client }): Promise<TaskApprovalContextLoadResult> =>
      connectionHost(client).taskApprovalContextGet(repoPath, taskId),
    staleTime: 0,
  });

export const loadTaskApprovalContextFromQuery = (
  queryClient: QueryClient,
  repoPath: WorkspaceRef,
  taskId: string,
): Promise<TaskApprovalContextLoadResult> =>
  queryClient.fetchQuery(taskApprovalContextQueryOptions(repoPath, taskId));

export const invalidateTaskApprovalContextQuery = (
  queryClient: QueryClient,
  repoPath: WorkspaceRef,
  taskId: string,
): Promise<void> =>
  queryClient.invalidateQueries({
    queryKey: taskApprovalQueryKeys.context(repoPath, taskId),
  });
