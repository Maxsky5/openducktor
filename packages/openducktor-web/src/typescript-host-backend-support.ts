import {
  type HostEventChannel,
  type HostReplayLoss,
  type HostReplayBoundary,
  type HostEventEnvelope,
  parseHostEventChannel,
} from "@openducktor/contracts";
import { randomUUID } from "node:crypto";
import { agentSessionLiveEnvelopeRepoPath } from "@openducktor/host-client";
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
  hostEpoch: string;
  bytes: number;
  loss: HostReplayLoss;
};
export type BufferedHostEventReplay = {
  events: BufferedHostEvent[];
  boundary: HostReplayBoundary;
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
  readonly hostEpoch = randomUUID();
  private nextId = 0;
  private readonly buffers = new Map<string, BufferedHostEvent[]>();
  private readonly losses = new Map<string, { id: number; loss: HostReplayLoss }>();
  private readonly listeners = new Set<(event: BufferedHostEvent) => void>();

  constructor(private readonly capacity: number) {}

  currentEventId(): number {
    return this.nextId;
  }

  private scope(envelope: HostEventEnvelope): HostReplayLoss {
    if (envelope.channel !== "openducktor://agent-session-live-event")
      return { channel: envelope.channel, facet: "other" };
    const payload = envelope.payload;
    const loss: HostReplayLoss = {
      channel: envelope.channel,
      repoPath: agentSessionLiveEnvelopeRepoPath(payload),
      facet: payload.type === "transcript_event" ? "transcript" : "state",
    };
    if (payload.type === "transcript_event") loss.refs = [payload.event.sessionRef];
    else if (payload.type === "session_upsert") loss.refs = [payload.session.ref];
    else if (payload.type === "session_removed") loss.refs = [payload.ref];
    return loss;
  }

  emit(envelope: HostEventEnvelope, reportDeliveryFailure: (cause: unknown) => void): void {
    const payload = JSON.stringify(envelope);
    const event: BufferedHostEvent = {
      id: ++this.nextId,
      hostEpoch: this.hostEpoch,
      payload,
      eventName: hostEventStreamEventName(envelope),
      bytes: new TextEncoder().encode(payload).byteLength,
      loss: this.scope(envelope),
    };
    // Transcript, live state, and each other channel have independent retention.
    const bucket = `${envelope.channel}:${event.loss.facet}`;
    const recent = this.buffers.get(bucket) ?? [];
    this.buffers.set(bucket, recent);
    recent.push(event);
    let bytes = recent.reduce((sum, entry) => sum + entry.bytes, 0);
    while (recent.length > this.capacity || bytes > 4 * 1024 * 1024) {
      const evicted = recent.shift()!;
      bytes -= evicted.bytes;
      this.losses.set(JSON.stringify(evicted.loss), { id: evicted.id, loss: evicted.loss });
      while (this.losses.size > 512) {
        // Compaction widens scope; it never forgets uncertainty.
        const oldestKey = Array.from(this.losses.entries()).find(
          ([, value]) => value.loss.repoPath || value.loss.refs,
        )?.[0];
        if (!oldestKey) throw new Error("Host replay loss metadata exceeded its channel bound.");
        const oldest = this.losses.get(oldestKey)!;
        this.losses.delete(oldestKey);
        const coarse: HostReplayLoss = { channel: oldest.loss.channel, facet: oldest.loss.facet };
        const coarseKey = JSON.stringify(coarse);
        const prior = this.losses.get(coarseKey);
        this.losses.set(coarseKey, { id: Math.max(oldest.id, prior?.id ?? 0), loss: coarse });
      }
    }
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(event);
      } catch (cause) {
        reportDeliveryFailure(cause);
      }
    }
  }

  replayAfter(lastSeenId: number | null): BufferedHostEvent[] {
    return lastSeenId === null
      ? []
      : Array.from(this.buffers.values())
          .flat()
          .filter((event) => event.id > lastSeenId)
          .sort((a, b) => a.id - b.id);
  }

  replayAfterWithDiagnostics(cursor: string | null): BufferedHostEventReplay {
    let lastSeenId: number | null = null;
    let hostChanged = false;
    if (cursor !== null) {
      const match = /^([0-9a-f-]{36}):(0|[1-9][0-9]*)$/u.exec(cursor);
      if (!match || !Number.isSafeInteger(Number(match[2])))
        throw new Error("Invalid host replay cursor. Reload the browser to reconnect.");
      hostChanged = match[1] !== this.hostEpoch;
      lastSeenId = hostChanged ? null : Number(match[2]);
    }
    if (lastSeenId !== null && lastSeenId > this.nextId)
      throw new Error("Host replay cursor is ahead of the host. Reload the browser to reconnect.");
    const events = this.replayAfter(lastSeenId);
    const losses =
      lastSeenId === null
        ? []
        : Array.from(this.losses.values())
            .filter((loss) => loss.id > lastSeenId)
            .map((loss) => loss.loss);
    return {
      events,
      boundary: { hostEpoch: this.hostEpoch, sequence: this.nextId, hostChanged, losses },
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

  get hostEpoch(): string {
    return this.eventStream.hostEpoch;
  }

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
