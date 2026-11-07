import type { WorkspaceRef } from "@openducktor/contracts";
import { queryOptions, type QueryKey, type QueryClient } from "@tanstack/react-query";
import { skippedQueryOptions } from "./skipped-query";
import { unfilteredRepoTaskDataQueryOptions, type RepoTaskData } from "./tasks";

const selectTask = (data: RepoTaskData, scope: WorkspaceRef | null, taskId: string) => {
  if (!scope) throw new Error("Select the task workspace before loading its workflow.");
  const task = data.tasks.find(({ id }) => id === taskId);
  if (!task)
    throw new Error(
      `Task "${taskId}" is unavailable in workspace "${scope.workspaceId}". Reload its task list.`,
    );
  return task;
};
/** Session and artifact views reuse the task cache beyond board retention. */
export const taskWorkflowContextQueryOptions = (scope: WorkspaceRef | null, taskId: string) =>
  queryOptions<RepoTaskData, Error, ReturnType<typeof selectTask>, QueryKey>({
    ...(scope && taskId
      ? unfilteredRepoTaskDataQueryOptions(scope)
      : skippedQueryOptions<RepoTaskData>({
          queryKey: ["tasks", "skipped", "workflow-context"],
          staleTime: Infinity,
        })),
    select: (data: RepoTaskData) => selectTask(data, scope, taskId),
  });
export const loadTaskWorkflowContext = async (
  queryClient: QueryClient,
  scope: WorkspaceRef,
  taskId: string,
) =>
  selectTask(
    await queryClient.ensureQueryData(unfilteredRepoTaskDataQueryOptions(scope)),
    scope,
    taskId,
  );
/** The role of a task in its exact workflow. */
export const loadTaskWorkflowRole = async (
  queryClient: QueryClient,
  scope: WorkspaceRef,
  taskId: string,
  roleId: string,
) => (await loadTaskWorkflowContext(queryClient, scope, taskId)).taskWorkflow.role(roleId);
