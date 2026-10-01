import { Cause, Effect } from "effect";
import type { AgentSessionLiveFaultLogger } from "../../application/agent-sessions/agent-session-live-state-service";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import { type HostLifecycleLogger, writeHostLifecycleLog } from "../host-lifecycle";

type FailureReporter = (failure: HostOperationErrorAggregate) => Effect.Effect<void, never>;

export const defaultLifecycleLogger: HostLifecycleLogger = {
  error: (message) => Effect.sync(() => console.error(message)),
  info: (message) => Effect.sync(() => console.info(message)),
};

export const createLiveSessionFaultLogger =
  (lifecycleLogger: HostLifecycleLogger): AgentSessionLiveFaultLogger =>
  (message) =>
    writeHostLifecycleLog(lifecycleLogger, "error", message);

export const createRuntimeFailureReporter =
  (lifecycleLogger: HostLifecycleLogger, onBackgroundFailure: FailureReporter): FailureReporter =>
  (failure) =>
    writeHostLifecycleLog(
      lifecycleLogger,
      "error",
      `Runtime failed: ${Cause.pretty(Cause.fail(failure), { renderErrorCause: true })}`,
    ).pipe(Effect.catchAll(onBackgroundFailure));
