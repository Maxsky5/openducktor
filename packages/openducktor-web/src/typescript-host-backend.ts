import { gitProviderFetch } from "./system-trust-store";
import { createHostCommandLifetime } from "@openducktor/remote-host/host-command-lifetime";
import {
  createRemoteAccessController,
  createRemoteAccessOperator,
  type RemoteAccessController,
  type RemoteAccessOperator,
} from "@openducktor/remote-host";
import { handleRemoteAccessHttp } from "./remote-access-http";
import webPackage from "../package.json";
import { localAttachmentPreviewResponse } from "@openducktor/remote-host/local-attachment-preview";
import {
  type HostCommandInputRecord,
  type HostErrorResponse,
  type HostInvokeFailure,
  hostErrorResponseSchema,
  hostInvokeFailureSchema,
} from "@openducktor/contracts";
import {
  createFilesystemRemoteApprovalStore,
  remoteHostOwnerFromEnvironment,
  resolveOpenDucktorBaseDir,
  createLocalAttachmentAdapter,
  createNodeEffectHostCommandRouter,
  type EffectHostCommandRouter,
  type EffectNodeHostCommandRouter,
  type HostRuntimeDistribution,
  type McpBridgeDiscoveryMode,
  type OpenDucktorConfigDirScope,
  resolveDevelopmentInstanceIdFromEnvironment,
  type TaskAssetReadService,
  type ToolDiscoveryId,
} from "@openducktor/host";
import { createChromeForTestingBrowserEngine } from "@openducktor/host/chrome-for-testing";
import { createNodePtyPort } from "@openducktor/host/node-pty";
import { Cause, Effect } from "effect";
import { z } from "zod";
import {
  causeToWebBoundaryError,
  errorMessage,
  runWebBoundary,
  toWebOperationError,
  WebHostRequestError,
  WebOperationError,
} from "@openducktor/remote-host/effect/web-errors";
import {
  type BrowserPreviewProxies,
  createBrowserPreviewProxies,
} from "./browser-tabs/browser-preview-proxy";
import { checkSiteFraming } from "./browser-tabs/browser-frame-check";
import { routeBrowserFrameHttpRequest } from "./browser-tabs/browser-frame-routes";
import { type WebLogger, writeWebLogEffect } from "./logger";
import {
  startNodeFetchServer,
  type NodeFetchServer,
} from "@openducktor/remote-host/node-fetch-server";
import { allowedHostnamesFor, isRequestHostAllowed } from "@openducktor/remote-host/http-origin";
import { routeTaskAssetHttpRequest } from "@openducktor/remote-host/task-asset-http-server";
import { createTaskEventLeaseManager } from "@openducktor/remote-host/task-event-leases";
import {
  createHostChannelSocketData,
  hostCommandFailure,
  type HostChannelReply,
  type HostChannelSocketData,
} from "@openducktor/remote-host/host-channel";
import {
  HOST_SOCKET_PROTOCOLS,
  hostWebSocketHandler,
  type HostWebSocketData,
} from "@openducktor/remote-host/host-websocket-handler";
import { createSocketData } from "@openducktor/remote-host/terminals/terminal-websocket-handler";

import { BufferedHostEventBus } from "@openducktor/remote-host/host-event-bus";
import { allowedFrontendOrigins, validateFrontendOriginEffect } from "./frontend-origin";
import { stopHostBackend } from "./host-backend-lifecycle";

export type TypescriptHostBackendOptions = {
  port: number;
  deferRemoteStartup?: boolean;
  frontendOrigin: string;
  remoteFrontendOrigin?: string;
  frontendPort?: number;
  controlToken: string;
  appToken: string;
  host?: string;
  basePath?: string;
  logger: WebLogger;
  configDirScope: OpenDucktorConfigDirScope;
  mcpBridgeDiscoveryMode: McpBridgeDiscoveryMode;
  onBackgroundFailure(cause: unknown): void;
  processEnv?: NodeJS.ProcessEnv;
  runtimeDistribution: HostRuntimeDistribution;
  providedToolPaths?: Partial<Record<ToolDiscoveryId, string>>;
};

