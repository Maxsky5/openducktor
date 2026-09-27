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
  skipped: ["terminals", "skipped"] as const,
  task: ({ repoPath, taskId }: TerminalQueryInput) =>
    [...terminalQueryKeys.all, repoPath, taskId] as const,
  workspaceSession: ({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }) =>
    [...terminalQueryKeys.all, "workspace_session", workspaceId, sessionId] as const,
  filter: (filter: TerminalListFilter) => {
    if (filter.kind === "task") return terminalQueryKeys.task(filter);
    if (filter.kind === "workspace_session") return terminalQueryKeys.workspaceSession(filter);
    return [...terminalQueryKeys.all, filter.kind] as const;
  },
};

export const terminalListByFilterQueryOptions = ({
  filter,
  hostClient = host,
  enabled = true,
}: {
  filter: TerminalListFilter;
  hostClient?: Pick<HostClient, "terminalList">;
  enabled?: boolean;
}) =>
  queryOptions({
    queryKey: enabled ? terminalQueryKeys.filter(filter) : terminalQueryKeys.skipped,
    queryFn: () => hostClient.terminalList({ filter }),
    enabled,
    retry: false,
    staleTime: 0,
  });
