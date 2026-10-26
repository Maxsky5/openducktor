import {
  REMOTE_BASELINE_CAPABILITIES,
  REMOTE_PROTOCOL_VERSION,
  REMOTE_CONNECTION_HEADER,
  type RemoteFailure,
  type RemoteHostDescriptor,
} from "@openducktor/contracts";
import {
  RemoteConnectionError,
  type RemoteHttpResponse,
  type RemoteTransport,
} from "@openducktor/host-client/remote";

const encoder = new TextEncoder();

/** What the simulated host does with the next connection attempts. */
export type SimulatedAdmission =
  | { kind: "accept" }
  | { kind: "unreachable" }
  | { kind: "refuse"; status: number; failure: RemoteFailure };

/**
 * A deterministic remote host for tests. It speaks the remote protocol over a fake transport:
 * discovery, negotiation, the combined event stream, and release.
 */
export const createSimulatedRemoteHost = (options?: {
  shell?: RemoteHostDescriptor["shell"];
  /** The stable host ID of the discovery reply. Without it, the host acts as an older host. */
  hostId?: string;
}) => {
  let admission: SimulatedAdmission = { kind: "accept" };
  let openStreams = 0;
  const notificationEpoch = crypto.randomUUID();
  const released: string[] = [];
  const descriptor = (): RemoteHostDescriptor => {
    const reply: RemoteHostDescriptor = {
      shell: options?.shell ?? "electron",
      appVersion: "host-test",
      hostInstanceId: "host-run-1",
      accessPolicy: "network_reach",
      protocols: [
        { version: REMOTE_PROTOCOL_VERSION, capabilities: [...REMOTE_BASELINE_CAPABILITIES] },
      ],
    };
    if (options?.hostId) reply.hostId = options.hostId;
    return reply;
  };

  const json = <Value>(value: Value, status = 200): RemoteHttpResponse => ({
    status,
    headers: { "content-type": "application/json" },
    body: (async function* () {
      if (status !== 204) yield encoder.encode(JSON.stringify(value));
    })(),
  });

  const frame = (event: string, data: string) => `event: ${event}\ndata: ${data}\n\n`;

  /** Sends the initial frames, then stays open until the client aborts the request. */
  const stream = (signal: AbortSignal, initial: string): RemoteHttpResponse => ({
    status: 200,
    headers: { "content-type": "text/event-stream" },
    body: (async function* () {
      openStreams += 1;
      try {
        yield encoder.encode(initial);
        await new Promise<never>((_resolve, reject) => {
          const abort = () => reject(signal.reason);
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
      } finally {
        openStreams -= 1;
      }
    })(),
  });

  const unreachable = () =>
    new RemoteConnectionError({
      code: "unavailable",
      message: "The host did not answer.",
      nextAction: "Check that this device can reach the host network, then retry.",
      transportCause: "network",
    });

  const transport: RemoteTransport = {
    async request(method, url, headers, signal) {
      const path = new URL(url).pathname;
      if (admission.kind === "unreachable") throw unreachable();
      if (method === "GET" && (path === "/" || path === "")) return json(descriptor());
      if (method === "POST" && path.endsWith("/connections")) {
        if (admission.kind === "refuse")
          return json({ status: "rejected", failure: admission.failure }, admission.status);
        return json({
          status: "accepted",
          host: descriptor(),
          connectionId: crypto.randomUUID(),
          protocolVersion: REMOTE_PROTOCOL_VERSION,
          missingOptionalCapabilities: [],
        });
      }
      if (method === "DELETE" && path.endsWith("/connections/current")) {
        released.push(headers[REMOTE_CONNECTION_HEADER] ?? "");
        return json(null, 204);
      }
      if (method === "GET" && path.endsWith("/events")) {
        return stream(
          signal,
          frame("replay-complete", JSON.stringify({ hostChanged: false, gaps: [] })) +
            frame(
              "notification-frame",
              JSON.stringify({
                type: "attached",
                cursor: { epoch: notificationEpoch, sequence: 0 },
                reason: "new",
                health: [],
              }),
            ),
        );
      }
      return json({ error: `Unhandled ${method} ${path}` }, 404);
    },
    openTerminal: async () => {
      throw new Error("The simulated host opens no terminals.");
    },
  };

  return {
    transport,
    /** The connection IDs that the client released. */
    released,
    setAdmission(next: SimulatedAdmission) {
      admission = next;
    },
    /** The event streams that the client reads now. */
    openStreamCount: () => openStreams,
  };
};
