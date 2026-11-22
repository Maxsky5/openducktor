import type {
  AgentSessionBackgroundTaskStopInput,
  AgentSessionLiveRef,
} from "@openducktor/contracts";
import { Effect, Exit } from "effect";
import type { HostError, HostOperationErrorAggregate } from "../../effect/host-errors";
import type { CodexSessionController } from "./codex-live-session-adapter-contract";

/** The controls of the Codex live-session adapter that end a session or one of its tasks. */
export const createCodexSessionStops = ({
  controller,
  settleSession,
  refreshProjection,
  sessionError,
}: {
  readonly controller: Pick<
    CodexSessionController,
    "stopSession" | "releaseSession" | "stopBackgroundTask"
  >;
  readonly settleSession: (input: AgentSessionLiveRef) => Effect.Effect<void, HostError>;
  readonly refreshProjection: () => Effect.Effect<void, HostError>;
  readonly sessionError: (
    operation: string,
    externalSessionId: string,
  ) => (cause: unknown) => HostOperationErrorAggregate;
}) => ({
  finishSession: (input: AgentSessionLiveRef, action: "stop" | "release") =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const settlement = yield* Effect.exit(restore(settleSession(input)));
        const cleanup = yield* Effect.exit(
          Effect.tryPromise({
            try: () =>
              action === "stop" ? controller.stopSession(input) : controller.releaseSession(input),
            catch: sessionError(`codex-live-session.${action}-session`, input.externalSessionId),
          }),
        );
        const projection = yield* Effect.exit(refreshProjection());
        const failures = Exit.asVoidAll([settlement, cleanup, projection]);
        if (Exit.isFailure(failures)) return yield* Effect.failCause(failures.cause);
        return yield* projection;
      }),
    ),
  /** Codex answers after the terminal exits. The snapshot drops it when Codex reports its end. */
  stopBackgroundTask: (input: AgentSessionBackgroundTaskStopInput) =>
    Effect.tryPromise({
      try: () => controller.stopBackgroundTask(input),
      catch: sessionError("codex-live-session.stop-background-task", input.externalSessionId),
    }).pipe(Effect.tap(() => refreshProjection())),
});
