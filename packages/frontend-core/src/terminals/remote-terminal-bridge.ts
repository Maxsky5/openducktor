import type { RemoteHostConnection } from "../recovery/remote-host-connection";
import type { TerminalBridge } from "./terminal-bridge";

/**
 * The terminal transport of a remote host. Each connection opens a terminal socket after admission.
 * Selected terminal owners join recovery through `subscribeRecovery`.
 */
export const createRemoteTerminalBridge = (host: RemoteHostConnection): TerminalBridge => ({
  subscribeRecovery: host.subscribeRecovery,
  connect: async (onFrame, onState, onFailure) => {
    const abort = new AbortController();
    await host.waitForAdmission();
    // The failure goes first: the disconnected state ends the connection, and the controller
    // then ignores a later failure of it.
    const socket = await host.remote.connectTerminal(abort.signal, onFrame, (failure) => {
      if (failure) onFailure({ code: "protocol_error", message: failure.message });
      onState("disconnected");
    });
    onState("connected");
    return {
      send: socket.send,
      close: () => {
        abort.abort();
        socket.close();
      },
    };
  },
});
