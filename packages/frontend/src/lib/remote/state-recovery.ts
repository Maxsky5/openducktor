import type { QueryClient } from "@tanstack/react-query";
import { browserLiveReconnectedEvent } from "../browser-live-control-events";
import type { BrowserLiveControlListener } from "../shell-bridge";

/** Event-owned baselines finish before active Query reads and the connection barrier. */
export const synchronizeBrowserState = async (
  queryClient: QueryClient,
  listeners: Iterable<BrowserLiveControlListener>,
  missedEvents: boolean,
): Promise<void> => {
  const recoveries: Promise<void>[] = [];
  const event = browserLiveReconnectedEvent(missedEvents);
  for (const listener of listeners) {
    try {
      recoveries.push(Promise.resolve(listener(event)));
    } catch (cause) {
      recoveries.push(Promise.reject(cause));
    }
  }
  await Promise.all(recoveries);
  // Local shell controls do not follow this host. Resource views report their own failures.
  const workQueries = {
    predicate: (query: import("@tanstack/react-query").Query) =>
      query.queryKey[0] !== "shell" && query.queryKey[0] !== "resource-source",
  };
  await queryClient.invalidateQueries({ ...workQueries, refetchType: "none" });
  await queryClient.refetchQueries({ ...workQueries, type: "active" }, { throwOnError: true });
};
