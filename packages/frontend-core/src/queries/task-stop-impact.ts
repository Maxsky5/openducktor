import type { TaskStopImpactOperation } from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";
import type { HostClient } from "@openducktor/host-client";
import { connectionHost } from "../connection/client-connection";
import { normalizeAgentSessionTaskIds } from "./agent-sessions";

export type TaskStopImpactReadPort = Pick<HostClient, "taskStopImpactGet">;

export const taskStopImpactQueryKeys = {
  all: ["task-stop-impact"] as const,
  repo: (repoPath: string) => [...taskStopImpactQueryKeys.all, "get", repoPath] as const,
  get: (repoPath: string, normalizedTaskIds: string[], operation: TaskStopImpactOperation) =>
    [...taskStopImpactQueryKeys.all, "get", repoPath, normalizedTaskIds, operation] as const,
};

type TaskStopImpactQueryArgs = {
  repoPath: string;
  taskIds: string[];
  operation: TaskStopImpactOperation;
};

export const taskStopImpactQueryOptions = ({
  repoPath,
  taskIds,
  operation,
}: TaskStopImpactQueryArgs) => {
  const normalizedTaskIds = normalizeAgentSessionTaskIds(taskIds);
  return queryOptions({
    queryKey: taskStopImpactQueryKeys.get(repoPath, normalizedTaskIds, operation),
    queryFn: ({ client }) =>
      connectionHost(client).taskStopImpactGet(repoPath, normalizedTaskIds, operation),
    staleTime: 0,
    gcTime: 0,
    // Do not retry: the dialog must show the error and block the action.
    retry: false,
  });
};
