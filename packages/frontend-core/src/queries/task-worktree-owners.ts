import type {
  TaskRemovalPreview,
  TaskWorktreeOwnersOperation,
  WorkspaceRef,
} from "@openducktor/contracts";
import { queryOptions, skipToken } from "@tanstack/react-query";
import { connectionHost } from "../connection/client-connection";
import { normalizeAgentSessionTaskIds } from "./agent-sessions";
import { previewEventId } from "./task-stop-impact";
import { workspaceScopeValue } from "./workspace-scope";

const taskWorktreeOwnersQueryKeys = {
  all: ["task-worktree-owners"] as const,
  get: (
    scope: WorkspaceRef,
    normalizedTaskIds: string[],
    operation: TaskWorktreeOwnersOperation | null,
    eventId: string | null,
  ) =>
    [
      ...taskWorktreeOwnersQueryKeys.all,
      "get",
      workspaceScopeValue(scope),
      normalizedTaskIds,
      operation,
      eventId,
    ] as const,
};

/** The others that need a worktree that a task action removes. Only a confirmation reads them. */
export const taskWorktreeOwnersQueryOptions = ({
  workspaceId,
  repoPath,
  taskIds,
  preview,
}: WorkspaceRef & {
  taskIds: string[];
  /** The operation to preview. Null reads nothing. */
  preview: TaskRemovalPreview<TaskWorktreeOwnersOperation> | null;
}) => {
  const normalizedTaskIds = normalizeAgentSessionTaskIds(taskIds);
  return queryOptions({
    queryKey: taskWorktreeOwnersQueryKeys.get(
      { workspaceId, repoPath },
      normalizedTaskIds,
      preview?.operation ?? null,
      previewEventId(preview),
    ),
    queryFn:
      preview === null
        ? skipToken
        : ({ client }) =>
            connectionHost(client).taskWorktreeOwnersGet({
              workspaceId,
              repoPath,
              taskIds: normalizedTaskIds,
              ...preview,
            }),
    // Each confirmation reads the current owners before Confirm works.
    staleTime: 0,
    gcTime: 0,
    // Do not retry: the confirmation shows the error and blocks the removal.
    retry: false,
  });
};
