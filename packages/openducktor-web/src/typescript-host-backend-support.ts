import {
  type HostEventBusPort,
  type HostEventChannel,
  type HostEventListener,
  type HostEventUnsubscribe,
  parseHostEventChannel,
} from "@openducktor/host";
import { Cause, Effect } from "effect";
import {
  causeToWebBoundaryError,
  combineWebErrors,
  errorMessage,
  runWebBoundary,
  runWebSyncBoundary,
  toWebOperationError,
  type WebError,
  WebOperationError,
  WebResourceError,
  WebValidationError,
} from "./effect/web-errors";
import { type WebLogger, writeWebLogEffect } from "./logger";

export type BufferedHostEvent = {
  id: number;
  payload: string;
};
export type BufferedHostEventReplay = {
  events: BufferedHostEvent[];
  skippedEventCount: number;
};
export type BufferedHostEventDeliveryReporter = {
  report(failure: { channel: HostEventChannel; cause: unknown }): void;
};
type StopTypescriptHostBackendServicesInput = {
  disposeHost: () => Effect.Effect<void, unknown>;
  logger: WebLogger;
  resolveExited: (exitCode: number) => void;
  stopServer: () => void | Promise<void>;
};

const EVENT_BUFFER_CAPACITY = 256;

export class BufferedHostEventStream {
  private nextId = 0;
  private readonly recent: BufferedHostEvent[] = [];
  private readonly listeners = new Set<(event: BufferedHostEvent) => void>();

  constructor(private readonly capacity: number) {}

  emit(payload: unknown, reportDeliveryFailure: (cause: unknown) => void): void {
    this.nextId += 1;
    const event = {
      id: this.nextId,
      payload: JSON.stringify(payload) ?? "null",
    };
    this.recent.push(event);
    if (this.recent.length > this.capacity) {
      this.recent.shift();
    }
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (cause) {
        reportDeliveryFailure(cause);
      }
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

  constructor(private readonly deliveryReporter: BufferedHostEventDeliveryReporter) {}

  publish(channel: string, payload: unknown): void {
    const hostChannel = this.requireChannel(channel);
    this.eventStream.emit({ channel: hostChannel, payload }, (cause) =>
      this.deliveryReporter.report({ channel: hostChannel, cause }),
    );
    const listeners = this.listenersByChannel.get(hostChannel);
    if (!listeners) {
      return;
    }
    for (const listener of [...listeners]) {
      try {
        listener(payload);
      } catch (cause) {
        this.deliveryReporter.report({ channel: hostChannel, cause });
      }
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
  logger,
  resolveExited,
  stopServer,
}: StopTypescriptHostBackendServicesInput): Effect.Effect<void, WebError> =>
  Effect.gen(function* () {
    let exitCode = 0;
    const failures: WebError[] = [];
    const disposeExit = yield* Effect.exit(disposeHost());
    if (disposeExit._tag === "Failure") {
      exitCode = 1;
      failures.push(
        toWebOperationError(causeToWebBoundaryError(disposeExit.cause), "web.host.dispose"),
      );
      const logResult = yield* Effect.either(
        writeWebLogEffect(logger, "error", Cause.pretty(disposeExit.cause)),
      );
      if (logResult._tag === "Left") {
        failures.push(logResult.left);
      }
    }
    const stopServerResult = yield* Effect.either(
      Effect.tryPromise({
        try: async () => {
          await stopServer();
        },
        catch: (cause) =>
          new WebOperationError({
            operation: "web.host.stop-server",
            message: errorMessage(cause),
            cause,
          }),
      }),
    );
    if (stopServerResult._tag === "Left") {
      exitCode = 1;
      failures.push(stopServerResult.left);
    }
    resolveExited(exitCode);
    const failure = combineWebErrors(
      "web.host.shutdown",
      "OpenDucktor TypeScript host shutdown failed.",
      failures,
    );
    if (failure) {
      return yield* failure;
    }
  });

export const stopTypescriptHostBackendServices = (
  input: StopTypescriptHostBackendServicesInput,
): Promise<void> => runWebBoundary(stopTypescriptHostBackendServicesEffect(input));
