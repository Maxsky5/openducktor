import { createNotificationFrameRelay } from "./notification-frame-relay";
import {
  notificationStreamFrameSchema,
  notificationStreamSubscribeSchema,
  type NotificationCursor,
  type AgentSessionLiveEnvelope,
  type AgentSessionLiveBaseline,
  type HostReplayLoss,
  hostReplayBoundarySchema,
  type AgentSessionLiveRefreshInput,
  type HostErrorResponse,
  type HostEventChannel,
  type HostEventEnvelope,
  parseHostEventEnvelope,
  type TaskEventCursor,
} from "@openducktor/contracts";
import type { HostCommandArgs, HostCommandName } from "@openducktor/host";
import type {
  AzureDevOpsConnectionUpdateListener,
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
  agentSessionLiveEnvelopeRepoPath,
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

type BrowserSseControlEvent = ReturnType<typeof browserLiveControlEvent> & {
  replayFailure?: boolean;
};
type BrowserSseEvent = HostEventEnvelope | BrowserSseControlEvent;
type BrowserSseListener = (event: BrowserSseEvent) => void;
type BrowserSseListenerRegistration = {
  channel: HostEventChannel;
  eventName: string;
  listener: BrowserSseListener;
  receivesControlEvents: boolean;
  onReplayGap?: (loss: HostReplayLoss | null) => void;
  onReplayComplete?: () => void;
};

const RUN_EVENT_CHANNEL = "openducktor://run-event";
const DEV_SERVER_EVENT_CHANNEL = "openducktor://dev-server-event";
const AGENT_SESSION_LIVE_EVENT_CHANNEL = "openducktor://agent-session-live-event";
const AZURE_DEVOPS_CONNECTION_EVENT_CHANNEL = "openducktor://azure-devops-connection-updated";
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
  readReplayPending: () => boolean;
  notifyPendingReplay: (registration: BrowserSseListenerRegistration) => void;
  handleMessage: EventListener;
  handleError: EventListener;
  handleStreamWarning: EventListener;
  handleNotification: EventListener;
  notifications: ReturnType<typeof createNotificationFrameRelay>;
  handleReplayStart: EventListener;
  handleReplayComplete: EventListener;
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
  channel.eventSource.removeEventListener("error", channel.handleError);
  channel.eventSource.removeEventListener("stream-warning", channel.handleStreamWarning);
  channel.eventSource.removeEventListener("notification-frame", channel.handleNotification);
  channel.eventSource.removeEventListener("replay-start", channel.handleReplayStart);
  channel.eventSource.removeEventListener("replay-complete", channel.handleReplayComplete);
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
      url.searchParams.set("notifications", "1");
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
      let transportEpoch: string | null = null;
      let resolveReady: () => void = () => {};
      let rejectReady: (cause: unknown) => void = () => {};
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      void ready.catch(() => undefined);
      let replayFailed = false;
      const snapshotControlListeners = (): BrowserSseListener[] =>
        [...listeners.values()]
          .filter((registration) => registration.receivesControlEvents)
          .map((registration) => registration.listener);
      const handleMessage: EventListener = (event) => {
        if (replayFailed) return;
        let hostEvent: HostEventEnvelope;
        try {
          hostEvent = parseHostEvent(readEventSourceData(event, event.type));
        } catch (cause) {
          dispatchBrowserSseListeners(
            [...listeners.values()].map((registration) => () => {
              registration.onReplayGap?.(null);
              if (registration.receivesControlEvents)
                registration.listener(
                  browserLiveControlEvent(
                    BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
                    `Host event validation failed: ${errorMessage(cause)}. Recover affected state.`,
                  ),
                );
            }),
            undefined,
          );
          throw cause;
        }
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
            .map((registration) => (payload: HostEventEnvelope) => {
              try {
                registration.listener(payload);
              } catch (cause) {
                const loss: HostReplayLoss = { channel: payload.channel, facet: "other" };
                if (payload.channel === AGENT_SESSION_LIVE_EVENT_CHANNEL) {
                  loss.repoPath = agentSessionLiveEnvelopeRepoPath(payload.payload);
                  loss.facet = payload.payload.type === "transcript_event" ? "transcript" : "state";
                  if (payload.payload.type === "transcript_event")
                    loss.refs = [payload.payload.event.sessionRef];
                }
                registration.onReplayGap?.(loss);
                throw cause;
              }
            }),
          hostEvent,
        );
      };
      let replayBoundary: ReturnType<typeof hostReplayBoundarySchema.parse> | null = null;
      const notifyReplayBoundary = (
        registration: BrowserSseListenerRegistration,
        boundary: ReturnType<typeof hostReplayBoundarySchema.parse>,
      ): void => {
        const losses = boundary.losses.filter((loss) => loss.channel === registration.channel);
        if (boundary.hostChanged) registration.onReplayGap?.(null);
        else for (const loss of losses) registration.onReplayGap?.(loss);
        if (boundary.hostChanged || losses.length > 0)
          registration.listener(
            browserLiveControlEvent(
              BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
              "Host replay is incomplete. Recover the affected state.",
            ),
          );
      };
      const failReplay = (cause: unknown): void => {
        replayFailed = true;
        eventSource.close();
        sseChannel = null;
        const message = `Invalid host replay: ${errorMessage(cause)} Reload the browser to reconnect to the configured host.`;
        rejectReady(new Error(message));
        dispatchBrowserSseListeners(snapshotControlListeners(), {
          ...browserLiveControlEvent(BROWSER_LIVE_STREAM_WARNING_EVENT_KIND, message),
          replayFailure: true,
        });
      };
      const handleReplayStart: EventListener = (event) => {
        if (replayFailed) return;
        let boundary: ReturnType<typeof hostReplayBoundarySchema.parse>;
        try {
          boundary = hostReplayBoundarySchema.parse(
            JSON.parse(readEventSourceData(event, "replay-start")),
          );
        } catch (cause) {
          failReplay(cause);
          return;
        }
        replayBoundary = boundary;
        transportEpoch = boundary.hostEpoch;
        dispatchBrowserSseListeners(
          Array.from(listeners.values()).map(
            (registration) => () => notifyReplayBoundary(registration, boundary),
          ),
          undefined,
        );
      };
      const handleReplayComplete: EventListener = (event) => {
        if (replayFailed) return;
        let complete: ReturnType<typeof hostReplayBoundarySchema.parse>;
        try {
          complete = hostReplayBoundarySchema.parse(
            JSON.parse(readEventSourceData(event, "replay-complete")),
          );
          if (!replayBoundary || JSON.stringify(complete) !== JSON.stringify(replayBoundary))
            throw new Error(
              "Host replay completion does not match its boundary. Reload the browser to reconnect.",
            );
        } catch (cause) {
          failReplay(cause);
          return;
        }
        replayBoundary = null;
        dispatchBrowserSseListeners(
          [...listeners.values()].map((registration) => () => registration.onReplayComplete?.()),
          undefined,
        );
        if (!hasOpened) {
          hasOpened = true;
          hasReportedConnectionError = false;
          resolveReady();
        } else {
          hasReportedConnectionError = false;
          dispatchBrowserSseListeners(
            snapshotControlListeners(),
            browserLiveControlEvent(BROWSER_LIVE_RECONNECTED_EVENT_KIND, complete.hostEpoch),
          );
        }
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
          const warningPayload = browserLiveControlEvent(
            BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
            `EventSource ${HOST_EVENT_STREAM_PATH} reported an error after opening.`,
          );
          try {
            dispatchBrowserSseListeners(snapshotControlListeners(), warningPayload);
          } finally {
            hasReportedConnectionError = true;
          }
          return;
        }
        dispatchBrowserSseListeners(
          snapshotControlListeners(),
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
        dispatchBrowserSseListeners(
          [...listeners.values()]
            .filter((registration) => registration.receivesControlEvents)
            .map((registration) => registration.listener),
          warningPayload,
        );
      };

      eventSource.addEventListener("notification-frame", handleNotification);
      eventSource.addEventListener("message", handleMessage);
      eventSource.addEventListener("error", handleError);
      eventSource.addEventListener("stream-warning", handleStreamWarning);
      eventSource.addEventListener("replay-start", handleReplayStart);
      eventSource.addEventListener("replay-complete", handleReplayComplete);
      channel = {
        eventSource,
        listeners,
        ready,
        readTransportEpoch: () => transportEpoch,
        readReplayPending: () => replayBoundary !== null,
        notifyPendingReplay: (registration) => {
          if (replayBoundary) notifyReplayBoundary(registration, replayBoundary);
        },
        handleMessage,
        handleError,
        handleStreamWarning,
        handleNotification,
        notifications,
        handleReplayStart,
        handleReplayComplete,
      };
      sseChannel = channel;
    }

    return channel;
  });

