import type {
  HostEventBusPort,
  HostEventChannel,
  HostEventListener,
  HostEventUnsubscribe,
} from "@openducktor/host";
import { Cause, Effect } from "effect";
import {
  errorMessage,
  runWebBoundary,
  runWebSyncBoundary,
  WebOperationError,
  WebResourceError,
  WebValidationError,
} from "./effect/web-errors";
import { logError } from "./logger";

export type BufferedHostEvent = {
  id: number;
  payload: string;
};
export type BufferedHostEventReplay = {
  events: BufferedHostEvent[];
  skippedEventCount: number;
};
type JsonRpcRequestId = string | number;
type StopTypescriptHostBackendServicesInput = {
  disposeHost: () => Effect.Effect<void, unknown>;
  resolveExited: (exitCode: number) => void;
  stopServer: () => void;
};

const EVENT_BUFFER_CAPACITY = 256;
const CODEX_APP_SERVER_EVENT_CHANNEL = "openducktor://codex-app-server-event";

export const STREAM_PATH_TO_CHANNEL = new Map<string, HostEventChannel>([
  ["events", "openducktor://run-event"],
  ["dev-server-events", "openducktor://dev-server-event"],
  ["task-events", "openducktor://task-event"],
  ["codex-app-server-events", CODEX_APP_SERVER_EVENT_CHANNEL],
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isJsonRpcRequestId = (value: unknown): value is JsonRpcRequestId =>
  typeof value === "string" || typeof value === "number";

const readCodexServerRequestRef = (
  value: unknown,
): { runtimeId: string; requestId: JsonRpcRequestId } | null => {
  if (!isRecord(value) || value.kind !== "server_request" || typeof value.runtimeId !== "string") {
    return null;
  }
  const message = value.message;
  if (!isRecord(message) || !isJsonRpcRequestId(message.id)) {
    return null;
  }
  return { runtimeId: value.runtimeId, requestId: message.id };
};

const readResolvedCodexServerRequestRef = (
  value: unknown,
): { runtimeId: string; requestId: JsonRpcRequestId } | null => {
  if (!isRecord(value) || value.kind !== "notification" || typeof value.runtimeId !== "string") {
    return null;
  }
  const message = value.message;
  if (!isRecord(message) || message.method !== "serverRequest/resolved") {
    return null;
  }
  const params = message.params;
  if (!isRecord(params)) {
    return null;
  }
  const requestId = params.requestId ?? params.request_id;
  return isJsonRpcRequestId(requestId) ? { runtimeId: value.runtimeId, requestId } : null;
};

const isMatchingCodexServerRequestEvent =
  (runtimeId: string, requestId: JsonRpcRequestId) =>
  (event: BufferedHostEvent): boolean => {
    const payload = JSON.parse(event.payload) as unknown;
    const ref = readCodexServerRequestRef(payload);
    return ref?.runtimeId === runtimeId && ref.requestId === requestId;
  };

export class BufferedHostEventStream {
  private nextId = 0;
  private readonly recent: BufferedHostEvent[] = [];
  private readonly listeners = new Set<(event: BufferedHostEvent) => void>();

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

  removeRecent(predicate: (event: BufferedHostEvent) => boolean): void {
    for (let index = this.recent.length - 1; index >= 0; index -= 1) {
      const event = this.recent[index];
      if (event && predicate(event)) {
        this.recent.splice(index, 1);
      }
    }
  }

  replayAfter(
    lastSeenId: number | null,
    options: { includeRecentWhenNoLastEventId?: boolean } = {},
  ): BufferedHostEvent[] {
    if (lastSeenId === null) {
      return options.includeRecentWhenNoLastEventId ? [...this.recent] : [];
    }
    return this.recent.filter((event) => event.id > lastSeenId);
  }

  replayAfterWithDiagnostics(
    lastSeenId: number | null,
    options: { includeRecentWhenNoLastEventId?: boolean } = {},
  ): BufferedHostEventReplay {
    const events = this.replayAfter(lastSeenId, options);
    if (lastSeenId === null) {
      return { events, skippedEventCount: 0 };
    }

    const firstAvailableEventId = this.recent[0]?.id ?? null;
    if (firstAvailableEventId === null || lastSeenId >= firstAvailableEventId - 1) {
      return { events, skippedEventCount: 0 };
    }

    return {
      events,
      skippedEventCount: firstAvailableEventId - lastSeenId - 1,
    };
  }

  subscribe(listener: (event: BufferedHostEvent) => void): HostEventUnsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export class BufferedHostEventBus implements HostEventBusPort {
  private readonly streams = new Map<HostEventChannel, BufferedHostEventStream>();
  private readonly listenersByChannel = new Map<HostEventChannel, Set<HostEventListener>>();

  publish(channel: string, payload: unknown): void {
    const hostChannel = this.requireChannel(channel);
    if (hostChannel === CODEX_APP_SERVER_EVENT_CHANNEL) {
      this.forgetResolvedCodexAppServerRequest(payload);
    }
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

  forgetCodexAppServerRequest(runtimeId: string, requestId: JsonRpcRequestId): void {
    this.streams
      .get(CODEX_APP_SERVER_EVENT_CHANNEL)
      ?.removeRecent(isMatchingCodexServerRequestEvent(runtimeId, requestId));
  }

  private forgetResolvedCodexAppServerRequest(payload: unknown): void {
    const ref = readResolvedCodexServerRequestRef(payload);
    if (!ref) {
      return;
    }
    this.forgetCodexAppServerRequest(ref.runtimeId, ref.requestId);
  }

  private requireChannel(channel: string): HostEventChannel {
    for (const knownChannel of STREAM_PATH_TO_CHANNEL.values()) {
      if (knownChannel === channel) {
        return knownChannel;
      }
    }
    throw new WebResourceError({
      resource: "host-event-channel",
      operation: "host-event-bus.require-channel",
      message: `Unknown OpenDucktor host event channel: ${channel}`,
      details: { channel },
    });
  }
}

export const validateWebFrontendOriginEffect = (
  origin: string,
): Effect.Effect<string, WebValidationError> =>
  Effect.gen(function* () {
    const trimmed = origin.trim();
    if (!trimmed) {
      return yield* new WebValidationError({
        field: "frontendOrigin",
        message: "browser frontend origin cannot be empty",
      });
    }

    const parsed = yield* Effect.try({
      try: () => new URL(trimmed),
      catch: (cause) =>
        new WebValidationError({
          field: "frontendOrigin",
          message: `invalid browser frontend origin configured: ${trimmed}`,
          cause,
          details: { origin },
        }),
    });

    if (parsed.protocol !== "http:") {
      return yield* new WebValidationError({
        field: "frontendOrigin",
        message: "browser frontend origin must use http",
        details: { origin },
      });
    }
    if (parsed.username || parsed.password) {
      return yield* new WebValidationError({
        field: "frontendOrigin",
        message: "browser frontend origin must not include credentials",
        details: { origin },
      });
    }
    if (parsed.port.length === 0) {
      return yield* new WebValidationError({
        field: "frontendOrigin",
        message: "browser frontend origin must include an explicit port",
        details: { origin },
      });
    }
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return yield* new WebValidationError({
        field: "frontendOrigin",
        message: "browser frontend origin must not include a path, query string, or fragment",
        details: { origin },
      });
    }
    if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname)) {
      return yield* new WebValidationError({
        field: "frontendOrigin",
        message: "browser frontend origin must target 127.0.0.1, localhost, or [::1]",
        details: { origin },
      });
    }

    return parsed.origin;
  });

export const validateWebFrontendOrigin = (origin: string): string =>
  runWebSyncBoundary(validateWebFrontendOriginEffect(origin));

export const allowedOriginsForFrontendOrigin = (frontendOrigin: string): Set<string> => {
  const parsed = new URL(frontendOrigin);
  return new Set([
    `http://127.0.0.1:${parsed.port}`,
    `http://localhost:${parsed.port}`,
    `http://[::1]:${parsed.port}`,
  ]);
};

export const stopTypescriptHostBackendServicesEffect = ({
  disposeHost,
  resolveExited,
  stopServer,
}: StopTypescriptHostBackendServicesInput): Effect.Effect<void, WebOperationError> =>
  Effect.gen(function* () {
    let exitCode = 0;
    const disposeExit = yield* Effect.exit(disposeHost());
    if (disposeExit._tag === "Failure") {
      exitCode = 1;
      logError(Cause.pretty(disposeExit.cause));
    }
    const stopServerExit = yield* Effect.exit(
      Effect.try({
        try: stopServer,
        catch: (cause) =>
          new WebOperationError({
            operation: "web.host.stop-server",
            message: errorMessage(cause),
            cause,
          }),
      }),
    );
    let stopServerError: WebOperationError | null = null;
    if (stopServerExit._tag === "Failure") {
      stopServerError =
        Array.from(Cause.failures(stopServerExit.cause))[0] ??
        new WebOperationError({
          operation: "web.host.stop-server",
          message: Cause.pretty(stopServerExit.cause),
          cause: stopServerExit.cause,
        });
    }
    if (stopServerError) {
      exitCode = 1;
    }
    resolveExited(exitCode);
    if (stopServerError) {
      return yield* stopServerError;
    }
  });

export const stopTypescriptHostBackendServices = (
  input: StopTypescriptHostBackendServicesInput,
): Promise<void> => runWebBoundary(stopTypescriptHostBackendServicesEffect(input));
