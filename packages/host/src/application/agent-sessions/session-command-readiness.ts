import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { BLOCKED_ON_INPUT_REASON } from "@openducktor/core";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";
import { hasBlockingInput } from "./session-foreground-readiness";

/** The live session checks that each session command runs before it calls the runtime. */
export const createSessionCommandReadiness = (
  runtime: Pick<AgentSessionLiveStateService, "read">,
) => {
  const readAvailableSession = (ref: AgentSessionLiveRef) =>
    Effect.gen(function* () {
      const { repoPath, runtimeKind, workingDirectory, externalSessionId } = ref;
      const live = yield* runtime.read({
        repoPath,
        runtimeKind,
        workingDirectory,
        externalSessionId,
      });
      if (live.type === "live" && live.session.statusUnavailableReason)
        return yield* new HostOperationError({
          operation: "session.prepare",
          message: live.session.statusUnavailableReason,
        });
      return live;
    });
  const checkPending = (ref: AgentSessionLiveRef) =>
    readAvailableSession(ref).pipe(
      Effect.flatMap((live) => {
        if (live.type === "live" && hasBlockingInput(live.session))
          return new HostOperationError({
            operation: "session.prepare",
            message: BLOCKED_ON_INPUT_REASON,
          });
        return Effect.succeed(live);
      }),
    );
  const requireReadySession = (ref: AgentSessionLiveRef) =>
    Effect.gen(function* () {
      const live = yield* checkPending(ref);
      if (live.type !== "live")
        return yield* new HostValidationError({
          field: "externalSessionId",
          message: "The session is not attached to its runtime. Reopen the session before sending.",
        });
      return live;
    });
  return { readAvailableSession, checkPending, requireReadySession };
};
