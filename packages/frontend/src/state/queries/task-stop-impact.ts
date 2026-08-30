import type { TaskStopImpactOperation } from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";
import { host } from "../operations/host";
import { normalizeAgentSessionTaskIds } from "./agent-sessions";

export type TaskStopImpactReadPort = Pick<typeof host, "taskStopImpactGet">;

const taskStopImpactQueryKeys = {
  all: ["task-stop-impact"] as const,
  get: (repoPath: string, normalizedTaskIds: string[], operation: TaskStopImpactOperation) =>
    [...taskStopImpactQueryKeys.all, "get", repoPath, normalizedTaskIds, operation] as const,
};

type TaskStopImpactQueryArgs = {
  repoPath: string;
  taskIds: string[];
  operation: TaskStopImpactOperation;
  readPort?: TaskStopImpactReadPort;
};

export const taskStopImpactQueryOptions = ({
  repoPath,
  taskIds,
  operation,
  readPort = host,
}: TaskStopImpactQueryArgs) => {
  const normalizedTaskIds = normalizeAgentSessionTaskIds(taskIds);
  return queryOptions({
    queryKey: taskStopImpactQueryKeys.get(repoPath, normalizedTaskIds, operation),
    queryFn: () => readPort.taskStopImpactGet(repoPath, normalizedTaskIds, operation),
    staleTime: 0,
    gcTime: 0,
    // Do not retry: the dialog must show the error and block the action.
    retry: false,
  });
};