type HostErrorPayloadInput = {
  error: string;
  message: string;
  failureKind?: string;
  failure?: HostInvokeFailure;
};

const scheduleNonFatalWebEventFailure = (
  logger: WebLogger,
  message: string,
  cause: unknown,
): void => {
  void runWebBoundary(
    writeWebLogEffect(logger, "error", `${message} ${errorMessage(cause)}`),
  ).catch((cause: unknown) => {
    console.error(
      `OpenDucktor web non-fatal event delivery reporting failed: ${errorMessage(cause)}`,
    );
  });
};

export type TypescriptHostBackend = {
  exited: Promise<number>;
  port: number;
  stop(): Promise<void>;
  remoteAccess: RemoteAccessController;
};

type TypescriptHostBackendServer = NodeFetchServer<HostWebSocketData>;

const LOCALHOST = "127.0.0.1";
const CONTROL_TOKEN_HEADER = "x-openducktor-control-token";
const APP_TOKEN_HEADER = "x-openducktor-app-token";
const APP_SESSION_COOKIE_NAME = "openducktor_web_session";
const HOST_IDLE_TIMEOUT_SECONDS = 0;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const SHUTDOWN_MESSAGE = "Browser backend is shutting down and is no longer accepting new work.";

export const resolveAppSessionCookieName = (
  mcpBridgeDiscoveryMode: McpBridgeDiscoveryMode,
  processEnv: NodeJS.ProcessEnv = process.env,
): string =>
  mcpBridgeDiscoveryMode === "development"
    ? `${APP_SESSION_COOKIE_NAME}_${resolveDevelopmentInstanceIdFromEnvironment(processEnv)}`
    : APP_SESSION_COOKIE_NAME;

type SocketUpgradeResult = { handled: false } | { handled: true; response: Response | undefined };

/** Upgrades a terminal or host channel socket of the local frontend. */
const tryUpgradeHostWebSocket = ({
  allowedOrigins,
  appSessionCookieName,
  appToken,
  createChannel,
  hostCommandRouter,
  logger,
  onBackgroundFailure,
  path,
  request,
  server,
  shutdownStarted,
}: {
  allowedOrigins: Set<string>;
  appSessionCookieName: string;
  appToken: string;
  createChannel(): HostChannelSocketData;
  hostCommandRouter: EffectNodeHostCommandRouter;
  logger: WebLogger;
  onBackgroundFailure(cause: unknown): void;
  path: string;
  request: Request;
  server: TypescriptHostBackendServer;
  shutdownStarted: boolean;
}): SocketUpgradeResult => {
  const protocol = HOST_SOCKET_PROTOCOLS.get(path);
  if (protocol === undefined) return { handled: false };
  const reject = (message: string, status: number): SocketUpgradeResult => ({
    handled: true,
    response: new Response(message, { status }),
  });
  if (shutdownStarted) return reject("Host is shutting down.", 503);
  const origin = request.headers.get("origin")?.trim();
  if (!origin || !allowedOrigins.has(origin)) return reject("Socket origin is not allowed.", 403);
  if (readCookie(request, appSessionCookieName) !== appToken)
    return reject("Socket session is unauthorized.", 401);
  if (request.headers.get("sec-websocket-protocol")?.trim() !== protocol)
    return reject("Socket protocol version is unsupported.", 426);
  const upgraded = server.upgrade({
    data:
      path === "/channel"
        ? createChannel()
        : createSocketData({
            connectionId: globalThis.crypto.randomUUID(),
            terminalService: hostCommandRouter.terminalService,
            logger,
            onBackgroundFailure,
          }),
  });
  return {
    handled: true,
    response: upgraded ? undefined : new Response("WebSocket upgrade failed.", { status: 500 }),
  };
};

const jsonResponseBody = <const Payload>(payload: Payload): string => {
  const serialized = JSON.stringify(payload);
  return serialized === undefined ? "null" : serialized;
};

