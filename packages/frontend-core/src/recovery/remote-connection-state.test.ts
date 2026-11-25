import { describe, expect, mock, test } from "bun:test";
import type { RemoteConnectionState } from "@openducktor/host-client/remote";
import { remoteConnectionState } from "./remote-connection-state";

const createRemote = (initial: RemoteConnectionState["status"]) => {
  let state: RemoteConnectionState = { status: initial, generation: 0 };
  const listeners = new Set<(state: RemoteConnectionState) => void>();
  return {
    readState: () => state,
    subscribeState: (listener: (state: RemoteConnectionState) => void) => {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    setStatus: (status: RemoteConnectionState["status"]) => {
      state = { status, generation: state.generation + 1 };
      for (const listener of listeners) listener(state);
    },
  };
};

describe("remoteConnectionState", () => {
  test("is connected only while the remote connection is connected", () => {
    const remote = createRemote("idle");
    const connection = remoteConnectionState(remote);
    const listener = mock(() => {});
    connection.subscribe(listener);
    expect(connection.getSnapshot()).toBe("reconnecting");

    remote.setStatus("connecting");
    remote.setStatus("synchronizing");
    expect(connection.getSnapshot()).toBe("reconnecting");

    remote.setStatus("connected");
    expect(connection.getSnapshot()).toBe("connected");
    remote.setStatus("disconnected");
    remote.setStatus("failed");
    expect(connection.getSnapshot()).toBe("reconnecting");
    // A listener runs only when the state changes.
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
