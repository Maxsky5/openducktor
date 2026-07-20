import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  failureKindSchema,
  type HostInvokeFailure,
  hostInvokeFailureSchema,
  TERMINAL_PROTOCOL_SUBPROTOCOL,
} from "@openducktor/contracts";
import {
  createLocalAttachmentAdapter,
  createNodeEffectHostCommandRouter,
  type EffectHostCommandRouter,
  type EffectNodeHostCommandRouter,
  type HostRuntimeDistribution,
  TerminalServiceError,
  type ToolDiscoveryId,
  terminalServiceErrorToFailure,
} from "@openducktor/host";
import { Cause, Effect } from "effect";
import {
  causeToWebBoundaryError,
  errorMessage,
  runWebBoundary,
  toWebOperationError,
  WebHostRequestError,
  WebOperationError,
} from "./effect/web-errors";
import { type WebLogger, writeWebLogEffect } from "./logger";
import { createBunPtyPort } from "./terminals/bun-pty-adapter";
import {
  type TerminalWebSocketData,
  terminalWebSocketHandler,
} from "./terminals/terminal-websocket-handler";
import {
  allowedOriginsForFrontendOrigin,
  type BufferedHostEvent,
  BufferedHostEventBus,
  type BufferedHostEventStream,
  stopTypescriptHostBackendServices,
  validateWebFrontendOriginEffect,
} from "./typescript-host-backend-support";

export type TypescriptHostBackendOptions = {
  port: number;
  frontendOrigin: string;
  controlToken: string;
  appToken: string;
  logger: WebLogger;
  onBackgroundFailure(failure: unknown): void;
  runtimeDistribution: HostRuntimeDistribution;
  providedToolPaths?: Partial<Record<ToolDiscoveryId, string>>;
};

export type TypescriptHostBackend = {
  exited: Promise<number>;
  port: number;
  stop(): Promise<void>;
};

type RequestTimeoutController = {
  timeout(request: Request, seconds: number): void;
};
type TypescriptHostBackendServer = Bun.Server<TerminalWebSocketData>;

const LOCALHOST = "127.0.0.1";
const CONTROL_TOKEN_HEADER = "x-openducktor-control-token";
const APP_TOKEN_HEADER = "x-openducktor-app-token";
const APP_SESSION_COOKIE_NAME = "openducktor_web_session";
const LAST_EVENT_ID_HEADER = "last-event-id";
const HOST_IDLE_TIMEOUT_SECONDS = 0;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const HOST_EVENT_STREAM_PATH = "events";

type TerminalUpgradeResult = { handled: false } | { handled: true; response: Response | undefined };

const tryUpgradeTerminalWebSocket = ({
  allowedOrigins,
  appToken,
  hostCommandRouter,
  logger,
  onBackgroundFailure,
  request,
  server,
  shutdownStarted,
}: {
  allowedOrigins: Set<string>;
  appToken: string;
  hostCommandRouter: EffectNodeHostCommandRouter;
  logger: WebLogger;
  onBackgroundFailure(failure: unknown): void;
  request: Request;
  server: Bun.Server<TerminalWebSocketData>;
  shutdownStarted: boolean;
}): TerminalUpgradeResult => {
  if (new URL(request.url).pathname !== "/terminal") return { handled: false };
  if (shutdownStarted) {
    return { handled: true, response: new Response("Host is shutting down.", { status: 503 }) };
  }
  const origin = request.headers.get("origin")?.trim();
  if (!origin || !allowedOrigins.has(origin)) {
    return {
      handled: true,
      response: new Response("Terminal origin is not allowed.", { status: 403 }),
    };
  }
  if (readCookie(request, APP_SESSION_COOKIE_NAME) !== appToken) {
    return {
      handled: true,
      response: new Response("Terminal session is unauthorized.", { status: 401 }),
    };
  }
  if (request.headers.get("sec-websocket-protocol")?.trim() !== TERMINAL_PROTOCOL_SUBPROTOCOL) {
    return {
      handled: true,
      response: new Response("Terminal protocol version is unsupported.", { status: 426 }),
    };
  }
  const upgraded = server.upgrade(request, {
    data: {
      connectionId: globalThis.crypto.randomUUID(),
      terminalService: hostCommandRouter.terminalService,
      clientSession: null,
      backpressured: false,
      inFlightBytes: 0,
      pendingBytes: 0,
      pendingFrames: [],
      logger,
      onBackgroundFailure,
    },
    headers: { "Sec-WebSocket-Protocol": TERMINAL_PROTOCOL_SUBPROTOCOL },
  });
  return {
    handled: true,
    response: upgraded
      ? undefined
      : new Response("Terminal WebSocket upgrade failed.", { status: 500 }),
  };
};

