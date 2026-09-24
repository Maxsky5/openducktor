import type { AgentSessionSummary, AgentSessionTitleUpdateResult } from "@openducktor/core";
import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type { AgentSessionTitleUpdateOutcome } from "../../ports/agent-session-live-adapter-port";

/**
 * Commits a renamed runtime title and reports the host outcome.
 * `not_attached` passes through: the runtime holds no session, so there is nothing to commit.
 * A failed live commit after a successful native rename is a live view fault, not a failed
 * rename. The runtime keeps the new title, so the outcome stays `renamed` and the callers
 * keep the durable title. A failed fault report keeps the same outcome, because the report
 * path logs the fault before it publishes the fault envelope.
 */
export const commitTitleUpdate = (
  result: AgentSessionTitleUpdateResult,
  commitRenamed: (summary: AgentSessionSummary) => Effect.Effect<unknown, HostError>,
  reportProjectionFailure: (failure: HostError) => Effect.Effect<void, HostError>,
): Effect.Effect<AgentSessionTitleUpdateOutcome, HostError> =>
  result.status === "not_attached"
    ? Effect.succeed({ status: "not_attached" })
    : commitRenamed(result.summary).pipe(
        Effect.as({ status: "renamed" as const }),
        Effect.catchAll((projectionFailure) =>
          reportProjectionFailure(projectionFailure).pipe(
            Effect.catchAll(() => Effect.void),
            Effect.as({ status: "renamed" as const }),
          ),
        ),
      );
