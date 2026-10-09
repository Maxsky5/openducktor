import type { SessionLaunchRef } from "./session-launch-types";
import type { SessionLaunchAttempt } from "./session-launch-worker";
import type { SessionLaunchRuntimePort } from "../../ports/session-launch-runtime-port";
import type { HostError } from "../../effect/host-errors";
import type { SessionLaunchState } from "@openducktor/contracts";
import { Cause, Deferred, Effect } from "effect";
import { errorMessage } from "../../effect/host-errors";
import { toControlSessionRef } from "./task-workflow-session-storage";

/** Finish cleanup before waking callers that await this worker. */
export const createSessionLaunchSettlement = <
  Request extends SessionLaunchRef,
  State extends SessionLaunchState,
>(
  deps: {
    runtime: SessionLaunchRuntimePort;
    publish: (state: State) => Effect.Effect<void, HostError>;
  },
  snapshot: (attempt: SessionLaunchAttempt<Request, State>, settled?: boolean) => State,
) => {
  const recordFailure = (attempt: SessionLaunchAttempt<Request, State>, cause: unknown) => {
    attempt.snapshot.phase = attempt.canceled ? "canceled" : "failed";
    attempt.snapshot.failure = {
      message: errorMessage(cause),
      stage: attempt.stage,
      cleanupErrors: [],
    };
  };
  const observeSession = (attempt: SessionLaunchAttempt<Request, State>) =>
    Effect.gen(function* () {
      if (!attempt.snapshot.session || !attempt.snapshot.ownershipSaved) return;
      const observed = yield* Effect.result(
        deps.runtime.read(toControlSessionRef(attempt.snapshot.repoPath, attempt.snapshot.session)),
      );
      if (observed._tag === "Success") {
        if (observed.success.type === "live")
          attempt.snapshot.liveSession = observed.success.session;
        else delete attempt.snapshot.liveSession;
      } else {
        if (!attempt.snapshot.failure) {
          attempt.stage = "observation";
          recordFailure(attempt, observed.failure);
        } else attempt.snapshot.failure.cleanupErrors.push(observed.failure.message);
      }
    });
  const settleCancellation = (attempt: SessionLaunchAttempt<Request, State>) =>
    Effect.gen(function* () {
      if (!attempt.canceled) return false;
      attempt.snapshot.phase = "canceled";
      if (
        !attempt.snapshot.session ||
        attempt.runtimeStopAttempted ||
        attempt.stopOwnedBySessionCommand
      )
        return true;
      attempt.runtimeStopAttempted = true;
      const stopped = yield* Effect.result(
        deps.runtime.stopSession(
          toControlSessionRef(attempt.snapshot.repoPath, attempt.snapshot.session),
        ),
      );
      if (stopped._tag === "Failure") {
        attempt.snapshot.failure ??= {
          message: "Session launch was canceled.",
          stage: attempt.stage,
          cleanupErrors: [],
        };
        attempt.snapshot.failure.cleanupErrors.push(stopped.failure.message);
      }
      yield* observeSession(attempt);
      return true;
    });
  const publishSettled = (attempt: SessionLaunchAttempt<Request, State>) =>
    deps.publish(snapshot(attempt, true)).pipe(
      Effect.catch((cause) =>
        Effect.sync(() => {
          if (!attempt.snapshot.failure) recordFailure(attempt, cause);
          else attempt.snapshot.failure.cleanupErrors.push(cause.message);
        }),
      ),
    );
  const settleSession = (
    attempt: SessionLaunchAttempt<Request, State>,
    operation: Effect.Effect<unknown, unknown>,
  ) =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(operation);
      if (result._tag === "Failure") {
        recordFailure(attempt, Cause.squash(result.cause));
      }
      if (attempt.snapshot.session) {
        const released = yield* Effect.result(
          deps.runtime.holdWorkflowLaunch(
            toControlSessionRef(attempt.snapshot.repoPath, attempt.snapshot.session),
            false,
          ),
        );
        if (released._tag === "Failure") {
          if (!attempt.snapshot.failure) recordFailure(attempt, released.failure);
          else attempt.snapshot.failure.cleanupErrors.push(released.failure.message);
        }
      }
      yield* observeSession(attempt);
      yield* settleCancellation(attempt);
    });
  const settle = (
    attempt: SessionLaunchAttempt<Request, State>,
    done: SessionLaunchAttempt<Request, State>["done"],
    operation: Effect.Effect<unknown, unknown>,
  ) =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(operation);
      if (result._tag === "Failure") recordFailure(attempt, Cause.squash(result.cause));
      const canceledBeforePublication = yield* settleCancellation(attempt);
      // Recovery must also wait for this worker's final publication.
      yield* publishSettled(attempt);
      const complete = () => {
        delete attempt.stoppedSources;
        attempt.active = false;
        const result = snapshot(attempt);
        if (!result.recoveryAllowed) delete attempt.sendInput;
        return Deferred.succeed(done, result);
      };
      // Handle cancellation that arrived during publication before completing.
      yield* Effect.suspend(() =>
        attempt.canceled && !canceledBeforePublication
          ? settleCancellation(attempt).pipe(
              Effect.andThen(Effect.suspend(() => publishSettled(attempt))),
              Effect.andThen(Effect.suspend(complete)),
            )
          : complete(),
      );
    });
  return { settleSession, settle };
};
