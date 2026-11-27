import type { Query, QueryClient } from "@tanstack/react-query";
import { isConnectionFailure } from "../lib/command-outcome";
import "../queries/query-meta";
import { connectionReconnectedEvent, type ReconnectionCoverage } from "./connection-control-events";
import type { ConnectionControlListener } from "../connection/host-connection";
import type { HostConnectionStateSource } from "../connection/host-connection-state";

/** Host reads that a reconnect reads again. A read that its own stream recovers is excluded. */
const hostQueries = {
  predicate: (query: Query) => query.meta?.skipHostRecovery !== true,
};

/** Event-owned baselines finish before active Query reads and the connection barrier. */
export const synchronizeConnectionState = async (
  queryClient: QueryClient,
  listeners: Iterable<ConnectionControlListener>,
  missedEvents: boolean,
  coverage: ReconnectionCoverage,
): Promise<void> => {
  const recoveries: Promise<void>[] = [];
  const event = connectionReconnectedEvent(missedEvents, coverage);
  for (const listener of listeners) {
    try {
      recoveries.push(Promise.resolve(listener(event)));
    } catch (cause) {
      recoveries.push(Promise.reject(cause));
    }
  }
  await Promise.all(recoveries);
  await queryClient.invalidateQueries({ ...hostQueries, refetchType: "none" });
  // A read that started while the host was away waits for this barrier. A refetch of a query
  // without data joins that read instead of starting another, so cancel it first.
  await queryClient.cancelQueries({
    predicate: (query) =>
      hostQueries.predicate(query) &&
      query.state.data === undefined &&
      query.state.fetchStatus === "fetching",
  });
  const started = Date.now();
  await queryClient.refetchQueries({ ...hostQueries, type: "active" });
  // A read that the host answers with an error shows that error in its own view. Only a lost
  // connection fails the barrier, so the next attempt reads again.
  const lost = queryClient
    .getQueryCache()
    .findAll({ ...hostQueries, type: "active" })
    .find(
      (query) => query.state.errorUpdatedAt >= started && isConnectionFailure(query.state.error),
    );
  if (lost) throw lost.state.error;
};

/**
 * Reads the host queries again each time the connection returns to `connected`. Each read shows
 * its own failure. A remote host does this in its own synchronization.
 */
export const refetchHostQueriesOnRecovery = (
  connection: HostConnectionStateSource,
  queryClient: QueryClient,
): (() => void) => {
  let state = connection.getSnapshot();
  return connection.subscribe(() => {
    const previous = state;
    state = connection.getSnapshot();
    if (previous !== "connected" && state === "connected") {
      void queryClient.invalidateQueries(hostQueries);
    }
  });
};
