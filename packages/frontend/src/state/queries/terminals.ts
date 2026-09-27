import type { TerminalListFilter, TerminalListResponse } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { type QueryKey, queryOptions } from "@tanstack/react-query";
import { host } from "../operations/host";
import { skippedQueryOptions } from "./skipped-query";

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
  filter: TerminalListFilter | null;
  hostClient?: Pick<HostClient, "terminalList">;
  enabled?: boolean;
}) =>
  filter === null
    ? skippedQueryOptions<TerminalListResponse, QueryKey>({
        queryKey: terminalQueryKeys.skipped,
        staleTime: 0,
      })
    : queryOptions<TerminalListResponse, Error, TerminalListResponse, QueryKey>({
        queryKey: terminalQueryKeys.filter(filter),
        queryFn: () => hostClient.terminalList({ filter }),
        enabled,
        retry: false,
        staleTime: 0,
      });
