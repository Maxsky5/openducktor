import type { HostClient } from "@openducktor/host-client";
import { queryOptions } from "@tanstack/react-query";
import { host } from "../operations/host";

type TerminalQueryInput = {
  repoPath: string;
  taskId: string;
};

export const terminalQueryKeys = {
  all: ["terminals"] as const,
  task: ({ repoPath, taskId }: TerminalQueryInput) =>
    [...terminalQueryKeys.all, repoPath, taskId] as const,
};

export const terminalListQueryOptions = ({
  repoPath,
  taskId,
  hostClient = host,
}: TerminalQueryInput & { hostClient?: Pick<HostClient, "terminalList"> }) =>
  queryOptions({
    queryKey: terminalQueryKeys.task({ repoPath, taskId }),
    queryFn: () => hostClient.terminalList({ filter: { kind: "task", repoPath, taskId } }),
    retry: false,
    staleTime: 0,
  });
