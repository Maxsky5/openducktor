import {
  decodeTerminalListSummary,
  type StartupOperationSnapshot,
  type TerminalListFilter,
  type TerminalListResponse,
  type TerminalSummary,
} from "@openducktor/contracts";
import {
  type QueryClient,
  type QueryKey,
  queryOptions,
  replaceEqualDeep,
} from "@tanstack/react-query";
import { connectionHost } from "../connection/client-connection";
import { skippedQueryOptions } from "./skipped-query";
import type { TerminalTransportController } from "../terminals/terminal-transport-controller";

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
          if (next.revision < current.revision) return current;
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

const updateTerminalList = (
  queryClient: QueryClient,
  filter: TerminalListFilter,
  update: (list: TerminalListResponse | undefined) => TerminalListResponse | undefined,
): void => {
  const queryKey = terminalQueryKeys.filter(filter);
  // Cancellation reverts an older read synchronously, before the live update enters the cache.
  void queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<TerminalListResponse>(queryKey, update);
};

const upsertSummary = (
  list: TerminalListResponse,
  summary: TerminalSummary,
): TerminalListResponse => ({
  ...list,
  terminals: list.terminals.some((known) => known.terminalId === summary.terminalId)
    ? list.terminals.map((known) => (known.terminalId === summary.terminalId ? summary : known))
    : [...list.terminals, summary],
});

const cacheTerminalSummary = (
  queryClient: QueryClient,
  filter: TerminalListFilter,
  summary: TerminalSummary,
  revision: number,
): void =>
  updateTerminalList(queryClient, filter, (list) =>
    list && revision > list.revision ? { ...upsertSummary(list, summary), revision } : list,
  );

export const cacheTerminalList = (
  queryClient: QueryClient,
  filter: TerminalListFilter,
  list: TerminalListResponse,
): void => updateTerminalList(queryClient, filter, () => list);

const cacheClosedTerminal = (
  queryClient: QueryClient,
  filter: TerminalListFilter,
  terminalId: string,
  revision: number,
): void =>
  updateTerminalList(queryClient, filter, (list) =>
    list && revision > list.revision
      ? {
          ...list,
          revision,
          terminals: list.terminals.filter((summary) => summary.terminalId !== terminalId),
        }
      : list,
  );

/** Keep an observed list current without attaching to terminal output or refetching it. */
export const watchTerminalList = (
  queryClient: QueryClient,
  controller: TerminalTransportController,
  filter: TerminalListFilter,
  onRemoved: (terminalId: string) => void,
): (() => void) => {
  let snapshot: TerminalListResponse | null = null;
  return controller.subscribeList(filter, (message, payload) => {
    if (message.type === "list_snapshot_start") {
      snapshot = {
        hostInstanceId: message.hostInstanceId,
        revision: message.revision,
        terminals: [],
      };
    } else if (message.type === "list_snapshot_end") {
      if (snapshot === null) throw new Error("Terminal list snapshot ended before it started.");
      const complete = snapshot;
      snapshot = null;
      updateTerminalList(queryClient, filter, () => complete);
    } else if (message.type === "list_updated") {
      const summary = decodeTerminalListSummary(payload);
      if (snapshot !== null) snapshot = upsertSummary(snapshot, summary);
      else cacheTerminalSummary(queryClient, filter, summary, message.revision);
    } else {
      if (snapshot !== null)
        snapshot = {
          ...snapshot,
          terminals: snapshot.terminals.filter(
            (summary) => summary.terminalId !== message.terminalId,
          ),
        };
      else cacheClosedTerminal(queryClient, filter, message.terminalId, message.revision);
      onRemoved(message.terminalId);
    }
  });
};
