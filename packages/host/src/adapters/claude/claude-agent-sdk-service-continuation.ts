import type { ResumeAgentSessionInput } from "@openducktor/core";
import { interruptedTurnResumeError } from "@openducktor/core";
import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import { loadClaudeHistory } from "./claude-agent-sdk-catalog";
import {
  assertClaudeContinuationEligible,
  assertClaudePersistedContinuationEligible,
} from "./claude-agent-sdk-continuation";
import { assertClaudeSessionRef } from "./claude-agent-sdk-session-shape";
import type { ClaudeSession } from "./claude-agent-sdk-types";
import { fromPromise } from "./claude-agent-sdk-utils";

/** Rejects an interrupted-turn resume that the registered live session cannot start. */
export const checkLiveClaudeContinuationEligibility = (
  session: ClaudeSession,
  input: ResumeAgentSessionInput,
) =>
  fromPromise("claudeRuntime.continueInterruptedTurn", async () => {
    assertClaudeSessionRef(session, input, "continue interrupted turn");
    assertClaudeContinuationEligible(session, input.externalSessionId);
  });

/**
 * Rejects an interrupted-turn resume after a restart, when no live session entry exists.
 * The check reads the persisted transcript because the CLI classifier is not available yet.
 */
export const checkPersistedClaudeContinuationEligibility = (
  input: ResumeAgentSessionInput,
  now: () => string,
) =>
  fromPromise("claudeRuntime.continueInterruptedTurn", () => loadClaudeHistory(input, now)).pipe(
    Effect.catchAll((cause) =>
      Effect.fail(
        toHostOperationError(
          interruptedTurnResumeError({
            reason: "probe_failed",
            message: `Cannot read the persisted Claude transcript for session '${input.externalSessionId}': ${cause.message}`,
            cause,
          }),
          "claudeRuntime.continueInterruptedTurn",
        ),
      ),
    ),
    Effect.flatMap((history) =>
      fromPromise("claudeRuntime.continueInterruptedTurn", async () => {
        assertClaudePersistedContinuationEligible(history, input.externalSessionId);
      }),
    ),
  );