const jsonResponse = <const Payload>(
  payload: Payload,
  init: ResponseInit = {},
  corsHeaders?: HeadersInit,
): Response =>
  new Response(jsonResponseBody(payload), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...corsHeaders,
      ...init.headers,
    },
  });

const hostErrorPayload = (
  message: string,
  failureKind?: string,
  failure?: HostInvokeFailure,
): HostErrorResponse => {
  const payload: HostErrorPayloadInput = { error: message, message };
  if (failureKind) {
    payload.failureKind = failureKind;
  }
  if (failure) {
    payload.failure = failure;
  }
  return hostErrorResponseSchema.parse(payload);
};

const errorResponse = (
  message: string,
  status: number,
  corsHeaders?: HeadersInit,
  failureKind?: string,
  failure?: HostInvokeFailure,
): Response =>
  jsonResponse(hostErrorPayload(message, failureKind, failure), { status }, corsHeaders);

const corsHeadersForRequest = (
  request: Request,
  allowedOrigins: Set<string>,
): HeadersInit | Response => {
  const origin = request.headers.get("origin");
  if (!origin) {
    return {};
  }
  if (!allowedOrigins.has(origin)) {
    return errorResponse("Browser backend request origin is not allowed.", 403);
  }
  return {
    "access-control-allow-credentials": "true",
    "access-control-allow-origin": origin,
    vary: "Origin",
  };
};

const preflightResponse = (request: Request, allowedOrigins: Set<string>): Response => {
  const corsHeaders = corsHeadersForRequest(request, allowedOrigins);
  if (corsHeaders instanceof Response) {
    return corsHeaders;
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders,
      "access-control-allow-headers": ["content-type", CONTROL_TOKEN_HEADER, APP_TOKEN_HEADER].join(
        ", ",
      ),
      "access-control-allow-methods": "DELETE, GET, POST, OPTIONS",
      "access-control-max-age": "600",
    },
  });
};

const webHostRequestDetailsSchema = z.object({
  hostInvokeFailure: hostInvokeFailureSchema.optional(),
});

/**
 * Runs a command of the local frontend and returns its result or its host error payload. A defect
 * fails only this command, not the channel of the tab.
 */
export const invokeLocalHostCommand = async (
  hostCommandRouter: EffectHostCommandRouter,
  command: string,
  args: HostCommandInputRecord,
  /** Interrupts the command. The channel aborts it only for a cancelled host read. */
  signal?: AbortSignal,
): Promise<HostChannelReply> => {
  try {
    return { result: await Effect.runPromise(hostCommandRouter.invoke(command, args), { signal }) };
  } catch (cause) {
    return hostCommandFailure(cause);
  }
};

const validateExpectedToken = (
  receivedToken: string | null,
  expectedToken: string,
  missingMessage: string,
  invalidMessage: string,
): Effect.Effect<void, WebHostRequestError> => {
  if (receivedToken === null) {
    return Effect.fail(new WebHostRequestError({ message: missingMessage, status: 401 }));
  }
  if (receivedToken !== expectedToken) {
    return Effect.fail(new WebHostRequestError({ message: invalidMessage, status: 403 }));
  }
  return Effect.void;
};

const readCookie = (request: Request, name: string): string | null => {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }
  for (const part of cookieHeader.split(";")) {
    const [cookieName, ...valueParts] = part.trim().split("=");
    if (cookieName === name && valueParts.length > 0) {
      const value = valueParts.join("=");
      return value.length > 0 ? value : null;
    }
  }
  return null;
};

const validateControlToken = (
  request: Request,
  expectedToken: string,
): Effect.Effect<void, WebHostRequestError> =>
  validateExpectedToken(
    request.headers.get(CONTROL_TOKEN_HEADER),
    expectedToken,
    "Missing OpenDucktor web host control token.",
    "Invalid OpenDucktor web host control token.",
  );

const validateAppTokenHeader = (
  request: Request,
  expectedToken: string,
): Effect.Effect<void, WebHostRequestError> =>
  validateExpectedToken(
    request.headers.get(APP_TOKEN_HEADER),
    expectedToken,
    "Missing OpenDucktor web host app token.",
    "Invalid OpenDucktor web host app token.",
  );

