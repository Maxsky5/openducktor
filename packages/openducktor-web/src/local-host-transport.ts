import {
  type AgentSessionLiveEnvelope,
  type AgentSessionLiveRefreshInput,
  agentSessionLiveEnvelopeSchema,
} from "@openducktor/contracts";
import type { DevServerEventSubscription } from "@openducktor/frontend";
import {
  BROWSER_LIVE_RECONNECTED_EVENT_KIND,
  BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
} from "@openducktor/frontend/lib/browser-live/constants";
import {
  browserLiveControlEvent,
  isBrowserLiveControlEvent,
} from "@openducktor/frontend/lib/browser-live-control-events";
import type { HostEventChannel } from "@openducktor/host";
import { createHostClient, type HostClient } from "@openducktor/host-client";
import { Effect } from "effect";
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
import { readLocalHostErrorPayloadEffect } from "./local-host-errors";

type BrowserSseListener = (payload: unknown) => void;
type BrowserSseListenerRegistration = {
  channel: HostEventChannel;
  listener: BrowserSseListener;
  receivesControlEvents: boolean;
};

const RUN_EVENT_CHANNEL = "openducktor://run-event";
const DEV_SERVER_EVENT_CHANNEL = "openducktor://dev-server-event";
const TASK_EVENT_CHANNEL = "openducktor://task-event";
const AGENT_SESSION_LIVE_EVENT_CHANNEL = "openducktor://agent-session-live-event";
const HOST_EVENT_STREAM_PATH = "events";
const APP_TOKEN_HEADER = "x-openducktor-app-token";
const SESSION_PATH = "session";
const INITIAL_SSE_READY_TIMEOUT_MS = 10_000;

type BrowserSseChannel = {
  eventSource: EventSource;
  listeners: Map<number, BrowserSseListenerRegistration>;
  ready: Promise<void>;
  readTransportEpoch: () => string | null;
  handleMessage: (event: MessageEvent<string>) => void;
  handleOpen: () => void;
  handleError: (event: Event) => void;
  handleStreamWarning: (event: MessageEvent<string>) => void;
};

type BrowserSseSubscription = {
  ready: Promise<string>;
  unsubscribe: () => void;
};

let sseChannel: BrowserSseChannel | null = null;
let nextSseListenerId = 0;
let nextSseTransportEpoch = 0;
let sessionPromise: Promise<void> | null = null;

const readFailureKind = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== "object" || !("failureKind" in payload)) {
    return undefined;
  }
  const failureKind = payload.failureKind;
  return typeof failureKind === "string" && failureKind.trim() ? failureKind : undefined;
};