const jsonResponseBody = (payload: unknown): string => {
  const serialized = JSON.stringify(payload);
  return serialized === undefined ? "null" : serialized;
};

const jsonResponse = (
  payload: unknown,
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

const errorResponse = (
  message: string,
  status: number,
  corsHeaders?: HeadersInit,
  failureKind?: string,
  failure?: HostInvokeFailure,
): Response =>
  jsonResponse(
    {
      error: message,
      message,
      ...(failureKind ? { failureKind } : {}),
      ...(failure ? { failure } : {}),
    },
    { status },
    corsHeaders,
  );

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
      "access-control-allow-headers": [
        "content-type",
        LAST_EVENT_ID_HEADER,
        CONTROL_TOKEN_HEADER,
        APP_TOKEN_HEADER,
      ].join(", "),
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-max-age": "600",
    },
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readUnknownProperty = (value: unknown, property: string): unknown =>
  isRecord(value) ? value[property] : undefined;

const readValidFailureKind = (value: unknown): string | undefined => {
  const parsed = failureKindSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

const readStructuredDetails = (value: unknown): Record<string, unknown> | undefined => {
  const details = readUnknownProperty(value, "details");
  return isRecord(details) ? details : undefined;
};

const extractHostCommandFailureKind = (
  value: unknown,
  visited = new Set<object>(),
): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  if (visited.has(value)) {
    return undefined;
  }
  visited.add(value);

  const direct = readValidFailureKind(readUnknownProperty(value, "failureKind"));
  if (direct) {
    return direct;
  }

  const details = readStructuredDetails(value);
  const detailsFailureKind = readValidFailureKind(readUnknownProperty(details, "failureKind"));
  if (detailsFailureKind) {
    return detailsFailureKind;
  }

  return extractHostCommandFailureKind(readUnknownProperty(value, "cause"), visited);
};

const hostCommandFailureToWebError = (command: string, error: unknown): WebHostRequestError => {
  const failureKind = extractHostCommandFailureKind(error);
  const details = readStructuredDetails(error);
  const hostInvokeFailure =
    error instanceof TerminalServiceError
      ? {
          kind: "terminal" as const,
          terminalFailure: terminalServiceErrorToFailure(error),
        }
      : undefined;
  return new WebHostRequestError({
    message: errorMessage(error),
    status: 500,
    cause: error,
    details: {
      command,
      ...(details ? { hostDetails: details } : {}),
      ...(hostInvokeFailure ? { hostInvokeFailure } : {}),
    },
    ...(failureKind ? { failureKind } : {}),
  });
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
): Effect.Effect<void, WebHostRequestError> =>
  validateExpectedToken(
    readCookie(request, APP_SESSION_COOKIE_NAME),
    expectedToken,
    "Missing OpenDucktor web host app token.",
    "Invalid OpenDucktor web host app token.",
  );

const validateAppCookieOrHeader = (
  request: Request,
  expectedToken: string,
): Effect.Effect<void, WebHostRequestError> =>
  validateExpectedToken(
    readCookie(request, APP_SESSION_COOKIE_NAME) ?? request.headers.get(APP_TOKEN_HEADER),
    expectedToken,
    "Missing OpenDucktor web host app token.",
    "Invalid OpenDucktor web host app token.",
  );

const writeSseEvent = (event: BufferedHostEvent): string =>
  [`id: ${event.id}`, ...event.payload.split(/\r?\n/).map((line) => `data: ${line}`), "", ""].join(
    "\n",
  );
const writeSseNamedEvent = (eventName: string, data: string): string =>
  [`event: ${eventName}`, ...data.split(/\r?\n/).map((line) => `data: ${line}`), "", ""].join("\n");
const SSE_READY_COMMENT = ": openducktor-ready\n\n";

const skippedReplayWarningMessage = (skippedEventCount: number): string => {
  const eventLabel = skippedEventCount === 1 ? "event" : "events";
  return `Host event stream skipped ${skippedEventCount} ${eventLabel}; reconnect will replay buffered events.`;
};