const validateAppSessionCookie = (
  request: Request,
  expectedToken: string,
  appSessionCookieName: string,
): Effect.Effect<void, WebHostRequestError> =>
  validateExpectedToken(
    readCookie(request, appSessionCookieName),
    expectedToken,
    "Missing OpenDucktor web host app token.",
    "Invalid OpenDucktor web host app token.",
  );

const validateAppCookieOrHeader = (
  request: Request,
  expectedToken: string,
  appSessionCookieName: string,
): Effect.Effect<void, WebHostRequestError> =>
  validateExpectedToken(
    readCookie(request, appSessionCookieName) ?? request.headers.get(APP_TOKEN_HEADER),
    expectedToken,
    "Missing OpenDucktor web host app token.",
    "Invalid OpenDucktor web host app token.",
  );

const rejectWebHostRequest = (
  message: string,
  status: number,
  failureKind?: string,
): Effect.Effect<never, WebHostRequestError> =>
  Effect.fail(
    new WebHostRequestError(failureKind ? { failureKind, message, status } : { message, status }),
  );
const webHostRequestErrorResponse = (
  error: WebHostRequestError,
  corsHeaders: HeadersInit,
): Response => {
  const { hostInvokeFailure } = webHostRequestDetailsSchema.parse(error.details ?? {});
  return errorResponse(
    error.message,
    error.status,
    corsHeaders,
    error.failureKind,
    hostInvokeFailure,
  );
};
const routeCorsRequest = ({
  appSessionCookieName,
  appToken,
  browserPreviews,
  controlToken,
  corsHeaders,
  taskAssetReadService,
  localAttachments,
  logger,
  request,
  remoteAccess,
  sessionCookieSecure,
  shutdownStarted,
  beginShutdown,
  stop,
}: {
  appSessionCookieName: string;
  appToken: string;
  browserPreviews: BrowserPreviewProxies;
  controlToken: string;
  corsHeaders: HeadersInit;
  taskAssetReadService: TaskAssetReadService;
  localAttachments: ReturnType<typeof createLocalAttachmentAdapter>;
  logger: WebLogger;
  request: Request;
  remoteAccess?: RemoteAccessOperator;
  sessionCookieSecure: boolean;
  shutdownStarted: boolean;
  beginShutdown: () => void;
  stop: () => Promise<void>;
}): Effect.Effect<Response, WebHostRequestError> =>
  Effect.gen(function* () {
    const requestUrl = new URL(request.url);

    if (requestUrl.pathname === "/health" && request.method === "GET") {
      return jsonResponse({ ok: true }, undefined, corsHeaders);
    }

    if (requestUrl.pathname === "/session" && request.method === "POST") {
      yield* validateAppTokenHeader(request, appToken);
      const sessionCookieAttributes = [
        `${appSessionCookieName}=${appToken}`,
        "HttpOnly",
        "SameSite=Strict",
        "Path=/",
      ];
      if (sessionCookieSecure) {
        sessionCookieAttributes.push("Secure");
      }
      return jsonResponse(
        { ok: true },
        {
          headers: {
            "set-cookie": sessionCookieAttributes.join("; "),
          },
        },
        corsHeaders,
      );
    }

    if (requestUrl.pathname === "/shutdown" && request.method === "POST") {
      yield* validateControlToken(request, controlToken);
      yield* Effect.sync(() => {
        beginShutdown();
        setTimeout(() => {
          void stop().catch((cause: unknown) => {
            void runWebBoundary(writeWebLogEffect(logger, "error", errorMessage(cause))).catch(
              (cause: unknown) => {
                console.error(errorMessage(cause));
                process.exitCode = 1;
              },
            );
          });
        }, 10);
      });
      return jsonResponse({ ok: true }, { status: 202 }, corsHeaders);
    }

    if (remoteAccess && requestUrl.pathname.startsWith("/remote-access")) {
      yield* validateAppCookieOrHeader(request, appToken, appSessionCookieName);
      if (shutdownStarted) {
        return yield* rejectWebHostRequest("The host is shutting down. Reopen OpenDucktor.", 503);
      }
      const response = yield* Effect.tryPromise({
        try: () => handleRemoteAccessHttp(request, remoteAccess),
        catch: (cause) =>
          new WebHostRequestError({
            message: errorMessage(cause),
            status: cause instanceof z.ZodError || cause instanceof SyntaxError ? 400 : 500,
            cause,
          }),
      });
      new Headers(corsHeaders).forEach((value, name) => response.headers.set(name, value));
      return response;
    }

    if (requestUrl.pathname === "/local-attachment-preview" && request.method === "GET") {
      yield* validateAppSessionCookie(request, appToken, appSessionCookieName);
      return yield* localAttachmentPreviewResponse(request, localAttachments, corsHeaders);
    }

    const taskAssetResponse = yield* routeTaskAssetHttpRequest({
      appToken,
      corsHeaders,
      request,
      taskAssetReadService,
      validateAppSessionCookie: (sessionRequest, expectedToken) =>
        validateAppSessionCookie(sessionRequest, expectedToken, appSessionCookieName),
    });
    if (taskAssetResponse) {
      return taskAssetResponse;
    }

    const browserFrameResponse = yield* routeBrowserFrameHttpRequest({
      appToken,
      corsHeaders,
      previews: browserPreviews,
      checkSiteFraming: (input) => checkSiteFraming({ ...input, fetch }),
      request,
      validateAppTokenHeader,
    });
    if (browserFrameResponse) {
      return browserFrameResponse;
    }

    return yield* rejectWebHostRequest("Not found", 404);
  });

