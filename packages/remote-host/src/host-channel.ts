import {
  type HostCommandInputRecord,
  encodeHostChannelBytesFrame,
  encodeHostChannelFrame,
  hostChannelClientMessageSchema,
  isHostReadCommand,
  HOST_CHANNEL_HEARTBEAT_INTERVAL_MS,
  HOST_CHANNEL_RESULT_PART_BYTES,
  type HostChannelError,
  type HostChannelClientMessage,
  type HostChannelMessage,
  type HostChannelRequestMessage,
  type HostErrorResponse,
  type HostEventsOpened,
  type RemoteAccessState,
  type RemoteFailure,
  type TaskEventLease as TaskEventLeaseResult,
} from "@openducktor/contracts";
import {
  hostInvokeFailureFromError,
  type EffectNodeHostCommandRouter,
  type HostCommandResult,
} from "@openducktor/host";
import { Effect, Fiber, Stream } from "effect";
import { errorMessage } from "./effect/web-errors";
import type { BufferedHostEventStream } from "./host-event-bus";
import type { NodeServerSocket } from "./node-fetch-server";
import type { TaskEventFrameSink, TaskEventLeaseManager } from "./task-event-leases";

/** Frames of at least this size use per-message deflate when the client negotiated it. */
const COMPRESS_MIN_BYTES = 1024;
/** Task frames wait while the socket buffers this many bytes, and resume on drain. */
const TASK_FRAME_BUFFER_BYTES = 1024 * 1024;
/** A client that lets this many bytes of events queue up cannot keep up, so its channel closes. */
const EVENT_BUFFER_LIMIT_BYTES = 64 * 1024 * 1024;

/** The reply of a command: its result, or why it has none. */
export type HostChannelReply = { result: HostCommandResult } | { error: HostChannelError };
/** A value that the host sends as the body of a result frame. */
type HostChannelResult = HostCommandResult | HostEventsOpened | TaskEventLeaseResult | null;

export type HostChannelOptions = {
  hostEvents: BufferedHostEventStream;
  notifications: EffectNodeHostCommandRouter["notificationStream"];
  leases: TaskEventLeaseManager;
  /** The task leases of this client's principal. All local channels share one set. */
  ownedLeases: Set<string>;
  /** The most task leases that `ownedLeases` can hold. */
  maxLeases?: number;
  /**
   * Runs a command under the policy of this listener. `signal` aborts when the client cancels a
   * host read or the socket closes during one. It never aborts for a command that can change state.
   */
  invoke(
    command: string,
    args: HostCommandInputRecord,
    signal: AbortSignal,
  ): Promise<HostChannelReply>;
  /** The live remote access state, for the local operator only. */
  remoteAccessStates?: Stream.Stream<RemoteAccessState>;
  /** A larger command reply fails with `reply_too_large`. */
  maxReplyBytes?: number;
  /**
   * Why the host takes no new work now, or null. A refusing host also ends notifications on
   * purpose, so their end is no failure then.
   */
  refusal(): RemoteFailure | null;
  /** Aborts when the admission of this client ends. */
  signal?: AbortSignal;
  reportFailure(cause: unknown): void;
};

/** A result body that goes out in parts. `sent` counts the bytes in the parts sent so far. */
type PartedResult = { id: number; body: Uint8Array; sent: number };

export type HostChannelSocketData = {
  kind: "channel";
  options: HostChannelOptions;
  closed: boolean;
  eventsOpened: boolean;
  /** The generation of each task lease that this socket receives. */
  leases: Map<string, number>;
  stops: Set<() => void>;
  remoteAccess: (() => void) | null;
  /** The running host reads that a cancel or a socket close interrupts. */
  reads: Map<number, AbortController>;
  /** Large results in send order. A part goes out only while the socket buffers nothing. */
  partedResults: PartedResult[];
};

export type HostChannelSocket = NodeServerSocket<HostChannelSocketData>;

export const createHostChannelSocketData = (
  options: HostChannelOptions,
): HostChannelSocketData => ({
  kind: "channel",
  options,
  closed: false,
  eventsOpened: false,
  leases: new Map(),
  stops: new Set(),
  remoteAccess: null,
  reads: new Map(),
  partedResults: [],
});

export const remoteFailure = (
  code: RemoteFailure["code"],
  message: string,
  nextAction: string,
): RemoteFailure => ({ code, message, nextAction });

/** The error payload of a host command that ran and failed. */
export const hostErrorResponse = (cause: unknown): HostErrorResponse => {
  const response: HostErrorResponse = { message: errorMessage(cause) };
  const failure = hostInvokeFailureFromError(cause);
  if (failure) response.failure = failure;
  return response;
};

/** The reply of a command that ran and failed. */
export const hostCommandFailure = (cause: unknown): HostChannelReply => ({
  error: { kind: "host", response: hostErrorResponse(cause) },
});

