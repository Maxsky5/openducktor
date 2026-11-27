import { useSyncExternalStore } from "react";
import { useHostConnection } from "./client-connection-react";
import type { HostConnectionState } from "./host-connection-state";

/** The connection state of the current host. */
export const useHostConnectionState = (): HostConnectionState => {
  const { getSnapshot, subscribe } = useHostConnection().connectionState;
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};
