import { Effect } from "effect";
import { type HostError, isHostError, toHostOperationError } from "../../effect/host-errors";
import type { ClaudeAgentSdkEvent, ClaudeSessionContext } from "../claude/claude-agent-sdk-types";
import type { ClaudeRuntimeEventListener } from "./claude-live-session-event-hub";

type CreateClaudeLiveSessionEventCoordinatorInput = {
  readonly runtimeId: string;
  readonly processEvent: (
    session: ClaudeSessionContext,
    event: ClaudeAgentSdkEvent,
  ) => Promise<void>;
  readonly readForwardingFailure: () => HostError | null;
};

export const createClaudeLiveSessionEventCoordinator = ({
  processEvent,
  readForwardingFailure,
  runtimeId,
}: CreateClaudeLiveSessionEventCoordinatorInput) => {
  const queuedEvents: Array<{
    session: ClaudeSessionContext;
    event: ClaudeAgentSdkEvent;
  }> = [];
  const barrierWaiters: Array<() => void> = [];
  let barrierDepth = 0;
  let forwarding = false;
  let forwardingChain = Promise.resolve();
  let released = false;

  const drainEvents = (): Promise<void> => {
    forwardingChain = forwardingChain.then(async () => {
      while (forwarding && !released && barrierDepth === 0 && queuedEvents.length > 0) {
        const queued = queuedEvents.shift();
        if (queued) {
          await processEvent(queued.session, queued.event);
        }
      }
    });
    return forwardingChain;
  };

  const enqueueEvent: ClaudeRuntimeEventListener = (session, event) => {
    if (released) {
      throw new Error(`Claude runtime '${runtimeId}' is already released.`);
    }
    if (session.runtimeId !== runtimeId) {
      throw new Error(
        `Claude event for runtime '${session.runtimeId}' cannot enter runtime '${runtimeId}'.`,
      );
    }
    queuedEvents.push({ session, event });
    if (forwarding && barrierDepth === 0) {
      void drainEvents();
    }
  };

  const waitForOpenBarrier = (): Promise<void> => {
    if (barrierDepth === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      barrierWaiters.push(resolve);
    });
  };

  const releaseBarrier = (): void => {
    barrierDepth -= 1;
    if (barrierDepth > 0) {
      return;
    }
    const waiters = barrierWaiters.splice(0);
    for (const resolve of waiters) {
      resolve();
    }
    if (forwarding && !released) {
      void drainEvents();
    }
  };

  const flush = (): Effect.Effect<void, HostError> =>
    Effect.tryPromise({
      try: async () => {
        await waitForOpenBarrier();
        await drainEvents();
        const forwardingFailure = readForwardingFailure();
        if (forwardingFailure) {
          throw forwardingFailure;
        }
      },
      catch: (cause) =>
        isHostError(cause)
          ? cause
          : toHostOperationError(cause, "claude-live-session.flush-events", { runtimeId }),
    });

  const runControlMutation = <Value>(
    effect: Effect.Effect<Value, HostError>,
  ): Effect.Effect<Value, HostError> =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        Effect.acquireUseRelease(
          Effect.sync(() => {
            barrierDepth += 1;
          }),
          () => effect,
          () => Effect.sync(releaseBarrier),
        ),
      );
      yield* flush();
      if (result._tag === "Left") {
        return yield* Effect.fail(result.left);
      }
      return result.right;
    });

  return {
    enqueueEvent,
    flush,
    isReleased: () => released,
    release: () => {
      released = true;
      queuedEvents.splice(0);
    },
    runControlMutation,
    startForwarding: (): Effect.Effect<void, HostError> =>
      Effect.tryPromise({
        try: async () => {
          if (released) {
            throw new Error(`Claude runtime '${runtimeId}' is already released.`);
          }
          forwarding = true;
          await drainEvents();
        },
        catch: (cause) =>
          toHostOperationError(cause, "claude-live-session.start-forwarding", { runtimeId }),
      }),
    stopForwarding: () => {
      forwarding = false;
    },
  };
};