const HEARTBEAT_FRAME = encodeHostChannelFrame({ type: "heartbeat" });

const closeChannel = (socket: HostChannelSocket, code: number, reason: string): void => {
  if (socket.data.closed) return;
  socket.data.closed = true;
  socket.close(code, reason);
};

const sendFrame = (socket: HostChannelSocket, frame: Uint8Array): void => {
  if (socket.data.closed) return;
  if (socket.send(frame, frame.byteLength >= COMPRESS_MIN_BYTES) === 0)
    closeChannel(socket, 1011, "Host channel could not send data.");
};

const send = (socket: HostChannelSocket, header: HostChannelMessage, body?: string): void =>
  sendFrame(socket, encodeHostChannelFrame(header, body));

/** Events have no flow control, so a client that falls far behind reconnects and replays. */
const sendEvent = (socket: HostChannelSocket, frame: Uint8Array): void => {
  if (socket.bufferedAmount() > EVENT_BUFFER_LIMIT_BYTES) {
    closeChannel(socket, 1013, "Host channel consumer cannot keep up.");
    return;
  }
  sendFrame(socket, frame);
};

const sendError = (socket: HostChannelSocket, id: number, error: HostChannelError): void =>
  send(socket, { type: "error", id, error });

const refuse = (
  socket: HostChannelSocket,
  id: number,
  code: RemoteFailure["code"],
  message: string,
  nextAction: string,
): void =>
  sendError(socket, id, { kind: "refused", failure: remoteFailure(code, message, nextAction) });

/**
 * Sends the next parts of the large results. A part waits while the socket buffers data, so on a
 * slow link the heartbeat and other messages pass between the parts. The drain sends the next part.
 */
const sendResultParts = (socket: HostChannelSocket): void => {
  const queue = socket.data.partedResults;
  while (!socket.data.closed && socket.bufferedAmount() === 0) {
    const [next] = queue;
    if (!next) return;
    const end = Math.min(next.sent + HOST_CHANNEL_RESULT_PART_BYTES, next.body.byteLength);
    const last = end === next.body.byteLength;
    const header: HostChannelMessage = { type: last ? "result" : "result_part", id: next.id };
    sendFrame(socket, encodeHostChannelBytesFrame(header, next.body.subarray(next.sent, end)));
    next.sent = end;
    if (last) queue.shift();
  }
};

const sendResult = (socket: HostChannelSocket, id: number, result: HostChannelResult): void => {
  const body = Buffer.from(JSON.stringify(result ?? null));
  const limit = socket.data.options.maxReplyBytes;
  if (limit !== undefined && body.byteLength > limit) {
    sendError(socket, id, { kind: "reply_too_large", limitBytes: limit });
    return;
  }
  if (body.byteLength <= HOST_CHANNEL_RESULT_PART_BYTES) {
    sendFrame(socket, encodeHostChannelBytesFrame({ type: "result", id }, body));
    return;
  }
  socket.data.partedResults.push({ id, body, sent: 0 });
  sendResultParts(socket);
};

/** Starts a fiber that the socket stops when it closes. */
const forkUntilClose = <A>(
  socket: HostChannelSocket,
  stream: Stream.Stream<A, unknown>,
  deliver: (value: A) => void,
  onFailure: (cause: unknown) => void,
): (() => void) => {
  const fiber = Effect.runFork(
    stream.pipe(
      Stream.runForEach((value) => Effect.sync(() => deliver(value))),
      Effect.catch((cause) => Effect.sync(() => onFailure(cause))),
    ),
  );
  const stop = () => {
    socket.data.stops.delete(stop);
    Effect.runFork(Fiber.interrupt(fiber));
  };
  socket.data.stops.add(stop);
  return stop;
};

const openEvents = (
  socket: HostChannelSocket,
  request: Extract<HostChannelRequestMessage, { method: "events.open" }>,
): void => {
  const { hostEvents, notifications, refusal, reportFailure } = socket.data.options;
  if (socket.data.eventsOpened) {
    refuse(
      socket,
      request.id,
      "invalid_protocol",
      "Host events are already open on this channel.",
      "Open host events once per channel.",
    );
    return;
  }
  socket.data.eventsOpened = true;
  const previous = request.cursor;
  // A cursor from another host process cannot be replayed. Its observers read current state.
  const hostChanged = previous !== null && previous.hostEpoch !== hostEvents.hostEpoch;
  const replay =
    previous && !hostChanged
      ? hostEvents.replayAfter(previous.hostEventId)
      : { events: [], gaps: [] };
  for (const event of replay.events) sendFrame(socket, event.frame);
  const opened: HostEventsOpened = {
    hostEpoch: hostEvents.hostEpoch,
    hostEventId: hostEvents.currentEventId(),
    hostChanged,
    gaps: replay.gaps,
  };
  sendResult(socket, request.id, opened);
  // Replay, result, and subscription run in one turn, so no event falls between them.
  const stopHost = hostEvents.subscribe((event) => sendEvent(socket, event.frame));
  const unsubscribeHost = () => {
    socket.data.stops.delete(unsubscribeHost);
    stopHost();
  };
  socket.data.stops.add(unsubscribeHost);
  forkUntilClose(
    socket,
    notifications.subscribe({ cursor: request.notificationCursor }),
    (frame) => sendEvent(socket, encodeHostChannelFrame({ type: "notification", frame })),
    (cause) => {
      if (socket.data.closed) return;
      // Host shutdown ends notifications before the listener closes.
      if (refusal() === null) reportFailure(cause);
      closeChannel(socket, 1011, "Notification delivery stopped.");
    },
  );
};

