import {
  type AgentSessionLiveEnvelope,
  type AgentSessionLiveRefreshInput,
  type HostErrorResponse,
  type HostEventChannel,
  type HostEventEnvelope,
  parseHostEventEnvelope,
  type TaskEventCursor,
} from "@openducktor/contracts";
import type { HostCommandArgs, HostCommandName } from "@openducktor/host";
import type {
  DevServerEventListener,
  DevServerEventSubscription,
  RunEventListener,
} from "@openducktor/frontend";
import {
  BROWSER_LIVE_RECONNECTED_EVENT_KIND,
  BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
} from "@openducktor/frontend/lib/browser-live/constants";
import { browserLiveControlEvent } from "@openducktor/frontend/lib/browser-live-control-events";
import type {
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
import { subscribeLocalTaskEventStreamEffect } from "./local-task-event-transport";

type BrowserSseControlEvent = ReturnType<typeof browserLiveControlEvent>;
type BrowserSseEvent = HostEventEnvelope | BrowserSseControlEvent;
type BrowserSseListener = (event: BrowserSseEvent) => void;
type BrowserSseListenerRegistration = {
  channel: HostEventChannel;
  listener: BrowserSseListener;
  receivesControlEvents: boolean;
  onReplayGap?: (message: string) => void;
};

const RUN_EVENT_CHANNEL = "openducktor://run-event";
const DEV_SERVER_EVENT_CHANNEL = "openducktor://dev-server-event";
const AGENT_SESSION_LIVE_EVENT_CHANNEL = "openducktor://agent-session-live-event";
const HOST_EVENT_STREAM_PATH = "events";
const APP_TOKEN_HEADER = "x-openducktor-app-token";
const SESSION_PATH = "session";
const INITIAL_SSE_READY_TIMEOUT_MS = 10_000;
const eventSourceDataSchema = z.object({ data: z.string() });
type BrowserSseChannel = {
  eventSource: EventSource;
  listeners: Map<number, BrowserSseListenerRegistration>;
  ready: Promise<void>;
  readTransportEpoch: () => string | null;
  handleMessage: EventListener;
  handleOpen: EventListener;
  handleError: EventListener;
  handleStreamWarning: EventListener;
};

type BrowserSseSubscription = {
  ready: Promise<string>;
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
let nextSseTransportEpoch = 0;
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
  if (channel.listeners.size > 0) {
    return;
  }
  channel.eventSource.removeEventListener("message", channel.handleMessage);
  channel.eventSource.removeEventListener("open", channel.handleOpen);
  channel.eventSource.removeEventListener("error", channel.handleError);
  channel.eventSource.removeEventListener("stream-warning", channel.handleStreamWarning);
  channel.eventSource.close();
  if (sseChannel === channel) {
    sseChannel = null;
  }
};

const subscribeSseChannelEffect = (
  eventChannel: HostEventChannel,
  listener: BrowserSseListener,
  receivesControlEvents = false,
  onReplayGap?: (message: string) => void,
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
      let hasReportedConnectionError = false;
      let transportEpoch: string | null = null;
      let resolveReady: () => void = () => {};
      const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
      const handleMessage: EventListener = (event) => {
        const hostEvent = parseHostEvent(readEventSourceData(event, "message"));
        for (const registration of listeners.values()) {
          if (registration.channel === hostEvent.channel) {
            registration.listener(hostEvent);
          }
        }
      };
      const handleOpen: EventListener = () => {
        transportEpoch = `${HOST_EVENT_STREAM_PATH}:${nextSseTransportEpoch}`;
        nextSseTransportEpoch += 1;
        if (!hasOpened) {
          hasOpened = true;
          hasReportedConnectionError = false;
          resolveReady();
          return;
        }
        hasReportedConnectionError = false;
        for (const registration of listeners.values()) {
          if (registration.receivesControlEvents) {
            registration.listener(
              browserLiveControlEvent(BROWSER_LIVE_RECONNECTED_EVENT_KIND, transportEpoch),
            );
          }
        }
      };
      const handleError: EventListener = () => {
        if (hasReportedConnectionError) {
          return;
        }
        if (hasOpened) {
          const warningPayload = browserLiveControlEvent(
            BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
            `EventSource ${HOST_EVENT_STREAM_PATH} reported an error after opening.`,
          );
          try {
            dispatchBrowserSseListeners(
              [...listeners.values()]
                .filter((registration) => registration.receivesControlEvents)
                .map((registration) => registration.listener),
              warningPayload,
            );
          } finally {
            hasReportedConnectionError = true;
          }
          return;
        }
        dispatchBrowserSseListeners(
          [...listeners.values()]
            .filter((registration) => registration.receivesControlEvents)
            .map((registration) => registration.listener),
          browserLiveControlEvent(
            BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
            `EventSource ${HOST_EVENT_STREAM_PATH} reported an error before opening.`,
          ),
        );
        hasReportedConnectionError = true;
      };
      const handleStreamWarning: EventListener = (event) => {
        const warning = readEventSourceData(event, "stream-warning");
        const warningPayload = browserLiveControlEvent(
          BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
          warning,
        );
        const replayGapListeners = [...listeners.values()].flatMap((registration) =>
          registration.onReplayGap ? [registration.onReplayGap] : [],
        );
        const controlListeners = [...listeners.values()]
          .filter((registration) => registration.receivesControlEvents)
          .map((registration) => (_message: string): void => {
            registration.listener(warningPayload);
          });
        dispatchBrowserSseListeners([...replayGapListeners, ...controlListeners], warning);
      };

      eventSource.addEventListener("message", handleMessage);
      eventSource.addEventListener("open", handleOpen);
      eventSource.addEventListener("error", handleError);
      eventSource.addEventListener("stream-warning", handleStreamWarning);
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
    const registration: BrowserSseListenerRegistration = {
      channel: eventChannel,
      listener,
      receivesControlEvents,
    };
    if (onReplayGap) {
      registration.onReplayGap = onReplayGap;
    }
    channel.listeners.set(listenerId, registration);
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

const subscribeReadyLocalHostEventsEffect = (
  channel: HostEventChannel,
  listener: BrowserSseListener,
  onReplayGap?: (message: string) => void,
): Effect.Effect<DevServerEventSubscription, WebError> =>
  Effect.gen(function* () {
    yield* ensureLocalHostSessionDedupedEffect();
    const subscription = yield* subscribeSseChannelEffect(channel, listener, true, onReplayGap);
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
  listener: DevServerEventListener,
): Promise<DevServerEventSubscription> => {
  return runWebBoundary(
    subscribeReadyLocalHostEventsEffect(DEV_SERVER_EVENT_CHANNEL, (event) => {
      if (isBrowserSseControlEvent(event)) {
        listener(event);
        return;
      }
      if (event.channel === DEV_SERVER_EVENT_CHANNEL) {
        listener(event.payload);
      }
    }),
  );
};

export const observeLocalHostAgentSessions = async (
  input: AgentSessionLiveRefreshInput,
  listener: (envelope: AgentSessionLiveEnvelope) => void,
): Promise<() => void> => {
  return runWebBoundary(
    Effect.gen(function* () {
      const client = createLocalHostClient();
      let closed = false;
      let refreshTail = Promise.resolve();
      const attachment = createAgentSessionLiveAttachment(input.repoPath, listener);
      const refresh = (): void => {
        attachment.restart();
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
        (event) => {
          if (isBrowserSseControlEvent(event)) {
            if (event.kind === BROWSER_LIVE_RECONNECTED_EVENT_KIND) {
              refresh();
            }
            return;
          }
          if (event.channel === AGENT_SESSION_LIVE_EVENT_CHANNEL) {
            attachment.accept(event.payload);
          }
        },
        (message) => {
          listener({ type: "transcript_gap", repoPath: input.repoPath, message });
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
