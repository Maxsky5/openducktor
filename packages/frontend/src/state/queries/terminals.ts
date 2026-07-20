import type { TerminalListFilter } from "@openducktor/contracts";
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
  filter: (filter: TerminalListFilter) => {
    if (filter.kind === "task") return terminalQueryKeys.task(filter);
    return [...terminalQueryKeys.all, filter.kind] as const;
  },
};

export const terminalListByFilterQueryOptions = ({
  filter,
  hostClient = host,
}: {
  filter: TerminalListFilter;
  hostClient?: Pick<HostClient, "terminalList">;
}) =>
  queryOptions({
    queryKey: terminalQueryKeys.filter(filter),
    queryFn: () => hostClient.terminalList({ filter }),
    retry: false,
    staleTime: 0,
  });

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
