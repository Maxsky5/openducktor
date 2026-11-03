import type { TaskWorktreeOwnersOperation, WorkspaceRef } from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";
import { connectionHost } from "../connection/client-connection";
import { normalizeAgentSessionTaskIds } from "./agent-sessions";
import { workspaceScopeValue } from "./workspace-scope";

export const taskWorktreeOwnersQueryKeys = {
  all: ["task-worktree-owners"] as const,
  get: (scope: WorkspaceRef, normalizedTaskIds: string[], operation: TaskWorktreeOwnersOperation) =>
    [
      ...taskWorktreeOwnersQueryKeys.all,
      "get",
      workspaceScopeValue(scope),
      normalizedTaskIds,
      operation,
    ] as const,
};

/** The others that need a worktree that a task action removes. Only a confirmation reads them. */
export const taskWorktreeOwnersQueryOptions = ({
  workspaceId,
  repoPath,
  taskIds,
  operation,
}: WorkspaceRef & {
  taskIds: string[];
  operation: TaskWorktreeOwnersOperation;
}) => {
  const normalizedTaskIds = normalizeAgentSessionTaskIds(taskIds);
  return queryOptions({
    queryKey: taskWorktreeOwnersQueryKeys.get(
      { workspaceId, repoPath },
      normalizedTaskIds,
      operation,
    ),
    queryFn: ({ client }) =>
      connectionHost(client).taskWorktreeOwnersGet({
        workspaceId,
        repoPath,
        taskIds: normalizedTaskIds,
        operation,
      }),
    // Each confirmation reads the current owners before Confirm works.
    staleTime: 0,
    gcTime: 0,
    // Do not retry: the confirmation shows the error and blocks the removal.
    retry: false,
  });
};
