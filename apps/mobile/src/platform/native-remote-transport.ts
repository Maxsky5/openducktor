/**
 * The `RemoteTransport` of the mobile app.
 * HTTP uses the `OpenDucktorNetwork` native module. It never follows redirects, keeps no cookies or cache, and uses platform certificate trust only.
 * The terminal uses the React Native WebSocket. It offers the connection tag subprotocol and also sends the connection header.
 * Create one transport at startup:
 * `createNativeRemoteTransport({ network: OpenDucktorNetwork, createWebSocket: (url, protocols, options) => new WebSocket(url, protocols, options), createRequestId: () => crypto.randomUUID() })`.
 */
import { z } from "zod";
import type { RemoteFailure } from "@openducktor/contracts";
import { RemoteConnectionError, type RemoteTransport } from "@openducktor/host-client/remote";
import {
  openRemoteTerminalSocket,
  type RemoteTerminalSocket,
} from "@openducktor/host-client/remote/terminal-socket";
import type {
  NativeHttpHead,
  NativeNetworkErrorCode,
  OpenDucktorNetworkModule,
} from "../../modules/openducktor-network";

export type NativeRemoteTransportDependencies = {
  network: OpenDucktorNetworkModule;
  createWebSocket: (
    url: string,
    protocols: string[],
    options: { headers: Record<string, string> },
  ) => RemoteTerminalSocket;
  createRequestId: () => string;
};

const nativeErrorSchema = z.object({
  code: z.enum([
    "ERR_ODT_NETWORK",
    "ERR_ODT_TIMEOUT",
    "ERR_ODT_TLS",
    "ERR_ODT_LOCAL_NETWORK_DENIED",
    "ERR_ODT_CANCELED",
  ]),
  message: z.string(),
}) satisfies z.ZodType<{ code: NativeNetworkErrorCode; message: string }>;

/**
 * The failure that the user sees for a native network error. The native text names platform
 * internals, so the message says what happened and what to do instead.
 */
const failureFor = (error: z.infer<typeof nativeErrorSchema>): RemoteFailure => {
  switch (error.code) {
    case "ERR_ODT_NETWORK":
      return {
        code: "unavailable",
        message: "The host does not answer at this address.",
        nextAction:
          "Check that OpenDucktor is open on the host computer with Remote control on, and that this device is on the same network.",
        transportCause: "network",
      };
    case "ERR_ODT_TIMEOUT":
      return {
        code: "unavailable",
        message: "The host took too long to answer.",
        nextAction:
          "Check that the host computer is awake and on the same network, then try again.",
        transportCause: "timeout",
      };
    case "ERR_ODT_TLS":
      return {
        code: "transport_failure",
        message: "This device does not trust the host certificate.",
        nextAction:
          "Install a certificate that this device trusts on the host or its proxy, then try again.",
        transportCause: "tls",
      };
    case "ERR_ODT_LOCAL_NETWORK_DENIED":
      return {
        code: "unavailable",
        // iOS gives the same reason while its first Local Network alert shows, so the words cover
        // both cases.
        message: "OpenDucktor needs Local Network access to reach this host.",
        nextAction:
          "Allow Local Network when iOS asks, or turn it on in Settings, Privacy & Security, Local Network. Then try again.",
        transportCause: "network",
      };
    case "ERR_ODT_CANCELED":
      return {
        code: "transport_failure",
        message: "The request stopped before the host answered.",
        nextAction: "Try again.",
      };
  }
};

/** Returns the failure of a network module rejection, or `null` for another rejection. */
const transportError = (cause: unknown): RemoteConnectionError | null => {
  const parsed = nativeErrorSchema.safeParse(cause);
  return parsed.success ? new RemoteConnectionError(failureFor(parsed.data)) : null;
};

/** Waits for a native call. An abort rejects at once with the abort reason. */
const untilSettled = <T>(operation: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (cause) => {
        signal.removeEventListener("abort", abort);
        reject(signal.aborted ? signal.reason : (transportError(cause) ?? cause));
      },
    );
  });

/** Ties one native request to its abort signal. `cancel` releases the native request once. */
const trackRequest = (
  network: OpenDucktorNetworkModule,
  requestId: string,
  signal: AbortSignal,
) => {
  let open = true;
  const detach = () => {
    open = false;
    signal.removeEventListener("abort", cancel);
  };
  function cancel(): void {
    if (!open) return;
    detach();
    network.cancel(requestId);
  }
  signal.addEventListener("abort", cancel, { once: true });
  return { detach, cancel, isOpen: () => open };
};

export const createNativeRemoteTransport = ({
  network,
  createWebSocket,
  createRequestId,
}: NativeRemoteTransportDependencies): RemoteTransport => ({
  async request(method, url, headers, signal, body) {
    signal.throwIfAborted();
    const requestId = createRequestId();
    const tracked = trackRequest(network, requestId, signal);
    let head: NativeHttpHead;
    try {
      head = await untilSettled(
        network.start(requestId, method, url, headers, body ?? null),
        signal,
      );
    } catch (cause) {
      tracked.cancel();
      throw cause;
    }
    const iterator: AsyncIterator<Uint8Array, undefined> = {
      next: async () => {
        signal.throwIfAborted();
        if (!tracked.isOpen()) return { done: true, value: undefined };
        let chunk: Uint8Array | null;
        try {
          chunk = await untilSettled(network.read(requestId), signal);
        } catch (cause) {
          tracked.cancel();
          throw cause;
        }
        if (chunk !== null) return { done: false, value: chunk };
        tracked.detach();
        return { done: true, value: undefined };
      },
      return: async () => {
        tracked.cancel();
        return { done: true, value: undefined };
      },
    };
    return {
      status: head.status,
      headers: head.headers,
      body: { [Symbol.asyncIterator]: () => iterator },
    };
  },
  openTerminal: (url, headers, signal, onFrame, onClose) =>
    openRemoteTerminalSocket(
      (protocols) => createWebSocket(url, protocols, { headers }),
      headers,
      signal,
      onFrame,
      onClose,
    ),
});
