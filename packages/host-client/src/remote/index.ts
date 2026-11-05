import type { JSONType } from "zod";
import { hostCommandInputRecordSchema, type HostCommandArgs } from "@openducktor/contracts";
import {
  AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS,
  HOST_CHANNEL_HEARTBEAT_INTERVAL_MS,
  HOST_CHANNEL_SUBPROTOCOL,
  hostErrorResponseSchema,
  isHostReadCommand,
  hostEventEnvelopeSchema,
  remoteEndpointSchema,
  remoteHostDescriptorSchema,
  remoteNegotiationResultSchema,
  REMOTE_CONNECTION_HEADER,
  REMOTE_HISTORY_TOOL_DETAILS_CAPABILITY,
  TERMINAL_PROTOCOL_SUBPROTOCOL,
  type HostEventEnvelope,
  type NotificationStreamFrame,
  type RemoteClientHello,
  type RemoteClientKind,
  type RemoteConnectionRequest,
  type RemoteFailure,
  type RemoteHostDescriptor,
  type TaskAssetRenderContext,
  type TaskEventCursor,
  type TaskEventStreamFrame,
  type TaskEventStreamSubscribe,
} from "@openducktor/contracts";
import { createHostClient, HostInvokeError, type HostClient } from "../index";
import {
  hostChannelInvokeError,
  HostChannelProtocolError,
  HostChannelRequestError,
  openHostChannel,
  type HostChannelCursors,
  type HostChannelLoss,
  type HostChannelReplay,
  type OpenedHostChannel,
} from "../channel";
import {
  readBytes,
  RemoteConnectionError,
  RemoteReplyTooLargeError,
  remoteError,
  type RemoteTransport,
  type RemoteHttpResponse,
  type RemoteSocketConnection,
} from "./transport";
import { acceptedProtocol, createClientAdmission, securePairingHostId } from "./client-admission";
import { linkSignals } from "./linked-signal";
export * from "./transport";
export * from "./authorization";
import {
  canonicalRemoteEndpoint,
  isRemotePairingFailure,
  type RemoteAuthorizationStore,
  type RemoteConnectInput,
} from "./authorization";
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
  /** Confirmed replacement retained until synchronization reports it. */
  hostChanged: boolean;
  hostReplay: HostChannelReplay;
};
/** The end of a host event replay: a host change, and the event names with missed events. */
export type RemoteSynchronizer = (context: RemoteSynchronizationContext) => Promise<void>;
export type RemoteTaskSubscription = {
  readonly ready: Promise<void>;
  acknowledge(cursor: TaskEventCursor): Promise<void>;
  unsubscribe(): Promise<void>;
};
export interface RemoteHostClient {
  readonly client: HostClient;
  readState(): RemoteConnectionState;
  connect(input?: RemoteConnectInput): Promise<void>;
  retry(): Promise<void>;
  disconnect(): Promise<void>;
  setActive(active: boolean): void;
  /**
   * Resolves true when the host channel delivers a message within the time that its heartbeat
   * allows, counted from now. Resolves false when the channel stays silent or the connection is not
   * connected. After a device pause, such as a locked screen, a dead channel shows no error until a
   * read fails, so the app checks it on return.
   */
  confirmEventStream(): Promise<boolean>;
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
  ): Promise<RemoteSocketConnection>;
  readTaskAsset(context: TaskAssetRenderContext, signal: AbortSignal): Promise<Resource>;
  readStagedPreview(path: string, signal: AbortSignal): Promise<Resource>;
}
/** How a request proves access: the admitted connection, no proof, or a saved access token. */
type RequestAuth = "connection" | "none" | { proof: string };
type RequestOptions = { auth?: RequestAuth; streaming?: boolean };
/** The host channel of one connection attempt. */
type Channel = { generation: number; opened: OpenedHostChannel };
/** The headers that carry an admitted connection. */
const admissionHeaders = (admission: RemoteAdmission) => ({
  [REMOTE_CONNECTION_HEADER]: admission.connectionId,
  authorization: `Bearer ${admission.connectionToken}`,
});
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
  authorization: { store: RemoteAuthorizationStore; clientKind: RemoteClientKind },
): RemoteHostClient => {
  const validated = remoteEndpointSchema.safeParse(endpoint);
  if (!validated.success)
    throw remoteError(
      "invalid_endpoint",
      validated.error.message,
      "Enter a reachable complete remote work endpoint.",
    );
  const base = canonicalRemoteEndpoint(validated.data);
  let state: RemoteConnectionState = { status: "idle", generation: 0 };
  let generation = 0;
  let owner: AbortController | null = null;
  let admission: RemoteAdmission | null = null;
  const clientAdmission = createClientAdmission({
    base,
    hello,
    store: authorization.store,
    clientKind: authorization.clientKind,
  });
  let selected = false;
  let active = true;
  let pending: Promise<void> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let pendingHostChanged = false;
  const pendingReplayGaps = new Set<string>();
  const cursors: HostChannelCursors = { hostEvents: null, notifications: null };
  let channel: Channel | null = null;
  /** The host of this admission cuts long tool details from history on request. */
  let compactHistory = false;
  /** When the host channel last delivered a message, heartbeats included. */
  let eventStreamBytesAt = 0;
  const eventStreamListeners = new Set<() => void>();
  const stateListeners = new Set<(state: RemoteConnectionState) => void>();
  const eventListeners = new Set<(event: HostEventEnvelope) => void>();
  const notificationListeners = new Set<(frame: NotificationStreamFrame) => void>();
  const publish = (status: RemoteConnectionState["status"], failure?: RemoteFailure) => {
    const next: RemoteConnectionState = { status, generation };
    if (state.host) next.host = state.host;
    if (failure) next.failure = failure;
    else if (
      (status === "connecting" || status === "synchronizing") &&
      state.failure &&
      isRemotePairingFailure(state.failure.code)
    )
      next.failure = state.failure;
    state = next;
    deliver(stateListeners, state);
  };
  const headers = () => {
    if (!admission)
      throw remoteError(
        "connection_expired",
        "There is no admitted remote connection.",
        "Connect before using host work.",
      );
    return admissionHeaders(admission);
  };
  /** Discovery, negotiation, release, and files need only a setup deadline. */
  const request = async (
    method: "GET" | "POST" | "DELETE",
    path: string,
    signal: AbortSignal,
    body?: RequestBody,
    { auth = "connection", streaming = false }: RequestOptions = {},
  ): Promise<RemoteHttpResponse> => {
    const admitted = auth === "connection";
    const setup = new AbortController();
    const timer = setTimeout(
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
    const { signal: combined, unlink } = linkSignals([signal, setup.signal]);
    const requestGeneration = generation;
    try {
      const requestHeaders: Record<string, string> = admitted ? headers() : {};
      if (auth !== "connection" && auth !== "none")
        requestHeaders.authorization = `Bearer ${auth.proof}`;
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
        if (negotiated.success && negotiated.data.status === "rejected") {
          const refusal = new RemoteRefusalError(negotiated.data.failure);
          // The host no longer knows this admission, so the connection is gone. A reconnect
          // negotiates a new one. The host refused the request, so it ran no work.
          if (
            admitted &&
            ["connection_expired", "authorization_rejected"].includes(refusal.failure.code)
          )
            lost(requestGeneration, refusal);
          throw refusal;
        }
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
            unlink();
          }
        })(),
      };
    } catch (cause) {
      clearTimeout(timer);
      // A native transport keeps a request until its body ends or its signal aborts, so a request
      // that fails with an unread body, such as a redirect, aborts before its signal detaches.
      setup.abort(cause);
      unlink();
      throw cause;
    }
  };
  const json = async (
    method: "GET" | "POST" | "DELETE",
    path: string,
    signal: AbortSignal,
    body?: RequestBody,
    options: Pick<RequestOptions, "auth"> = {},
  ): Promise<JSONType> => {
    const bytes = await readBytes(await request(method, path, signal, body, options), signal);
    try {
      // `JSON.parse` returns only JSON values. Each command checks the shape with its own schema.
      const value: JSONType = JSON.parse(new TextDecoder().decode(bytes));
      return value;
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
    const previousAdmission = admission;
    if (error.failure.code === "authorization_rejected") clientAdmission.refuseCurrent();
    owner?.abort(error);
    admission = null;
    if (previousAdmission) void release(previousAdmission);
    publish(canRetry(error) ? "disconnected" : "failed", error.failure);
    if (canRetry(error)) schedule();
  };
  /** The remote error of a lost host channel. */
  const channelLossError = (loss: HostChannelLoss): RemoteConnectionError => {
    switch (loss.reason) {
      case "closed":
        return remoteError(
          "transport_failure",
          "The host channel closed.",
          "Reconnect to the selected host.",
        );
      case "silent":
        return remoteError(
          "transport_failure",
          "The host channel went silent.",
          "Reconnect to the selected host.",
        );
      case "unreadable":
        return invalidFrame();
      case "send_failed":
        return connectionError(loss.cause);
    }
  };
  /** The WebSocket URL of a host route. */
  const socketUrl = (path: string): string => {
    const url = new URL(`${base}${path}`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.href;
  };
  /** The host channel of attempt `current`, or a failure when that channel is gone. */
  const channelOf = (current: number): OpenedHostChannel => {
    if (!channel || channel.generation !== current)
      throw remoteError(
        "connection_expired",
        "The host channel of this connection is closed.",
        "Reconnect before using host work.",
      );
    return channel.opened;
  };
  /**
   * Opens the host channel of attempt `current`, receives the replay of missed host events, and
   * waits for notification attachment. A closed or silent channel loses the connection.
   */
  const openChannel = async (current: number, signal: AbortSignal): Promise<HostChannelReplay> => {
    const setup = new AbortController();
    const setupTimer = setTimeout(
      () =>
        setup.abort(
          remoteError(
            "transport_failure",
            "The host channel did not finish setup.",
            "Check the proxy WebSocket forwarding and retry.",
          ),
        ),
      SETUP_TIMEOUT_MS,
    );
    const { signal: setupSignal, unlink } = linkSignals([signal, setup.signal]);
    const attached = deferred<void>();
    signal.addEventListener(
      "abort",
      () => {
        if (channel?.generation === current) channel = null;
      },
      { once: true },
    );
    try {
      const hostChannel = await waitWithAbort(
        openHostChannel({
          cursors,
          open: (onFrame, onClose) =>
            transport.openSocket(
              socketUrl("/channel"),
              HOST_CHANNEL_SUBPROTOCOL,
              headers(),
              signal,
              onFrame,
              onClose,
            ),
          signal,
          handlers: {
            hostEvent: (event) => {
              let envelope: HostEventEnvelope;
              try {
                envelope = hostEventEnvelopeSchema.parse(JSON.parse(event.body()));
              } catch {
                lost(current, invalidFrame());
                return;
              }
              deliver(eventListeners, envelope);
            },
            notification: (frame) => {
              deliver(notificationListeners, frame);
              if (frame.type === "attached") attached.resolve();
            },
          },
          onHandlerError: (cause) => console.error("Remote listener failed", cause),
          onFrame: () => {
            eventStreamBytesAt = Date.now();
            for (const listener of eventStreamListeners) listener();
          },
          onLost: (loss) => lost(current, channelLossError(loss)),
        }),
        setupSignal,
      ).catch(throwChannelRequestError);
      channel = { generation: current, opened: hostChannel };
      await waitWithAbort(attached.promise, setupSignal);
      return hostChannel.replay;
    } finally {
      clearTimeout(setupTimer);
      unlink();
    }
  };
  const connect = (input: RemoteConnectInput = {}): Promise<void> => {
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
    admission = null;
    const cancelled = () => {
      if (owner !== abort) return;
      selected = false;
      abort.abort(input.signal?.reason);
      publish("idle");
    };
    input.signal?.addEventListener("abort", cancelled, { once: true });
    if (input.signal?.aborted) cancelled();
    const previousHostInstanceId = state.host?.hostInstanceId ?? null;
    const operation = (async () => {
      let pendingAdmission: RemoteAdmission | null = null;
      try {
        const discoveredResult = remoteHostDescriptorSchema.safeParse(
          await json("GET", "", abort.signal, undefined, { auth: "none" }),
        );
        if (!discoveredResult.success)
          throw remoteError(
            "invalid_protocol",
            "Host discovery has an invalid shape.",
            "Update the host or correct the work endpoint.",
          );
        const discovered = discoveredResult.data;
        abort.signal.throwIfAborted();
        const hostId = securePairingHostId(discovered, hello);
        abort.signal.throwIfAborted();
        const admitted = await clientAdmission.negotiate({
          hostId,
          pairingCode: input.pairingCode,
          // Read a late admission after local cancellation so cleanup can release it.
          post: (payload, proof) =>
            json("POST", "/connections", AbortSignal.timeout(SETUP_TIMEOUT_MS), payload, {
              auth: proof === null ? "none" : { proof },
            }),
          aborted: () => abort.signal.aborted,
        });
        const { accepted } = admitted;
        pendingAdmission = accepted;
        abort.signal.throwIfAborted();
        await clientAdmission.keep(admitted, hostId);
        abort.signal.throwIfAborted();
        const negotiatedProtocol = acceptedProtocol(accepted, discovered, hello);
        abort.signal.throwIfAborted();
        // Shared admission unlocks work, so publish it only after validation and device storage.
        admission = {
          connectionId: accepted.connectionId,
          connectionToken: accepted.connectionToken,
        };
        pendingAdmission = null;
        // This client uses an optional capability only when it asked for it and the host has it.
        compactHistory =
          hello.optionalCapabilities.includes(REMOTE_HISTORY_TOOL_DETAILS_CAPABILITY) &&
          negotiatedProtocol.capabilities.includes(REMOTE_HISTORY_TOOL_DETAILS_CAPABILITY);
        state = { ...state, host: accepted.host };
        if (previousHostInstanceId !== accepted.host.hostInstanceId) {
          cursors.hostEvents = null;
          cursors.notifications = null;
          if (previousHostInstanceId !== null) pendingHostChanged = true;
        }
        let hostReplay: HostChannelReplay = await openChannel(current, abort.signal);
        for (const gap of hostReplay.gaps) pendingReplayGaps.add(gap);
        hostReplay = { ...hostReplay, gaps: [...pendingReplayGaps] };
        publish("synchronizing");
        try {
          await waitWithAbort(
            synchronize({
              generation: current,
              signal: abort.signal,
              host: accepted.host,
              previousHostInstanceId,
              hostChanged: pendingHostChanged,
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
        pendingReplayGaps.clear();
        pendingHostChanged = false;
        attempts = 0;
        publish("connected");
      } catch (cause) {
        if (pendingAdmission) await release(pendingAdmission);
        if (admission && owner === abort) {
          const previousAdmission = admission;
          admission = null;
          await release(previousAdmission);
        }
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
        input.signal?.removeEventListener("abort", cancelled);
        if (pending === operation) pending = null;
      })
      .catch(() => {});
    return operation;
  };
  const currentConnection = () => {
    if ((!owner || owner.signal.aborted || !admission) && state.failure)
      throw new RemoteConnectionError(state.failure);
    if (!owner || owner.signal.aborted || !admission)
      throw remoteError(
        "connection_expired",
        "The remote host is disconnected.",
        "Reconnect before using host work.",
      );
    return { generation, signal: owner.signal };
  };
  /** The failure of the current state, for work that cannot wait for a reconnect. */
  const disconnectedError = (): RemoteConnectionError =>
    new RemoteConnectionError(
      state.failure ?? {
        code: "connection_expired",
        message: "The remote host is disconnected.",
        nextAction: "Reconnect before using host work.",
      },
    );
  /**
   * Waits until the client connects again by itself. A read sent by the recovery barrier runs at
   * once, as its attempt holds an admission. A waiting read runs only after the barrier, so stream
   * snapshots come before current-state reads. Rejects when reconnects stop, after a disconnect
   * or a permanent failure, or when `deadline` passes.
   */
  const connected = (deadline: number): Promise<void> =>
    new Promise((resolve, reject) => {
      let settled = false;
      const settle = (failure?: RemoteConnectionError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stateListeners.delete(check);
        if (failure) reject(failure);
        else resolve();
      };
      const check = () => {
        if (state.status === "connected" && admission && owner && !owner.signal.aborted) settle();
        else if (!selected || state.status === "failed") settle(disconnectedError());
      };
      const timer = setTimeout(
        () => settle(disconnectedError()),
        Math.max(0, deadline - Date.now()),
      );
      stateListeners.add(check);
      check();
    });
  const client = createHostClient(async (command, args, resultSchema, options) => {
    // A read changes no host state, so it waits for the reconnect and runs again. A mutation is
    // never resent: a lost reply leaves its outcome unknown.
    const read = isHostReadCommand(command);
    const deadline = Date.now() + READ_RECONNECT_WAIT_MS;
    const callerSignal = options?.signal;
    while (true) {
      callerSignal?.throwIfAborted();
      const admitted = admission !== null && owner !== null && !owner.signal.aborted;
      if (read && !admitted) await waitForCaller(connected(deadline), callerSignal);
      // An admitted attempt still opens its channel. The recovery barrier runs after it opened.
      else if ((!admission || channel?.generation !== generation) && pending)
        await waitForCaller(pending, callerSignal);
      const { generation: current } = currentConnection();
      // Replies have a size limit, so a history read asks a host that can do it for compact history.
      const body = command === LOAD_HISTORY_COMMAND && compactHistory ? compact(args) : args;
      let payload: JSONType;
      try {
        payload = await channelOf(current).session.request(
          { method: "invoke", command, args: body ?? {} },
          callerSignal,
        );
      } catch (cause) {
        // The caller stopped waiting. The host may still run the command.
        if (callerSignal?.aborted && cause === callerSignal.reason) throw cause;
        if (cause instanceof HostChannelRequestError) {
          const { error } = cause;
          if (error.kind === "host") throw hostChannelInvokeError(cause);
          // The connection is sound, so only this command fails. A read gets the same reply again.
          // The host ran a mutation, so its outcome is unknown.
          if (error.kind === "reply_too_large") {
            if (read) throw new RemoteReplyTooLargeError(error.limitBytes);
            throw outcomeUnknown(command, "is larger than the limit of this app");
          }
          // The host ran no work. An ended admission also closes the channel, and that loss
          // starts the reconnect, so the refusal itself is not retried.
          throw new RemoteRefusalError(error.failure);
        }
        lost(current, cause);
        if (read) {
          if (Date.now() < deadline) continue;
          throw connectionError(cause);
        }
        throw outcomeUnknown(command, "was lost");
      }
      // A result of another shape is a version mismatch, not a lost connection.
      const parsed = resultSchema.safeParse(payload);
      if (parsed.success) return parsed.data;
      throw remoteError(
        "invalid_protocol",
        `The host sent a ${command} result that this app cannot read.`,
        "Update OpenDucktor on the host and on this device to the same version.",
      );
    }
  });
  const resource = async (path: string, signal: AbortSignal) => {
    const { signal: combined, unlink } = linkSignals(owner ? [signal, owner.signal] : [signal]);
    try {
      if (!admission && pending) await waitWithAbort(pending, combined);
      combined.throwIfAborted();
      currentConnection();
      const response = await request("GET", path, combined, undefined, { streaming: true });
      return { bytes: await readBytes(response, combined), headers: response.headers };
    } finally {
      unlink();
    }
  };
  /** Stop local delivery at once and finish bounded host cleanup before returning. */
  const stop = async () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    const previousAdmission = admission;
    const attempt = pending;
    const oldOwner = owner;
    ++generation;
    owner = null;
    admission = null;
    pending = null;
    oldOwner?.abort();
    publish("idle");
    if (previousAdmission) await release(previousAdmission);
    await attempt?.catch(() => {});
  };
  const release = async (ending: RemoteAdmission) => {
    const signal = AbortSignal.timeout(SETUP_TIMEOUT_MS);
    try {
      const response = await waitWithAbort(
        transport.request(
          "DELETE",
          `${base}/connections/current`,
          admissionHeaders(ending),
          signal,
        ),
        signal,
      );
      await readBytes(response, signal);
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
    retry: () => {
      // The client stays selected, so reads that wait for a reconnect keep waiting. The old
      // admission ends in the background: after a network change, its release can wait for the
      // setup deadline, and the new attempt does not need it.
      void stop();
      return connect();
    },
    disconnect,
    setActive(value) {
      active = value;
      if (!value) void stop();
      else if (selected) void connect().catch(() => {});
    },
    confirmEventStream() {
      const connection = owner;
      if (state.status !== "connected" || !connection || connection.signal.aborted)
        return Promise.resolve(false);
      // The host sends a heartbeat at each interval, and a live channel also delivers the messages
      // that arrived during the pause. So the next message is due by the next heartbeat.
      const window = Math.max(
        STREAM_PROOF_GRACE_MS,
        eventStreamBytesAt +
          HOST_CHANNEL_HEARTBEAT_INTERVAL_MS +
          STREAM_PROOF_GRACE_MS -
          Date.now(),
      );
      return new Promise((resolve) => {
        const finish = (alive: boolean) => {
          clearTimeout(timer);
          eventStreamListeners.delete(delivered);
          connection.signal.removeEventListener("abort", ended);
          resolve(alive);
        };
        const delivered = () => finish(true);
        const ended = () => finish(false);
        const timer = setTimeout(() => finish(false), window);
        eventStreamListeners.add(delivered);
        connection.signal.addEventListener("abort", ended, { once: true });
      });
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
      const { session } = channelOf(current);
      const signal = requestSignal ? AbortSignal.any([requestSignal, hostSignal]) : hostSignal;
      signal.throwIfAborted();
      const local = new AbortController();
      const combined = AbortSignal.any([signal, local.signal]);
      const ready = deferred<void>();
      let boundary: TaskEventCursor | null = null;
      // Create the lease even if the view closes, so cleanup can release it.
      const { subscriptionId } = await session
        .subscribeTaskEvents(input, (frame) => {
          if (generation !== current || combined.aborted) return;
          if (frame.type === "snapshot_required") boundary = frame.cursor;
          onFrame(frame);
        })
        .then((lease) => {
          // A snapshot frame can arrive before this continuation. It moves the boundary on.
          boundary ??= lease.replayBoundary;
          return lease;
        }, throwChannelRequestError);
      const reachedBoundary = (cursor: TaskEventCursor | null) =>
        cursor !== null &&
        boundary !== null &&
        cursor.epoch === boundary.epoch &&
        cursor.sequence >= boundary.sequence;
      const fail = () => ready.reject(combined.reason);
      combined.addEventListener("abort", fail, { once: true });
      if (reachedBoundary(input.cursor)) ready.resolve();
      const unsubscribe = async () => {
        local.abort();
        combined.removeEventListener("abort", fail);
        if (generation !== current || hostSignal.aborted) return;
        try {
          await session.releaseTaskEvents(subscriptionId);
        } catch (cause) {
          throwChannelRequestError(cause);
        }
      };
      if (combined.aborted) {
        await unsubscribe();
        combined.throwIfAborted();
      }
      return {
        ready: ready.promise,
        async acknowledge(cursor) {
          if (generation !== current)
            throw remoteError(
              "connection_expired",
              "This task handle belongs to an old connection.",
              "Restore the task subscription on the current connection.",
            );
          try {
            await session.request({ method: "task_events.ack", subscriptionId, cursor }, combined);
          } catch (cause) {
            throwChannelRequestError(cause);
          }
          if (reachedBoundary(cursor)) ready.resolve();
        },
        unsubscribe,
      };
    },
    async connectTerminal(signal, onFrame, onClose) {
      const connection = currentConnection();
      const { signal: combined, unlink } = linkSignals([signal, connection.signal]);
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
      const socketPromise = transport.openSocket(
        socketUrl("/terminal"),
        TERMINAL_PROTOCOL_SUBPROTOCOL,
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
            unlink();
            socket.close();
          },
        };
      } catch (cause) {
        connection.signal.removeEventListener("abort", hostLost);
        unlink();
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

type RemoteAdmission = {
  connectionId: string;
  connectionToken: string;
};

type RequestBody = RemoteConnectionRequest;
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

const invalidFrame = (): RemoteConnectionError =>
  remoteError(
    "invalid_protocol",
    "The host channel sent an invalid protocol frame.",
    "Update the host or correct proxy WebSocket routing, then retry.",
  );
class RemoteRefusalError extends RemoteConnectionError {}
/** Throws the remote error of a failed channel request that is no command. */
const throwChannelRequestError = (cause: unknown): never => {
  if (cause instanceof HostChannelProtocolError) throw invalidFrame();
  if (!(cause instanceof HostChannelRequestError)) throw cause;
  const { error } = cause;
  if (error.kind === "refused") throw new RemoteRefusalError(error.failure);
  throw remoteError("invalid_protocol", cause.message, "Update the host and this app.");
};
/** Waits for `operation`, or rejects with the reason of `signal` when the caller stops waiting. */
const waitForCaller = <T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> =>
  signal ? waitWithAbort(operation, signal) : operation;
/** The host may have run `command`. `reason` says why this client has no result. */
const outcomeUnknown = (command: string, reason: string): RemoteConnectionError =>
  remoteError(
    "outcome_unknown",
    `The result of ${command} ${reason}.`,
    "Read current host state to check the outcome. Do not resend the operation automatically.",
  );
const LOAD_HISTORY_COMMAND = AGENT_RUNTIME_QUERY_COMMAND_CONTRACTS.loadSessionHistory.command;
/** The history read input with `toolDetails: "on_demand"`. */
const compact = (args: HostCommandArgs): HostCommandArgs => ({
  ...args,
  input: { ...hostCommandInputRecordSchema.parse(args?.input), toolDetails: "on_demand" },
});
const SETUP_TIMEOUT_MS = 10_000;
/** How long a read waits for a reconnect before it fails with the connection failure. */
const READ_RECONNECT_WAIT_MS = 30_000;
/** How long a stream check waits at least for bytes that the stream delivers after a pause. */
const STREAM_PROOF_GRACE_MS = 2_000;
/**
 * A synchronization failure also retries: one failed read or recovery, as during a host restart,
 * must not stop the reconnects. The state keeps the failure, so the user can see it.
 */
const canRetry = (error: RemoteConnectionError): boolean =>
  ["unavailable", "transport_failure", "connection_expired", "synchronization_failed"].includes(
    error.failure.code,
  ) &&
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
/** Waits for `operation`, or rejects with the abort reason when `signal` aborts first. */
export const waitWithAbort = <T>(operation: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
