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

type LocalHostRequestErrorInput = {
  message: string;
  status: number;
  cause?: HostErrorResponse;
  failureKind?: string;
};

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
  prepare: async () => {
    await ensureLocalHostSession();
    return {
      url: channelSocketUrl(await runWebBoundary(getBrowserBackendUrlEffect())),
      token: null,
    };
  },
  openSocket: (url, protocols, signal, onFrame, onClose) =>
    openWebSocket((offered) => new WebSocket(url, offered), protocols, signal, onFrame, onClose),
  mapError: localChannelError,
  beforeSubscribe: ensureLocalHostSession,
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
