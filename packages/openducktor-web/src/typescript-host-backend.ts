import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  createNodeHostCommandRouter,
  createNodeLocalAttachmentPort,
  type HostCommandRouter,
  type HostEventBusPort,
  type HostEventChannel,
  type HostEventListener,
  type HostEventUnsubscribe,
} from "@openducktor/host";

export type TypescriptHostBackendOptions = {
  port: number;
  frontendOrigin: string;
  controlToken: string;
  appToken: string;
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

const jsonResponse = (
  payload: unknown,
  init: ResponseInit = {},
  corsHeaders?: HeadersInit,
): Response =>
  new Response(JSON.stringify(payload), {
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

const parseJsonObjectBody = async (request: Request): Promise<Record<string, unknown>> => {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Malformed JSON request body.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Command request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
};

const parseLastEventId = (request: Request): number | null => {
  const raw = request.headers.get(LAST_EVENT_ID_HEADER);
  if (raw === null) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid Last-Event-ID header: ${raw}`);
  }
  return parsed;
};

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

const localAttachmentPreviewResponse = async (
  request: Request,
  localAttachmentPort: ReturnType<typeof createNodeLocalAttachmentPort>,
  corsHeaders: HeadersInit,
): Promise<Response> => {
  const requestUrl = new URL(request.url);
  const requestedPath = requestUrl.searchParams.get("path");
  if (!requestedPath) {
    return errorResponse("Local attachment preview path is required.", 400, corsHeaders);
  }

  let metadata: Stats;
  try {
    metadata = await stat(requestedPath);
  } catch (error) {
    return errorResponse(
      `Failed to stat local attachment preview: ${String(error)}`,
      404,
      corsHeaders,
    );
  }
  if (!metadata.isFile()) {
    return errorResponse("Local attachment preview path must reference a file", 400, corsHeaders);
  }

  const canonicalDirectory = await localAttachmentPort.canonicalizePath(
    localAttachmentPort.stageDirectory(),
  );
  const canonicalPath = await localAttachmentPort.canonicalizePath(requestedPath);
  if (!isWithinDirectory(canonicalDirectory, canonicalPath)) {
    return errorResponse(
      "Local attachment preview is only available for staged attachment files.",
      403,
      corsHeaders,
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
};

export const startTypescriptHostBackend = ({
  port,
  frontendOrigin,
  controlToken,
  appToken,
}: TypescriptHostBackendOptions): TypescriptHostBackend => {
  const validatedFrontendOrigin = validateWebFrontendOrigin(frontendOrigin);
  const allowedOrigins = allowedOriginsForFrontendOrigin(validatedFrontendOrigin);
  const eventBus = new BufferedHostEventBus();
  const localAttachments = createNodeLocalAttachmentPort();
  const hostCommandRouter: HostCommandRouter = createNodeHostCommandRouter({
    eventBus,
    localAttachments,
  });
  let shutdownStarted = false;
  let resolveExited: (exitCode: number) => void = () => {};
  const exited = new Promise<number>((resolve) => {
    resolveExited = resolve;
  });

  const stop = async (): Promise<void> => {
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;
    server.stop(true);
    resolveExited(0);
  };

  const server = Bun.serve({
    hostname: LOCALHOST,
    port,
    async fetch(request) {
      if (request.method === "OPTIONS") {
        return preflightResponse(request, allowedOrigins);
      }

      const corsHeaders = corsHeadersForRequest(request, allowedOrigins);
      if (corsHeaders instanceof Response) {
        return corsHeaders;
      }

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
        setTimeout(() => {
          void stop();
        }, 10);
        return jsonResponse({ ok: true }, { status: 202 }, corsHeaders);
      }

      const streamChannel = STREAM_PATH_TO_CHANNEL.get(requestUrl.pathname.replace(/^\//, ""));
      if (streamChannel && request.method === "GET") {
        const tokenError = validateAppCookieOrHeader(request, appToken);
        if (tokenError) {
          return tokenError;
        }
        if (shutdownStarted) {
          return errorResponse(
            "Browser backend is shutting down and is no longer accepting new work.",
            503,
            corsHeaders,
          );
        }
        try {
          return createSseResponse(
            eventBus.streamFor(streamChannel),
            parseLastEventId(request),
            corsHeaders,
          );
        } catch (error) {
          return errorResponse(
            error instanceof Error ? error.message : String(error),
            400,
            corsHeaders,
          );
        }
      }

      if (requestUrl.pathname === "/local-attachment-preview" && request.method === "GET") {
        const tokenError = validateAppSessionCookie(request, appToken);
        if (tokenError) {
          return tokenError;
        }
        return localAttachmentPreviewResponse(request, localAttachments, corsHeaders);
      }

      const invokeMatch = /^\/invoke\/([^/]+)$/.exec(requestUrl.pathname);
      if (invokeMatch && request.method === "POST") {
        const tokenError = validateAppTokenHeader(request, appToken);
        if (tokenError) {
          return tokenError;
        }
        if (shutdownStarted) {
          return errorResponse(
            "Browser backend is shutting down and is no longer accepting new work.",
            503,
            corsHeaders,
          );
        }
        try {
          const args = await parseJsonObjectBody(request);
          const [, command] = invokeMatch;
          if (!command) {
            return errorResponse("Host command is required.", 400, corsHeaders);
          }
          const result = await hostCommandRouter.invoke(decodeURIComponent(command), args);
          return jsonResponse(result, undefined, corsHeaders);
        } catch (error) {
          return errorResponse(
            error instanceof Error ? error.message : String(error),
            500,
            corsHeaders,
          );
        }
      }

      return errorResponse("Not found", 404, corsHeaders);
    },
  });

  if (server.port === undefined) {
    server.stop(true);
    throw new Error("OpenDucktor TypeScript host did not expose a listening port.");
  }

  return {
    exited,
    port: server.port,
    stop,
  };
};

export const __typescriptHostBackendTestInternals = {
  BufferedHostEventBus,
  validateWebFrontendOrigin,
};
