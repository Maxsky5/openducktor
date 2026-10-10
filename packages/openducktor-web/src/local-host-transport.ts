import { createNotificationFrameRelay } from "./notification-frame-relay";
import {
  notificationStreamFrameSchema,
  notificationStreamSubscribeSchema,
  type NotificationCursor,
  type AgentSessionLiveAttachInput,
  type AgentSessionLiveEnvelope,
  browserReplayCompleteSchema,
  type HostErrorResponse,
  type HostEventChannel,
  type HostEventEnvelope,
  type HostEventPayload,
  parseHostEventEnvelope,
  type TaskEventCursor,
} from "@openducktor/contracts";
import type { HostCommandArgs, HostCommandName } from "@openducktor/host";
import type { AzureDevOpsConnectionUpdateListener, RunEventListener } from "@openducktor/frontend";
import { BROWSER_LIVE_RECONNECTED_EVENT_KIND } from "@openducktor/frontend/lib/browser-live/constants";
import {
  browserLiveReconnectedEvent,
  browserLiveStreamWarningEvent,
} from "@openducktor/frontend/lib/browser-live-control-events";
import type {
  RuntimeChangeListener,
  TaskStreamFrame,
  TaskStreamSubscription,
} from "@openducktor/frontend/lib/shell-bridge";
import {
  createAgentSessionLiveAttachment,
  createHostClient,
  type HostClient,
  HostInvokeError,
  type InvokeFn,
} from "@openducktor/host-client";
import { Effect } from "effect";
import { z } from "zod";
import { getBrowserAuthTokenEffect, getBrowserBackendUrlEffect } from "./browser-config";
import {
  causeToWebBoundaryError,
  errorMessage,
  isWebError,
  runWebBoundary,
  WebDependencyError,
  type WebError,
  WebHostRequestError,
} from "./effect/web-errors";
import {
  readLocalHostErrorPayloadEffect,
  readLocalHostInvokeErrorPayloadEffect,
} from "./local-host-errors";
import { hostEventStreamEventName, liveSessionStreamEventName } from "./host-event-stream-name";
import { subscribeLocalTaskEventStreamEffect } from "./local-task-event-transport";

type BrowserSseControlEvent = ReturnType<typeof browserLiveReconnectedEvent>;
type BrowserSseEvent = HostEventEnvelope | BrowserSseControlEvent;
type BrowserSseListener = (event: BrowserSseEvent) => void;
type BrowserSseListenerRegistration = {
  channel: HostEventChannel;
  eventName: string;
  listener: BrowserSseListener;
  receivesControlEvents: boolean;
};

const RUN_EVENT_CHANNEL = "openducktor://run-event";
const AGENT_SESSION_LIVE_EVENT_CHANNEL = "openducktor://agent-session-live-event";
const AZURE_DEVOPS_CONNECTION_EVENT_CHANNEL = "openducktor://azure-devops-connection-updated";
const RUNTIME_CHANGED_EVENT_CHANNEL = "openducktor://runtime-changed";
const HOST_EVENT_STREAM_PATH = "events";
const APP_TOKEN_HEADER = "x-openducktor-app-token";
const SESSION_PATH = "session";
const INITIAL_SSE_READY_TIMEOUT_MS = 10_000;
const eventSourceDataSchema = z.object({ data: z.string() });
type BrowserSseChannel = {
  eventSource: EventSource;
  listeners: Map<number, BrowserSseListenerRegistration>;
  /** Resolves when the first connection finishes its replay. */
  ready: Promise<void>;
  /** The warning of the current connection failure, or null while the stream is connected. */
  readConnectionWarning: () => string | null;
  handleMessage: EventListener;
  handleReplayComplete: EventListener;
  handleError: EventListener;
  handleNotification: EventListener;
  notifications: ReturnType<typeof createNotificationFrameRelay>;
};

type BrowserSseSubscription = {
  ready: Promise<void>;
  unsubscribe: () => void;
};
type LocalHostRequestErrorInput = {
  message: string;
  status: number;
  cause?: HostErrorResponse;
  failureKind?: string;
};

const isBrowserSseControlEvent = (event: BrowserSseEvent): event is BrowserSseControlEvent =>
  "__openducktorBrowserLive" in event;

