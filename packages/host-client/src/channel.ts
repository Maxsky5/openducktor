import {
  HOST_CHANNEL_SILENCE_LIMIT_MS,
  encodeHostChannelFrame,
  hostChannelMessageSchema,
  remoteFailureText,
  splitHostChannelFrame,
  taskEventLeaseSchema,
  type HostChannelError,
  type HostChannelRequest,
  type NotificationStreamFrame,
  type RemoteAccessState,
  type TaskEventLease,
  type TaskEventStreamFrame,
  type TaskEventStreamSubscribe,
} from "@openducktor/contracts";
import type { JSONType } from "zod";
import { HostInvokeError } from "./invoke-utils";
import type { RemoteSocketConnection } from "./remote/transport";

/** A host that does not answer a task stream request within this time lost its channel. */
export const HOST_CHANNEL_REQUEST_TIMEOUT_MS = 10_000;

/** The host answered a request without a result. */
export class HostChannelRequestError extends Error {
  constructor(readonly error: HostChannelError) {
    super(hostChannelErrorMessage(error));
    this.name = "HostChannelRequestError";
  }
}

/** The host sent a frame that this client cannot read. The channel cannot continue. */
export class HostChannelProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HostChannelProtocolError";
  }
}

/**
 * The `HostInvokeError` of a failed request. A host failure keeps its structured failure, and other
 * causes stay as they are.
 */
export const hostChannelInvokeError = (cause: unknown): Error => {
  if (cause instanceof HostChannelRequestError)
    return new HostInvokeError(
      cause.message,
      cause.error.kind === "host" ? (cause.error.response.failure ?? null) : null,
      cause,
    );
  return cause instanceof Error ? cause : new Error(String(cause));
};

const hostChannelErrorMessage = (error: HostChannelError): string => {
  switch (error.kind) {
    case "host":
      return error.response.message ?? error.response.error ?? "Host command failed.";
    case "refused":
      return remoteFailureText(error.failure);
    case "reply_too_large":
      return `The host reply is larger than ${Math.round(error.limitBytes / (1024 * 1024))} MiB.`;
  }
};

/** One host event. Its envelope JSON decodes only when a reader asks for it. */
export type HostChannelEvent = {
  id: number;
  name: string;
  body(): string;
};

export type HostChannelHandlers = {
  hostEvent(event: HostChannelEvent): void;
  notification(frame: NotificationStreamFrame): void;
  remoteAccessState?(state: RemoteAccessState): void;
};

export type HostChannelSessionOptions = {
  send(frame: Uint8Array): void;
  handlers: HostChannelHandlers;
  /** Reports a handler failure. Handler failures do not end the channel. */
  onHandlerError(cause: unknown): void;
};

/** The protocol state of one open host channel socket. */
export type HostChannelSession = {
  /**
   * Sends one request and resolves with its result. Rejects with `HostChannelRequestError` when the
   * host answers without a result, with the close cause when the channel ends first, and with the
   * signal reason on abort. An abort drops the request at once; the host may still run it.
   */
  request(request: HostChannelRequest, signal?: AbortSignal): Promise<JSONType>;
  /**
   * Creates a task lease and delivers its frames to `onFrame`. The session registers the lease
   * before the next frame, so no frame of it is lost.
   */
  subscribeTaskEvents(
    input: TaskEventStreamSubscribe,
    onFrame: (frame: TaskEventStreamFrame) => void,
  ): Promise<TaskEventLease>;
  /** Delivers the frames of an existing lease on this socket. The host replays unacknowledged frames. */
  attachTaskEvents(
    subscriptionId: string,
    onFrame: (frame: TaskEventStreamFrame) => void,
  ): Promise<void>;
  /** Stops local delivery at once and releases the lease on the host. */
  releaseTaskEvents(subscriptionId: string): Promise<void>;
  /** Reads one host frame. Throws `HostChannelProtocolError` for a frame that it cannot read. */
  receive(frame: Uint8Array): void;
  /** Rejects all pending requests with `cause`. Later requests reject with it too. */
  close(cause: unknown): void;
};

type Pending = {
  resolve(value: JSONType): void;
  reject(cause: unknown): void;
  /** Runs in the turn of the result, before any later frame. */
  onResult?(value: JSONType): void;
};

// A decode call without `stream` keeps no state, so one decoder serves every body.
const bodyDecoder = new TextDecoder("utf-8", { fatal: true });

