import { onlineManager, type QueryClient } from "@tanstack/react-query";
import type { HostConnectionStateSource } from "./host-connection-state";

let owner: HostConnectionStateSource | null = null;

/**
 * Makes the online state of TanStack Query follow a local host connection. A host read that loses
 * the connection pauses, keeps its last data, and continues after the reconnect. Browser network
 * events do not change this state. The newest connection owns it. Do not use it for a remote host:
 * its client waits for its own reconnect and recovery barrier before it sends a read.
 *
 * The query client is mounted so that a paused read continues also without a React provider.
 * Returns the release.
 */
export const followHostConnection = (
  queryClient: QueryClient,
  connection: HostConnectionStateSource,
): (() => void) => {
  owner = connection;
  onlineManager.setEventListener((setOnline) => {
    const update = () => setOnline(connection.getSnapshot() === "connected");
    update();
    return connection.subscribe(update);
  });
  queryClient.mount();
  return () => {
    queryClient.unmount();
    if (owner !== connection) return;
    owner = null;
    onlineManager.setEventListener((setOnline) => {
      setOnline(true);
      return undefined;
    });
  };
};
