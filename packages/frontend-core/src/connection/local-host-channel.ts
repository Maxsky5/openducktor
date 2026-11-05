import {
  failedRemoteAccessState,
  HOST_CHANNEL_SUBPROTOCOL,
  REMOTE_SOCKET_AUTHORIZATION_PREFIX,
  hostEventsOpenedSchema,
  type HostEventsOpened,
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
  openHostChannel,
  type HostChannelHandlers,
  type HostChannelLoss,
  type HostChannelSession,
  type OpenedHostChannel,
} from "@openducktor/host-client/channel";
import { waitWithAbort, type RemoteSocketConnection } from "@openducktor/host-client/remote";
import { errorMessage } from "../lib/errors";
import { hostEventStreamEventName } from "@openducktor/host-client";
import type { JSONType } from "zod";

export type LocalHostChannelEvent = HostEventEnvelope | ConnectionControlEvent;
export type LocalHostChannelListener = (event: LocalHostChannelEvent) => void | Promise<void>;
export type LocalHostChannelRegistration = {
  channel: HostEventChannel;
  /** The host event name, which selects the listeners of an event before its body is parsed. */
  eventName: string;
  /** Also receives the connection warnings and reconnections. */
  listener: LocalHostChannelListener;
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
  /**
   * Prepares the session and returns the endpoint. It runs inside the setup deadline, and `signal`
   * aborts when the attempt ends, so a shell must stop its requests then.
   */
  prepare(signal: AbortSignal): Promise<LocalHostChannelEndpoint>;
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

type Open = OpenedHostChannel & { abort: AbortController };
/** One connection attempt. `open` is set once the attempt finished its setup. */
type Attempt = { abort: AbortController; open: Open | null };

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 5_000;
const SETUP_TIMEOUT_MS = 10_000;

const defaultSchedule = (callback: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

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
  /** The listeners of each host event name, so an event reaches only its own listeners. */
  const listeners = new Map<string, Set<LocalHostChannelRegistration>>();
  let listenerCount = 0;
  const notifications = createNotificationFrameRelay();
  const tasks = new Map<string, TaskRecord>();
  const remoteAccessObservers = new Set<(state: RemoteAccessState) => void>();
  let pendingRequests = 0;
  /** The session that sends remote access states to this tab. */
  let observing: HostChannelSession | null = null;
  let disposed = false;
  let open: Open | null = null;
  /** The connection attempt in flight. */
  let opening: { attempt: Attempt; promise: Promise<Open> } | null = null;
  let cancelRetry: (() => void) | null = null;
  let attempts = 0;
  let cursor: HostEventCursor | null = null;
  let notificationCursor = initialNotificationCursor;
  let hasOpened = false;
  let hasReportedFailure = false;
  let connectionWarning: string | null = null;
  const { promise: ready, resolve: resolveReady } = Promise.withResolvers<void>();

  /** Every listener once, for the connection control events. */
  const allListeners = function* (): Generator<LocalHostChannelRegistration> {
    for (const registrations of listeners.values()) yield* registrations;
  };

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
    (listenerCount > 0 ||
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
    opening?.attempt.abort.abort(closed);
    opening = null;
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
    const warning = connectionStreamWarningEvent(connectionWarning);
    for (const registration of allListeners()) dispatch([registration.listener], warning);
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
    if (cursor) cursor.hostEventId = event.id;
    const targets = listeners.get(event.name);
    // Events of unobserved repositories advance the cursor without parsing.
    if (!targets?.size) return;
    const envelope = parseHostEventEnvelope(JSON.parse(event.body()));
    if (hostEventStreamEventName(envelope) !== event.name)
      throw new Error("OpenDucktor host event arrived with the wrong event name.");
    for (const registration of targets)
      if (registration.channel === envelope.channel) dispatch([registration.listener], envelope);
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

  const sessionHandlers: HostChannelHandlers = {
    hostEvent: deliverHostEvent,
    notification: (frame) => {
      notificationCursor = frame.cursor;
      notifications.accept(frame);
    },
    remoteAccessState: (state) => {
      for (const observer of remoteAccessObservers) observer(state);
    },
  };

  /** The error of a lost channel, as the connection warning shows it. */
  const lossError = (attempt: Attempt, loss: HostChannelLoss): Error => {
    switch (loss.reason) {
      case "closed":
        return new Error(
          attempt.open ? "The host channel closed." : "The host channel closed during setup.",
        );
      case "silent":
        return new Error("The host channel went silent.");
      case "unanswered":
        return new Error("The host did not answer a task stream request.");
      case "unreadable":
      case "send_failed":
        return loss.cause instanceof Error ? loss.cause : new Error(errorMessage(loss.cause));
    }
  };

  /** Ends an attempt: a lost open channel reconnects, and a failed setup ends its attempt. */
  const failAttempt = (attempt: Attempt, loss: HostChannelLoss) => {
    const cause = lossError(attempt, loss);
    if (attempt.open) lose(attempt.open, cause);
    else attempt.abort.abort(cause);
  };

  /** Opens the socket and the protocol session of an attempt. */
  const openSession = (
    attempt: Attempt,
    { url, token }: LocalHostChannelEndpoint,
  ): Promise<OpenedHostChannel> => {
    const { signal } = attempt.abort;
    const protocols =
      token === null
        ? [HOST_CHANNEL_SUBPROTOCOL]
        : [HOST_CHANNEL_SUBPROTOCOL, `${REMOTE_SOCKET_AUTHORIZATION_PREFIX}${token}`];
    return openHostChannel({
      open: (onFrame, onClose) => openSocket(url, protocols, signal, onFrame, onClose),
      signal,
      handlers: sessionHandlers,
      onHandlerError: (cause) => console.error("Host channel delivery failed.", cause),
      onLost: (loss) => failAttempt(attempt, loss),
      schedule,
    });
  };

  /** Replays the missed host events, then restores the task leases and observers. */
  const resume = async (
    session: HostChannelSession,
    signal: AbortSignal,
  ): Promise<HostEventsOpened> => {
    const opened = hostEventsOpenedSchema.parse(
      await waitWithAbort(
        session.request({ method: "events.open", cursor, notificationCursor }),
        signal,
      ),
    );
    cursor = { hostEpoch: opened.hostEpoch, hostEventId: opened.hostEventId };
    await waitWithAbort(restoreDelivery(session), signal);
    return opened;
  };

  /** Clears the failure state and tells control listeners what the reconnect missed. */
  const announceOpen = (opened: HostEventsOpened) => {
    attempts = 0;
    const recovers = connectionWarning !== null;
    connectionWarning = null;
    hasReportedFailure = false;
    const resumed = hasOpened;
    if (!hasOpened) {
      hasOpened = true;
      resolveReady();
      if (!recovers) return;
    }
    const gaps = new Set(opened.gaps);
    for (const registration of allListeners())
      dispatch(
        [registration.listener],
        connectionReconnectedEvent(
          // A first connection has no cursor, so it cannot prove that nothing was missed.
          !resumed || opened.hostChanged || gaps.has(registration.eventName),
          { hostChanged: opened.hostChanged, missedEventNames: opened.gaps },
        ),
      );
  };

  const connect = (): Promise<Open> => {
    if (open) return Promise.resolve(open);
    if (opening) return opening.promise;
    cancelRetry?.();
    cancelRetry = null;
    const abort = new AbortController();
    const { signal } = abort;
    // The deadline covers the session preparation, the handshake, and the replay.
    const cancelSetupTimer = schedule(
      () => abort.abort(new Error("The host channel did not finish setup.")),
      SETUP_TIMEOUT_MS,
    );
    const attempt: Attempt = { abort, open: null };
    const promise = (async (): Promise<Open> => {
      try {
        const endpoint = await waitWithAbort(prepare(signal), signal);
        const hostChannel = await openSession(attempt, endpoint);
        const replay = await resume(hostChannel.session, signal);
        signal.throwIfAborted();
        attempt.open = { ...hostChannel, abort };
        open = attempt.open;
        // A loss of this channel must schedule a reconnect, so the attempt ends here.
        opening = null;
        announceOpen(replay);
        return attempt.open;
      } catch (cause) {
        abort.abort(cause);
        throw cause;
      }
    })();
    const current = { attempt, promise };
    opening = current;
    const settle = () => {
      cancelSetupTimer();
      if (opening === current) opening = null;
    };
    promise.then(settle, (cause: unknown) => {
      settle();
      if (disposed) return;
      reportFailure(cause);
      scheduleReconnect();
    });
    return promise;
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
      let registrations = listeners.get(registration.eventName);
      if (!registrations) {
        registrations = new Set();
        listeners.set(registration.eventName, registrations);
      }
      registrations.add(registration);
      listenerCount += 1;
      void connect().catch(() => {});
      return () => {
        if (!registrations.delete(registration)) return;
        listenerCount -= 1;
        if (registrations.size === 0) listeners.delete(registration.eventName);
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
      withOpen(async (opened) => {
        const record: TaskRecord = { onFrame, onTerminalFailure };
        const lease = await opened.withinDeadline(
          opened.session.subscribeTaskEvents(input, (frame) => record.onFrame(frame)),
        );
        const { subscriptionId } = lease;
        tasks.set(subscriptionId, record);
        let released: Promise<void> | null = null;
        return {
          subscriptionId,
          acknowledge: async (acknowledged) => {
            await withOpen((current) =>
              current.withinDeadline(
                current.session.request({
                  method: "task_events.ack",
                  subscriptionId,
                  cursor: acknowledged,
                }),
              ),
            );
          },
          unsubscribe: () => {
            released ??= (async () => {
              tasks.delete(subscriptionId);
              const current = open;
              try {
                // A lease without a channel expires on the host.
                if (current)
                  await current.withinDeadline(current.session.releaseTaskEvents(subscriptionId));
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