export const handleTypescriptHostBackendRequest = ({
  allowedOrigins,
  appSessionCookieName,
  appToken,
  browserPreviews,
  controlToken,
  taskAssetReadService,
  localAttachments,
  logger,
  request,
  remoteAccess,
  sessionCookieSecure,
  shutdownStarted,
  beginShutdown,
  stop,
}: {
  allowedOrigins: Set<string>;
  appSessionCookieName: string;
  appToken: string;
  browserPreviews: BrowserPreviewProxies;
  controlToken: string;
  taskAssetReadService: TaskAssetReadService;
  localAttachments: ReturnType<typeof createLocalAttachmentAdapter>;
  logger: WebLogger;
  request: Request;
  remoteAccess?: RemoteAccessOperator;
  sessionCookieSecure: boolean;
  shutdownStarted: boolean;
  beginShutdown: () => void;
  stop: () => Promise<void>;
}): Effect.Effect<Response> =>
  Effect.gen(function* () {
    if (request.method === "OPTIONS") {
      return preflightResponse(request, allowedOrigins);
    }

    const corsHeaders = corsHeadersForRequest(request, allowedOrigins);
    if (corsHeaders instanceof Response) {
      return corsHeaders;
    }

    const routeInput: Parameters<typeof routeCorsRequest>[0] = {
      appSessionCookieName,
      appToken,
      browserPreviews,
      controlToken,
      corsHeaders,
      taskAssetReadService,
      localAttachments,
      logger,
      request,
      sessionCookieSecure,
      shutdownStarted,
      beginShutdown,
      stop,
    };
    if (remoteAccess) routeInput.remoteAccess = remoteAccess;
    return yield* routeCorsRequest(routeInput).pipe(
      Effect.catch((error) => Effect.succeed(webHostRequestErrorResponse(error, corsHeaders))),
    );
  });

const stripBasePath = (basePath: string | undefined, requestUrl: string): string => {
  if (!basePath) {
    return requestUrl;
  }
  const parsed = new URL(requestUrl);
  if (parsed.pathname === basePath) {
    parsed.pathname = "/";
    return parsed.toString();
  }
  if (parsed.pathname.startsWith(`${basePath}/`)) {
    parsed.pathname = parsed.pathname.slice(basePath.length);
    return parsed.toString();
  }
  return requestUrl;
};