const leaseSink = (socket: HostChannelSocket, subscriptionId: string): TaskEventFrameSink => ({
  desiredSize: () =>
    socket.data.closed ? null : TASK_FRAME_BUFFER_BYTES - socket.bufferedAmount(),
  write: (frame) => send(socket, { type: "task_frame", subscriptionId, frame }),
  close: () => {
    socket.data.leases.delete(subscriptionId);
  },
});

const attachLease = (socket: HostChannelSocket, subscriptionId: string): void => {
  const { leases } = socket.data.options;
  const lease = leases.get(subscriptionId);
  if (!lease) return;
  // Attach closes the previous sink first, which can belong to this socket.
  const generation = leases.attach(lease, leaseSink(socket, subscriptionId));
  socket.data.leases.set(subscriptionId, generation);
};

/** The owned lease, or a refusal that tells the client to subscribe again. */
const ownedLease = (socket: HostChannelSocket, id: number, subscriptionId: string) => {
  const { leases, ownedLeases } = socket.data.options;
  const lease = ownedLeases.has(subscriptionId) ? leases.get(subscriptionId) : undefined;
  if (!lease) {
    ownedLeases.delete(subscriptionId);
    refuse(
      socket,
      id,
      "connection_expired",
      "Task subscription is expired or belongs to another connection.",
      "Create a task subscription on this connection.",
    );
  }
  return lease;
};

const subscribeTaskEvents = (
  socket: HostChannelSocket,
  request: Extract<HostChannelRequestMessage, { method: "task_events.subscribe" }>,
): void => {
  const { leases, ownedLeases, maxLeases, refusal } = socket.data.options;
  const refused = refusal();
  if (refused) {
    sendError(socket, request.id, { kind: "refused", failure: refused });
    return;
  }
  for (const leaseId of ownedLeases) if (!leases.get(leaseId)) ownedLeases.delete(leaseId);
  if (maxLeases !== undefined && ownedLeases.size >= maxLeases) {
    refuse(
      socket,
      request.id,
      "consumer_overflow",
      "Task subscription limit reached.",
      "Close unused subscriptions before retrying.",
    );
    return;
  }
  const subscriptionId = crypto.randomUUID();
  const lease = leases.create(request.input, subscriptionId);
  ownedLeases.add(subscriptionId);
  const result: TaskEventLeaseResult = {
    subscriptionId,
    replayBoundary: lease.hostSubscription.replayBoundary,
  };
  // The client registers the subscription from the result, so frames follow it.
  sendResult(socket, request.id, result);
  attachLease(socket, subscriptionId);
};

const observeRemoteAccess = (socket: HostChannelSocket, id: number): void => {
  const states = socket.data.options.remoteAccessStates;
  if (!states) {
    refuse(
      socket,
      id,
      "function_unavailable",
      "Remote control status is available only to the local operator.",
      "Open the local operator URL.",
    );
    return;
  }
  sendResult(socket, id, null);
  if (socket.data.remoteAccess) return;
  socket.data.remoteAccess = forkUntilClose(
    socket,
    states,
    (state) => send(socket, { type: "remote_access_state", state }),
    (cause) => {
      socket.data.options.reportFailure(cause);
      closeChannel(socket, 1011, "Remote control status delivery stopped.");
    },
  );
};

/** A command that only reads host state can stop at once. Other accepted work keeps running. */
const NEVER_CANCELLED = new AbortController().signal;

const runInvoke = async (
  socket: HostChannelSocket,
  request: Extract<HostChannelRequestMessage, { method: "invoke" }>,
): Promise<void> => {
  const refused = socket.data.options.refusal();
  if (refused) {
    sendError(socket, request.id, { kind: "refused", failure: refused });
    return;
  }
  const cancel = isHostReadCommand(request.command) ? new AbortController() : null;
  if (cancel) socket.data.reads.set(request.id, cancel);
  try {
    const reply = await socket.data.options.invoke(
      request.command,
      request.args,
      cancel?.signal ?? NEVER_CANCELLED,
    );
    // The client stopped waiting, so a cancelled read sends no answer.
    if (cancel?.signal.aborted) return;
    if ("error" in reply) sendError(socket, request.id, reply.error);
    else sendResult(socket, request.id, reply.result);
  } finally {
    if (cancel) socket.data.reads.delete(request.id);
  }
};