const createSseResponse = (
  stream: BufferedHostEventStream,
  lastEventId: number | null,
  corsHeaders: HeadersInit,
): Response => {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(SSE_READY_COMMENT));
      const replay = stream.replayAfterWithDiagnostics(lastEventId);
      if (replay.skippedEventCount > 0) {
        controller.enqueue(
          encoder.encode(
            writeSseNamedEvent(
              "stream-warning",
              skippedReplayWarningMessage(replay.skippedEventCount),
            ),
          ),
        );
      }
      for (const event of replay.events) {
        controller.enqueue(encoder.encode(writeSseEvent(event)));
      }
      unsubscribe = stream.subscribe((event) => {
        controller.enqueue(encoder.encode(writeSseEvent(event)));
      });
    },
    cancel() {
      unsubscribe?.();
    },
  });

  return new Response(body, {
    headers: {
      ...corsHeaders,
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
    },
  });
};

const isWithinDirectory = (directory: string, candidate: string): boolean => {
  const relative = path.relative(directory, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

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
  const hostInvokeFailureValue = error.details?.hostInvokeFailure;
  const hostInvokeFailure =
    hostInvokeFailureValue === undefined
      ? undefined
      : hostInvokeFailureSchema.parse(hostInvokeFailureValue);
  return errorResponse(
    error.message,
    error.status,
    corsHeaders,
    error.failureKind,
    hostInvokeFailure,
  );
};

const isJsonObject = (value: unknown): value is Record<string, unknown> => isRecord(value);

const parseJsonObjectBody = (
  request: Request,
): Effect.Effect<Record<string, unknown>, WebHostRequestError> =>
  Effect.gen(function* () {
    const parsed: unknown = yield* Effect.tryPromise({
      try: () => request.json(),
      catch: (error) =>
        new WebHostRequestError({
          message: error instanceof Error ? error.message : "Malformed JSON request body.",
          status: 400,
        }),
    });
    if (!isJsonObject(parsed)) {
      return yield* rejectWebHostRequest("Command request body must be a JSON object.", 400);
    }
    return parsed;
  });

const parseLastEventId = (request: Request): Effect.Effect<number | null, WebHostRequestError> =>
  Effect.gen(function* () {
    const raw = request.headers.get(LAST_EVENT_ID_HEADER);
    if (raw === null) {
      return null;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return yield* rejectWebHostRequest(`Invalid Last-Event-ID header: ${raw}`, 400);
    }
    return parsed;
  });

const statLocalAttachmentPreview = (
  requestedPath: string,
): Effect.Effect<Stats, WebHostRequestError> =>
  Effect.tryPromise({
    try: () => stat(requestedPath),
    catch: (error) =>
      new WebHostRequestError({
        message: `Failed to stat local attachment preview: ${errorMessage(error)}`,
        status: 404,
      }),
  });

const localAttachmentPreviewResponse = (
  request: Request,
  localAttachmentPort: ReturnType<typeof createLocalAttachmentAdapter>,
  corsHeaders: HeadersInit,
): Effect.Effect<Response, WebHostRequestError> =>
  Effect.gen(function* () {
    const requestUrl = new URL(request.url);
    const requestedPath = requestUrl.searchParams.get("path");
    if (!requestedPath) {
      return yield* rejectWebHostRequest("Local attachment preview path is required.", 400);
    }

    const metadata = yield* statLocalAttachmentPreview(requestedPath);
    if (!metadata.isFile()) {
      return yield* rejectWebHostRequest(
        "Local attachment preview path must reference a file",
        400,
      );
    }

    const canonicalDirectory = yield* localAttachmentPort
      .canonicalizePath(localAttachmentPort.stageDirectory())
      .pipe(
        Effect.mapError(
          (error) =>
            new WebHostRequestError({
              message: `Failed to resolve local attachment preview directory: ${errorMessage(error)}`,
              status: 500,
            }),
        ),
      );
    const canonicalPath = yield* localAttachmentPort.canonicalizePath(requestedPath).pipe(
      Effect.mapError(
        (error) =>
          new WebHostRequestError({
            message: `Failed to resolve local attachment preview path: ${errorMessage(error)}`,
            status: 500,
          }),
      ),
    );
    if (!isWithinDirectory(canonicalDirectory, canonicalPath)) {
      return yield* rejectWebHostRequest(
        "Local attachment preview is only available for staged attachment files.",
        403,
      );
    }

    const file = Bun.file(requestedPath);
    return new Response(file, {
      headers: {
        ...corsHeaders,
        "cache-control": "no-store, private",
        "content-type": file.type || "application/octet-stream",
      },
    });
  });

const routeCorsRequest = ({
  appToken,
  controlToken,
  corsHeaders,
  eventBus,
  hostCommandRouter,
  localAttachments,
  logger,
  request,
  requestTimeouts,
  shutdownStarted,
  beginShutdown,
  stop,
}: {
  appToken: string;
  controlToken: string;
  corsHeaders: HeadersInit;
  eventBus: BufferedHostEventBus;
  hostCommandRouter: EffectHostCommandRouter;
  localAttachments: ReturnType<typeof createLocalAttachmentAdapter>;
  logger: WebLogger;
  request: Request;
  requestTimeouts?: RequestTimeoutController | undefined;
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
      return jsonResponse(
        { ok: true },
        {
          headers: {
            "set-cookie": `${APP_SESSION_COOKIE_NAME}=${appToken}; HttpOnly; SameSite=Strict; Path=/`,
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
          void stop().catch((error: unknown) => {
            void runWebBoundary(writeWebLogEffect(logger, "error", errorMessage(error))).catch(
              (logError: unknown) => {
                console.error(errorMessage(logError));
                process.exitCode = 1;
              },
            );
          });
        }, 10);
      });
      return jsonResponse({ ok: true }, { status: 202 }, corsHeaders);
    }

    if (requestUrl.pathname === `/${HOST_EVENT_STREAM_PATH}` && request.method === "GET") {
      yield* validateAppCookieOrHeader(request, appToken);
      if (shutdownStarted) {
        return yield* rejectWebHostRequest(
          "Browser backend is shutting down and is no longer accepting new work.",
          503,
        );
      }
      requestTimeouts?.timeout(request, 0);
      return createSseResponse(eventBus.stream(), yield* parseLastEventId(request), corsHeaders);
    }

    if (requestUrl.pathname === "/local-attachment-preview" && request.method === "GET") {
      yield* validateAppSessionCookie(request, appToken);
      return yield* localAttachmentPreviewResponse(request, localAttachments, corsHeaders);
    }

    const invokeMatch = /^\/invoke\/([^/]+)$/.exec(requestUrl.pathname);
    if (invokeMatch && request.method === "POST") {
      yield* validateAppTokenHeader(request, appToken);
      if (shutdownStarted) {
        return yield* rejectWebHostRequest(
          "Browser backend is shutting down and is no longer accepting new work.",
          503,
        );
      }
      const args = yield* parseJsonObjectBody(request);
      const [, command] = invokeMatch;
      if (!command) {
        return yield* rejectWebHostRequest("Host command is required.", 400);
      }
      const decodedCommand = yield* Effect.try({
        try: () => decodeURIComponent(command),
        catch: (cause) =>
          new WebHostRequestError({
            message: `Invalid command URI component: ${command}`,
            status: 400,
            cause,
          }),
      });
      const result = yield* hostCommandRouter
        .invoke(decodedCommand, args)
        .pipe(
          Effect.mapError((error) =>
            error instanceof WebHostRequestError
              ? error
              : hostCommandFailureToWebError(decodedCommand, error),
          ),
        );
      return jsonResponse(result, undefined, corsHeaders);
    }

    return yield* rejectWebHostRequest("Not found", 404);
  });