let sseChannel: BrowserSseChannel | null = null;
let nextSseListenerId = 0;
let sessionPromise: Promise<void> | null = null;

const createLocalHostRequestError = (
  response: Response,
  message: string,
  payload: HostErrorResponse | null,
): WebHostRequestError => {
  const input: LocalHostRequestErrorInput = { message, status: response.status };
  if (payload !== null) {
    input.cause = payload;
  }
  if (payload?.failureKind) {
    input.failureKind = payload.failureKind;
  }
  return new WebHostRequestError(input);
};

const localHostRequestErrorEffect = (
  response: Response,
): Effect.Effect<never, WebDependencyError | WebHostRequestError> =>
  Effect.gen(function* () {
    const { message, payload } = yield* readLocalHostErrorPayloadEffect(response);
    return yield* createLocalHostRequestError(response, message, payload);
  });

const localHostInvokeErrorEffect = (
  response: Response,
): Effect.Effect<never, WebDependencyError | WebHostRequestError | HostInvokeError> =>
  Effect.gen(function* () {
    const { message, payload } = yield* readLocalHostInvokeErrorPayloadEffect(response);
    if (payload?.failure) {
      return yield* Effect.fail(new HostInvokeError(message, payload.failure));
    }
    return yield* createLocalHostRequestError(response, message, payload);
  });

export const ensureLocalHostSessionEffect = (): Effect.Effect<void, WebError> =>
  Effect.gen(function* () {
    const baseUrl = (yield* getBrowserBackendUrlEffect()).replace(/\/$/, "");
    const appToken = yield* getBrowserAuthTokenEffect();
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`${baseUrl}/${SESSION_PATH}`, {
          method: "POST",
          credentials: "include",
          headers: {
            [APP_TOKEN_HEADER]: appToken,
          },
        }),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "local-web-host",
          operation: "session",
          message: errorMessage(cause),
          cause,
        }),
    });

    if (!response.ok) {
      return yield* localHostRequestErrorEffect(response);
    }
  });

export const ensureLocalHostSession = (): Promise<void> => {
  if (sessionPromise) {
    return sessionPromise;
  }

  sessionPromise = runWebBoundary(ensureLocalHostSessionEffect()).catch((cause: unknown) => {
    sessionPromise = null;
    throw cause;
  });

  return sessionPromise;
};

export const ensureLocalHostSessionDedupedEffect = (): Effect.Effect<void, WebError> =>
  Effect.tryPromise({
    try: () => ensureLocalHostSession(),
    catch: (cause) =>
      isWebError(cause)
        ? cause
        : new WebDependencyError({
            dependency: "local-web-host",
            operation: "session",
            message: errorMessage(cause),
            cause,
          }),
  });

const invokeLocalHostEffect = <Command extends HostCommandName>(
  command: Command,
  args: Exclude<HostCommandArgs, undefined> | undefined,
): Effect.Effect<unknown, WebError | HostInvokeError> =>
  Effect.gen(function* () {
    const baseUrl = (yield* getBrowserBackendUrlEffect()).replace(/\/$/, "");
    const appToken = yield* getBrowserAuthTokenEffect();
    yield* ensureLocalHostSessionDedupedEffect();
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`${baseUrl}/invoke/${command}`, {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            [APP_TOKEN_HEADER]: appToken,
          },
          body: JSON.stringify(args ?? {}),
        }),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "local-web-host",
          operation: "invoke",
          message: errorMessage(cause),
          cause,
          details: { command },
        }),
    });

    if (!response.ok) {
      return yield* localHostInvokeErrorEffect(response);
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const payload: unknown = await response.json();
        return payload;
      },
      catch: (cause) =>
        new WebDependencyError({
          dependency: "local-web-host",
          operation: "read-invoke-response",
          message: errorMessage(cause),
          cause,
          details: { command },
        }),
    });
  });

const createHttpInvoke = (): InvokeFn => async (command, args, resultSchema) => {
  const payload = await runWebBoundary(invokeLocalHostEffect(command, args));
  return resultSchema.parse(payload);
};

export const createLocalHostClient = (): HostClient => createHostClient(createHttpInvoke());

