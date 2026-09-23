import type { AgentSessionSummary, AgentSessionTitleUpdateResult } from "@openducktor/core";
import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type { AgentSessionTitleUpdateOutcome } from "../../ports/agent-session-live-adapter-port";

/**
 * Commits a renamed runtime title and reports the host outcome.
 * `not_attached` passes through: the runtime holds no session, so there is nothing to commit.
 */
export const commitTitleUpdate = (
  result: AgentSessionTitleUpdateResult,
  commitRenamed: (summary: AgentSessionSummary) => Effect.Effect<unknown, HostError>,
): Effect.Effect<AgentSessionTitleUpdateOutcome, HostError> =>
  result.status === "not_attached"
    ? Effect.succeed({ status: "not_attached" })
    : commitRenamed(result.summary).pipe(Effect.as({ status: "renamed" }));