const decodeBody = (body: Uint8Array): string => {
  try {
    return bodyDecoder.decode(body);
  } catch (cause) {
    throw new HostChannelProtocolError("The host channel sent invalid UTF-8.", { cause });
  }
};

const parseJson = (text: string, what: string): JSONType => {
  try {
    const value: JSONType = JSON.parse(text);
    return value;
  } catch (cause) {
    throw new HostChannelProtocolError(`The host channel sent an invalid ${what}.`, { cause });
  }
};

export const createHostChannelSession = ({
  send,
  handlers,
  onHandlerError,
}: HostChannelSessionOptions): HostChannelSession => {
  let nextId = 0;
  let closedBy: { cause: unknown } | null = null;
  const pending = new Map<number, Pending>();
  const taskHandlers = new Map<string, (frame: TaskEventStreamFrame) => void>();

  const run = (handler: () => void): void => {
    try {
      handler();
    } catch (cause) {
      onHandlerError(cause);
    }
  };

  const sendRequest = (
    request: HostChannelRequest,
    signal: AbortSignal | undefined,
    onResult?: (value: JSONType) => void,
  ): Promise<JSONType> =>
    new Promise((resolve, reject) => {
      if (closedBy) {
        reject(closedBy.cause);
        return;
      }
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const id = nextId++;
      const abort = () => {
        if (!pending.delete(id)) return;
        reject(signal?.reason);
        // The host interrupts a running read and sends no answer.
        try {
          send(encodeHostChannelFrame({ type: "cancel", id }));
        } catch {
          // A closed socket already ended the request on the host.
        }
      };
      const settle = () => signal?.removeEventListener("abort", abort);
      const entry: Pending = {
        resolve: (value) => {
          settle();
          resolve(value);
        },
        reject: (cause) => {
          settle();
          reject(cause);
        },
      };
      if (onResult) entry.onResult = onResult;
      pending.set(id, entry);
      signal?.addEventListener("abort", abort, { once: true });
      try {
        send(encodeHostChannelFrame({ type: "request", id, ...request }));
      } catch (cause) {
        pending.delete(id);
        entry.reject(cause);
      }
    });

  return {
    request: (request, signal) => sendRequest(request, signal),
    subscribeTaskEvents: async (input, onFrame) => {
      let lease: TaskEventLease | null = null;
      await sendRequest({ method: "task_events.subscribe", input }, undefined, (value) => {
        const parsed = taskEventLeaseSchema.safeParse(value);
        if (!parsed.success)
          throw new HostChannelProtocolError("The host sent an invalid task lease.");
        lease = parsed.data;
        taskHandlers.set(lease.subscriptionId, onFrame);
      });
      if (!lease) throw new HostChannelProtocolError("The host sent no task lease.");
      return lease;
    },
    attachTaskEvents: async (subscriptionId, onFrame) => {
      await sendRequest({ method: "task_events.attach", subscriptionId }, undefined, () => {
        taskHandlers.set(subscriptionId, onFrame);
      });
    },
    releaseTaskEvents: async (subscriptionId) => {
      taskHandlers.delete(subscriptionId);
      await sendRequest({ method: "task_events.release", subscriptionId }, undefined);
    },
    receive(frame) {
      let header: string;
      let body: Uint8Array | null;
      try {
        ({ header, body } = splitHostChannelFrame(frame));
      } catch (cause) {
        throw new HostChannelProtocolError("The host channel sent invalid UTF-8.", { cause });
      }
      const parsed = hostChannelMessageSchema.safeParse(parseJson(header, "message header"));
      if (!parsed.success)
        throw new HostChannelProtocolError("The host channel sent an invalid message.", {
          cause: parsed.error,
        });
      const message = parsed.data;
      switch (message.type) {
        case "result": {
          const entry = pending.get(message.id);
          if (!entry) return;
          pending.delete(message.id);
          let value: JSONType;
          try {
            value = body === null ? null : parseJson(decodeBody(body), "result");
            entry.onResult?.(value);
          } catch (cause) {
            // The request fails with the frame, and the caller ends the channel.
            entry.reject(cause);
            throw cause;
          }
          entry.resolve(value);
          return;
        }
        case "error": {
          const entry = pending.get(message.id);
          if (!entry) return;
          pending.delete(message.id);
          entry.reject(new HostChannelRequestError(message.error));
          return;
        }
        case "host_event": {
          if (body === null)
            throw new HostChannelProtocolError("The host channel sent an event without a body.");
          const bytes = body;
          let text: string | null = null;
          const event: HostChannelEvent = {
            id: message.id,
            name: message.name,
            body: () => {
              text ??= decodeBody(bytes);
              return text;
            },
          };
          run(() => handlers.hostEvent(event));
          return;
        }
        case "notification":
          run(() => handlers.notification(message.frame));
          return;
        case "task_frame": {
          const onFrame = taskHandlers.get(message.subscriptionId);
          if (onFrame) run(() => onFrame(message.frame));
          return;
        }
        case "remote_access_state": {
          const onState = handlers.remoteAccessState;
          if (onState) run(() => onState(message.state));
          return;
        }
        case "heartbeat":
          return;
      }
    },
    close(cause) {
      if (closedBy) return;
      closedBy = { cause };
      taskHandlers.clear();
      const entries = [...pending.values()];
      pending.clear();
      for (const entry of entries) entry.reject(cause);
    },
  };
};

