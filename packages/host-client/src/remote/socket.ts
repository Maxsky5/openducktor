import {
  REMOTE_CONNECTION_HEADER,
  REMOTE_SOCKET_CONNECTION_PREFIX,
  REMOTE_SOCKET_AUTHORIZATION_PREFIX,
  readBearerToken,
  remoteConnectionTokenSchema,
} from "@openducktor/contracts";
import { remoteError, type RemoteSocketConnection } from "./transport";

/** The WebSocket members that a socket handshake uses. Browser and React Native sockets have them. */
export type RemoteSocket = Pick<
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
 * Opens a binary WebSocket. The host must select the first protocol of `protocols`. `onClose` runs
 * once when an open socket closes without a local abort.
 */
export const openWebSocket = (
  createSocket: (protocols: string[]) => RemoteSocket,
  protocols: string[],
  signal: AbortSignal,
  onFrame: (frame: Uint8Array) => void,
  onClose: () => void,
): Promise<RemoteSocketConnection> =>
  new Promise((resolve, reject) => {
    const [protocol] = protocols;
    const socket = createSocket(protocols);
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
      if (socket.protocol !== protocol) {
        socket.close();
        reject(
          remoteError(
            "invalid_protocol",
            `The host did not select ${protocol}.`,
            "Update the host or correct proxy WebSocket routing.",
          ),
        );
        return;
      }
      opened = true;
      resolve({
        send: async (frame) => {
          signal.throwIfAborted();
          if (socket.readyState !== OPEN) throw new Error("The socket is disconnected.");
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
        "The host socket failed.",
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
            "The host socket closed during setup.",
            "Check the selected host and retry.",
          ),
        );
      else if (!signal.aborted) onClose();
    };
  });

/**
 * Opens a host socket on the negotiated connection. Browser sockets cannot set headers, so the
 * connection ID and live token travel as subprotocol tags. Each platform supplies the constructor.
 */
export const openRemoteSocket = (
  createSocket: (protocols: string[]) => RemoteSocket,
  protocol: string,
  headers: Readonly<Record<string, string>>,
  signal: AbortSignal,
  onFrame: (frame: Uint8Array) => void,
  onClose: () => void,
): Promise<RemoteSocketConnection> => {
  const connectionId = headers[REMOTE_CONNECTION_HEADER];
  const token = readBearerToken(headers.authorization, remoteConnectionTokenSchema);
  if (!connectionId || !token)
    return Promise.reject(
      remoteError(
        "connection_expired",
        "The socket has no negotiated connection.",
        "Reconnect before opening the socket.",
      ),
    );
  return openWebSocket(
    createSocket,
    [
      protocol,
      `${REMOTE_SOCKET_CONNECTION_PREFIX}${connectionId}`,
      `${REMOTE_SOCKET_AUTHORIZATION_PREFIX}${token}`,
    ],
    signal,
    onFrame,
    onClose,
  );
};
