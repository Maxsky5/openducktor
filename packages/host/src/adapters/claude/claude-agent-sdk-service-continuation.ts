import type { AgentSessionHistoryMessage, ResumeAgentSessionInput } from "@openducktor/core";
import {
  AgentRuntimeQueryError,
  interruptedTurnResumeError,
  type InterruptedTurnResumeError,
  type InterruptedTurnResumeFailureReason,
} from "@openducktor/core";
import { Effect } from "effect";
import {
  HostOperationError,
  type HostOperationErrorAggregate,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import { loadClaudeHistory } from "./claude-agent-sdk-catalog";
import {
  type ClaudeContinuationDecision,
  decideClaudeContinuation,
  decideClaudePersistedContinuation,
} from "./claude-agent-sdk-continuation";
import {
  claudeLiveHistoryContext,
  type ClaudeLiveHistoryContext,
} from "./claude-agent-sdk-history-loader";
import { assertClaudeSessionRef } from "./claude-agent-sdk-session-shape";
import { isClaudeSessionStopped } from "./claude-agent-sdk-session-store";
import type { ClaudeSession, ClaudeSessionStore } from "./claude-agent-sdk-types";
import { fromPromise } from "./claude-agent-sdk-utils";

const continuationOperation = "claudeRuntime.continueInterruptedTurn";

const failClaudeContinuation = (error: InterruptedTurnResumeError) =>
  Effect.fail(toHostOperationError(error, continuationOperation));

const finishClaudeContinuationDecision = (decision: ClaudeContinuationDecision) =>
  decision.kind === "reject" ? failClaudeContinuation(decision.error) : Effect.void;

/**
 * Decides what happens to the attached session after a failed replacement. A session
 * whose stream ended in the meantime has no consumer, so it is dropped instead of
 * restored, and the failure names the missing session.
 */
export const resolveFailedClaudeContinuationSession = <Failure>(input: {
  cause: Failure;
  existing: ClaudeSession | undefined;
  externalSessionId: string;
  sessionStore: ClaudeSessionStore;
}): Failure | HostOperationErrorAggregate => {
  const { cause, existing, externalSessionId, sessionStore } = input;
  if (!existing) {
    return cause;
  }
  if (isClaudeSessionStopped(existing)) {
    sessionStore.close(existing);
    return toHostOperationError(
      interruptedTurnResumeError({
        reason: "session_not_found",
        message: `Claude session '${externalSessionId}' stopped while the continuation was being created, so the continuation cannot use it.`,
        cause,
      }),
      continuationOperation,
    );
  }
  sessionStore.set(existing);
  return cause;
};

/**
 * Reads the persisted transcript for a continuation. The read covers the full
 * transcript, subagent imports included, because the installed SDK exposes no tail
 * read. Resume is user-initiated, so the cost stays acceptable.
 */
const readClaudeContinuationTranscript = async (
  input: ResumeAgentSessionInput,
  now: () => string,
  liveContext?: ClaudeLiveHistoryContext,
): Promise<readonly AgentSessionHistoryMessage[]> => {
  try {
    return await loadClaudeHistory(input, now, liveContext);
  } catch (cause) {
    throw interruptedTurnResumeError({
      ...classifyPersistedClaudeContinuationFailure(cause, input.externalSessionId),
      cause,
    });
  }
};

/**
 * Rejects a continuation that the registered live session cannot start. The live state
 * answers waiting input, live work, and an in-process completed latest turn. A session
 * without accepted user turns falls through to the persisted transcript, so a fresh or
 * reattached session cannot continue a turn the transcript does not show as unfinished.
 */
export const checkLiveClaudeContinuationEligibility = (
  session: ClaudeSession,
  input: ResumeAgentSessionInput,
  now: () => string,
) =>
  fromPromise(continuationOperation, async () => {
    try {
      assertClaudeSessionRef(session, input, "continue interrupted turn");
    } catch (cause) {
      if (cause instanceof HostValidationError) {
        throw interruptedTurnResumeError({
          reason: "identity_mismatch",
          message: cause.message,
          cause,
        });
      }
      throw cause;
    }
    return decideClaudeContinuation(session, input.externalSessionId, () =>
      readClaudeContinuationTranscript(input, now, claudeLiveHistoryContext(session)),
    );
  }).pipe(Effect.flatMap(finishClaudeContinuationDecision));

type PersistedContinuationFailure = {
  readonly reason: InterruptedTurnResumeFailureReason;
  readonly message: string;
};

/**
 * Classifies a persisted-history failure with the native code that caused it. A missing
 * session and a working-directory mismatch must not collapse into a generic probe failure.
 */
export const classifyPersistedClaudeContinuationFailure = (
  cause: unknown,
  externalSessionId: string,
): PersistedContinuationFailure => {
  const native =
    cause instanceof HostOperationError || cause instanceof HostValidationError
      ? cause.cause
      : cause;
  if (native instanceof AgentRuntimeQueryError && native.code === "scope_mismatch") {
    return {
      reason: "identity_mismatch",
      message: `Cannot continue Claude session '${externalSessionId}': ${native.message}`,
    };
  }
  if (native instanceof AgentRuntimeQueryError && native.code === "request_failed") {
    return {
      reason: "session_not_found",
      message: `Cannot read the persisted Claude transcript for session '${externalSessionId}': ${native.message}`,
    };
  }
  const detail = cause instanceof Error ? cause.message : String(cause);
  return {
    reason: "probe_failed",
    message: `Cannot read the persisted Claude transcript for session '${externalSessionId}': ${detail}`,
  };
};

/**
 * Rejects an interrupted-turn resume after a restart, when no live session entry exists.
 * The check reads the persisted transcript because the CLI classifier is not available yet.
 */
export const checkPersistedClaudeContinuationEligibility = (
  input: ResumeAgentSessionInput,
  now: () => string,
) =>
  fromPromise(continuationOperation, async () =>
    decideClaudePersistedContinuation(
      await readClaudeContinuationTranscript(input, now),
      input.externalSessionId,
    ),
  ).pipe(Effect.flatMap(finishClaudeContinuationDecision));
