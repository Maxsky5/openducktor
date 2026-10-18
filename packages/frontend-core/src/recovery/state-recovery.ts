import type { Query, QueryClient } from "@tanstack/react-query";
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
  await queryClient.refetchQueries({ ...workQueries, type: "active" }, { throwOnError: true });
};
