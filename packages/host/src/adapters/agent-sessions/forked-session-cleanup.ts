import type { AgentSessionControlForkInput } from "@openducktor/contracts";
import type { AgentSessionSummary } from "@openducktor/core";
import { Cause, Effect, Exit } from "effect";
import { HostOperationError, type HostError } from "../../effect/host-errors";
import type { AgentSessionControlAdapterPort } from "../../ports/agent-session-live-adapter-port";

/** Stop and release the new fork if live registration fails. */
export const withForkedSessionCleanup = <A, R>(
  source: Pick<
    AgentSessionControlForkInput,
    "repoPath" | "runtimeKind" | "parentExternalSessionId"
  >,
  controls: Pick<AgentSessionControlAdapterPort, "stopSession" | "releaseSession">,
  run: (
    capture: (summary: AgentSessionSummary) => AgentSessionSummary,
  ) => Effect.Effect<A, HostError, R>,
): Effect.Effect<A, HostError, R> =>
  Effect.uninterruptible(
    Effect.suspend(() => {
      let child: AgentSessionSummary | undefined;
      return Effect.gen(function* () {
        const result = yield* Effect.exit(
          run((summary) => {
            child = summary;
            return summary;
          }),
        );
        if (Exit.isSuccess(result)) return result.value;
        if (!child || child.externalSessionId === source.parentExternalSessionId)
          return yield* Effect.failCause(result.cause);
        const ref = {
          repoPath: source.repoPath,
          runtimeKind: source.runtimeKind,
          workingDirectory: child.workingDirectory,
          externalSessionId: child.externalSessionId,
        };
        const stopped = yield* Effect.exit(controls.stopSession(ref));
        const released = yield* Effect.exit(controls.releaseSession(ref));
        const cleanupFailures = [stopped, released].flatMap((cleanup) =>
          Exit.isFailure(cleanup) ? [cleanup.cause] : [],
        );
        return yield* new HostOperationError({
          operation: "agent-session.fork.register",
          message: `${Cause.pretty(result.cause)} The unused native fork '${ref.externalSessionId}' could not finish registration.${cleanupFailures.length > 0 ? ` Cleanup also failed: ${cleanupFailures.map(Cause.pretty).join("; ")}.` : " It was stopped and released."} Its native history can remain. Inspect that conversation before retrying.`,
          cause: { registration: result.cause, cleanup: cleanupFailures },
          details: { childRef: ref },
        });
      });
    }),
  );
