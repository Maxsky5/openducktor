import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  createLocalAttachmentAdapter,
  createNodeEffectHostCommandRouter,
  type EffectHostCommandRouter,
  type HostEventBusPort,
  type HostEventChannel,
  type HostEventListener,
  type HostEventUnsubscribe,
  type HostRuntimeDistribution,
} from "@openducktor/host";
import { Cause, Data, Effect } from "effect";
import { logError, logInfo } from "./logger";

export type TypescriptHostBackendOptions = {
  port: number;
  frontendOrigin: string;
  controlToken: string;
  appToken: string;
  runtimeDistribution: HostRuntimeDistribution;
};

export type TypescriptHostBackend = {
  exited: Promise<number>;
  port: number;
  stop(): Promise<void>;
};

type BufferedEvent = {
  id: number;
  payload: string;
};
type RequestTimeoutController = {
  timeout(request: Request, seconds: number): void;
};
type StopTypescriptHostBackendServicesInput = {
  disposeHost: () => Effect.Effect<void, unknown>;
  resolveExited: (exitCode: number) => void;
  stopServer: () => void;
};

const LOCALHOST = "127.0.0.1";
const CONTROL_TOKEN_HEADER = "x-openducktor-control-token";
const APP_TOKEN_HEADER = "x-openducktor-app-token";
const APP_SESSION_COOKIE_NAME = "openducktor_web_session";
const LAST_EVENT_ID_HEADER = "last-event-id";
const EVENT_BUFFER_CAPACITY = 256;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

const STREAM_PATH_TO_CHANNEL = new Map<string, HostEventChannel>([
  ["events", "openducktor://run-event"],
  ["dev-server-events", "openducktor://dev-server-event"],
  ["task-events", "openducktor://task-event"],
  ["codex-app-server-events", "openducktor://codex-app-server-event"],
]);

class BufferedHostEventStream {
  private nextId = 0;
  private readonly recent: BufferedEvent[] = [];
  private readonly listeners = new Set<(event: BufferedEvent) => void>();

  constructor(private readonly capacity: number) {}

  emit(payload: unknown): void {
    this.nextId += 1;
    const event = {
      id: this.nextId,
      payload: JSON.stringify(payload) ?? "null",
    };
    this.recent.push(event);
    if (this.recent.length > this.capacity) {
      this.recent.shift();
    }
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  replayAfter(lastSeenId: number | null): BufferedEvent[] {
    if (lastSeenId === null) {
      return [];
    }
    return this.recent.filter((event) => event.id > lastSeenId);
  }

  subscribe(listener: (event: BufferedEvent) => void): HostEventUnsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

class BufferedHostEventBus implements HostEventBusPort {
  private readonly streams = new Map<HostEventChannel, BufferedHostEventStream>();
  private readonly listenersByChannel = new Map<HostEventChannel, Set<HostEventListener>>();

  publish(channel: string, payload: unknown): void {
    const hostChannel = this.requireChannel(channel);
    this.streamFor(hostChannel).emit(payload);
    const listeners = this.listenersByChannel.get(hostChannel);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener(payload);
    }
  }

  subscribe(channel: string, listener: HostEventListener): HostEventUnsubscribe {
    const hostChannel = this.requireChannel(channel);
    const listeners = this.listenersByChannel.get(hostChannel) ?? new Set<HostEventListener>();
    listeners.add(listener);
    this.listenersByChannel.set(hostChannel, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listenersByChannel.delete(hostChannel);
      }
    };
  }

  streamFor(channel: HostEventChannel): BufferedHostEventStream {
    const existing = this.streams.get(channel);
    if (existing) {
      return existing;
    }
    const stream = new BufferedHostEventStream(EVENT_BUFFER_CAPACITY);
    this.streams.set(channel, stream);
    return stream;
  }

  private requireChannel(channel: string): HostEventChannel {
    for (const knownChannel of STREAM_PATH_TO_CHANNEL.values()) {
      if (knownChannel === channel) {
        return knownChannel;
      }
    }
    throw new Error(`Unknown OpenDucktor host event channel: ${channel}`);
  }
}

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
): Response =>
  jsonResponse(
    {
      error: message,
      message,
      ...(failureKind ? { failureKind } : {}),
    },
    { status },
    corsHeaders,
  );