const parseHostEvent = (raw: string): HostEventEnvelope => parseHostEventEnvelope(JSON.parse(raw));

const readEventSourceData = (event: Event, eventName: string): string => {
  const parsed = eventSourceDataSchema.safeParse(event);
  if (!parsed.success) {
    throw new Error(`EventSource ${eventName} events must contain string data.`, {
      cause: parsed.error,
    });
  }
  return parsed.data.data;
};

const dispatchBrowserSseListeners = <Payload>(
  listeners: Iterable<(payload: Payload) => void>,
  payload: Payload,
): void => {
  let didListenerThrow = false;
  let firstListenerError: unknown;

  for (const currentListener of listeners) {
    try {
      currentListener(payload);
    } catch (error) {
      if (!didListenerThrow) {
        firstListenerError = error;
      }
      didListenerThrow = true;
    }
  }

  if (didListenerThrow) {
    throw firstListenerError;
  }
};

const closeSseChannelIfUnused = (channel: BrowserSseChannel): void => {
  if (channel.listeners.size > 0 || channel.notifications.hasListeners()) {
    return;
  }
  channel.eventSource.removeEventListener("message", channel.handleMessage);
  channel.eventSource.removeEventListener("replay-complete", channel.handleReplayComplete);
  channel.eventSource.removeEventListener("error", channel.handleError);
  channel.eventSource.removeEventListener("notification-frame", channel.handleNotification);
  channel.eventSource.close();
  if (sseChannel === channel) {
    sseChannel = null;
  }
};

const getSseChannelEffect = (
  notificationCursor: NotificationCursor | null = null,
): Effect.Effect<BrowserSseChannel, WebError> =>
  Effect.gen(function* () {
    const baseUrl = (yield* getBrowserBackendUrlEffect()).replace(/\/$/, "");
    let channel = sseChannel;

    if (!channel) {
      const url = new URL(`${baseUrl}/${HOST_EVENT_STREAM_PATH}`);
      if (notificationCursor)
        url.searchParams.set("notificationCursor", JSON.stringify(notificationCursor));
      const eventSource = yield* Effect.try({
        try: () =>
          new EventSource(url.href, {
            withCredentials: true,
          }),
        catch: (cause) =>
          new WebDependencyError({
            dependency: "event-source",
            operation: "subscribe",
            message: errorMessage(cause),
            cause,
            details: { path: HOST_EVENT_STREAM_PATH },
          }),
      });
      const listeners = new Map<number, BrowserSseListenerRegistration>();
      const notifications = createNotificationFrameRelay();
      const handleNotification: EventListener = (event) => {
        try {
          notifications.accept(
            notificationStreamFrameSchema.parse(
              JSON.parse(readEventSourceData(event, "notification-frame")),
            ),
          );
        } catch (cause) {
          notifications.fail(cause);
        }
      };
      let hasOpened = false;
      let hasReportedConnectionError = false;
      let connectionWarning: string | null = null;
      let resolveReady: () => void = () => {};
      const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
      const snapshotControlListeners = (): BrowserSseListener[] =>
        [...listeners.values()]
          .filter((registration) => registration.receivesControlEvents)
          .map((registration) => registration.listener);
      const handleMessage: EventListener = (event) => {
        const hostEvent = parseHostEvent(readEventSourceData(event, event.type));
        const expectedName = hostEventStreamEventName(hostEvent);
        if (event.type !== expectedName) {
          throw new Error("OpenDucktor host event arrived on the wrong stream event name.");
        }
        dispatchBrowserSseListeners(
          [...listeners.values()]
            .filter(
              (registration) =>
                registration.channel === hostEvent.channel && registration.eventName === event.type,
            )
            .map((registration) => registration.listener),
          hostEvent,
        );
      };
      // The host ends the replay of each connection with the event names it could not replay.
      const handleReplayComplete: EventListener = (event) => {
        const replay = browserReplayCompleteSchema.parse(
          JSON.parse(readEventSourceData(event, "replay-complete")),
        );
        // A connection after a reported failure is a recovery, also when it is the first one.
        const recovers = connectionWarning !== null;
        connectionWarning = null;
        hasReportedConnectionError = false;
        const resumed = hasOpened;
        if (!hasOpened) {
          hasOpened = true;
          resolveReady();
          if (!recovers) return;
        }
        const gaps = new Set(replay.gaps);
        dispatchBrowserSseListeners(
          [...listeners.values()]
            .filter((registration) => registration.receivesControlEvents)
            .map(
              (registration) => () =>
                registration.listener(
                  browserLiveReconnectedEvent(
                    // A first connection has no cursor, so it cannot prove that nothing was missed.
                    !resumed || replay.hostChanged || gaps.has(registration.eventName),
                  ),
                ),
            ),
          undefined,
        );
      };
      const handleError: EventListener = () => {
        if (!hasReportedConnectionError)
          notifications.fail(
            new Error(
              "Notification connection failed. The stream will reconnect when the host is available.",
            ),
          );
        if (hasReportedConnectionError) {
          return;
        }
        if (hasOpened) {
          connectionWarning = `EventSource ${HOST_EVENT_STREAM_PATH} reported an error after opening.`;
          const warningPayload = browserLiveStreamWarningEvent(connectionWarning);
          try {
            dispatchBrowserSseListeners(snapshotControlListeners(), warningPayload);
          } finally {
            hasReportedConnectionError = true;
          }
          return;
        }
        connectionWarning = `EventSource ${HOST_EVENT_STREAM_PATH} reported an error before opening.`;
        dispatchBrowserSseListeners(
          snapshotControlListeners(),
          browserLiveStreamWarningEvent(connectionWarning),
        );
        hasReportedConnectionError = true;
      };
      eventSource.addEventListener("notification-frame", handleNotification);
      eventSource.addEventListener("message", handleMessage);
      eventSource.addEventListener("replay-complete", handleReplayComplete);
      eventSource.addEventListener("error", handleError);
      channel = {
        eventSource,
        listeners,
        ready,
        readConnectionWarning: () => connectionWarning,
        handleMessage,
        handleReplayComplete,
        handleError,
        handleNotification,
        notifications,
      };
      sseChannel = channel;
    }

    return channel;
  });

