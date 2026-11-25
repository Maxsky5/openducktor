import { workspaceScopeValue } from "./workspace-scope";
import type { WorkspaceRef } from "@openducktor/contracts";
import type { TaskRemovalPreview, TaskStopImpactOperation } from "@openducktor/contracts";
import { queryOptions, skipToken } from "@tanstack/react-query";
import { connectionHost } from "../connection/client-connection";
import { normalizeAgentSessionTaskIds } from "./agent-sessions";

export const taskStopImpactQueryKeys = {
  all: ["task-stop-impact"] as const,
  repo: (repoPath: WorkspaceRef) =>
    [...taskStopImpactQueryKeys.all, "get", workspaceScopeValue(repoPath)] as const,
  get: (
    repoPath: WorkspaceRef,
    normalizedTaskIds: string[],
    operation: TaskStopImpactOperation | null,
    eventId: string | null,
  ) =>
    [
      ...taskStopImpactQueryKeys.all,
      "get",
      workspaceScopeValue(repoPath),
      normalizedTaskIds,
      operation,
      eventId,
    ] as const,
};

/** The event of a Reset Implementation preview, else null. It keys the preview read. */
export const previewEventId = (preview: TaskRemovalPreview<string> | null): string | null =>
  preview !== null && "eventId" in preview ? preview.eventId : null;

type TaskStopImpactQueryArgs = {
  workspaceId: string;
  repoPath: string;
  taskIds: string[];
  /** The operation to preview. Null reads nothing. */
  preview: TaskRemovalPreview<TaskStopImpactOperation> | null;
};

export const taskStopImpactQueryOptions = ({
  workspaceId,
  repoPath,
  taskIds,
  preview,
}: TaskStopImpactQueryArgs) => {
  const normalizedTaskIds = normalizeAgentSessionTaskIds(taskIds);
  return queryOptions({
    queryKey: taskStopImpactQueryKeys.get(
      { workspaceId, repoPath },
      normalizedTaskIds,
      preview?.operation ?? null,
      previewEventId(preview),
    ),
    queryFn:
      preview === null
        ? skipToken
        : ({ client }) =>
            connectionHost(client).taskStopImpactGet(
              { workspaceId, repoPath },
              normalizedTaskIds,
              preview,
            ),
    staleTime: 0,
    gcTime: 0,
    // Do not retry: the dialog must show the error and block the action.
    retry: false,
  });
};
