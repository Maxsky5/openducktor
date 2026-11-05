import type { HostErrorResponse } from "@openducktor/contracts";
import { createLocalHostConnection } from "@openducktor/frontend-core/connection/local-host-connection";
import { HostInvokeError, type HostClient } from "@openducktor/host-client";
import { HostChannelRequestError } from "@openducktor/host-client/channel";
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

type LocalHostRequestErrorInput = {
  message: string;
  status: number;
  cause?: HostErrorResponse;
  failureKind?: string;
};

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

/** Sets the app session cookie. `signal` aborts the request and releases its connection. */
export const ensureLocalHostSessionEffect = (signal?: AbortSignal): Effect.Effect<void, WebError> =>
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

const channelSocketUrl = (backendUrl: string): string => {
  const url = new URL(`${backendUrl.replace(/\/$/, "")}/${HOST_CHANNEL_PATH}`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
};

/** The web error of a failed channel request. */
const localChannelError = (
  cause: unknown,
  operation: string,
): WebError | HostInvokeError | WebHostRequestError => {
  if (cause instanceof HostChannelRequestError) {
    const { error } = cause;
    if (error.kind === "host") {
      if (error.response.failure) return new HostInvokeError(cause.message, error.response.failure);
      const input: LocalHostRequestErrorInput = {
        message: cause.message,
        status: 500,
        cause: error.response,
      };
      if (error.response.failureKind) input.failureKind = error.response.failureKind;
      return new WebHostRequestError(input);
    }
    return new WebHostRequestError({
      message: cause.message,
      status: error.kind === "refused" ? 503 : 500,
    });
  }
  if (isWebError(cause) || cause instanceof HostInvokeError) return cause;
  return new WebDependencyError({
    dependency: "local-web-host",
    operation,
    message: errorMessage(cause),
    cause,
  });
};

/** The host channel of this tab. The session cookie authorizes its socket. */
const connection = createLocalHostConnection({
  // The channel setup deadline aborts `signal`, so a stalled session request ends with it.
  prepare: async (signal) => {
    await ensureLocalHostSession(signal);
    return {
      url: channelSocketUrl(await runWebBoundary(getBrowserBackendUrlEffect())),
      token: null,
    };
  },
  openSocket: (url, protocols, signal, onFrame, onClose) =>
    openWebSocket((offered) => new WebSocket(url, offered), protocols, signal, onFrame, onClose),
  mapError: localChannelError,
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