const subscribeSseChannelEffect = (
  eventChannel: HostEventChannel,
  listener: BrowserSseListener,
  receivesControlEvents = false,
  eventName = "message",
): Effect.Effect<BrowserSseSubscription, WebError> =>
  Effect.gen(function* () {
    const channel = yield* getSseChannelEffect();
    const listenerId = nextSseListenerId;
    nextSseListenerId += 1;
    const registration: BrowserSseListenerRegistration = {
      channel: eventChannel,
      eventName,
      listener,
      receivesControlEvents,
    };
    if (
      eventName !== "message" &&
      ![...channel.listeners.values()].some((entry) => entry.eventName === eventName)
    ) {
      channel.eventSource.addEventListener(eventName, channel.handleMessage);
    }
    channel.listeners.set(listenerId, registration);
    const activeChannel = channel;
    const subscriptionReady = activeChannel.ready.then(() => {
      // The first open does not prove the stream is connected now. A control subscriber that
      // joins during a connection failure gets that failure before its subscription is ready.
      const connectionWarning = activeChannel.readConnectionWarning();
      if (
        receivesControlEvents &&
        connectionWarning !== null &&
        activeChannel.listeners.get(listenerId) === registration
      ) {
        dispatchBrowserSseListeners(
          [registration.listener],
          browserLiveStreamWarningEvent(connectionWarning),
        );
      }
    });
    void subscriptionReady.catch(() => {});

    return {
      ready: subscriptionReady,
      unsubscribe: () => {
        const currentChannel = sseChannel;
        if (!currentChannel) {
          return;
        }
        currentChannel.listeners.delete(listenerId);
        if (
          eventName !== "message" &&
          ![...currentChannel.listeners.values()].some((entry) => entry.eventName === eventName)
        ) {
          currentChannel.eventSource.removeEventListener(eventName, currentChannel.handleMessage);
        }
        closeSseChannelIfUnused(currentChannel);
      },
    };
  });

