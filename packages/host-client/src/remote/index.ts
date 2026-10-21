import { z, type JSONType } from "zod";
import type { HostCommandArgs } from "@openducktor/contracts";
import {
  browserEventCursorSchema,
  browserReplayCompleteSchema,
  hostErrorResponseSchema,
  notificationStreamFrameSchema,
  hostEventEnvelopeSchema,
  remoteEndpointSchema,
  remoteHostDescriptorSchema,
  remoteNegotiationResultSchema,
  remoteTaskLeaseSchema,
  taskEventStreamFrameSchema,
  REMOTE_CONNECTION_HEADER,
  type BrowserEventCursor,
  type BrowserReplayComplete,
  type HostEventEnvelope,
  type NotificationStreamFrame,
  type RemoteClientHello,
  type RemoteFailure,
  type RemoteHostDescriptor,
  type TaskAssetRenderContext,
  type TaskEventCursor,
  type TaskEventStreamFrame,
  type TaskEventStreamSubscribe,
} from "@openducktor/contracts";
import { createHostClient, HostInvokeError, type HostClient } from "../index";
import {
  readBytes,
  RemoteConnectionError,
  remoteError,
  type RemoteTransport,
  type RemoteHttpResponse,
  type RemoteTerminalConnection,
} from "./transport";
import { readSse } from "./sse";
export * from "./transport";
export { readSse, type SseFrame } from "./sse";
export type RemoteConnectionState = {
  status: "idle" | "connecting" | "synchronizing" | "connected" | "disconnected" | "failed";
  generation: number;
  host?: RemoteHostDescriptor;
  failure?: RemoteFailure;
};
export type RemoteSynchronizationContext = {
  generation: number;
  signal: AbortSignal;
  host: RemoteHostDescriptor;
  previousHostInstanceId: string | null;
  hostReplay: BrowserReplayComplete;
};
export type RemoteSynchronizer = (context: RemoteSynchronizationContext) => Promise<void>;
export type RemoteTaskSubscription = {
  readonly ready: Promise<void>;
  acknowledge(cursor: TaskEventCursor): Promise<void>;
  unsubscribe(): Promise<void>;
};
export interface RemoteHostClient {
  readonly client: HostClient;
  readState(): RemoteConnectionState;
  connect(): Promise<void>;
  retry(): Promise<void>;
  disconnect(): Promise<void>;
  setActive(active: boolean): void;
  subscribeState(listener: (state: RemoteConnectionState) => void): () => void;
  subscribeHostEvents(listener: (event: HostEventEnvelope) => void): () => void;
  subscribeNotifications(listener: (frame: NotificationStreamFrame) => void): () => void;
  subscribeTaskStream(
    input: TaskEventStreamSubscribe,
    onFrame: (frame: TaskEventStreamFrame) => void,
    signal?: AbortSignal,
  ): Promise<RemoteTaskSubscription>;
  connectTerminal(
    signal: AbortSignal,
    onFrame: (frame: Uint8Array) => void,
    onClose: (failure?: RemoteFailure) => void,
  ): Promise<RemoteTerminalConnection>;
  readTaskAsset(context: TaskAssetRenderContext, signal: AbortSignal): Promise<Resource>;
  readStagedPreview(path: string, signal: AbortSignal): Promise<Resource>;
}
/**
 * Owns one host connection and its live handles.
 * Each attempt waits for replay and state recovery before it reports connected.
 * A new attempt cancels old handles; it does not resend work.
 */
