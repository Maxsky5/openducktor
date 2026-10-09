import type { WorkflowLaunchRead } from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";
import { host } from "../operations/shared/host";

export const workflowLaunchQueryOptions = (
  {
    workspaceId,
    repoPath,
    taskId,
  }: Pick<WorkflowLaunchRead, "workspaceId" | "repoPath" | "taskId">,
  client: Pick<typeof host, "agentSessionWorkflowLaunchRead"> = host,
) =>
  queryOptions({
    queryKey: ["workflow-launches", workspaceId, repoPath, taskId] as const,
    queryFn: () => client.agentSessionWorkflowLaunchRead({ workspaceId, repoPath, taskId }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