export const subscribeLocalHostRunEvents = async (
  listener: RunEventListener,
): Promise<() => void> => {
  return runWebBoundary(
    Effect.gen(function* () {
      yield* ensureLocalHostSessionDedupedEffect();
      return (yield* subscribeSseChannelEffect(RUN_EVENT_CHANNEL, (event) => {
        if (!isBrowserSseControlEvent(event) && event.channel === RUN_EVENT_CHANNEL) {
          listener(event.payload);
        }
      })).unsubscribe;
    }),
  );
};

export const subscribeLocalHostAzureDevOpsConnectionUpdates = async (
  listener: AzureDevOpsConnectionUpdateListener,
): Promise<() => void> => {
  return runWebBoundary(
    subscribeReadyLocalHostEventsEffect(AZURE_DEVOPS_CONNECTION_EVENT_CHANNEL, (event) => {
      if (
        !isBrowserSseControlEvent(event) &&
        event.channel === AZURE_DEVOPS_CONNECTION_EVENT_CHANNEL
      ) {
        listener(event.payload);
      }
    }),
  );
};
export const subscribeLocalHostWorkspaceProviderSetupUpdates = async (
  listener: (payload: HostEventPayload<"openducktor://workspace-provider-setup-updated">) => void,
): Promise<() => void> => {
  return runWebBoundary(
    subscribeReadyLocalHostEventsEffect(
      "openducktor://workspace-provider-setup-updated",
      (event) => {
        if (
          !isBrowserSseControlEvent(event) &&
          event.channel === "openducktor://workspace-provider-setup-updated"
        )
          listener(event.payload);
      },
    ),
  );
};

const subscribeReadyLocalHostEventsEffect = (
  channel: HostEventChannel,
  listener: BrowserSseListener,
  eventName = "message",
): Effect.Effect<() => void, WebError> =>
  Effect.gen(function* () {
    yield* ensureLocalHostSessionDedupedEffect();
    const subscription = yield* subscribeSseChannelEffect(channel, listener, true, eventName);
    const readyExit = yield* Effect.exit(
      Effect.tryPromise({
        try: () => {
          let timeoutId: ReturnType<typeof setTimeout> | null = null;
          const timeout = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () =>
                reject(
                  new WebDependencyError({
                    dependency: "event-source",
                    operation: "await-ready",
                    message: `Timed out waiting for EventSource ${HOST_EVENT_STREAM_PATH} subscription to open.`,
                    details: {
                      path: HOST_EVENT_STREAM_PATH,
                      timeoutMs: INITIAL_SSE_READY_TIMEOUT_MS,
                    },
                  }),
                ),
              INITIAL_SSE_READY_TIMEOUT_MS,
            );
          });
          return Promise.race([subscription.ready, timeout]).finally(() => {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
          });
        },
        catch: (cause) => {
          if (isWebError(cause)) {
            return cause;
          }
          return new WebDependencyError({
            dependency: "event-source",
            operation: "await-ready",
            message: errorMessage(cause),
            cause,
            details: { path: HOST_EVENT_STREAM_PATH },
          });
        },
      }),
    );
    if (readyExit._tag === "Failure") {
      subscription.unsubscribe();
      return yield* causeToWebBoundaryError(readyExit.cause);
    }
    return subscription.unsubscribe;
  });

export const subscribeLocalHostWorkspaceSessionUpdates = async (
  listener: import("@openducktor/frontend/lib/shell-bridge").WorkspaceSessionUpdateListener,
): Promise<() => void> => {
  return runWebBoundary(
    subscribeReadyLocalHostEventsEffect("openducktor://workspace-session-updated", (event) => {
      if (isBrowserSseControlEvent(event)) {
        listener(event);
      } else if (event.channel === "openducktor://workspace-session-updated") {
        listener(event.payload);
      }
    }),
  );
};

export const subscribeLocalHostRuntimeChanges = async (
  listener: RuntimeChangeListener,
): Promise<() => void> => {
  return runWebBoundary(
    subscribeReadyLocalHostEventsEffect(RUNTIME_CHANGED_EVENT_CHANNEL, (event) => {
      if (isBrowserSseControlEvent(event)) {
        listener(event);
      } else if (event.channel === RUNTIME_CHANGED_EVENT_CHANNEL) {
        listener(event.payload);
      }
    }),
  );
};

