import type { RemoteConnectionState, RemoteHostClient } from "@openducktor/host-client/remote";
import {
  createHostConnectionStore,
  type HostConnectionState,
  type HostConnectionStateSource,
} from "../connection/host-connection-state";

const toHostConnectionState = ({ status }: RemoteConnectionState): HostConnectionState =>
  status === "connected" ? "connected" : "reconnecting";

/**
 * The connection state of a remote host, derived from its remote connection. The remote reconnect
 * dialog explains a lost connection, so this state never asks for a reload.
 */
export const remoteConnectionState = (
  remote: Pick<RemoteHostClient, "readState" | "subscribeState">,
): HostConnectionStateSource => {
  const store = createHostConnectionStore(toHostConnectionState(remote.readState()));
  remote.subscribeState((state) => store.setState(toHostConnectionState(state)));
  return store;
};
