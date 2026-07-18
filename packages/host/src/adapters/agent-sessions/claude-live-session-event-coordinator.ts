import { Effect } from "effect";
import { type HostError, HostOperationError } from "../../effect/host-errors";
import type { ClaudeAgentSdkEvent, ClaudeSessionContext } from "../claude/claude-agent-sdk-types";
import type { ClaudeRuntimeEventListener } from "./claude-live-session-event-hub";

type CreateClaudeLiveSessionEventCoordinatorInput = {
  readonly runtimeId: string;
  readonly processEvent: (
    session: ClaudeSessionContext,
    event: ClaudeAgentSdkEvent,
  ) => Effect.Effect<void, HostError>;
};

export const createClaudeLiveSessionEventCoordinator = ({
  processEvent,
  runtimeId,
}: CreateClaudeLiveSessionEventCoordinatorInput) => {
  const queuedEvents: Array<{
    session: ClaudeSessionContext;
    event: ClaudeAgentSdkEvent;
  }> = [];
  const operationSemaphore = Effect.unsafeMakeSemaphore(1);
  let backgroundDrainScheduled = false;
  let forwarding = false;
  let forwardingFailure: HostError | null = null;
  let released = false;

  const runtimeReleasedError = (): HostOperationError =>
    new HostOperationError({
      operation: "claude-live-session.event-coordinator",
      message: `Claude runtime '${runtimeId}' is already released.`,
      details: { runtimeId },
    });

  const drainQueuedEvents = Effect.gen(function* () {
    while (forwarding && !released && queuedEvents.length > 0) {
      const queued = queuedEvents.shift();
      if (!queued) {
        continue;
      }
      const result = yield* Effect.either(processEvent(queued.session, queued.event));
      if (result._tag === "Left" && forwardingFailure === null) {
        forwardingFailure = result.left;
      }
    }
  });

  const takeForwardingFailure = (): Effect.Effect<void, HostError> =>
    Effect.suspend(() => {
      const failure = forwardingFailure;
      forwardingFailure = null;
      return failure ? Effect.fail(failure) : Effect.void;
    });

  const drainInBackground = (): void => {
    if (backgroundDrainScheduled) {
      return;
    }
    backgroundDrainScheduled = true;
    Effect.runFork(
      operationSemaphore
        .withPermits(1)(drainQueuedEvents)
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              backgroundDrainScheduled = false;
              if (forwarding && !released && queuedEvents.length > 0) {
                drainInBackground();
              }
            }),
          ),
        ),
    );
  };

  const enqueueEvent: ClaudeRuntimeEventListener = (session, event) => {
    if (released) {
      throw runtimeReleasedError();
    }
    if (session.runtimeId !== runtimeId) {
      throw new HostOperationError({
        operation: "claude-live-session.enqueue-event",
        message: `Claude event for runtime '${session.runtimeId}' cannot enter runtime '${runtimeId}'.`,
        details: { eventRuntimeId: session.runtimeId, runtimeId },
      });
    }
    queuedEvents.push({ session, event });
    if (forwarding) {
      drainInBackground();
    }
  };

  const flush = (): Effect.Effect<void, HostError> =>
    operationSemaphore.withPermits(1)(
      Effect.gen(function* () {
        yield* drainQueuedEvents;
        yield* takeForwardingFailure();
      }),
    );

  const runControlMutation = <Value>(
    effect: Effect.Effect<Value, HostError>,
  ): Effect.Effect<Value, HostError> =>
    operationSemaphore.withPermits(1)(
      Effect.gen(function* () {
        yield* takeForwardingFailure();
        const result = yield* Effect.either(effect);
        yield* drainQueuedEvents;
        yield* takeForwardingFailure();
        if (result._tag === "Left") {
          return yield* Effect.fail(result.left);
        }
        return result.right;
      }),
    );

  const shutdown = <Value>(
    effect: Effect.Effect<Value, HostError>,
  ): Effect.Effect<Value, HostError> =>
    operationSemaphore.withPermits(1)(
      Effect.gen(function* () {
        if (released) {
          return yield* Effect.fail(runtimeReleasedError());
        }
        forwarding = false;
        return yield* effect.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              released = true;
              forwardingFailure = null;
              queuedEvents.splice(0);
            }),
          ),
        );
      }),
    );

  return {
    enqueueEvent,
    flush,
    isReleased: () => released,
    runControlMutation,
    shutdown,
    startForwarding: (): Effect.Effect<void, HostError> =>
      operationSemaphore.withPermits(1)(
        Effect.gen(function* () {
          if (released) {
            return yield* Effect.fail(runtimeReleasedError());
          }
          forwarding = true;
          yield* drainQueuedEvents;
          yield* takeForwardingFailure();
        }),
      ),
  };
};