type HostFetchInput = Omit<Parameters<typeof handleTypescriptHostBackendRequest>[0], "request"> & {
  allowedHostnames: ReadonlySet<string>;
  basePath: string | undefined;
  createChannel(): HostChannelSocketData;
  hostCommandRouter: EffectNodeHostCommandRouter;
  onBackgroundFailure(cause: unknown): void;
  request: Request;
  server: TypescriptHostBackendServer;
};

export const handleHostFetch = (
  input: HostFetchInput,
): Response | Promise<Response> | undefined => {
  const {
    allowedHostnames,
    basePath,
    createChannel,
    hostCommandRouter,
    onBackgroundFailure,
    request,
    server,
    ...backendInput
  } = input;
  if (!isRequestHostAllowed(request, allowedHostnames)) {
    return new Response("Host not allowed.", { status: 403 });
  }
  const routedUrl = stripBasePath(basePath, request.url);
  const socketUpgrade = tryUpgradeHostWebSocket({
    allowedOrigins: backendInput.allowedOrigins,
    appSessionCookieName: backendInput.appSessionCookieName,
    appToken: backendInput.appToken,
    createChannel,
    hostCommandRouter,
    logger: backendInput.logger,
    onBackgroundFailure,
    path: new URL(routedUrl).pathname,
    request,
    server,
    shutdownStarted: backendInput.shutdownStarted,
  });
  if (socketUpgrade.handled) return socketUpgrade.response;
  const routedRequest = routedUrl === request.url ? request : new Request(routedUrl, request);
  return Effect.runPromise(
    handleTypescriptHostBackendRequest({ ...backendInput, request: routedRequest }),
  );
};

