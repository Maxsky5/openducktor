import { workspaceScopeValue } from "./workspace-scope";
import type { WorkspaceRef } from "@openducktor/contracts";
import type { TaskStopImpactOperation } from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";
import type { HostClient } from "@openducktor/host-client";
import { connectionHost } from "../connection/client-connection";
import { normalizeAgentSessionTaskIds } from "./agent-sessions";

export type TaskStopImpactReadPort = Pick<HostClient, "taskStopImpactGet">;

export const taskStopImpactQueryKeys = {
  all: ["task-stop-impact"] as const,
  repo: (repoPath: WorkspaceRef) =>
    [...taskStopImpactQueryKeys.all, "get", workspaceScopeValue(repoPath)] as const,
  get: (repoPath: WorkspaceRef, normalizedTaskIds: string[], operation: TaskStopImpactOperation) =>
    [
      ...taskStopImpactQueryKeys.all,
      "get",
      workspaceScopeValue(repoPath),
      normalizedTaskIds,
      operation,
    ] as const,
};

type TaskStopImpactQueryArgs = {
  workspaceId: string;
  repoPath: string;
  taskIds: string[];
  operation: TaskStopImpactOperation;
};

export const taskStopImpactQueryOptions = ({
  workspaceId,
  repoPath,
  taskIds,
  operation,
}: TaskStopImpactQueryArgs) => {
  const normalizedTaskIds = normalizeAgentSessionTaskIds(taskIds);
  return queryOptions({
    queryKey: taskStopImpactQueryKeys.get({ workspaceId, repoPath }, normalizedTaskIds, operation),
    queryFn: ({ client }) =>
      connectionHost(client).taskStopImpactGet(
        { workspaceId, repoPath },
        normalizedTaskIds,
        operation,
      ),
    staleTime: 0,
    gcTime: 0,
    // Do not retry: the dialog must show the error and block the action.
    retry: false,
  });
};