const validateWebFrontendOrigin = (origin: string): string => {
  const trimmed = origin.trim();
  if (!trimmed) {
    throw new Error("browser frontend origin cannot be empty");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    throw new Error(`invalid browser frontend origin configured: ${trimmed}`, { cause: error });
  }

  if (parsed.protocol !== "http:") {
    throw new Error("browser frontend origin must use http");
  }
  if (parsed.username || parsed.password) {
    throw new Error("browser frontend origin must not include credentials");
  }
  if (parsed.port.length === 0) {
    throw new Error("browser frontend origin must include an explicit port");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("browser frontend origin must not include a path, query string, or fragment");
  }
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname)) {
    throw new Error("browser frontend origin must target 127.0.0.1, localhost, or [::1]");
  }

  return parsed.origin;
};

const allowedOriginsForFrontendOrigin = (frontendOrigin: string): Set<string> => {
  const parsed = new URL(frontendOrigin);
  return new Set([
    `http://127.0.0.1:${parsed.port}`,
    `http://localhost:${parsed.port}`,
    `http://[::1]:${parsed.port}`,
  ]);
};

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

const validateExpectedToken = (
  receivedToken: string | null,
  expectedToken: string,
  missingMessage: string,
  invalidMessage: string,
): Response | null => {
  if (receivedToken === null) {
    return errorResponse(missingMessage, 401);
  }
  if (receivedToken !== expectedToken) {
    return errorResponse(invalidMessage, 403);
  }
  return null;
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

const validateControlToken = (request: Request, expectedToken: string): Response | null =>
  validateExpectedToken(
    request.headers.get(CONTROL_TOKEN_HEADER),
    expectedToken,
    "Missing OpenDucktor web host control token.",
    "Invalid OpenDucktor web host control token.",
  );

const validateAppTokenHeader = (request: Request, expectedToken: string): Response | null =>
  validateExpectedToken(
    request.headers.get(APP_TOKEN_HEADER),
    expectedToken,
    "Missing OpenDucktor web host app token.",
    "Invalid OpenDucktor web host app token.",
  );

const validateAppSessionCookie = (request: Request, expectedToken: string): Response | null =>
  validateExpectedToken(
    readCookie(request, APP_SESSION_COOKIE_NAME),
    expectedToken,
    "Missing OpenDucktor web host app token.",
    "Invalid OpenDucktor web host app token.",
  );

const validateAppCookieOrHeader = (request: Request, expectedToken: string): Response | null =>
  validateExpectedToken(
    readCookie(request, APP_SESSION_COOKIE_NAME) ?? request.headers.get(APP_TOKEN_HEADER),
    expectedToken,
    "Missing OpenDucktor web host app token.",
    "Invalid OpenDucktor web host app token.",
  );

const writeSseEvent = (event: BufferedEvent): string =>
  [`id: ${event.id}`, ...event.payload.split(/\r?\n/).map((line) => `data: ${line}`), "", ""].join(
    "\n",
  );

const createSseResponse = (
  stream: BufferedHostEventStream,
  lastEventId: number | null,
  corsHeaders: HeadersInit,
): Response => {
  const encoder = new TextEncoder();
  let unsubscribe: HostEventUnsubscribe | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of stream.replayAfter(lastEventId)) {
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

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

class WebHostRequestRejection extends Data.TaggedError("WebHostRequestRejection")<{
  message: string;
  status: number;
  failureKind?: string | undefined;
}> {}

class WebHostStartupError extends Data.TaggedError("WebHostStartupError")<{
  message: string;
  cause?: unknown | undefined;
}> {}

const rejectWebHostRequest = (
  message: string,
  status: number,
  failureKind?: string,
): Effect.Effect<never, WebHostRequestRejection> =>
  Effect.fail(
    new WebHostRequestRejection(
      failureKind ? { failureKind, message, status } : { message, status },
    ),
  );

const webHostRequestErrorResponse = (
  error: WebHostRequestRejection,
  corsHeaders: HeadersInit,
): Response => errorResponse(error.message, error.status, corsHeaders, error.failureKind);

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJsonObjectBody = (
  request: Request,
): Effect.Effect<Record<string, unknown>, WebHostRequestRejection> =>
  Effect.gen(function* () {
    const parsed: unknown = yield* Effect.tryPromise({
      try: () => request.json(),
      catch: (error) =>
        new WebHostRequestRejection({
          message: error instanceof Error ? error.message : "Malformed JSON request body.",
          status: 400,
        }),
    });
    if (!isJsonObject(parsed)) {
      return yield* rejectWebHostRequest("Command request body must be a JSON object.", 400);
    }
    return parsed;
  });

const parseLastEventId = (
  request: Request,
): Effect.Effect<number | null, WebHostRequestRejection> =>
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
): Effect.Effect<Stats, WebHostRequestRejection> =>
  Effect.tryPromise({
    try: () => stat(requestedPath),
    catch: (error) =>
      new WebHostRequestRejection({
        message: `Failed to stat local attachment preview: ${errorMessage(error)}`,
        status: 404,
      }),
  });

const localAttachmentPreviewResponse = (
  request: Request,
  localAttachmentPort: ReturnType<typeof createLocalAttachmentAdapter>,
  corsHeaders: HeadersInit,
): Effect.Effect<Response, WebHostRequestRejection> =>
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
            new WebHostRequestRejection({
              message: `Failed to resolve local attachment preview directory: ${errorMessage(error)}`,
              status: 500,
            }),
        ),
      );
    const canonicalPath = yield* localAttachmentPort.canonicalizePath(requestedPath).pipe(
      Effect.mapError(
        (error) =>
          new WebHostRequestRejection({
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
  request,
  requestTimeouts,
  shutdownStarted,
  stop,
}: {
  appToken: string;
  controlToken: string;
  corsHeaders: HeadersInit;
  eventBus: BufferedHostEventBus;
  hostCommandRouter: EffectHostCommandRouter;
  localAttachments: ReturnType<typeof createLocalAttachmentAdapter>;
  request: Request;
  requestTimeouts?: RequestTimeoutController | undefined;
  shutdownStarted: boolean;
  stop: () => Promise<void>;
}): Effect.Effect<Response, WebHostRequestRejection> =>
  Effect.gen(function* () {
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname === "/health" && request.method === "GET") {
      return jsonResponse({ ok: true }, undefined, corsHeaders);
    }

    if (requestUrl.pathname === "/session" && request.method === "POST") {
      const tokenError = validateAppTokenHeader(request, appToken);
      if (tokenError) {
        return tokenError;
      }
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
      const tokenError = validateControlToken(request, controlToken);
      if (tokenError) {
        return tokenError;
      }
      yield* Effect.sync(() => {
        setTimeout(() => {
          void stop();
        }, 10);
      });
      return jsonResponse({ ok: true }, { status: 202 }, corsHeaders);
    }

    const streamChannel = STREAM_PATH_TO_CHANNEL.get(requestUrl.pathname.replace(/^\//, ""));
    if (streamChannel && request.method === "GET") {
      const tokenError = validateAppCookieOrHeader(request, appToken);
      if (tokenError) {
        return tokenError;
      }
      if (shutdownStarted) {
        return yield* rejectWebHostRequest(
          "Browser backend is shutting down and is no longer accepting new work.",
          503,
        );
      }
      requestTimeouts?.timeout(request, 0);
      return createSseResponse(
        eventBus.streamFor(streamChannel),
        yield* parseLastEventId(request),
        corsHeaders,
      );
    }

    if (requestUrl.pathname === "/local-attachment-preview" && request.method === "GET") {
      const tokenError = validateAppSessionCookie(request, appToken);
      if (tokenError) {
        return tokenError;
      }
      return yield* localAttachmentPreviewResponse(request, localAttachments, corsHeaders);
    }

    const invokeMatch = /^\/invoke\/([^/]+)$/.exec(requestUrl.pathname);
    if (invokeMatch && request.method === "POST") {
      const tokenError = validateAppTokenHeader(request, appToken);
      if (tokenError) {
        return tokenError;
      }
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
      const result = yield* hostCommandRouter.invoke(decodeURIComponent(command), args).pipe(
        Effect.mapError(
          (error) =>
            new WebHostRequestRejection({
              message: errorMessage(error),
              status: 500,
            }),
        ),
      );
      return jsonResponse(result, undefined, corsHeaders);
    }

    return errorResponse("Not found", 404, corsHeaders);
  });

const handleTypescriptHostBackendRequest = ({
  allowedOrigins,
  appToken,
  controlToken,
  eventBus,
  hostCommandRouter,
  localAttachments,
  request,
  requestTimeouts,
  shutdownStarted,
  stop,
}: {
  allowedOrigins: Set<string>;
  appToken: string;
  controlToken: string;
  eventBus: BufferedHostEventBus;
  hostCommandRouter: EffectHostCommandRouter;
  localAttachments: ReturnType<typeof createLocalAttachmentAdapter>;
  request: Request;
  requestTimeouts?: RequestTimeoutController | undefined;
  shutdownStarted: boolean;
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
      request,
      requestTimeouts,
      shutdownStarted,
      stop,
    }).pipe(
      Effect.catchAll((error) => Effect.succeed(webHostRequestErrorResponse(error, corsHeaders))),
    );
  });

const toWebHostStartupError = (message: string, cause?: unknown): WebHostStartupError =>
  new WebHostStartupError(cause === undefined ? { message } : { cause, message });

const stopTypescriptHostBackendServices = ({
  disposeHost,
  resolveExited,
  stopServer,
}: StopTypescriptHostBackendServicesInput): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      let exitCode = 0;
      const disposeExit = yield* Effect.exit(disposeHost());
      if (disposeExit._tag === "Failure") {
        exitCode = 1;
        logError(Cause.pretty(disposeExit.cause));
      }
      yield* Effect.sync(stopServer);
      resolveExited(exitCode);
    }),
  );