export const startTypescriptHostBackendEffect = ({
  port,
  frontendOrigin,
  remoteFrontendOrigin,
  frontendPort,
  controlToken,
  appToken,
  host,
  basePath,
  logger,
  configDirScope,
  mcpBridgeDiscoveryMode,
  onBackgroundFailure,
  processEnv,
  providedToolPaths,
  runtimeDistribution,
  deferRemoteStartup,
}: TypescriptHostBackendOptions): Effect.Effect<TypescriptHostBackend, WebOperationError> =>
  Effect.gen(function* () {
    const appSessionCookieName = resolveAppSessionCookieName(mcpBridgeDiscoveryMode, processEnv);
    const validatedFrontendOrigin = yield* validateFrontendOriginEffect(frontendOrigin).pipe(
      Effect.mapError((cause) => toWebOperationError(cause, "web.host.validate-frontend-origin")),
    );
    const allowedOrigins = allowedFrontendOrigins(validatedFrontendOrigin, frontendPort);
    const allowedHostnames = allowedHostnamesFor({
      bindHost: host ?? LOCALHOST,
      externalUrl: validatedFrontendOrigin,
    });
    const sessionCookieSecure = new URL(validatedFrontendOrigin).protocol === "https:";
    const eventBus = new BufferedHostEventBus({
      report: ({ channel, cause }) =>
        scheduleNonFatalWebEventFailure(
          logger,
          `OpenDucktor host event delivery failed for channel '${channel}'.`,
          cause,
        ),
    });
    const localAttachments = createLocalAttachmentAdapter();
    const browserPreviews = createBrowserPreviewProxies({
      reportFailure: (message, cause) => scheduleNonFatalWebEventFailure(logger, message, cause),
    });
    let shutdownStarted = false;
    const beginShutdown = (): void => {
      shutdownStarted = true;
    };
    let stopPromise: Promise<void> | null = null;
    let rejectExited: (cause: unknown) => void = () => {};
    let resolveExited: (exitCode: number) => void = () => {};
    let server: TypescriptHostBackendServer;
    const exited = new Promise<number>((resolve, reject) => {
      rejectExited = reject;
      resolveExited = resolve;
    });
    const routerInput: Parameters<typeof createNodeEffectHostCommandRouter>[0] = {
      configDirScope,
      eventBus,
      gitProviderFetch,
      lifecycleLogger: {
        error: logger.error,
        info: logger.info,
      },
      localAttachments,
      mcpBridgeDiscoveryMode,
      onBackgroundFailure: (failure) =>
        Effect.sync(() => {
          rejectExited(failure);
          onBackgroundFailure(failure);
        }),
      taskEventPublicationReporter: {
        report: (failure) =>
          Effect.sync(() =>
            scheduleNonFatalWebEventFailure(
              logger,
              `OpenDucktor task event publication failed during '${failure.operation}' for '${failure.repoPath}'.`,
              failure.cause,
            ),
          ),
      },
      runtimeDistribution,
      terminalPty: createNodePtyPort(),
      browserEngine: ({ configRoot }) =>
        createChromeForTestingBrowserEngine({
          configRoot,
          platform: process.platform,
          arch: process.arch,
        }),
    };
    if (processEnv) {
      routerInput.processEnvironmentInput = { baseEnv: processEnv };
    }
    if (providedToolPaths) {
      routerInput.providedToolPaths = providedToolPaths;
    }
    const originalRouter: EffectNodeHostCommandRouter = yield* createNodeEffectHostCommandRouter(
      routerInput,
    ).pipe(Effect.mapError((cause) => toWebOperationError(cause, "web.host.create-host-router")));
    const commandLifetime = createHostCommandLifetime(originalRouter);
    const hostCommandRouter: EffectNodeHostCommandRouter = {
      ...originalRouter,
      invoke: commandLifetime.invoke,
    };
    const remoteFrontendOrigins = new Set(allowedOrigins);
    if (remoteFrontendOrigin !== undefined)
      remoteFrontendOrigins.add(new URL(remoteFrontendOrigin).origin);
    const remoteAccess = createRemoteAccessController(
      { ...hostCommandRouter, eventBus },
      {
        shell: "web",
        appVersion: webPackage.version,
        approvalStore: createFilesystemRemoteApprovalStore(
          resolveOpenDucktorBaseDir(configDirScope, processEnv ?? process.env),
        ).open(remoteHostOwnerFromEnvironment("web", processEnv ?? process.env)),
        frontendOrigins: remoteFrontendOrigins,
        sharedListener: {
          listenHost: host ?? LOCALHOST,
          listenPort: () => server.port,
          isPrivateRequest: (request) =>
            (request.method === "GET" &&
              new URL(stripBasePath(basePath, request.url)).pathname === "/health") ||
            request.headers.has(APP_TOKEN_HEADER) ||
            request.headers.has(CONTROL_TOKEN_HEADER) ||
            readCookie(request, appSessionCookieName) !== null ||
            (request.method === "OPTIONS" &&
              (request.headers.get("access-control-request-headers") ?? "")
                .split(",")
                .some((header) =>
                  [APP_TOKEN_HEADER, CONTROL_TOKEN_HEADER].includes(header.trim().toLowerCase()),
                )),
        },
        logger,
        reportFailure: (cause) =>
          scheduleNonFatalWebEventFailure(logger, "Remote transport failed", cause),
      },
    );
    const remoteAccessOperator = createRemoteAccessOperator(
      remoteAccess,
      hostCommandRouter.hostSettings,
      {
        reportFailure: (cause) =>
          scheduleNonFatalWebEventFailure(logger, "Remote control could not start", cause),
      },
    );
    const taskEventLeaseManager = createTaskEventLeaseManager({
      reportDeliveryFailure: ({ cause, subscriptionId }) =>
        scheduleNonFatalWebEventFailure(
          logger,
          `Failed to enqueue task event stream frame for subscription '${subscriptionId}'.`,
          cause,
        ),
      taskEventStream: hostCommandRouter.taskEventStream,
    });
    /** All local channels share the app session, so they share their task leases. */
    const localTaskLeases = new Set<string>();
    const createChannel = (): HostChannelSocketData =>
      createHostChannelSocketData({
        hostEvents: eventBus.stream(),
        notifications: hostCommandRouter.notificationStream,
        leases: taskEventLeaseManager,
        ownedLeases: localTaskLeases,
        invoke: (command, args, signal) =>
          invokeLocalHostCommand(hostCommandRouter, command, args, signal),
        remoteAccessStates: remoteAccessOperator.states,
        refusal: () =>
          shutdownStarted
            ? {
                code: "unavailable",
                message: SHUTDOWN_MESSAGE,
                nextAction: "Reopen OpenDucktor.",
              }
            : null,
        reportFailure: (cause) =>
          scheduleNonFatalWebEventFailure(logger, "Host channel delivery failed.", cause),
      });
    // Close the preview servers after the host stops, also when that fails.
    const disposeHost = () =>
      hostCommandRouter
        .dispose()
        .pipe(Effect.ensuring(Effect.promise(() => browserPreviews.close())));

    const stop = async (): Promise<void> => {
      if (stopPromise) {
        return stopPromise;
      }
      beginShutdown();
      taskEventLeaseManager.dispose();
      stopPromise = (async () => {
        const remoteResult = await Effect.runPromise(Effect.result(remoteAccess.close()));
        await Effect.runPromise(commandLifetime.drain());
        await stopHostBackend({
          disposeHost,
          logger,
          resolveExited,
          stopServer: () => server.stop(true),
        });
        if (remoteResult._tag === "Failure") throw remoteResult.failure;
      })();
      return stopPromise;
    };

    const cleanupStartedServerEffect = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Effect.sync(() => taskEventLeaseManager.dispose());
        const disposeExit = yield* Effect.exit(disposeHost());
        yield* Effect.promise(() => server.stop(true));
        if (disposeExit._tag === "Failure") {
          const loggingExit = yield* Effect.exit(
            writeWebLogEffect(
              logger,
              "error",
              `Failed to dispose local OpenDucktor host after startup failure: ${Cause.pretty(
                disposeExit.cause,
              )}`,
            ),
          );
          if (loggingExit._tag === "Failure") {
            yield* Effect.sync(() =>
              onBackgroundFailure(causeToWebBoundaryError(loggingExit.cause)),
            );
          }
        }
      });

    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        server = yield* Effect.tryPromise({
          try: () =>
            startNodeFetchServer<HostWebSocketData>({
              hostname: host ?? LOCALHOST,
              idleTimeoutSeconds: HOST_IDLE_TIMEOUT_SECONDS,
              port,
              onError: onBackgroundFailure,
              fetch(request, server) {
                const remote = remoteAccess.handleSharedRequest(request, server);
                if (remote !== null) return remote;
                return handleHostFetch({
                  allowedHostnames,
                  allowedOrigins,
                  appSessionCookieName,
                  appToken,
                  browserPreviews,
                  controlToken,
                  createChannel,
                  hostCommandRouter,
                  taskAssetReadService: hostCommandRouter.taskAssetReadService,
                  remoteAccess: remoteAccessOperator,
                  localAttachments,
                  logger,
                  basePath,
                  onBackgroundFailure,
                  request,
                  server,
                  sessionCookieSecure,
                  shutdownStarted,
                  beginShutdown,
                  stop,
                });
              },
              websocket: hostWebSocketHandler,
            }),
          catch: (cause) => toWebOperationError(cause, "web.host.start-server", { port }),
        });

        yield* restore(hostCommandRouter.initialize()).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              yield* cleanupStartedServerEffect();
              return yield* new WebOperationError({
                operation: "web.host.initialize",
                message: `Failed to initialize OpenDucktor host services: ${errorMessage(error)}`,
                cause: error,
              });
            }),
          ),
          Effect.onInterrupt(cleanupStartedServerEffect),
        );

        if (!deferRemoteStartup) yield* remoteAccessOperator.restore(processEnv ?? process.env);
        return {
          remoteAccess,
          exited,
          port: server.port,
          stop,
        };
      }),
    );
  });

export const startTypescriptHostBackend = (
  options: TypescriptHostBackendOptions,
): Promise<TypescriptHostBackend> => runWebBoundary(startTypescriptHostBackendEffect(options));