export const handleTypescriptHostBackendRequest = ({
  allowedOrigins,
  appToken,
  controlToken,
  eventBus,
  hostCommandRouter,
  localAttachments,
  logger,
  request,
  requestTimeouts,
  shutdownStarted,
  beginShutdown,
  stop,
}: {
  allowedOrigins: Set<string>;
  appToken: string;
  controlToken: string;
  eventBus: BufferedHostEventBus;
  hostCommandRouter: EffectHostCommandRouter;
  localAttachments: ReturnType<typeof createLocalAttachmentAdapter>;
  logger: WebLogger;
  request: Request;
  requestTimeouts?: RequestTimeoutController | undefined;
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

    return yield* routeCorsRequest({
      appToken,
      controlToken,
      corsHeaders,
      eventBus,
      hostCommandRouter,
      localAttachments,
      logger,
      request,
      requestTimeouts,
      shutdownStarted,
      beginShutdown,
      stop,
    }).pipe(
      Effect.catchAll((error) => Effect.succeed(webHostRequestErrorResponse(error, corsHeaders))),
    );
  });

export const startTypescriptHostBackendEffect = ({
  port,
  frontendOrigin,
  controlToken,
  appToken,
  logger,
  onBackgroundFailure,
  providedToolPaths,
  runtimeDistribution,
}: TypescriptHostBackendOptions): Effect.Effect<TypescriptHostBackend, WebOperationError> =>
  Effect.gen(function* () {
    const validatedFrontendOrigin = yield* validateWebFrontendOriginEffect(frontendOrigin).pipe(
      Effect.mapError((cause) => toWebOperationError(cause, "web.host.validate-frontend-origin")),
    );
    const allowedOrigins = allowedOriginsForFrontendOrigin(validatedFrontendOrigin);
    const eventBus = new BufferedHostEventBus();
    const localAttachments = createLocalAttachmentAdapter();
    let shutdownStarted = false;
    const beginShutdown = (): void => {
      shutdownStarted = true;
    };
    let stopPromise: Promise<void> | null = null;
    let rejectExited: (failure: unknown) => void = () => {};
    let resolveExited: (exitCode: number) => void = () => {};
    let server: TypescriptHostBackendServer;
    const exited = new Promise<number>((resolve, reject) => {
      rejectExited = reject;
      resolveExited = resolve;
    });
    const hostCommandRouter: EffectNodeHostCommandRouter = createNodeEffectHostCommandRouter({
      eventBus,
      lifecycleLogger: {
        error: logger.error,
        info: logger.info,
      },
      localAttachments,
      onBackgroundFailure: (failure) =>
        Effect.sync(() => {
          rejectExited(failure);
          onBackgroundFailure(failure);
        }),
      ...(providedToolPaths ? { providedToolPaths } : {}),
      runtimeDistribution,
      terminalPty: createBunPtyPort(),
    });

    const stop = async (): Promise<void> => {
      if (stopPromise) {
        return stopPromise;
      }
      beginShutdown();
      stopPromise = stopTypescriptHostBackendServices({
        disposeHost: () => hostCommandRouter.dispose(),
        logger,
        resolveExited,
        stopServer: () => server.stop(true),
      });
      return stopPromise;
    };

    const cleanupStartedServerEffect = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        const disposeExit = yield* Effect.exit(hostCommandRouter.dispose());
        yield* Effect.sync(() => server.stop(true));
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
        server = yield* Effect.try({
          try: () =>
            Bun.serve<TerminalWebSocketData>({
              hostname: LOCALHOST,
              idleTimeout: HOST_IDLE_TIMEOUT_SECONDS,
              port,
              fetch(request, server) {
                const terminalUpgrade = tryUpgradeTerminalWebSocket({
                  allowedOrigins,
                  appToken,
                  hostCommandRouter,
                  logger,
                  onBackgroundFailure,
                  request,
                  server,
                  shutdownStarted,
                });
                if (terminalUpgrade.handled) return terminalUpgrade.response;
                return Effect.runPromise(
                  handleTypescriptHostBackendRequest({
                    allowedOrigins,
                    appToken,
                    controlToken,
                    eventBus,
                    hostCommandRouter,
                    localAttachments,
                    logger,
                    request,
                    requestTimeouts: server,
                    shutdownStarted,
                    beginShutdown,
                    stop,
                  }),
                );
              },
              websocket: terminalWebSocketHandler,
            }),
          catch: (cause) => toWebOperationError(cause, "web.host.start-server", { port }),
        });

        if (server.port === undefined) {
          yield* cleanupStartedServerEffect();
          return yield* new WebOperationError({
            operation: "web.host.start-server",
            message: "OpenDucktor TypeScript host did not expose a listening port.",
            details: { port },
          });
        }

        yield* restore(hostCommandRouter.initialize()).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              yield* cleanupStartedServerEffect();
              return yield* new WebOperationError({
                operation: "web.host.initialize",
                message: `Failed to initialize the local MCP bridge used for external OpenDucktor discovery: ${errorMessage(
                  error,
                )}`,
                cause: error,
              });
            }),
          ),
          Effect.onInterrupt(cleanupStartedServerEffect),
        );

        return {
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