export const observeLocalHostAgentSessions = async (
  input: AgentSessionLiveAttachInput,
  listener: (envelope: AgentSessionLiveEnvelope) => void,
): Promise<() => void> => {
  return runWebBoundary(
    Effect.gen(function* () {
      const client = createLocalHostClient();
      let closed = false;
      // Only the latest attachment can install its snapshot.
      let attachGeneration = 0;
      const attachment = createAgentSessionLiveAttachment(input.repoPath, listener);
      const attach = async (generation: number): Promise<void> => {
        const snapshot = await client.agentSessionLiveAttach(input);
        if (!closed && generation === attachGeneration) attachment.install(snapshot);
      };
      // A complete replay keeps the current state. Missed events need a new host snapshot.
      const reattach = (): void => {
        attachGeneration += 1;
        const generation = attachGeneration;
        attachment.restart();
        attach(generation).catch((cause: unknown) => {
          if (!closed && generation === attachGeneration) {
            listener({
              type: "fault",
              repoPath: input.repoPath,
              operation: "agent-session-live.attach",
              message: errorMessage(cause),
            } satisfies AgentSessionLiveEnvelope);
          }
        });
      };
      const unsubscribe = yield* subscribeReadyLocalHostEventsEffect(
        AGENT_SESSION_LIVE_EVENT_CHANNEL,
        (event) => {
          if (isBrowserSseControlEvent(event)) {
            if (event.kind === BROWSER_LIVE_RECONNECTED_EVENT_KIND && event.missedEvents) {
              reattach();
            }
            return;
          }
          if (event.channel === AGENT_SESSION_LIVE_EVENT_CHANNEL) {
            attachment.accept(event.payload);
          }
        },
        liveSessionStreamEventName(input.repoPath),
      );
      const initialAttachExit = yield* Effect.exit(
        Effect.tryPromise({
          try: () => attach(attachGeneration),
          catch: (cause) =>
            isWebError(cause)
              ? cause
              : new WebDependencyError({
                  dependency: "local-web-host",
                  operation: "agent-session-live.attach",
                  message: errorMessage(cause),
                  cause,
                }),
        }),
      );
      if (initialAttachExit._tag === "Failure") {
        unsubscribe();
        return yield* causeToWebBoundaryError(initialAttachExit.cause);
      }
      return () => {
        closed = true;
        unsubscribe();
      };
    }),
  );
};

export const subscribeLocalHostTaskStream = async (
  input: { cursor: TaskEventCursor | null },
  onFrame: (frame: TaskStreamFrame) => void,
  onTerminalFailure?: (cause: unknown) => void,
): Promise<TaskStreamSubscription> =>
  runWebBoundary(
    subscribeLocalTaskEventStreamEffect(input, onFrame, onTerminalFailure, {
      ensureSession: ensureLocalHostSessionDedupedEffect,
      localHostRequestErrorEffect,
    }),
  );

export const buildLocalAttachmentPreviewUrl = (browserBackendUrl: string, path: string): string => {
  const baseUrl = browserBackendUrl.replace(/\/$/, "");
  const query = new URLSearchParams({ path });
  return `${baseUrl}/local-attachment-preview?${query.toString()}`;
};

export const buildTaskAssetUrl = (
  browserBackendUrl: string,
  input: { workspaceId: string; taskId: string; scope: string; assetId: string },
): string => {
  const baseUrl = browserBackendUrl.replace(/\/$/, "");
  const segments = [input.workspaceId, input.taskId, input.scope, input.assetId].map((segment) =>
    encodeURIComponent(segment),
  );
  return `${baseUrl}/task-assets/${segments.join("/")}`;
};

export const subscribeLocalHostNotificationStream: import("@openducktor/frontend/lib/shell-bridge").HostBridge["subscribeNotificationStream"] =
  (input, onFrame, onFailure) =>
    runWebBoundary(
      Effect.gen(function* () {
        const parsed = notificationStreamSubscribeSchema.parse(input);
        yield* ensureLocalHostSessionDedupedEffect();
        const channel = yield* getSseChannelEffect(parsed.cursor);
        const stop = channel.notifications.subscribe(parsed, onFrame, onFailure);
        return () => {
          stop();
          closeSseChannelIfUnused(channel);
        };
      }),
    );
