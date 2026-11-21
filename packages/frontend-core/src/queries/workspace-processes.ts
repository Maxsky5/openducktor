import type {
  WorkspaceProcessList,
  WorkspaceProcessStopRequest,
  WorkspaceProcessStopResult,
} from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { connectionHost } from "../connection/client-connection";

export const workspaceProcessQueryKeys = {
  all: ["workspace-processes"] as const,
};

/**
 * The stop state of each connection. It outlives the view, so a view that opens again shows a
 * pending stop and keeps out-of-date rows disabled.
 *
 * `outdated` holds the time of each mark by process reference. A mark disables a row that the host
 * could not confirm after a stop. Only a host read that started after the mark replaces the row
 * and clears the mark.
 */
export type ProcessActionState = {
  outdated: ReadonlyMap<string, number>;
  pending: ReadonlySet<string>;
};

type ProcessActionStore = { state: ProcessActionState; listeners: Set<() => void> };

const actionStores = new WeakMap<QueryClient, ProcessActionStore>();
let sequence = 0;
const nextSequence = () => (sequence += 1);

const actionStoreFor = (queryClient: QueryClient): ProcessActionStore => {
  let store = actionStores.get(queryClient);
  if (!store) {
    store = { state: { outdated: new Map(), pending: new Set() }, listeners: new Set() };
    actionStores.set(queryClient, store);
  }
  return store;
};

const updateActionState = (
  queryClient: QueryClient,
  update: (state: ProcessActionState) => ProcessActionState,
): void => {
  const store = actionStoreFor(queryClient);
  const next = update(store.state);
  if (next === store.state) return;
  store.state = next;
  for (const listener of store.listeners) listener();
};

const listsProcess = (list: WorkspaceProcessList | undefined, processRef: string): boolean =>
  list?.groups.some((group) => group.processes.some((row) => row.processRef === processRef)) ??
  false;

/** Subscribes to the stop state of a connection, for `useSyncExternalStore`. */
export const subscribeProcessActionState = (queryClient: QueryClient, listener: () => void) => {
  const store = actionStoreFor(queryClient);
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
};

export const readProcessActionState = (queryClient: QueryClient): ProcessActionState =>
  actionStoreFor(queryClient).state;

/** The processes of the open workspaces. They change without host events, so the view reads them again. */
export const workspaceProcessesQueryOptions = () =>
  queryOptions({
    queryKey: workspaceProcessQueryKeys.all,
    queryFn: async ({ client, signal }): Promise<WorkspaceProcessList> => {
      const startedAt = nextSequence();
      const list = await connectionHost(client).workspaceProcessesList({ signal });
      // This read replaces every row, so the host checked the rows that it keeps.
      updateActionState(client, (state) => {
        const kept = new Map([...state.outdated].filter(([, markedAt]) => markedAt > startedAt));
        return kept.size === state.outdated.size ? state : { ...state, outdated: kept };
      });
      return list;
    },
    staleTime: 0,
    retry: false,
  });

const withoutProcesses = (
  list: WorkspaceProcessList | undefined,
  processRefs: ReadonlySet<string>,
): WorkspaceProcessList | undefined =>
  list && {
    ...list,
    groups: list.groups.map((group) => ({
      ...group,
      processes: group.processes.filter((row) => !processRefs.has(row.processRef)),
    })),
  };

/**
 * What the view does with a stopped process instance. `stale` keeps the last verified row with
 * its actions off until a fresh read checks it.
 */
export type WorkspaceProcessStopOutcome =
  | { kind: "removed"; result: Exclude<WorkspaceProcessStopResult, { issue: unknown }> }
  | { kind: "stale"; result: Extract<WorkspaceProcessStopResult, { issue: unknown }> }
  | { kind: "unchanged"; result: Extract<WorkspaceProcessStopResult, { issue: unknown }> }
  | { kind: "lost"; error: unknown };

export type WorkspaceProcessStopOutcomes = {
  processRef: string;
  outcome: WorkspaceProcessStopOutcome;
}[];

const outcomeOf = (result: WorkspaceProcessStopResult): WorkspaceProcessStopOutcome => {
  switch (result.kind) {
    case "stopped":
    case "already_exited":
      return { kind: "removed", result };
    case "out_of_date":
    case "unconfirmed":
      return { kind: "stale", result };
    case "pending":
    case "still_running":
      return { kind: "unchanged", result };
  }
};

/**
 * Sends one stop request for processes that stop together, and updates every cached scope that
 * shows them. Reads that started before the outcome are cancelled, so they cannot restore an old
 * row.
 */
export const stopWorkspaceProcesses = async (
  queryClient: QueryClient,
  request: WorkspaceProcessStopRequest,
): Promise<WorkspaceProcessStopOutcomes> => {
  try {
    return await sendStop(queryClient, request);
  } finally {
    updateActionState(queryClient, (state) => {
      const pending = new Set(state.pending);
      for (const processRef of request.processRefs) pending.delete(processRef);
      return { ...state, pending };
    });
  }
};

const sendStop = async (
  queryClient: QueryClient,
  request: WorkspaceProcessStopRequest,
): Promise<WorkspaceProcessStopOutcomes> => {
  const { processRefs } = request;
  // Marks the rows that the cached list shows now.
  const markOutdated = (refs: readonly string[]) => {
    const markedAt = nextSequence();
    const list = queryClient.getQueryData<WorkspaceProcessList>(workspaceProcessQueryKeys.all);
    const listed = refs.filter((processRef) => listsProcess(list, processRef));
    if (listed.length === 0) return;
    updateActionState(queryClient, (state) => {
      const outdated = new Map(state.outdated);
      for (const processRef of listed) outdated.set(processRef, markedAt);
      return { ...state, outdated };
    });
  };
  updateActionState(queryClient, (state) => ({
    ...state,
    pending: new Set([...state.pending, ...processRefs]),
  }));
  let results: { processRef: string; result: WorkspaceProcessStopResult }[];
  try {
    ({ results } = await connectionHost(queryClient).workspaceProcessStop(request));
  } catch (error) {
    // The host may have accepted the request before the reply was lost.
    markOutdated(processRefs);
    await queryClient.cancelQueries({ queryKey: workspaceProcessQueryKeys.all });
    void queryClient.invalidateQueries({ queryKey: workspaceProcessQueryKeys.all });
    return processRefs.map((processRef) => ({ processRef, outcome: { kind: "lost", error } }));
  }
  const outcomes = results.map(({ processRef, result }) => ({
    processRef,
    outcome: outcomeOf(result),
  }));
  const refsOf = (kind: WorkspaceProcessStopOutcome["kind"]) =>
    outcomes.filter(({ outcome }) => outcome.kind === kind).map(({ processRef }) => processRef);
  const removed = new Set(refsOf("removed"));
  markOutdated(refsOf("stale"));
  await queryClient.cancelQueries({ queryKey: workspaceProcessQueryKeys.all });
  if (removed.size > 0) {
    queryClient.setQueryData<WorkspaceProcessList>(workspaceProcessQueryKeys.all, (list) =>
      withoutProcesses(list, removed),
    );
    updateActionState(queryClient, (state) => ({
      ...state,
      outdated: new Map([...state.outdated].filter(([ref]) => !removed.has(ref))),
    }));
  }
  void queryClient.invalidateQueries({ queryKey: workspaceProcessQueryKeys.all });
  return outcomes;
};