/** Why an open host channel can no longer serve its client. */
export type HostChannelLoss =
  | { reason: "closed"; cause: unknown }
  | { reason: "silent" }
  | { reason: "unreadable"; cause: unknown }
  | { reason: "unanswered" }
  | { reason: "send_failed"; cause: unknown };

export type OpenHostChannelOptions = {
  /** Opens the socket. It must close when `signal` aborts. */
  open(
    onFrame: (frame: Uint8Array) => void,
    onClose: (cause?: unknown) => void,
  ): Promise<RemoteSocketConnection>;
  /** The lifetime of this channel. Its abort closes the session. */
  signal: AbortSignal;
  handlers: HostChannelHandlers;
  onHandlerError(cause: unknown): void;
  /** Runs once a received frame arrives, before the session reads it. */
  onFrame?(): void;
  /** Runs for each loss. The owner ends the channel and decides how to reconnect. */
  onLost(loss: HostChannelLoss): void;
  schedule?(callback: () => void, delayMs: number): () => void;
};

export type OpenedHostChannel = {
  session: HostChannelSession;
  socket: RemoteSocketConnection;
  /**
   * Bounds a request by `HOST_CHANNEL_REQUEST_TIMEOUT_MS`. A host that keeps the socket open but
   * does not answer would otherwise hold its caller, so a missed deadline loses the channel.
   */
  withinDeadline<T>(operation: Promise<T>): Promise<T>;
};

const scheduleTimeout = (callback: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

/**
 * Opens a socket and the protocol session on it. It watches for silence, because a network path can
 * drop an idle socket without closing it and the host sends heartbeats. It reports each loss of the
 * channel to `onLost`.
 */
export const openHostChannel = async ({
  open,
  signal,
  handlers,
  onHandlerError,
  onFrame,
  onLost,
  schedule = scheduleTimeout,
}: OpenHostChannelOptions): Promise<OpenedHostChannel> => {
  let socket: RemoteSocketConnection | null = null;
  let cancelSilence: (() => void) | null = null;
  const watchSilence = () => {
    cancelSilence?.();
    cancelSilence = schedule(() => onLost({ reason: "silent" }), HOST_CHANNEL_SILENCE_LIMIT_MS);
  };
  const session = createHostChannelSession({
    send: (frame) => {
      if (!socket) throw new Error("The host channel is not open.");
      void socket.send(frame).catch((cause: unknown) => onLost({ reason: "send_failed", cause }));
    },
    handlers,
    onHandlerError,
  });
  signal.addEventListener(
    "abort",
    () => {
      cancelSilence?.();
      session.close(signal.reason);
    },
    { once: true },
  );
  socket = await open(
    (frame) => {
      onFrame?.();
      watchSilence();
      try {
        session.receive(frame);
      } catch (cause) {
        onLost({ reason: "unreadable", cause });
      }
    },
    (cause) => onLost({ reason: "closed", cause }),
  );
  watchSilence();
  return {
    session,
    socket,
    withinDeadline: (operation) => {
      const cancel = schedule(
        () => onLost({ reason: "unanswered" }),
        HOST_CHANNEL_REQUEST_TIMEOUT_MS,
      );
      return operation.finally(cancel);
    },
  };
};
