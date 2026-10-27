import type {
  StartupOperationSnapshot,
  TerminalListFilter,
  TerminalListResponse,
} from "@openducktor/contracts";
import {
  type QueryClient,
  type QueryKey,
  queryOptions,
  replaceEqualDeep,
} from "@tanstack/react-query";
import { connectionHost } from "../connection/client-connection";
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
  enabled = true,
}: {
  filter: TerminalListFilter | null;
  enabled?: boolean;
}) =>
  filter === null
    ? skippedQueryOptions<TerminalListResponse, QueryKey>({
        queryKey: terminalQueryKeys.skipped,
        staleTime: 0,
      })
    : queryOptions<TerminalListResponse, Error, TerminalListResponse, QueryKey>({
        queryKey: terminalQueryKeys.filter(filter),
        queryFn: ({ client }) => connectionHost(client).terminalList({ filter }),
        enabled,
        retry: false,
        staleTime: 0,
        // A list read can start before an action result arrives.
        structuralSharing: (previous, incoming) => {
          // SAFETY: terminal list keys hold only TerminalListResponse values.
          const current = previous as TerminalListResponse | undefined;
          // SAFETY: the terminal list query returns a TerminalListResponse.
          const next = incoming as TerminalListResponse;
          if (!current || current.hostInstanceId !== next.hostInstanceId)
            return replaceEqualDeep(previous, incoming);
          return replaceEqualDeep(current, {
            ...next,
            terminals: next.terminals.map((terminal) => {
              const known = current.terminals.find(
                (item) => item.terminalId === terminal.terminalId,
              );
              return terminal.initialCommandResult === undefined &&
                known?.initialCommandResult !== undefined
                ? { ...terminal, initialCommandResult: known.initialCommandResult }
                : terminal;
            }),
          });
        },
      });

/** Action outcomes remain available in loaded terminal lists after startup feedback ends. */
export const updateTerminalCommandResults = (
  queryClient: QueryClient,
  progress: StartupOperationSnapshot,
): void => {
  for (const [key, current] of queryClient.getQueriesData<TerminalListResponse>({
    queryKey: terminalQueryKeys.all,
  })) {
    if (!current || current.hostInstanceId !== progress.hostInstanceId) continue;
    let changed = false;
    const terminals = current.terminals.map((terminal) => {
      const result = progress.steps.find(
        (step) => step.action?.terminalId === terminal.terminalId && step.action.result,
      )?.action?.result;
      if (!result) return terminal;
      changed = true;
      return { ...terminal, initialCommandResult: result };
    });
    if (changed) queryClient.setQueryData(key, { ...current, terminals });
  }
};

/**
 * Refreshes the terminal list of one owner. Call it after a host command that can open terminals,
 * such as a worktree creation that runs actions.
 */
export const invalidateTerminalList = (
  queryClient: QueryClient,
  filter: TerminalListFilter,
): Promise<void> => queryClient.invalidateQueries({ queryKey: terminalQueryKeys.filter(filter) });
