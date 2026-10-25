import {
  REMOTE_CONNECTION_HEADER,
  REMOTE_TERMINAL_CONNECTION_PREFIX,
  TERMINAL_PROTOCOL_SUBPROTOCOL,
} from "@openducktor/contracts";
import { remoteError, type RemoteTerminalConnection } from "./transport";

/** The WebSocket members that the terminal handshake uses. Browser and React Native sockets have them. */
export type RemoteTerminalSocket = Pick<
  WebSocket,
  | "binaryType"
  | "protocol"
  | "readyState"
  | "onopen"
  | "onmessage"
  | "onerror"
  | "onclose"
  | "send"
  | "close"
>;

/** The `readyState` of an open socket. React Native types have no static `WebSocket.OPEN`. */
const OPEN = 1;

/**
 * Opens a host terminal socket on the negotiated connection. The host must select the terminal
 * subprotocol. Each platform transport supplies only the socket constructor.
 */
export const openRemoteTerminalSocket = (
  createSocket: (protocols: string[]) => RemoteTerminalSocket,
  headers: Readonly<Record<string, string>>,
  signal: AbortSignal,
  onFrame: (frame: Uint8Array) => void,
  onClose: () => void,
): Promise<RemoteTerminalConnection> =>
  new Promise((resolve, reject) => {
    const connectionId = headers[REMOTE_CONNECTION_HEADER];
    if (!connectionId) {
      reject(
        remoteError(
          "connection_expired",
          "Terminal has no negotiated connection.",
          "Reconnect before attaching the terminal.",
        ),
      );
      return;
    }
    const socket = createSocket([
      TERMINAL_PROTOCOL_SUBPROTOCOL,
      `${REMOTE_TERMINAL_CONNECTION_PREFIX}${connectionId}`,
    ]);
    socket.binaryType = "arraybuffer";
    let opened = false;
    const abort = () => {
      socket.close();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    socket.onopen = () => {
      if (signal.aborted) {
        socket.close();
        return;
      }
      if (socket.protocol !== TERMINAL_PROTOCOL_SUBPROTOCOL) {
        socket.close();
        reject(
          remoteError(
            "invalid_protocol",
            "Terminal protocol was not selected.",
            "Update the host or correct proxy WebSocket routing.",
          ),
        );
        return;
      }
      opened = true;
      resolve({
        send: async (frame) => {
          signal.throwIfAborted();
          if (socket.readyState !== OPEN) throw new Error("Terminal is disconnected.");
          socket.send(Uint8Array.from(frame));
        },
        close: () => socket.close(),
      });
    };
    socket.onmessage = (event) => {
      if (!signal.aborted && event.data instanceof ArrayBuffer) onFrame(new Uint8Array(event.data));
    };
    socket.onerror = () => {
      const error = remoteError(
        "transport_failure",
        "Terminal connection failed.",
        "Check the host and proxy WebSocket forwarding.",
      );
      if (!opened) reject(error);
    };
    socket.onclose = () => {
      signal.removeEventListener("abort", abort);
      if (!opened)
        reject(
          remoteError(
            "transport_failure",
            "Terminal closed during setup.",
            "Check the selected host and retry.",
          ),
        );
      else if (!signal.aborted) onClose();
    };
  });
