import {
  BROWSER_LIVE_RECONNECTED_EVENT_KIND,
  BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
} from "@openducktor/frontend/lib/browser-live/constants";
import { browserLiveControlEvent } from "@openducktor/frontend/lib/browser-live-control-events";
import { createHostClient, type HostClient } from "@openducktor/host-client";
import { Effect } from "effect";
import { getBrowserAuthTokenEffect, getBrowserBackendUrlEffect } from "./browser-config";
import {
  errorMessage,
  isWebError,
  runWebBoundary,
  WebDependencyError,
  type WebError,
  WebHostRequestError,
} from "./effect/web-errors";
import { readLocalHostErrorPayloadEffect } from "./local-host-errors";

type BrowserSseListener = (payload: unknown) => void;

const CONTROL_EVENT_SSE_PATHS = new Set(["dev-server-events", "task-events"]);
const APP_TOKEN_HEADER = "x-openducktor-app-token";
const SESSION_PATH = "session";

type BrowserSseChannel = {
  eventSource: EventSource;
  listeners: Map<number, BrowserSseListener>;
  ready: Promise<void>;
  handleMessage: (event: MessageEvent<string>) => void;
  handleOpen: () => void;
  handleStreamWarning: (event: MessageEvent<string>) => void;
};

type BrowserSseSubscription = {
  ready: Promise<void>;
  unsubscribe: () => void;
};

const sseChannels = new Map<string, BrowserSseChannel>();
let nextSseListenerId = 0;
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

const parseSsePayload = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const closeSseChannelIfUnused = (path: string, channel: BrowserSseChannel): void => {
  if (channel.listeners.size > 0) {
    return;
  }
  channel.eventSource.removeEventListener("message", channel.handleMessage as EventListener);
  channel.eventSource.removeEventListener("open", channel.handleOpen as EventListener);
  channel.eventSource.removeEventListener(
    "stream-warning",
    channel.handleStreamWarning as EventListener,
  );
  channel.eventSource.close();
  sseChannels.delete(path);
};

const subscribeSseChannelEffect = (
  path: string,
  listener: BrowserSseListener,
): Effect.Effect<BrowserSseSubscription, WebError> =>
  Effect.gen(function* () {
    const baseUrl = (yield* getBrowserBackendUrlEffect()).replace(/\/$/, "");
    let channel = sseChannels.get(path);

    if (!channel) {
      const eventSource = yield* Effect.try({
        try: () => new EventSource(`${baseUrl}/${path}`, { withCredentials: true }),
        catch: (cause) =>
          new WebDependencyError({
            dependency: "event-source",
            operation: "subscribe",
            message: errorMessage(cause),
            cause,
            details: { path },
          }),
      });
      const listeners = new Map<number, BrowserSseListener>();
      const shouldEmitControlEvents = CONTROL_EVENT_SSE_PATHS.has(path);
      let hasOpened = false;
      let resolveReady: () => void = () => {};
      const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
      const handleMessage = (event: MessageEvent<string>): void => {
        const payload = parseSsePayload(event.data);
        for (const currentListener of listeners.values()) {
          currentListener(payload);
        }
      };
      const handleOpen = (): void => {
        if (!hasOpened) {
          hasOpened = true;
          resolveReady();
          return;
        }
        if (!shouldEmitControlEvents) {
          return;
        }
        for (const currentListener of listeners.values()) {
          currentListener(browserLiveControlEvent(BROWSER_LIVE_RECONNECTED_EVENT_KIND));
        }
      };
      const handleStreamWarning = (event: MessageEvent<string>): void => {
        if (!shouldEmitControlEvents) {
          return;
        }
        for (const currentListener of listeners.values()) {
          currentListener(
            browserLiveControlEvent(BROWSER_LIVE_STREAM_WARNING_EVENT_KIND, event.data),
          );
        }
      };

      eventSource.addEventListener("message", handleMessage as EventListener);
      eventSource.addEventListener("open", handleOpen as EventListener);
      eventSource.addEventListener("stream-warning", handleStreamWarning as EventListener);
      channel = {
        eventSource,
        listeners,
        ready,
        handleMessage,
        handleOpen,
        handleStreamWarning,
      };
      sseChannels.set(path, channel);
    }

    const listenerId = nextSseListenerId;
    nextSseListenerId += 1;
    channel.listeners.set(listenerId, listener);

    return {
      ready: channel.ready,
      unsubscribe: () => {
        const currentChannel = sseChannels.get(path);
        if (!currentChannel) {
          return;
        }
        currentChannel.listeners.delete(listenerId);
        closeSseChannelIfUnused(path, currentChannel);
      },
    };
  });

export const subscribeLocalHostRunEvents = async (
  listener: (payload: unknown) => void,
): Promise<() => void> => {
  return runWebBoundary(
    Effect.gen(function* () {
      yield* ensureLocalHostSessionDedupedEffect();
      return (yield* subscribeSseChannelEffect("events", listener)).unsubscribe;
    }),
  );
};

export const subscribeLocalHostDevServerEvents = async (
  listener: (payload: unknown) => void,
): Promise<() => void> => {
  return runWebBoundary(
    Effect.gen(function* () {
      yield* ensureLocalHostSessionDedupedEffect();
      const subscription = yield* subscribeSseChannelEffect("dev-server-events", listener);
      yield* Effect.tryPromise({
        try: () => subscription.ready,
        catch: (cause) =>
          new WebDependencyError({
            dependency: "event-source",
            operation: "await-ready",
            message: errorMessage(cause),
            cause,
            details: { path: "dev-server-events" },
          }),
      });
      return subscription.unsubscribe;
    }),
  );
};

export const subscribeLocalHostTaskEvents = async (
  listener: (payload: unknown) => void,
): Promise<() => void> => {
  return runWebBoundary(
    Effect.gen(function* () {
      yield* ensureLocalHostSessionDedupedEffect();
      return (yield* subscribeSseChannelEffect("task-events", listener)).unsubscribe;
    }),
  );
};

export const subscribeLocalHostCodexAppServerEvents = async (
  listener: (payload: unknown) => void,
): Promise<() => void> => {
  return runWebBoundary(
    Effect.gen(function* () {
      yield* ensureLocalHostSessionDedupedEffect();
      return (yield* subscribeSseChannelEffect("codex-app-server-events", listener)).unsubscribe;
    }),
  );
};

export const buildLocalAttachmentPreviewUrl = (browserBackendUrl: string, path: string): string => {
  const baseUrl = browserBackendUrl.replace(/\/$/, "");
  const query = new URLSearchParams({ path });
  return `${baseUrl}/local-attachment-preview?${query.toString()}`;
};
