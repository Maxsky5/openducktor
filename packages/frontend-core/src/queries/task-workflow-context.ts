import type { WorkspaceRef } from "@openducktor/contracts";
import { useQuery, type QueryKey, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { skippedQueryOptions } from "./skipped-query";
import { unfilteredRepoTaskDataQueryOptions, type RepoTaskData } from "./tasks";

const findTask = (data: RepoTaskData, taskId: string) =>
  data.tasks.find(({ id }) => id === taskId) ?? null;

const taskUnavailable = (workspaceId: string, taskId: string): Error =>
  new Error(`Task "${taskId}" is unavailable in workspace "${workspaceId}". Reload its task list.`);

/** Session and artifact views reuse the task cache beyond board retention. */
export const useTaskWorkflowContextQuery = (
  scope: WorkspaceRef | null,
  taskId: string,
  enabled: boolean,
) => {
  const workspaceId = scope?.workspaceId ?? null;
  const select = useCallback((data: RepoTaskData) => findTask(data, taskId), [taskId]);
  const query = useQuery<RepoTaskData, Error, ReturnType<typeof findTask>, QueryKey>({
    ...(scope && taskId
      ? unfilteredRepoTaskDataQueryOptions(scope)
      : skippedQueryOptions<RepoTaskData>({
          queryKey: ["tasks", "skipped", "workflow-context"],
          staleTime: Infinity,
        })),
    enabled,
    select,
  });
  // A missing task is a result of the list read. Selector errors keep changing the query snapshot.
  const isMissing = query.data === null;
  const unavailable = useMemo(
    () => (isMissing && workspaceId !== null ? taskUnavailable(workspaceId, taskId) : null),
    [isMissing, workspaceId, taskId],
  );
  return {
    data: query.data ?? undefined,
    error: query.error ?? unavailable,
    isPending: query.isPending,
    refetch: query.refetch,
  };
};
export const loadTaskWorkflowContext = async (
  queryClient: QueryClient,
  scope: WorkspaceRef,
  taskId: string,
) => {
  const task = findTask(
    await queryClient.ensureQueryData(unfilteredRepoTaskDataQueryOptions(scope)),
    taskId,
  );
  if (!task) throw taskUnavailable(scope.workspaceId, taskId);
  return task;
};
/** The role of a task in its exact workflow. */
export const loadTaskWorkflowRole = async (
  queryClient: QueryClient,
  scope: WorkspaceRef,
  taskId: string,
  roleId: string,
) => (await loadTaskWorkflowContext(queryClient, scope, taskId)).taskWorkflow.role(roleId);