export const createRemoteHostClient = (
  endpoint: string,
  hello: RemoteClientHello,
  transport: RemoteTransport,
  synchronize: RemoteSynchronizer,
): RemoteHostClient => {
  const validated = remoteEndpointSchema.safeParse(endpoint);
  if (!validated.success)
    throw remoteError(
      "invalid_endpoint",
      validated.error.message,
      "Enter a reachable complete remote work endpoint.",
    );
  const base = new URL(validated.data).href.replace(/\/$/, "");
  let state: RemoteConnectionState = { status: "idle", generation: 0 };
  let generation = 0;
  let owner: AbortController | null = null;
  let connectionId: string | null = null;
  let selected = false;
  let active = true;
  let pending: Promise<void> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let cursor: BrowserEventCursor | null = null;
  const stateListeners = new Set<(state: RemoteConnectionState) => void>();
  const eventListeners = new Set<(event: HostEventEnvelope) => void>();
  const notificationListeners = new Set<(frame: NotificationStreamFrame) => void>();
  const publish = (status: RemoteConnectionState["status"], failure?: RemoteFailure) => {
    const next: RemoteConnectionState = { status, generation };
    if (state.host) next.host = state.host;
    if (failure) next.failure = failure;
    state = next;
    deliver(stateListeners, state);
  };
  const headers = () => {
    if (!connectionId)
      throw remoteError(
        "connection_expired",
        "There is no admitted remote connection.",
        "Connect before using host work.",
      );
    return { [REMOTE_CONNECTION_HEADER]: connectionId };
  };
  /** Host commands can outlive setup deadlines. Streams and files only need a setup deadline. */
  const request = async (
    method: "GET" | "POST" | "DELETE",
    path: string,
    signal: AbortSignal,
    body?: RequestBody,
    admitted = true,
    streaming = false,
  ): Promise<RemoteHttpResponse> => {
    const setup = new AbortController();
    const timer = path.startsWith("/invoke/")
      ? undefined
      : setTimeout(
          () =>
            setup.abort(
              remoteError(
                "transport_failure",
                "Remote request setup timed out.",
                "Check the host and proxy, then retry.",
              ),
            ),
          SETUP_TIMEOUT_MS,
        );
    const combined = AbortSignal.any([signal, setup.signal]);
    try {
      const requestHeaders: Record<string, string> = admitted ? headers() : {};
      if (cursor && path === "/events") requestHeaders["last-event-id"] = JSON.stringify(cursor);
      if (body !== undefined) requestHeaders["content-type"] = "application/json";
      const response = await waitWithAbort(
        transport.request(
          method,
          `${base}${path}`,
          requestHeaders,
          combined,
          body === undefined ? undefined : JSON.stringify(body),
        ),
        combined,
      );
      if (response.status >= 300 && response.status < 400)
        throw remoteError(
          "invalid_endpoint",
          "The host redirected this request.",
          "Use the final work endpoint and correct proxy routing.",
        );
      if (response.status < 200 || response.status >= 300) {
        const payload: unknown = JSON.parse(
          new TextDecoder().decode(await readBytes(response, combined)),
        );
        const negotiated = remoteNegotiationResultSchema.safeParse(payload);
        if (negotiated.success && negotiated.data.status === "rejected")
          throw new RemoteRefusalError(negotiated.data.failure);
        const hostError = hostErrorResponseSchema.safeParse(payload);
        if (hostError.success)
          throw new HostInvokeError(
            hostError.data.message ?? hostError.data.error ?? "Host command failed.",
            hostError.data.failure ?? null,
          );
        throw remoteError(
          "transport_failure",
          `Remote request failed with HTTP ${response.status}.`,
          "Check the host and proxy configuration.",
        );
      }
      if (streaming || response.status === 204 || response.status === 205) clearTimeout(timer);
      return {
        ...response,
        body: (async function* () {
          try {
            const iterator = response.body[Symbol.asyncIterator]();
            try {
              while (true) {
                const next = await waitWithAbort(iterator.next(), combined);
                if (next.done) break;
                yield next.value;
              }
            } finally {
              void iterator.return?.();
            }
          } finally {
            clearTimeout(timer);
          }
        })(),
      };
    } catch (cause) {
      clearTimeout(timer);
      throw cause;
    }
  };
  const json = async (
    method: "GET" | "POST" | "DELETE",
    path: string,
    signal: AbortSignal,
    body?: RequestBody,
    admitted = true,
  ): Promise<JSONType> => {
    const bytes = await readBytes(await request(method, path, signal, body, admitted), signal);
    try {
      return z.json().parse(JSON.parse(new TextDecoder().decode(bytes)));
    } catch (cause) {
      throw remoteError(
        "invalid_protocol",
        `Remote response is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
        "Correct the proxy routing or update the host, then retry.",
      );
    }
  };
  const schedule = () => {
    if (!selected || !active || reconnectTimer) return;
    reconnectTimer = setTimeout(
      () => {
        reconnectTimer = null;
        void connect().catch(() => {});
      },
      Math.min(500 * 2 ** attempts++, 15_000),
    );
  };
  const lost = (current: number, cause: unknown) => {
    if (generation !== current || owner?.signal.aborted) return;
    const error = connectionError(cause);
    const id = connectionId;
    owner?.abort(error);
    connectionId = null;
    if (id) void release(id);
    publish(canRetry(error) ? "disconnected" : "failed", error.failure);
    if (canRetry(error)) schedule();
  };
  const connect = (): Promise<void> => {
    selected = true;
    if (!active) return Promise.resolve();
    if (pending) return pending;
    if (state.status === "connected") return Promise.resolve();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    owner?.abort();
    const current = ++generation;
    const abort = new AbortController();
    owner = abort;
    connectionId = null;
    const previousHostInstanceId = state.host?.hostInstanceId ?? null;
    const operation = (async () => {
      try {
        const discoveredResult = remoteHostDescriptorSchema.safeParse(
          await json("GET", "", abort.signal, undefined, false),
        );
        if (!discoveredResult.success)
          throw remoteError(
            "invalid_protocol",
            "Host discovery has an invalid shape.",
            "Update the host or correct the work endpoint.",
          );
        const discovered = discoveredResult.data;
        abort.signal.throwIfAborted();
        // Read the admission ID after local cancellation so cleanup can release it.
        const acceptedResult = remoteNegotiationResultSchema.safeParse(
          await json("POST", "/connections", AbortSignal.timeout(SETUP_TIMEOUT_MS), hello, false),
        );
        if (!acceptedResult.success)
          throw remoteError(
            "invalid_protocol",
            "Remote negotiation has an invalid shape.",
            "Update the host or correct the work endpoint.",
          );
        const accepted = acceptedResult.data;
        if (accepted.status === "rejected") throw new RemoteConnectionError(accepted.failure);
        if (abort.signal.aborted) {
          await release(accepted.connectionId);
          abort.signal.throwIfAborted();
        }
        connectionId = accepted.connectionId;
        if (accepted.host.hostInstanceId !== discovered.hostInstanceId)
          throw remoteError(
            "unavailable",
            "The host restarted during negotiation.",
            "Reconnect to synchronize the current host.",
          );
        const negotiatedProtocol = accepted.host.protocols.find(
          (protocol) => protocol.version === accepted.protocolVersion,
        );
        if (
          !hello.supportedProtocolVersions.includes(accepted.protocolVersion) ||
          !negotiatedProtocol ||
          hello.requiredCapabilities.some(
            (capability) => !negotiatedProtocol.capabilities.includes(capability),
          )
        )
          throw remoteError(
            "invalid_protocol",
            "The host accepted an unsupported protocol or omitted required capabilities.",
            "Update the host to implement its advertised remote contract.",
          );
        abort.signal.throwIfAborted();
        state = { ...state, host: accepted.host };
        if (previousHostInstanceId !== accepted.host.hostInstanceId) cursor = null;
        const replay = deferred<BrowserReplayComplete>();
        const attached = deferred<void>();
        const setupTimer = setTimeout(() => {
          const error = remoteError(
            "transport_failure",
            "Host stream did not finish attachment.",
            "Check SSE proxy forwarding and retry.",
          );
          replay.reject(error);
          attached.reject(error);
        }, SETUP_TIMEOUT_MS);
        const events = await request("GET", "/events", abort.signal, undefined, true, true);
        void (async () => {
          try {
            for await (const frame of readSse(events.body, abort.signal)) {
              if (generation !== current) return;
              if (frame.event === "replay-complete")
                replay.resolve(parsePayload(browserReplayCompleteSchema, frame.data));
              else if (frame.event === "notification-frame") {
                const notification = parsePayload(notificationStreamFrameSchema, frame.data);
                deliver(notificationListeners, notification);
                if (notification.type === "attached") attached.resolve();
              } else {
                const event = parsePayload(hostEventEnvelopeSchema, frame.data);
                deliver(eventListeners, event);
              }
              if (frame.id) cursor = parsePayload(browserEventCursorSchema, frame.id);
            }
            throw remoteError(
              "transport_failure",
              "The host event stream ended.",
              "Reconnect to the selected host.",
            );
          } catch (cause) {
            replay.reject(cause);
            attached.reject(cause);
            lost(current, cause);
          }
        })();
        let hostReplay: BrowserReplayComplete;
        try {
          [hostReplay] = await waitWithAbort(
            Promise.all([replay.promise, attached.promise]),
            abort.signal,
          );
        } finally {
          clearTimeout(setupTimer);
        }
        publish("synchronizing");
        try {
          await waitWithAbort(
            synchronize({
              generation: current,
              signal: abort.signal,
              host: accepted.host,
              previousHostInstanceId,
              hostReplay,
            }),
            abort.signal,
          );
        } catch (cause) {
          if (abort.signal.aborted) throw cause;
          throw connectionError(cause, "synchronization_failed");
        }
        abort.signal.throwIfAborted();
        if (generation !== current) return;
        attempts = 0;
        publish("connected");
      } catch (cause) {
        if (generation !== current || !selected || !active) throw cause;
        if (!abort.signal.aborted) lost(current, cause);
        throw connectionError(cause);
      }
    })();
    pending = operation;
    // State listeners can start reads before connect returns.
    publish("connecting");
    void operation
      .finally(() => {
        if (pending === operation) pending = null;
      })
      .catch(() => {});
    return operation;
  };
  const currentConnection = () => {
    if ((!owner || owner.signal.aborted || !connectionId) && state.failure)
      throw new RemoteConnectionError(state.failure);
    if (!owner || owner.signal.aborted || !connectionId)
      throw remoteError(
        "connection_expired",
        "The remote host is disconnected.",
        "Reconnect before using host work.",
      );
    return { generation, signal: owner.signal };
  };
  const client = createHostClient(async (command, args, resultSchema) => {
    if (!connectionId && pending) await pending;
    const { generation: current, signal } = currentConnection();
    try {
      return resultSchema.parse(
        await json("POST", `/invoke/${encodeURIComponent(command)}`, signal, args ?? {}),
      );
    } catch (cause) {
      if (cause instanceof HostInvokeError || cause instanceof RemoteRefusalError) throw cause;
      lost(current, cause);
      throw remoteError(
        "outcome_unknown",
        `The result of ${command} was lost.`,
        "Read current host state to check the outcome. Do not resend the operation automatically.",
      );
    }
  });
  const resource = async (path: string, signal: AbortSignal) => {
    const combined = owner ? AbortSignal.any([signal, owner.signal]) : signal;
    if (!connectionId && pending) await waitWithAbort(pending, combined);
    combined.throwIfAborted();
    currentConnection();
    const response = await request("GET", path, combined, undefined, true, true);
    return { bytes: await readBytes(response, combined), headers: response.headers };
  };
  /** Stop local delivery at once and finish bounded host cleanup before returning. */
  const stop = async () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    const id = connectionId;
    const attempt = pending;
    const oldOwner = owner;
    ++generation;
    owner = null;
    connectionId = null;
    pending = null;
    oldOwner?.abort();
    publish("idle");
    if (id) await release(id);
    await attempt?.catch(() => {});
  };
  const release = async (id: string) => {
    const signal = AbortSignal.timeout(SETUP_TIMEOUT_MS);
    try {
      await waitWithAbort(
        transport.request(
          "DELETE",
          `${base}/connections/current`,
          { [REMOTE_CONNECTION_HEADER]: id },
          signal,
        ),
        signal,
      );
    } catch {
      // Local cleanup does not depend on the host reply.
    }
  };
  const disconnect = () => {
    selected = false;
    return stop();
  };
  return {
    client,
    readState: () => state,
    connect,
    retry: async () => {
      await disconnect();
      return connect();
    },
    disconnect,
    setActive(value) {
      active = value;
      if (!value) void stop();
      else if (selected) void connect().catch(() => {});
    },
    subscribeState(listener) {
      stateListeners.add(listener);
      deliver([listener], state);
      return () => stateListeners.delete(listener);
    },
    subscribeHostEvents(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    subscribeNotifications(listener) {
      notificationListeners.add(listener);
      return () => notificationListeners.delete(listener);
    },
    async subscribeTaskStream(input, onFrame, requestSignal) {
      const { generation: current, signal: hostSignal } = currentConnection();
      const signal = requestSignal ? AbortSignal.any([requestSignal, hostSignal]) : hostSignal;
      signal.throwIfAborted();
      // Read the lease ID even if the view closes so cleanup can release it.
      const lease = remoteTaskLeaseSchema.parse(
        await json("POST", "/task-events/subscriptions", hostSignal, input),
      );
      const local = new AbortController();
      const combined = AbortSignal.any([signal, local.signal]);
      const ready = deferred<void>();
      let boundary = lease.replayBoundary;
      const path = `/task-events/subscriptions/${lease.subscriptionId}`;
      const fail = () => ready.reject(combined.reason);
      combined.addEventListener("abort", fail, { once: true });
      if (input.cursor?.epoch === boundary.epoch && input.cursor.sequence >= boundary.sequence)
        ready.resolve();
      const unsubscribe = async () => {
        local.abort();
        combined.removeEventListener("abort", fail);
        if (generation === current && !hostSignal.aborted)
          await request("DELETE", path, hostSignal);
      };
      let response: RemoteHttpResponse;
      try {
        response = await request("GET", `${path}/stream`, combined, undefined, true, true);
      } catch (cause) {
        try {
          await unsubscribe();
        } catch (cleanupFailure) {
          throw new AggregateError(
            [cause, cleanupFailure],
            "Task stream setup failed and its lease could not be released.",
          );
        }
        throw cause;
      }
      const setupTimer = setTimeout(() => {
        const error = remoteError(
          "transport_failure",
          "Task stream did not establish delivery.",
          "Check SSE proxy forwarding and retry.",
        );
        ready.reject(error);
        lost(current, error);
      }, SETUP_TIMEOUT_MS);
      combined.addEventListener("abort", () => clearTimeout(setupTimer), { once: true });
      void (async () => {
        try {
          for await (const frame of readSse(response.body, combined, () =>
            clearTimeout(setupTimer),
          )) {
            clearTimeout(setupTimer);
            if (generation !== current) return;
            const parsed = parsePayload(taskEventStreamFrameSchema, frame.data);
            if (parsed.type === "snapshot_required") boundary = parsed.cursor;
            onFrame(parsed);
          }
          if (!combined.aborted)
            throw remoteError(
              "transport_failure",
              "Task stream ended.",
              "Reconnect and restore the task subscription.",
            );
        } catch (cause) {
          clearTimeout(setupTimer);
          ready.reject(cause);
          if (!local.signal.aborted && !requestSignal?.aborted && !hostSignal.aborted)
            lost(current, cause);
        }
      })();
      return {
        ready: ready.promise,
        async acknowledge(cursor) {
          if (generation !== current)
            throw remoteError(
              "connection_expired",
              "This task handle belongs to an old connection.",
              "Restore the task subscription on the current connection.",
            );
          await request("POST", `${path}/ack`, combined, { cursor });
          if (cursor.epoch === boundary.epoch && cursor.sequence >= boundary.sequence)
            ready.resolve();
        },
        unsubscribe,
      };
    },
    async connectTerminal(signal, onFrame, onClose) {
      const connection = currentConnection();
      const combined = AbortSignal.any([signal, connection.signal]);
      const wsUrl = new URL(`${base}/terminal`);
      wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
      const deadline = new AbortController();
      const timer = setTimeout(
        () =>
          deadline.abort(
            remoteError(
              "transport_failure",
              "Terminal setup timed out.",
              "Check the proxy WebSocket forwarding.",
            ),
          ),
        SETUP_TIMEOUT_MS,
      );
      const setupSignal = AbortSignal.any([combined, deadline.signal]);
      let closedByClient = false;
      let reported = false;
      const reportClose = (failure?: RemoteFailure) => {
        if (reported || closedByClient || signal.aborted) return;
        reported = true;
        onClose(failure);
      };
      const hostLost = () =>
        reportClose({
          code: "transport_failure",
          message: "The host connection was lost.",
          nextAction: "Reconnect and attach the surviving terminal. Do not replay input.",
        });
      connection.signal.addEventListener("abort", hostLost, { once: true });
      const socketPromise = transport.openTerminal(
        wsUrl.href,
        headers(),
        setupSignal,
        (frame) => {
          if (generation === connection.generation && !setupSignal.aborted) onFrame(frame);
        },
        (cause) => {
          if (generation === connection.generation) reportClose(cause);
        },
      );
      void socketPromise.then(
        (socket) => {
          if (setupSignal.aborted) socket.close();
        },
        () => {},
      );
      try {
        const socket = await waitWithAbort(socketPromise, setupSignal);
        return {
          send: async (frame) => {
            setupSignal.throwIfAborted();
            try {
              await socket.send(frame);
            } catch {
              throw remoteError(
                "outcome_unknown",
                "Terminal input delivery is uncertain.",
                "Inspect the terminal. Do not replay input automatically.",
              );
            }
          },
          close: () => {
            closedByClient = true;
            connection.signal.removeEventListener("abort", hostLost);
            socket.close();
          },
        };
      } catch (cause) {
        connection.signal.removeEventListener("abort", hostLost);
        throw cause;
      } finally {
        clearTimeout(timer);
      }
    },
    readTaskAsset: (context, signal) =>
      resource(
        `/task-assets/${[context.workspaceId, context.taskId, context.scope, context.assetId].map(encodeURIComponent).join("/")}`,
        signal,
      ),
    readStagedPreview: (path, signal) =>
      resource(`/local-attachment-preview?${new URLSearchParams({ path })}`, signal),
  };
};

type RequestBody =
  | HostCommandArgs
  | RemoteClientHello
  | TaskEventStreamSubscribe
  | { cursor: TaskEventCursor };
type Resource = {
  bytes: Uint8Array<ArrayBuffer>;
  headers: Readonly<Record<string, string>>;
};

/** Report view errors without stopping the connection or replaying delivered events. */
const deliver = <Value>(listeners: Iterable<(value: Value) => void>, value: Value): void => {
  for (const listener of listeners) {
    try {
      listener(value);
    } catch (cause) {
      console.error("Remote listener failed", cause);
    }
  }
};

const parsePayload = <Value>(schema: z.ZodType<Value>, text: string): Value => {
  try {
    return schema.parse(JSON.parse(text));
  } catch {
    throw remoteError(
      "invalid_protocol",
      "The host stream sent an invalid protocol frame.",
      "Update the host or correct proxy stream routing, then retry.",
    );
  }
};
class RemoteRefusalError extends RemoteConnectionError {}
const SETUP_TIMEOUT_MS = 10_000;
const canRetry = (error: RemoteConnectionError): boolean =>
  ["unavailable", "transport_failure", "connection_expired"].includes(error.failure.code) &&
  error.failure.transportCause !== "tls" &&
  error.failure.transportCause !== "local_network";
const connectionError = (
  cause: unknown,
  code: RemoteFailure["code"] = "transport_failure",
): RemoteConnectionError => {
  if (cause instanceof RemoteConnectionError) return cause;
  return remoteError(
    code,
    cause instanceof Error ? cause.message : String(cause),
    "Check the selected host address, network, TLS and proxy configuration, then retry.",
  );
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
};
const waitWithAbort = <T>(operation: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
