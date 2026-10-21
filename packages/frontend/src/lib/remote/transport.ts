import {
  REMOTE_CONNECTION_HEADER,
  REMOTE_TERMINAL_CONNECTION_PREFIX,
  TERMINAL_PROTOCOL_SUBPROTOCOL,
} from "@openducktor/contracts";
import {
  RemoteConnectionError,
  remoteError,
  type RemoteTransport,
} from "@openducktor/host-client/remote";

export const createBrowserRemoteTransport = (): RemoteTransport => {
  // Once the host answered, a local network block does not apply to it, so later failures keep
  // their own errors.
  let reachedHost = false;
  return {
    async request(method, url, headers, signal, body) {
      const init: RequestInit = {
        method,
        headers,
        signal,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      };
      if (body !== undefined) init.body = body;
      let response: Response;
      try {
        response = await fetch(url, init);
      } catch (cause) {
        if (!reachedHost && !signal.aborted && (await isLocalNetworkDenied()))
          throw localNetworkBlocked();
        throw cause;
      }
      reachedHost = true;
      if (new URL(response.url).href !== new URL(url).href) {
        await response.body?.cancel();
        throw remoteError(
          "invalid_endpoint",
          "Remote response used another endpoint.",
          "Correct the proxy routing.",
        );
      }
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: (async function* () {
          const reader = response.body?.getReader();
          if (!reader) return;
          try {
            while (true) {
              const result = await reader.read();
              if (result.done) return;
              yield result.value;
            }
          } finally {
            await reader.cancel();
            reader.releaseLock();
          }
        })(),
      };
    },
    openTerminal(url, headers, signal, onFrame, onClose) {
      return new Promise((resolve, reject) => {
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
        const socket = new WebSocket(url, [
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
              if (socket.readyState !== WebSocket.OPEN)
                throw new Error("Terminal is disconnected.");
              socket.send(Uint8Array.from(frame));
            },
            close: () => socket.close(),
          });
        };
        socket.onmessage = (event) => {
          if (!signal.aborted && event.data instanceof ArrayBuffer)
            onFrame(new Uint8Array(event.data));
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
    },
  };
};

/**
 * Chrome reports a blocked Local Network Access permission only as a network error, so the
 * transport reads the permission to name the cause. Browsers without this permission name reject
 * the query, and the original failure stays.
 */
const isLocalNetworkDenied = async (): Promise<boolean> => {
  try {
    // SAFETY: TypeScript's DOM types do not list Chrome's `local-network` permission name yet.
    const status = await navigator.permissions.query({ name: "local-network" as PermissionName });
    return status.state === "denied";
  } catch {
    return false;
  }
};

const localNetworkBlocked = (): RemoteConnectionError =>
  new RemoteConnectionError({
    code: "transport_failure",
    transportCause: "local_network",
    message: "This browser blocked access to your local network.",
    nextAction:
      "Allow local network access for this site in the browser's site settings, then select Retry.",
  });
