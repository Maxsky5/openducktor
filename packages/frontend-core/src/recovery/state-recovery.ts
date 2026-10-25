import type { Query, QueryClient } from "@tanstack/react-query";
import { isConnectionFailure } from "../lib/command-outcome";
import "../queries/query-meta";
import { connectionReconnectedEvent } from "./connection-control-events";
import type { ConnectionControlListener } from "../connection/host-connection";

/** Event-owned baselines finish before active Query reads and the connection barrier. */
export const synchronizeConnectionState = async (
  queryClient: QueryClient,
  listeners: Iterable<ConnectionControlListener>,
  missedEvents: boolean,
): Promise<void> => {
  const recoveries: Promise<void>[] = [];
  const event = connectionReconnectedEvent(missedEvents);
  for (const listener of listeners) {
    try {
      recoveries.push(Promise.resolve(listener(event)));
    } catch (cause) {
      recoveries.push(Promise.reject(cause));
    }
  }
  await Promise.all(recoveries);
  const workQueries = {
    predicate: (query: Query) => query.meta?.skipHostRecovery !== true,
  };
  await queryClient.invalidateQueries({ ...workQueries, refetchType: "none" });
  const started = Date.now();
  await queryClient.refetchQueries({ ...workQueries, type: "active" });
  // A read that the host answers with an error shows that error in its own view. Only a lost
  // connection fails the barrier, so the next attempt reads again.
  const lost = queryClient
    .getQueryCache()
    .findAll({ ...workQueries, type: "active" })
    .find(
      (query) => query.state.errorUpdatedAt >= started && isConnectionFailure(query.state.error),
    );
  if (lost) throw lost.state.error;
};
