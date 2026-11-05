import {
  failedRemoteAccessState,
  HOST_CHANNEL_SILENCE_LIMIT_MS,
  HOST_CHANNEL_SUBPROTOCOL,
  REMOTE_SOCKET_AUTHORIZATION_PREFIX,
  hostEventsOpenedSchema,
  parseHostEventEnvelope,
  type HostChannelRequest,
  type HostEventChannel,
  type HostEventCursor,
  type HostEventEnvelope,
  type NotificationCursor,
  type NotificationStreamFrame,
  type RemoteAccessState,
  type TaskEventCursor,
  type TaskEventStreamFrame,
} from "@openducktor/contracts";
import {
  connectionReconnectedEvent,
  connectionStreamWarningEvent,
  type ConnectionControlEvent,
} from "../recovery/connection-control-events";
import { createNotificationFrameRelay } from "../recovery/notification-frame-relay";
import {
  createHostChannelSession,
  type HostChannelSession,
} from "@openducktor/host-client/channel";
import type { RemoteSocketConnection } from "@openducktor/host-client/remote";
import { hostEventStreamEventName } from "@openducktor/host-client";
import type { JSONType } from "zod";

export type LocalHostChannelEvent = HostEventEnvelope | ConnectionControlEvent;
export type LocalHostChannelListener = (event: LocalHostChannelEvent) => void | Promise<void>;
export type LocalHostChannelRegistration = {
  channel: HostEventChannel;
  /** The host event name, which selects the listeners of an event before its body is parsed. */
  eventName: string;
  listener: LocalHostChannelListener;
  /** Receives connection warnings and reconnections. */
  receivesControlEvents: boolean;
};

export type LocalTaskSubscription = {
  subscriptionId: string;
  acknowledge(cursor: TaskEventCursor): Promise<void>;
  unsubscribe(): Promise<void>;
};

export type LocalHostChannel = {
  /** Resolves when the first connection finishes its replay. */
  readonly ready: Promise<void>;
  /** The warning of the current connection failure, or null while the channel is connected. */
  readConnectionWarning(): string | null;
  addListener(registration: LocalHostChannelRegistration): () => void;
  /**
   * Delivers notification frames. A subscriber that joins an open channel gets an `attached` frame
   * and the retained frames after its cursor. A lost channel reports `onFailure` once.
   */
  subscribeNotifications(
    input: { cursor: NotificationCursor | null },
    onFrame: (frame: NotificationStreamFrame) => void,
    onFailure: (cause: unknown) => void,
  ): () => void;
  /**
   * Sends one request when the channel is open. A closed channel connects once at once, and a
   * failed attempt rejects the request.
   */
  request(request: HostChannelRequest, signal?: AbortSignal): Promise<JSONType>;
  /**
   * Creates a task lease. After a reconnect, the channel attaches the lease again and the host
   * replays unacknowledged frames. A lease that the host lost reports `onTerminalFailure`.
   */
  subscribeTaskEvents(
    input: { cursor: TaskEventCursor | null },
    onFrame: (frame: TaskEventStreamFrame) => void,
    onTerminalFailure: ((cause: unknown) => void) | undefined,
  ): Promise<LocalTaskSubscription>;
  observeRemoteAccess(listener: (state: RemoteAccessState) => void): () => void;
};

/**
 * The WebSocket URL of the shell's own host channel. A `token` travels as the authorization
 * subprotocol tag, for a shell whose sockets cannot carry a session cookie.
 */
export type LocalHostChannelEndpoint = { url: string; token: string | null };

export type LocalHostChannelDependencies = {
  /** Prepares the app session cookie and returns the channel WebSocket URL. */
  prepare(): Promise<LocalHostChannelEndpoint>;
  /**
   * Opens a binary WebSocket that must select the first protocol, as `openWebSocket` of
   * `@openducktor/host-client/remote/socket` does with the platform socket.
   */
  openSocket(
    url: string,
    protocols: string[],
    signal: AbortSignal,
    onFrame: (frame: Uint8Array) => void,
    onClose: () => void,
  ): Promise<RemoteSocketConnection>;
  notificationCursor: NotificationCursor | null;
  /** Runs when the channel closes because nothing uses it. */
  onDispose(): void;
  schedule?(callback: () => void, delayMs: number): () => void;
};