const subscribeSseChannelEffect = (
  eventChannel: HostEventChannel,
  listener: BrowserSseListener,
  receivesControlEvents = false,
  onReplayGap?: (loss: HostReplayLoss | null) => void,
  eventName = "message",
  onReplayComplete?: () => void,
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
    if (onReplayGap) {
      registration.onReplayGap = onReplayGap;
    }
    if (onReplayComplete) registration.onReplayComplete = onReplayComplete;
    if (
      eventName !== "message" &&
      ![...channel.listeners.values()].some((entry) => entry.eventName === eventName)
    ) {
      channel.eventSource.addEventListener(eventName, channel.handleMessage);
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

    const unsubscribe = (): void => {
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
    };
    try {
      activeChannel.notifyPendingReplay(registration);
    } catch (cause) {
      unsubscribe();
      throw cause;
    }
    return { ready: subscriptionReady, unsubscribe };
  });

export const subscribeLocalHostRunEvents = async (
  listener: RunEventListener,
): Promise<() => void> => {
  return runWebBoundary(
    Effect.gen(function* () {
      yield* ensureLocalHostSessionDedupedEffect();
      return (yield* subscribeSseChannelEffect(
        RUN_EVENT_CHANNEL,
        (event) => {
          if (isBrowserSseControlEvent(event)) listener(event);
          else if (event.channel === RUN_EVENT_CHANNEL) {
            listener(event.payload);
          }
        },
        true,
      )).unsubscribe;
    }),
  );
};