const handleRequest = (socket: HostChannelSocket, request: HostChannelRequestMessage): void => {
  const { leases, ownedLeases } = socket.data.options;
  switch (request.method) {
    case "events.open":
      openEvents(socket, request);
      return;
    case "invoke":
      runInvoke(socket, request).catch((cause: unknown) => {
        socket.data.options.reportFailure(cause);
        closeChannel(socket, 1011, "Host command delivery failed.");
      });
      return;
    case "task_events.subscribe":
      subscribeTaskEvents(socket, request);
      return;
    case "task_events.attach":
      if (!ownedLease(socket, request.id, request.subscriptionId)) return;
      sendResult(socket, request.id, null);
      attachLease(socket, request.subscriptionId);
      return;
    case "task_events.ack": {
      const lease = ownedLease(socket, request.id, request.subscriptionId);
      if (!lease) return;
      try {
        leases.acknowledge(lease, request.cursor);
      } catch (cause) {
        refuse(
          socket,
          request.id,
          "invalid_protocol",
          `Task event acknowledgement was rejected: ${errorMessage(cause)}`,
          "Subscribe again from the last applied cursor.",
        );
        return;
      }
      sendResult(socket, request.id, null);
      return;
    }
    case "task_events.release": {
      const lease = leases.get(request.subscriptionId);
      if (lease && ownedLeases.has(request.subscriptionId)) leases.delete(lease);
      ownedLeases.delete(request.subscriptionId);
      socket.data.leases.delete(request.subscriptionId);
      sendResult(socket, request.id, null);
      return;
    }
    case "remote_access.observe":
      observeRemoteAccess(socket, request.id);
      return;
    case "remote_access.unobserve":
      socket.data.remoteAccess?.();
      socket.data.remoteAccess = null;
      sendResult(socket, request.id, null);
  }
};

const parseMessage = (raw: string | Buffer): HostChannelClientMessage | null => {
  try {
    const parsed = hostChannelClientMessageSchema.safeParse(
      JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : raw),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const hostChannelWebSocketHandler = {
  open(socket: HostChannelSocket): void {
    const heartbeat = setInterval(
      () => sendFrame(socket, HEARTBEAT_FRAME),
      HOST_CHANNEL_HEARTBEAT_INTERVAL_MS,
    );
    heartbeat.unref?.();
    socket.data.stops.add(() => clearInterval(heartbeat));
    const signal = socket.data.options.signal;
    if (!signal) return;
    const ended = () => closeChannel(socket, 1001, "Remote connection ended.");
    signal.addEventListener("abort", ended, { once: true });
    socket.data.stops.add(() => signal.removeEventListener("abort", ended));
    if (signal.aborted) ended();
  },
  message(socket: HostChannelSocket, raw: string | Buffer): void {
    if (socket.data.closed) return;
    const message = parseMessage(raw);
    if (!message) {
      closeChannel(socket, 1002, "Invalid host channel message.");
      return;
    }
    if (message.type === "cancel") {
      socket.data.reads.get(message.id)?.abort(new Error("The client cancelled the request."));
      // The client no longer reads this result, so its remaining parts stay unsent.
      const queue = socket.data.partedResults;
      const parted = queue.findIndex((result) => result.id === message.id);
      if (parted >= 0) queue.splice(parted, 1);
      return;
    }
    handleRequest(socket, message);
  },
  drain(socket: HostChannelSocket): void {
    sendResultParts(socket);
    const { leases } = socket.data.options;
    for (const [subscriptionId, generation] of socket.data.leases) {
      const lease = leases.get(subscriptionId);
      if (lease) leases.resume(lease, generation);
    }
  },
  close(socket: HostChannelSocket): void {
    socket.data.closed = true;
    // No client waits for these reads any more.
    for (const read of socket.data.reads.values())
      read.abort(new Error("The host channel closed."));
    socket.data.reads.clear();
    socket.data.partedResults = [];
    // Each stop deletes itself, which a Set iteration allows.
    for (const stop of socket.data.stops) stop();
    socket.data.remoteAccess = null;
    const { leases } = socket.data.options;
    // Leases outlive the socket for their expiry time, so a reconnect can attach them again.
    for (const [subscriptionId, generation] of socket.data.leases) {
      const lease = leases.get(subscriptionId);
      if (lease) leases.detach(lease, generation);
    }
    socket.data.leases.clear();
  },
};