type TaskRecord = {
  onFrame(frame: TaskEventStreamFrame): void;
  onTerminalFailure: ((cause: unknown) => void) | undefined;
};

type Open = { session: HostChannelSession; socket: RemoteSocketConnection; abort: AbortController };

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 5_000;
const SETUP_TIMEOUT_MS = 10_000;

const defaultSchedule = (callback: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Owns the one host channel of this browser tab. It reconnects after a loss, replays missed host
 * events and notifications from its cursors, and attaches task leases again.
 */
export const createLocalHostChannel = ({
  prepare,
  openSocket,
  notificationCursor: initialNotificationCursor,
  onDispose,
  schedule = defaultSchedule,
}: LocalHostChannelDependencies): LocalHostChannel => {
  const listeners = new Map<number, LocalHostChannelRegistration>();
  let nextListenerId = 0;
  const notifications = createNotificationFrameRelay();
  const tasks = new Map<string, TaskRecord>();
  const remoteAccessObservers = new Set<(state: RemoteAccessState) => void>();
  let pendingRequests = 0;
  /** The session that sends remote access states to this tab. */
  let observing: HostChannelSession | null = null;
  let disposed = false;
  let open: Open | null = null;
  let opening: Promise<Open> | null = null;
  /** Aborts the connection attempt in flight. */
  let openingAbort: AbortController | null = null;
  let cancelRetry: (() => void) | null = null;
  let attempts = 0;
  let cursor: HostEventCursor | null = null;
  let notificationCursor = initialNotificationCursor;
  let hasOpened = false;
  let hasReportedFailure = false;
  let connectionWarning: string | null = null;
  const { promise: ready, resolve: resolveReady } = Promise.withResolvers<void>();

  const controlListeners = () =>
    [...listeners.values()].filter((registration) => registration.receivesControlEvents);

  const dispatch = (
    targets: Iterable<LocalHostChannelListener>,
    event: LocalHostChannelEvent,
  ): void => {
    for (const listener of targets) {
      try {
        const result = listener(event);
        if (result instanceof Promise)
          result.catch((cause: unknown) => console.error("Host event listener failed.", cause));
      } catch (cause) {
        console.error("Host event listener failed.", cause);
      }
    }
  };

  const inUse = () =>
    !disposed &&
    (listeners.size > 0 ||
      notifications.hasListeners() ||
      tasks.size > 0 ||
      remoteAccessObservers.size > 0 ||
      pendingRequests > 0);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelRetry?.();
    cancelRetry = null;
    const closed = new Error("The host channel closed.");
    open?.abort.abort(closed);
    open = null;
    openingAbort?.abort(closed);
    openingAbort = null;
    onDispose();
  };

  const releaseIfUnused = () => {
    if (!inUse()) dispose();
  };

  const reportFailure = (cause: unknown) => {
    if (hasReportedFailure) return;
    hasReportedFailure = true;
    connectionWarning = hasOpened
      ? `The host channel reported an error after opening: ${errorMessage(cause)}`
      : `The host channel reported an error before opening: ${errorMessage(cause)}`;
    notifications.fail(
      new Error(
        "Notification connection failed. The stream will reconnect when the host is available.",
      ),
    );
    const lostState = failedRemoteAccessState({
      code: "transport_failure",
      message: "Remote operator status stream was lost.",
      nextAction: "Wait for the reconnect or reload the local operator URL.",
    });
    for (const observer of remoteAccessObservers) observer(lostState);
    dispatch(
      controlListeners().map((registration) => registration.listener),
      connectionStreamWarningEvent(connectionWarning),
    );
  };

  const scheduleReconnect = () => {
    if (!inUse() || cancelRetry || opening) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempts, RECONNECT_MAX_MS);
    attempts += 1;
    cancelRetry = schedule(() => {
      cancelRetry = null;
      if (inUse()) void connect().catch(() => {});
    }, delay);
  };

  const lose = (current: Open, cause: unknown) => {
    if (open !== current) return;
    open = null;
    current.abort.abort(cause);
    reportFailure(cause);
    scheduleReconnect();
  };

  const deliverHostEvent = (event: { id: number; name: string; body(): string }) => {
    if (cursor) cursor = { ...cursor, hostEventId: event.id };
    const targets = [...listeners.values()].filter(
      (registration) => registration.eventName === event.name,
    );
    // Events of unobserved repositories advance the cursor without parsing.
    if (targets.length === 0) return;
    const envelope = parseHostEventEnvelope(JSON.parse(event.body()));
    if (hostEventStreamEventName(envelope) !== event.name)
      throw new Error("OpenDucktor host event arrived with the wrong event name.");
    dispatch(
      targets
        .filter((registration) => registration.channel === envelope.channel)
        .map((registration) => registration.listener),
      envelope,
    );
  };

  const ensureObserving = async (session: HostChannelSession): Promise<void> => {
    if (remoteAccessObservers.size === 0 || observing === session) return;
    observing = session;
    await session.request({ method: "remote_access.observe" });
  };

  const restoreDelivery = async (session: HostChannelSession): Promise<void> => {
    await ensureObserving(session);
    await Promise.all(
      [...tasks].map(([subscriptionId, record]) =>
        session.attachTaskEvents(subscriptionId, record.onFrame).then(
          // The owner unsubscribed while the lease attached, so the host releases it now.
          () =>
            tasks.get(subscriptionId) === record
              ? undefined
              : // A failed release means a closed socket, and the lease then expires on the host.
                session.releaseTaskEvents(subscriptionId).catch(() => {}),
          (cause: unknown) => {
            // The host no longer has this lease. The owner subscribes again from its cursor.
            if (tasks.get(subscriptionId) !== record) return;
            tasks.delete(subscriptionId);
            record.onTerminalFailure?.(cause);
          },
        ),
      ),
    );
  };

  const connect = (): Promise<Open> => {
    if (open) return Promise.resolve(open);
    if (opening) return opening;
    cancelRetry?.();
    cancelRetry = null;
    const abort = new AbortController();
    openingAbort = abort;
    // The deadline covers the session preparation, the handshake, and the replay.
    const cancelSetupTimer = schedule(
      () => abort.abort(new Error("The host channel did not finish setup.")),
      SETUP_TIMEOUT_MS,
    );
    const attempt = (async (): Promise<Open> => {
      const { url, token } = await waitWithAbort(prepare(), abort.signal);
      let current: Open | null = null;
      let silenceTimer: (() => void) | null = null;
      const watchSilence = () => {
        silenceTimer?.();
        silenceTimer = schedule(() => {
          if (current) lose(current, new Error("The host channel went silent."));
        }, HOST_CHANNEL_SILENCE_LIMIT_MS);
      };
      abort.signal.addEventListener("abort", () => silenceTimer?.(), { once: true });
      let socket: RemoteSocketConnection | null = null;
      const session = createHostChannelSession({
        send: (frame) => {
          if (!socket) throw new Error("The host channel is not open.");
          void socket.send(frame).catch((cause: unknown) => {
            if (current) lose(current, cause);
          });
        },
        handlers: {
          hostEvent: deliverHostEvent,
          notification: (frame) => {
            notificationCursor = frame.cursor;
            notifications.accept(frame);
          },
          remoteAccessState: (state) => {
            for (const observer of remoteAccessObservers) observer(state);
          },
        },
        onHandlerError: (cause) => console.error("Host channel delivery failed.", cause),
      });
      abort.signal.addEventListener("abort", () => session.close(abort.signal.reason), {
        once: true,
      });
      try {
        socket = await openSocket(
          url,
          token === null
            ? [HOST_CHANNEL_SUBPROTOCOL]
            : [HOST_CHANNEL_SUBPROTOCOL, `${REMOTE_SOCKET_AUTHORIZATION_PREFIX}${token}`],
          abort.signal,
          (frame) => {
            if (!current && !socket) return;
            watchSilence();
            try {
              session.receive(frame);
            } catch (cause) {
              if (current) lose(current, cause);
              else abort.abort(cause);
            }
          },
          () => {
            if (current) lose(current, new Error("The host channel closed."));
            else abort.abort(new Error("The host channel closed during setup."));
          },
        );
        watchSilence();
        const opened = hostEventsOpenedSchema.parse(
          await waitWithAbort(
            session.request({ method: "events.open", cursor, notificationCursor }),
            abort.signal,
          ),
        );
        cursor = { hostEpoch: opened.hostEpoch, hostEventId: opened.hostEventId };
        await waitWithAbort(restoreDelivery(session), abort.signal);
        abort.signal.throwIfAborted();
        current = { session, socket, abort };
        open = current;
        // A loss of this channel must schedule a reconnect, so the attempt ends here.
        opening = null;
        attempts = 0;
        const recovers = connectionWarning !== null;
        connectionWarning = null;
        hasReportedFailure = false;
        const resumed = hasOpened;
        if (!hasOpened) {
          hasOpened = true;
          resolveReady();
          if (!recovers) return current;
        }
        const gaps = new Set(opened.gaps);
        for (const registration of controlListeners())
          dispatch(
            [registration.listener],
            connectionReconnectedEvent(
              // A first connection has no cursor, so it cannot prove that nothing was missed.
              !resumed || opened.hostChanged || gaps.has(registration.eventName),
              { hostChanged: opened.hostChanged, missedEventNames: opened.gaps },
            ),
          );
        return current;
      } catch (cause) {
        abort.abort(cause);
        throw cause;
      }
    })();
    opening = attempt;
    void attempt.finally(cancelSetupTimer).catch(() => {});
    attempt.then(
      () => {
        if (opening === attempt) opening = null;
        if (openingAbort === abort) openingAbort = null;
      },
      (cause: unknown) => {
        if (opening === attempt) opening = null;
        if (openingAbort === abort) openingAbort = null;
        if (disposed) return;
        reportFailure(cause);
        scheduleReconnect();
      },
    );
    return attempt;
  };

  /**
   * Runs `work` on an open channel. The channel stays while the work runs. An abort of `signal`
   * stops the wait for the channel at once; the attempt goes on for its other users.
   */
  const withOpen = async <T>(
    work: (current: Open) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> => {
    if (disposed) throw new Error("The host channel closed.");
    signal?.throwIfAborted();
    pendingRequests += 1;
    try {
      const opened = connect();
      return await work(await (signal ? waitWithAbort(opened, signal) : opened));
    } finally {
      pendingRequests -= 1;
      releaseIfUnused();
    }
  };

  return {
    ready,
    readConnectionWarning: () => connectionWarning,
    addListener(registration) {
      const id = nextListenerId++;
      listeners.set(id, registration);
      void connect().catch(() => {});
      return () => {
        listeners.delete(id);
        releaseIfUnused();
      };
    },
    subscribeNotifications(input, onFrame, onFailure) {
      const stop = notifications.subscribe(input, onFrame, onFailure);
      void connect().catch(() => {});
      return () => {
        stop();
        releaseIfUnused();
      };
    },
    request: (request, signal) =>
      withOpen(({ session }) => session.request(request, signal), signal),
    subscribeTaskEvents: (input, onFrame, onTerminalFailure) =>
      withOpen(async ({ session }) => {
        const record: TaskRecord = { onFrame, onTerminalFailure };
        const lease = await session.subscribeTaskEvents(input, (frame) => record.onFrame(frame));
        const { subscriptionId } = lease;
        tasks.set(subscriptionId, record);
        let released: Promise<void> | null = null;
        return {
          subscriptionId,
          acknowledge: async (acknowledged) => {
            await withOpen(({ session: current }) =>
              current.request({
                method: "task_events.ack",
                subscriptionId,
                cursor: acknowledged,
              }),
            );
          },
          unsubscribe: () => {
            released ??= (async () => {
              tasks.delete(subscriptionId);
              const current = open;
              try {
                // A lease without a channel expires on the host.
                if (current) await current.session.releaseTaskEvents(subscriptionId);
              } finally {
                releaseIfUnused();
              }
            })();
            return released;
          },
        };
      }),
    observeRemoteAccess(observer) {
      remoteAccessObservers.add(observer);
      // A failed request loses the channel, and the reconnect observes again.
      void connect()
        .then(({ session }) => ensureObserving(session))
        .catch(() => {});
      return () => {
        if (!remoteAccessObservers.delete(observer)) return;
        if (remoteAccessObservers.size === 0 && open && observing === open.session) {
          observing = null;
          void open.session.request({ method: "remote_access.unobserve" }).catch(() => {});
        }
        releaseIfUnused();
      };
    },
  };
};

const waitWithAbort = <T>(operation: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