export const startTypescriptHostBackendEffect = ({
  port,
  frontendOrigin,
  controlToken,
  appToken,
  runtimeDistribution,
}: TypescriptHostBackendOptions): Effect.Effect<TypescriptHostBackend, WebHostStartupError> =>
  Effect.gen(function* () {
    const validatedFrontendOrigin = yield* Effect.try({
      try: () => validateWebFrontendOrigin(frontendOrigin),
      catch: (error) => toWebHostStartupError(errorMessage(error), error),
    });
    const allowedOrigins = allowedOriginsForFrontendOrigin(validatedFrontendOrigin);
    const eventBus = new BufferedHostEventBus();
    const localAttachments = createLocalAttachmentAdapter();
    const hostCommandRouter: EffectHostCommandRouter = createNodeEffectHostCommandRouter({
      eventBus,
      lifecycleLogger: {
        error: logError,
        info: logInfo,
      },
      localAttachments,
      runtimeDistribution,
    });
    let shutdownStarted = false;
    let stopPromise: Promise<void> | null = null;
    let resolveExited: (exitCode: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      resolveExited = resolve;
    });

    const stop = async (): Promise<void> => {
      if (stopPromise) {
        return stopPromise;
      }
      shutdownStarted = true;
      stopPromise = stopTypescriptHostBackendServices({
        disposeHost: () => hostCommandRouter.dispose(),
        resolveExited,
        stopServer: () => server.stop(true),
      });
      return stopPromise;
    };

    const server = Bun.serve({
      hostname: LOCALHOST,
      port,
      fetch(request, server) {
        return Effect.runPromise(
          handleTypescriptHostBackendRequest({
            allowedOrigins,
            appToken,
            controlToken,
            eventBus,
            hostCommandRouter,
            localAttachments,
            request,
            requestTimeouts: server,
            shutdownStarted,
            stop,
          }),
        );
      },
    });

    if (server.port === undefined) {
      server.stop(true);
      return yield* Effect.fail(
        toWebHostStartupError("OpenDucktor TypeScript host did not expose a listening port."),
      );
    }

    const initializeExit = yield* Effect.exit(hostCommandRouter.initialize());
    if (initializeExit._tag === "Failure") {
      const disposeExit = yield* Effect.exit(hostCommandRouter.dispose());
      yield* Effect.sync(() => server.stop(true));
      if (disposeExit._tag === "Failure") {
        logError(
          `Failed to dispose local OpenDucktor host after startup failure: ${Cause.pretty(
            disposeExit.cause,
          )}`,
        );
      }
      return yield* Effect.fail(
        toWebHostStartupError(
          `Failed to initialize the local MCP bridge used for external OpenDucktor discovery: ${Cause.pretty(
            initializeExit.cause,
          )}`,
          initializeExit.cause,
        ),
      );
    }

    return {
      exited,
      port: server.port,
      stop,
    };
  });

export const startTypescriptHostBackend = (
  options: TypescriptHostBackendOptions,
): Promise<TypescriptHostBackend> => Effect.runPromise(startTypescriptHostBackendEffect(options));

export const __typescriptHostBackendTestInternals = {
  BufferedHostEventBus,
  stopTypescriptHostBackendServices,
  validateWebFrontendOrigin,
};