const localHostRequestErrorEffect = (
  response: Response,
): Effect.Effect<never, WebDependencyError | WebHostRequestError> =>
  Effect.gen(function* () {
    const { message, payload } = yield* readLocalHostErrorPayloadEffect(response);
    const failureKind = payload !== null ? readFailureKind(payload) : undefined;
    return yield* new WebHostRequestError({
      message,
      status: response.status,
      ...(payload !== null ? { cause: payload } : {}),
      ...(failureKind ? { failureKind } : {}),
    });
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

  sessionPromise = runWebBoundary(ensureLocalHostSessionEffect()).catch((error: unknown) => {
    sessionPromise = null;
    throw error;
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

const invokeLocalHostEffect = <T>(
  command: string,
  args?: Record<string, unknown>,
): Effect.Effect<T, WebError> =>
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
      return yield* localHostRequestErrorEffect(response);
    }

    return yield* Effect.tryPromise({
      try: () => response.json() as Promise<T>,
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

const createHttpInvoke =
  () =>
  async <T>(command: string, args?: Record<string, unknown>): Promise<T> =>
    runWebBoundary(invokeLocalHostEffect<T>(command, args));

export const createLocalHostClient = (): HostClient => createHostClient(createHttpInvoke());

const parseHostEvent = (raw: string): { channel: string; payload: unknown } => {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") {
    throw new Error("Host event payload must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.channel !== "string" || !("payload" in record)) {
    throw new Error("Host event payload must contain channel and payload fields.");
  }
  return { channel: record.channel, payload: record.payload };
};

const dispatchBrowserSseWarning = (
  listeners: Iterable<BrowserSseListener>,
  warningPayload: unknown,
): void => {
  let didListenerThrow = false;
  let firstListenerError: unknown;

  for (const currentListener of listeners) {
    try {
      currentListener(warningPayload);
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
  if (channel.listeners.size > 0) {
    return;
  }
  channel.eventSource.removeEventListener("message", channel.handleMessage as EventListener);
  channel.eventSource.removeEventListener("open", channel.handleOpen as EventListener);
  channel.eventSource.removeEventListener("error", channel.handleError as EventListener);
  channel.eventSource.removeEventListener(
    "stream-warning",
    channel.handleStreamWarning as EventListener,
  );
  channel.eventSource.close();
  if (sseChannel === channel) {
    sseChannel = null;
  }
};

const subscribeSseChannelEffect = (
  eventChannel: HostEventChannel,
  listener: BrowserSseListener,
  receivesControlEvents = false,
): Effect.Effect<BrowserSseSubscription, WebError> =>
  Effect.gen(function* () {
    const baseUrl = (yield* getBrowserBackendUrlEffect()).replace(/\/$/, "");
    let channel = sseChannel;

    if (!channel) {
      const eventSource = yield* Effect.try({
        try: () =>
          new EventSource(`${baseUrl}/${HOST_EVENT_STREAM_PATH}`, { withCredentials: true }),
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
      let hasOpened = false;
      let hasReportedPostOpenError = false;
      let transportEpoch: string | null = null;
      let resolveReady: () => void = () => {};
      let rejectReady: (error: unknown) => void = () => {};
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      void ready.catch(() => {});
      const handleMessage = (event: MessageEvent<string>): void => {
        const hostEvent = parseHostEvent(event.data);
        for (const registration of listeners.values()) {
          if (registration.channel === hostEvent.channel) {
            registration.listener(hostEvent.payload);
          }
        }
      };
      const handleOpen = (): void => {
        transportEpoch = `${HOST_EVENT_STREAM_PATH}:${nextSseTransportEpoch}`;
        nextSseTransportEpoch += 1;
        if (!hasOpened) {
          hasOpened = true;
          hasReportedPostOpenError = false;
          resolveReady();
          return;
        }
        hasReportedPostOpenError = false;
        for (const registration of listeners.values()) {
          if (registration.receivesControlEvents) {
            registration.listener(
              browserLiveControlEvent(BROWSER_LIVE_RECONNECTED_EVENT_KIND, transportEpoch),
            );
          }
        }
      };
      const handleError = (event: Event): void => {
        if (hasOpened) {
          if (hasReportedPostOpenError) {
            return;
          }
          const warningPayload = browserLiveControlEvent(
            BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
            `EventSource ${HOST_EVENT_STREAM_PATH} reported an error after opening.`,
          );
          try {
            dispatchBrowserSseWarning(
              [...listeners.values()]
                .filter((registration) => registration.receivesControlEvents)
                .map((registration) => registration.listener),
              warningPayload,
            );
          } finally {
            hasReportedPostOpenError = true;
          }
          return;
        }
        rejectReady(
          new WebDependencyError({
            dependency: "event-source",
            operation: "await-ready",
            message: `EventSource failed before opening ${HOST_EVENT_STREAM_PATH}.`,
            cause: event,
            details: { path: HOST_EVENT_STREAM_PATH },
          }),
        );
      };
      const handleStreamWarning = (event: MessageEvent<string>): void => {
        const warningPayload = browserLiveControlEvent(
          BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
          event.data,
        );
        dispatchBrowserSseWarning(
          [...listeners.values()]
            .filter((registration) => registration.receivesControlEvents)
            .map((registration) => registration.listener),
          warningPayload,
        );
      };

      eventSource.addEventListener("message", handleMessage as EventListener);
      eventSource.addEventListener("open", handleOpen as EventListener);
      eventSource.addEventListener("error", handleError as EventListener);
      eventSource.addEventListener("stream-warning", handleStreamWarning as EventListener);
      channel = {
        eventSource,
        listeners,
        ready,
        readTransportEpoch: () => transportEpoch,
        handleMessage,
        handleOpen,
        handleError,
        handleStreamWarning,
      };
      sseChannel = channel;
    }

    const listenerId = nextSseListenerId;
    nextSseListenerId += 1;
    channel.listeners.set(listenerId, { channel: eventChannel, listener, receivesControlEvents });
    const activeChannel = channel;
    const subscriptionReady = activeChannel.ready.then(() => {
      const transportEpoch = activeChannel.readTransportEpoch();
      if (transportEpoch === null) {
        throw new WebDependencyError({
          dependency: "event-source",
          operation: "read-transport-epoch",
          message: `EventSource ${HOST_EVENT_STREAM_PATH} opened without a transport epoch.`,
          details: { path: HOST_EVENT_STREAM_PATH },
        });
      }
      return transportEpoch;
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
        closeSseChannelIfUnused(currentChannel);
      },
    };
  });

export const subscribeLocalHostRunEvents = async (
  listener: (payload: unknown) => void,
): Promise<() => void> => {
  return runWebBoundary(
    Effect.gen(function* () {
      yield* ensureLocalHostSessionDedupedEffect();
      return (yield* subscribeSseChannelEffect(RUN_EVENT_CHANNEL, listener)).unsubscribe;
    }),
  );
};

const subscribeReadyLocalHostEventsEffect = (
  channel: HostEventChannel,
  listener: (payload: unknown) => void,
): Effect.Effect<DevServerEventSubscription, WebError> =>
  Effect.gen(function* () {
    yield* ensureLocalHostSessionDedupedEffect();
    const subscription = yield* subscribeSseChannelEffect(channel, listener, true);
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
    return {
      transportEpoch: readyExit.value,
      unsubscribe: subscription.unsubscribe,
    };
  });

export const subscribeLocalHostDevServerEvents = async (
  listener: (payload: unknown) => void,
): Promise<DevServerEventSubscription> => {
  return runWebBoundary(subscribeReadyLocalHostEventsEffect(DEV_SERVER_EVENT_CHANNEL, listener));
};

const liveEnvelopeRepoPath = (envelope: AgentSessionLiveEnvelope): string => {
  switch (envelope.type) {
    case "snapshot":
    case "fault":
      return envelope.repoPath;
    case "session_upsert":
      return envelope.session.ref.repoPath;
    case "session_removed":
      return envelope.ref.repoPath;
    case "transcript_event":
      return envelope.event.sessionRef.repoPath;
    case "catalog_invalidated":
      return envelope.scope.repoPath;
  }
};

export const observeLocalHostAgentSessions = async (
  input: AgentSessionLiveRefreshInput,
  listener: (envelope: AgentSessionLiveEnvelope) => void,
): Promise<() => void> => {
  return runWebBoundary(
    Effect.gen(function* () {
      const client = createLocalHostClient();
      let closed = false;
      let awaitingSnapshot = true;
      let refreshTail = Promise.resolve();
      const refresh = (): void => {
        awaitingSnapshot = true;
        refreshTail = refreshTail
          .then(async () => {
            if (!closed) {
              await client.agentSessionLiveRefresh(input);
            }
          })
          .catch((cause: unknown) => {
            if (!closed) {
              listener({
                type: "fault",
                repoPath: input.repoPath,
                operation: "agent-session-live.refresh",
                message: errorMessage(cause),
              } satisfies AgentSessionLiveEnvelope);
            }
          });
      };
      const subscription = yield* subscribeReadyLocalHostEventsEffect(
        AGENT_SESSION_LIVE_EVENT_CHANNEL,
        (payload) => {
          if (isBrowserLiveControlEvent(payload)) {
            if (payload.kind === BROWSER_LIVE_RECONNECTED_EVENT_KIND) {
              refresh();
            }
            return;
          }
          const envelope = agentSessionLiveEnvelopeSchema.parse(payload);
          if (liveEnvelopeRepoPath(envelope) !== input.repoPath) {
            return;
          }
          if (envelope.type === "snapshot") {
            awaitingSnapshot = false;
            listener(envelope);
            return;
          }
          if (!awaitingSnapshot) {
            listener(envelope);
          }
        },
      );
      const initialRefreshExit = yield* Effect.exit(
        Effect.tryPromise({
          try: () => client.agentSessionLiveRefresh(input),
          catch: (cause) =>
            isWebError(cause)
              ? cause
              : new WebDependencyError({
                  dependency: "local-web-host",
                  operation: "agent-session-live.refresh",
                  message: errorMessage(cause),
                  cause,
                }),
        }),
      );
      if (initialRefreshExit._tag === "Failure") {
        subscription.unsubscribe();
        return yield* causeToWebBoundaryError(initialRefreshExit.cause);
      }
      return () => {
        closed = true;
        subscription.unsubscribe();
      };
    }),
  );
};

export const subscribeLocalHostTaskEvents = async (
  listener: (payload: unknown) => void,
): Promise<() => void> => {
  return runWebBoundary(
    Effect.gen(function* () {
      yield* ensureLocalHostSessionDedupedEffect();
      return (yield* subscribeSseChannelEffect(TASK_EVENT_CHANNEL, listener, true)).unsubscribe;
    }),
  );
};

export const buildLocalAttachmentPreviewUrl = (browserBackendUrl: string, path: string): string => {
  const baseUrl = browserBackendUrl.replace(/\/$/, "");
  const query = new URLSearchParams({ path });
  return `${baseUrl}/local-attachment-preview?${query.toString()}`;
};
