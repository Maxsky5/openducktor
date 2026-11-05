import { createLocalHostConnection } from "@openducktor/frontend-core/connection/local-host-connection";
import type { HostClient } from "@openducktor/host-client";
import { openWebSocket } from "@openducktor/host-client/remote/socket";
import { Effect } from "effect";
import { getBrowserAuthTokenEffect, getBrowserBackendUrlEffect } from "./browser-config";
import {
  errorMessage,
  isWebError,
  runWebBoundary,
  WebDependencyError,
  type WebError,
  WebHostRequestError,
} from "@openducktor/remote-host/effect/web-errors";
import { readLocalHostErrorPayloadEffect } from "./local-host-errors";

const HOST_CHANNEL_PATH = "channel";
export const APP_TOKEN_HEADER = "x-openducktor-app-token";
const SESSION_PATH = "session";
const SESSION_TIMEOUT_MS = 10_000;

const localHostRequestErrorEffect = (
  response: Response,
): Effect.Effect<never, WebDependencyError | WebHostRequestError> =>
  Effect.gen(function* () {
    const { message, payload } = yield* readLocalHostErrorPayloadEffect(response);
    return yield* new WebHostRequestError({
      message,
      status: response.status,
      cause: payload ?? undefined,
    });
  });

/** Sets the app session cookie. `signal` aborts the request and releases its connection. */
const ensureLocalHostSessionEffect = (signal?: AbortSignal): Effect.Effect<void, WebError> =>
  Effect.gen(function* () {
    const baseUrl = (yield* getBrowserBackendUrlEffect()).replace(/\/$/, "");
    const appToken = yield* getBrowserAuthTokenEffect();
    const init: RequestInit = {
      method: "POST",
      credentials: "include",
      headers: {
        [APP_TOKEN_HEADER]: appToken,
      },
    };
    if (signal) init.signal = signal;
    const response = yield* Effect.tryPromise({
      try: () => fetch(`${baseUrl}/${SESSION_PATH}`, init),
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

/** One session request that every waiting caller shares. */
type SessionAttempt = {
  promise: Promise<void>;
  abort: AbortController;
  /** The callers that wait with a signal. */
  waiters: number;
  /** A caller without a signal needs the request to finish. */
  pinned: boolean;
};

let sessionAttempt: SessionAttempt | null = null;
let sessionReady = false;

const startSessionAttempt = (): SessionAttempt => {
  const abort = new AbortController();
  // A stalled request ends at the deadline, so a later attempt can start.
  const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(SESSION_TIMEOUT_MS)]);
  const attempt: SessionAttempt = {
    promise: runWebBoundary(ensureLocalHostSessionEffect(signal)),
    abort,
    waiters: 0,
    pinned: false,
  };
  attempt.promise.then(
    () => {
      sessionReady = true;
      if (sessionAttempt === attempt) sessionAttempt = null;
    },
    () => {
      if (sessionAttempt === attempt) sessionAttempt = null;
    },
  );
  return attempt;
};

/**
 * Sets the app session cookie once for this page. Callers share one request. When every caller
 * that waits with a signal stops waiting, and no caller without a signal waits, the request aborts
 * and a later call starts a new one.
 */
export const ensureLocalHostSession = (signal?: AbortSignal): Promise<void> => {
  if (sessionReady) return Promise.resolve();
  signal?.throwIfAborted();
  sessionAttempt ??= startSessionAttempt();
  const attempt = sessionAttempt;
  if (!signal) {
    attempt.pinned = true;
    return attempt.promise;
  }
  attempt.waiters += 1;
  return new Promise<void>((resolve, reject) => {
    const leave = () => {
      signal.removeEventListener("abort", stop);
      attempt.waiters -= 1;
    };
    const stop = () => {
      leave();
      reject(signal.reason);
      if (attempt.waiters > 0 || attempt.pinned) return;
      if (sessionAttempt === attempt) sessionAttempt = null;
      attempt.abort.abort(signal.reason);
    };
    signal.addEventListener("abort", stop, { once: true });
    attempt.promise.then(
      () => {
        leave();
        resolve();
      },
      (cause: unknown) => {
        leave();
        reject(cause);
      },
    );
  });
};

export const ensureLocalHostSessionDedupedEffect = (): Effect.Effect<void, WebError> =>
  Effect.tryPromise({
    // Fiber interruption aborts `signal`, so the caller stops holding the shared request.
    try: (signal) => ensureLocalHostSession(signal),
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

/** The WebSocket URL of a backend socket route, such as `channel` or `terminal`. */
export const hostSocketUrl = (backendUrl: string, route: string): string => {
  const url = new URL(backendUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${route}`;
  url.search = "";
  url.hash = "";
  return url.href;
};

/** The host channel of this tab. The session cookie authorizes its socket. */
const connection = createLocalHostConnection({
  // The channel setup deadline aborts `signal`, so a stalled session request ends with it.
  prepare: async (signal) => {
    await ensureLocalHostSession(signal);
    return {
      url: hostSocketUrl(await runWebBoundary(getBrowserBackendUrlEffect()), HOST_CHANNEL_PATH),
      token: null,
    };
  },
  openSocket: (url, protocols, signal, onFrame, onClose) =>
    openWebSocket((offered) => new WebSocket(url, offered), protocols, signal, onFrame, onClose),
});

export const createLocalHostClient = (): HostClient => connection.client;
export const subscribeLocalHostRunEvents = connection.subscribeRunEvents;
export const subscribeLocalHostAzureDevOpsConnectionUpdates =
  connection.subscribeAzureDevOpsConnectionUpdates;
export const subscribeLocalHostWorkspaceProviderSetupUpdates =
  connection.subscribeWorkspaceProviderSetupUpdates;
export const subscribeLocalHostWorkspaceSessionUpdates =
  connection.subscribeWorkspaceSessionUpdates;
export const subscribeLocalHostStartupProgress = connection.subscribeStartupProgress;
export const subscribeLocalHostRuntimeChanges = connection.subscribeRuntimeChanges;
export const subscribeLocalHostTaskMergeStatusUpdates = connection.subscribeTaskMergeStatusUpdates;
export const subscribeLocalHostBrowserTabEvents = connection.subscribeBrowserTabEvents;
export const observeLocalHostAgentSessions = connection.observeAgentSessionLive;
export const subscribeLocalHostTaskStream = connection.subscribeTaskStream;
export const subscribeLocalHostNotificationStream = connection.subscribeNotificationStream;
/** Delivers the live remote access state of the local operator. */
export const observeLocalHostRemoteAccess = connection.observeRemoteAccess;

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