export const subscribeLocalHostAzureDevOpsConnectionUpdates = async (
  listener: AzureDevOpsConnectionUpdateListener,
): Promise<() => void> => {
  const subscription = await runWebBoundary(
    subscribeReadyLocalHostEventsEffect(AZURE_DEVOPS_CONNECTION_EVENT_CHANNEL, (event) => {
      if (isBrowserSseControlEvent(event)) listener(event);
      else if (event.channel === AZURE_DEVOPS_CONNECTION_EVENT_CHANNEL) {
        listener(event.payload);
      }
    }),
  );
  return subscription.unsubscribe;
};

const subscribeReadyLocalHostEventsEffect = (
  channel: HostEventChannel,
  listener: BrowserSseListener,
  onReplayGap?: (loss: HostReplayLoss | null) => void,
  eventName = "message",
  onReplayComplete?: () => void,
): Effect.Effect<DevServerEventSubscription, WebError> =>
  Effect.gen(function* () {
    yield* ensureLocalHostSessionDedupedEffect();
    const subscription = yield* subscribeSseChannelEffect(
      channel,
      listener,
      true,
      onReplayGap,
      eventName,
      onReplayComplete,
    );
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

export const subscribeLocalHostWorkspaceSessionUpdates = async (
  listener: import("@openducktor/frontend/lib/shell-bridge").WorkspaceSessionUpdateListener,
): Promise<() => void> => {
  const subscription = await runWebBoundary(
    subscribeReadyLocalHostEventsEffect("openducktor://workspace-session-updated", (event) => {
      if (isBrowserSseControlEvent(event)) {
        listener(event);
      } else if (event.channel === "openducktor://workspace-session-updated") {
        listener(event.payload);
      }
    }),
  );
  return subscription.unsubscribe;
};

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

type PendingTranscriptRepair = {
  repoPath: string;
  losses: Array<HostReplayLoss | null>;
  closed: boolean;
};
const pendingTranscriptRepairs = new Set<PendingTranscriptRepair>();

export const observeLocalHostAgentSessions = async (
  input: AgentSessionLiveRefreshInput,
  listener: (envelope: AgentSessionLiveEnvelope) => void,
): Promise<() => void> => {
  return runWebBoundary(
    Effect.gen(function* () {
      const client = createLocalHostClient();
      const inherited = [...pendingTranscriptRepairs].filter(
        (owner) => owner.closed && owner.repoPath === input.repoPath,
      );
      const repairOwner: PendingTranscriptRepair = {
        repoPath: input.repoPath,
        losses: [],
        closed: false,
      };
      let refreshTail = Promise.resolve();
      let refreshQueued = false;
      let waitingForReplay = false;
      let pendingBaseline: AgentSessionLiveBaseline | null = null;
      let initialAttachmentSuperseded = false;
      const attachment = createAgentSessionLiveAttachment(input.repoPath, listener);
      const installBaseline = (baseline: AgentSessionLiveBaseline): void => {
        if (baseline.cursor.hostEpoch !== sseChannel?.readTransportEpoch())
          throw new Error(
            "The host changed during attachment. Reconnect to the configured host to restore observation.",
          );
        attachment.install(baseline);
        // Baseline faults do not keep a delivered gap pending.
        pendingTranscriptRepairs.delete(repairOwner);
        repairOwner.losses = [];
        for (const owner of inherited) pendingTranscriptRepairs.delete(owner);
      };
      const reportRefreshFailure = (cause: unknown): void => {
        if (!repairOwner.closed)
          listener({
            type: "fault",
            repoPath: input.repoPath,
            operation: "agent-session-live.refresh",
            message: errorMessage(cause),
          });
      };
      const installPendingBaseline = (): void => {
        if (repairOwner.closed || waitingForReplay || refreshQueued || !pendingBaseline) return;
        const baseline = pendingBaseline;
        pendingBaseline = null;
        installBaseline(baseline);
      };
      const refresh = (): void => {
        initialAttachmentSuperseded = true;
        attachment.restart();
        pendingBaseline = null;
        // Losses from one replay boundary share the queued recovery read.
        if (refreshQueued) return;
        refreshQueued = true;
        refreshTail = refreshTail
          .then(async () => {
            refreshQueued = false;
            if (!repairOwner.closed) {
              attachment.restart();
              const baseline = await client.agentSessionLiveRecover(input);
              // Keep replay buffered when a later loss requires another baseline.
              if (!repairOwner.closed && !refreshQueued) {
                pendingBaseline = baseline;
                installPendingBaseline();
              }
            }
          })
          .catch(reportRefreshFailure);
      };
      const recoverLoss = (loss: HostReplayLoss | null): void => {
        if (loss?.repoPath && loss.repoPath !== input.repoPath) return;
        if (!loss || loss.facet === "transcript") {
          repairOwner.losses.push(loss);
          pendingTranscriptRepairs.add(repairOwner);
        }
        if ((!loss || loss.facet === "transcript") && sseChannel?.readReplayPending())
          waitingForReplay = true;
        refresh();
        if (!loss || loss.facet === "transcript") {
          const gap: Extract<AgentSessionLiveEnvelope, { type: "transcript_gap" }> = {
            type: "transcript_gap",
            repoPath: input.repoPath,
            message: "Transcript events were lost. Reload affected conversation history.",
          };
          if (loss?.refs) gap.refs = loss.refs;
          attachment.accept(gap);
        }
      };
      const subscription = yield* subscribeReadyLocalHostEventsEffect(
        AGENT_SESSION_LIVE_EVENT_CHANNEL,
        (event) => {
          if (isBrowserSseControlEvent(event)) {
            if (event.replayFailure && event.kind === BROWSER_LIVE_STREAM_WARNING_EVENT_KIND) {
              repairOwner.losses.push(null);
              pendingTranscriptRepairs.add(repairOwner);
              repairOwner.closed = true;
              listener({
                type: "transcript_gap",
                repoPath: input.repoPath,
                replayPending: true,
                message: event.message ?? "Invalid host replay. Reload the browser to reconnect.",
              });
              listener({
                type: "fault",
                repoPath: input.repoPath,
                operation: "agent-session-live.replay",
                message: event.message ?? "Invalid host replay. Reload the browser to reconnect.",
              });
            }
            if (event.kind === BROWSER_LIVE_RECONNECTED_EVENT_KIND) {
              listener({ type: "connection_state", repoPath: input.repoPath, state: "ready" });
            } else {
              listener({
                type: "connection_state",
                repoPath: input.repoPath,
                state: "uncertain",
                message: event.message ?? "Host connection interrupted. Reconnect to the host.",
              });
            }
            return;
          }
          if (event.channel === AGENT_SESSION_LIVE_EVENT_CHANNEL) {
            attachment.accept(event.payload);
          }
        },
        recoverLoss,
        liveSessionStreamEventName(input.repoPath),
        () => {
          waitingForReplay = false;
          try {
            installPendingBaseline();
          } catch (cause) {
            reportRefreshFailure(cause);
          }
        },
      ).pipe(
        Effect.onError(() =>
          Effect.sync(() => {
            repairOwner.closed = true;
          }),
        ),
      );
      for (const owner of inherited)
        for (const loss of owner.losses)
          if (
            !repairOwner.losses.some((pending) => JSON.stringify(pending) === JSON.stringify(loss))
          )
            recoverLoss(loss);
      const initialRefreshExit = yield* Effect.exit(
        Effect.tryPromise({
          try: async () => {
            const baseline = await client.agentSessionLiveAttach(input);
            // A later recovery owns attachment and its buffered replay.
            if (!initialAttachmentSuperseded) installBaseline(baseline);
          },
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
        repairOwner.closed = true;
        subscription.unsubscribe();
        return yield* causeToWebBoundaryError(initialRefreshExit.cause);
      }
      return () => {
        repairOwner.closed = true;
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
