import {
  type HostEventBusPort,
  type HostEventChannel,
  type HostEventListener,
  type HostEventUnsubscribe,
  parseHostEventChannel,
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
type StopTypescriptHostBackendServicesInput = {
  disposeHost: () => Effect.Effect<void, unknown>;
  resolveExited: (exitCode: number) => void;
  stopServer: () => void;
};

const EVENT_BUFFER_CAPACITY = 256;

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

  replayAfter(lastSeenId: number | null): BufferedHostEvent[] {
    if (lastSeenId === null) {
      return [];
    }
    return this.recent.filter((event) => event.id > lastSeenId);
  }

  replayAfterWithDiagnostics(lastSeenId: number | null): BufferedHostEventReplay {
    const events = this.replayAfter(lastSeenId);
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
  private readonly eventStream = new BufferedHostEventStream(EVENT_BUFFER_CAPACITY);
  private readonly listenersByChannel = new Map<HostEventChannel, Set<HostEventListener>>();

  publish(channel: string, payload: unknown): void {
    const hostChannel = this.requireChannel(channel);
    this.eventStream.emit({ channel: hostChannel, payload });
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

  stream(): BufferedHostEventStream {
    return this.eventStream;
  }

  private requireChannel(channel: string): HostEventChannel {
    try {
      return parseHostEventChannel(channel);
    } catch (cause) {
      throw new WebResourceError({
        resource: "host-event-channel",
        operation: "host-event-bus.require-channel",
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: { channel },
      });
    }
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
