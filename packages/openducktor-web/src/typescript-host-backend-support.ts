import {
  type HostEventChannel,
  type HostEventEnvelope,
  parseHostEventChannel,
} from "@openducktor/contracts";
import { hostEventStreamEventName } from "./host-event-stream-name";
import type { HostEventBusPort, HostEventListener, HostEventUnsubscribe } from "@openducktor/host";
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
import { parseHttpOriginEffect, portOfHttpOrigin } from "./http-origin";

export type BufferedHostEvent = {
  id: number;
  payload: string;
  eventName: string;
  bytes: number;
};
export type BufferedHostEventReplay = {
  events: BufferedHostEvent[];
  /** SSE event names whose missed events are no longer retained. */
  gaps: string[];
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

type ReplayBuffer = {
  events: BufferedHostEvent[];
  bytes: number;
  evictedThroughId: number;
};
export type ReplayLimits = { events: number; bytes: number; totalBytes: number };

const DEFAULT_REPLAY_LIMITS: ReplayLimits = {
  events: 4096,
  bytes: 2 * 1024 * 1024,
  totalBytes: 16 * 1024 * 1024,
};

/**
 * Retains recent host events for SSE reconnects. Each SSE event name has its own buffer, so a busy
 * repository or channel cannot evict the events of another one until all buffers reach
 * `totalBytes`.
 */
export class BufferedHostEventStream {
  /** Event IDs are valid only for this host process. */
  readonly hostEpoch = crypto.randomUUID();
  private nextId = 0;
  private totalBytes = 0;
  private readonly buffers = new Map<string, ReplayBuffer>();
  private readonly listeners = new Set<(event: BufferedHostEvent) => void>();

  constructor(private readonly limits: ReplayLimits = DEFAULT_REPLAY_LIMITS) {}

  currentEventId(): number {
    return this.nextId;
  }

  emit(envelope: HostEventEnvelope, reportDeliveryFailure: (cause: unknown) => void): void {
    this.nextId += 1;
    const payload = JSON.stringify(envelope);
    const event = {
      id: this.nextId,
      payload,
      eventName: hostEventStreamEventName(envelope),
      bytes: Buffer.byteLength(payload),
    };
    this.retain(event);
    // oxlint-disable-next-line unicorn/no-useless-spread -- listeners can unsubscribe during delivery
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (cause) {
        reportDeliveryFailure(cause);
      }
    }
  }

  /** Returns the retained events after `lastSeenId` in publication order. */
  replayAfter(lastSeenId: number): BufferedHostEventReplay {
    const events: BufferedHostEvent[] = [];
    const gaps: string[] = [];
    for (const [eventName, buffer] of this.buffers) {
      if (buffer.evictedThroughId > lastSeenId) gaps.push(eventName);
      for (const event of buffer.events) {
        if (event.id > lastSeenId) events.push(event);
      }
    }
    events.sort((left, right) => left.id - right.id);
    return { events, gaps };
  }

  subscribe(listener: (event: BufferedHostEvent) => void): HostEventUnsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private retain(event: BufferedHostEvent): void {
    let buffer = this.buffers.get(event.eventName);
    if (!buffer) {
      buffer = { events: [], bytes: 0, evictedThroughId: 0 };
      this.buffers.set(event.eventName, buffer);
    }
    buffer.events.push(event);
    buffer.bytes += event.bytes;
    this.totalBytes += event.bytes;
    while (buffer.events.length > this.limits.events || buffer.bytes > this.limits.bytes) {
      this.evictFirst(buffer);
    }
    // The total limit evicts the oldest retained event of any event name.
    while (this.totalBytes > this.limits.totalBytes) {
      let oldest: ReplayBuffer | null = null;
      for (const candidate of this.buffers.values()) {
        const firstId = candidate.events[0]?.id;
        if (firstId !== undefined && firstId < (oldest?.events[0]?.id ?? Infinity)) {
          oldest = candidate;
        }
      }
      if (!oldest) break;
      this.evictFirst(oldest);
    }
  }

  private evictFirst(buffer: ReplayBuffer): void {
    const evicted = buffer.events.shift();
    if (!evicted) return;
    buffer.bytes -= evicted.bytes;
    this.totalBytes -= evicted.bytes;
    buffer.evictedThroughId = evicted.id;
  }
}

export class BufferedHostEventBus implements HostEventBusPort {
  private readonly eventStream = new BufferedHostEventStream();
  private readonly listenersByChannel = new Map<HostEventChannel, Set<HostEventListener>>();

  constructor(private readonly deliveryReporter: BufferedHostEventDeliveryReporter) {}

  publish(envelope: HostEventEnvelope): void {
    this.eventStream.emit(envelope, (cause) =>
      this.deliveryReporter.report({ channel: envelope.channel, cause }),
    );
    const listeners = this.listenersByChannel.get(envelope.channel);
    if (!listeners) {
      return;
    }
    // oxlint-disable-next-line unicorn/no-useless-spread -- listeners can unsubscribe during delivery
    for (const listener of [...listeners]) {
      try {
        listener(envelope);
      } catch (cause) {
        this.deliveryReporter.report({ channel: envelope.channel, cause });
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

    const parsed = yield* parseHttpOriginEffect(trimmed, "browser frontend origin", {
      field: "frontendOrigin",
    });
    return parsed.origin;
  });

export const validateWebFrontendOrigin = (origin: string): string =>
  runWebSyncBoundary(validateWebFrontendOriginEffect(origin));

export const allowedOriginsForFrontendOrigin = (
  frontendOrigin: string,
  frontendPort?: number,
): Set<string> => {
  const parsed = new URL(frontendOrigin);
  const port = String(frontendPort ?? Number(portOfHttpOrigin(parsed)));
  const loopbackOrigins = ["127.0.0.1", "localhost", "[::1]"].map(
    (host) => new URL(`http://${host}:${port}`).origin,
  );
  const origins = new Set([parsed.origin, ...loopbackOrigins]);
  parsed.hostname = parsed.hostname.replace(/\.$/u, "");
  origins.add(parsed.origin);
  return origins;
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
      const logResult = yield* Effect.result(
        writeWebLogEffect(logger, "error", Cause.pretty(disposeExit.cause)),
      );
      if (logResult._tag === "Failure") {
        failures.push(logResult.failure);
      }
    }
    const stopServerResult = yield* Effect.result(
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
    if (stopServerResult._tag === "Failure") {
      exitCode = 1;
      failures.push(stopServerResult.failure);
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
