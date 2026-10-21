import {
  AgentRuntimeQueryError,
  interruptedTurnResumeError,
  type InterruptedTurnResumeError,
  type InterruptedTurnResumeFailureReason,
  type ResumeAgentSessionInput,
} from "@openducktor/core";
import { Effect, Exit } from "effect";
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
import { toClaudeServiceError } from "./claude-agent-sdk-utils";

const continuationOperation = "claudeRuntime.continueInterruptedTurn";

const failClaudeContinuation = (error: InterruptedTurnResumeError) =>
  Effect.fail(toHostOperationError(error, continuationOperation));

const finishClaudeContinuationDecision = (decision: ClaudeContinuationDecision) =>
  decision.kind === "reject" ? failClaudeContinuation(decision.error) : Effect.void;

/**
 * Restore the attached session only if its stream still runs.
 * A stopped session must finish cleanup before the continuation reports it missing.
 */
export const resolveFailedClaudeContinuationSession = <Failure>(input: {
  cause: Failure;
  existing: ClaudeSession | undefined;
  externalSessionId: string;
  sessionStore: ClaudeSessionStore;
}): Effect.Effect<never, Failure | HostOperationErrorAggregate> =>
  Effect.gen(function* () {
    const { cause, existing, externalSessionId, sessionStore } = input;
    if (!existing) return yield* Effect.fail(cause);
    if (isClaudeSessionStopped(existing)) {
      const settled = yield* Effect.exit(sessionStore.settle(existing));
      return yield* Effect.fail(
        toHostOperationError(
          interruptedTurnResumeError({
            reason: "session_not_found",
            message: `Claude session '${externalSessionId}' stopped while the continuation was being created, so the continuation cannot use it.`,
            cause: Exit.isFailure(settled)
              ? new AggregateError(
                  [cause, settled.cause],
                  "Claude continuation and settlement failed.",
                )
              : cause,
          }),
          continuationOperation,
        ),
      );
    }
    sessionStore.set(existing);
    return yield* Effect.fail(cause);
  });

/** Reads the saved transcript and classifies expected continuation failures. */
const readClaudeContinuationTranscript = (
  input: ResumeAgentSessionInput,
  now: () => string,
  liveContext?: ClaudeLiveHistoryContext,
) =>
  loadClaudeHistory(input, now, liveContext).pipe(
    Effect.mapError((cause) =>
      interruptedTurnResumeError({
        ...classifyPersistedClaudeContinuationFailure(cause, input.externalSessionId),
        cause,
      }),
    ),
  );

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
  Effect.gen(function* () {
    yield* Effect.try({
      try: () => assertClaudeSessionRef(session, input, "continue interrupted turn"),
      catch: (cause) => {
        if (cause instanceof HostValidationError)
          return interruptedTurnResumeError({
            reason: "identity_mismatch",
            message: cause.message,
            cause,
          });
        throw cause;
      },
    });
    return yield* decideClaudeContinuation(session, input.externalSessionId, () =>
      readClaudeContinuationTranscript(input, now, claudeLiveHistoryContext(session)),
    );
  }).pipe(
    Effect.mapError((cause) => toClaudeServiceError(continuationOperation, cause)),
    Effect.flatMap(finishClaudeContinuationDecision),
  );

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
  readClaudeContinuationTranscript(input, now).pipe(
    Effect.map((history) => decideClaudePersistedContinuation(history, input.externalSessionId)),
    Effect.mapError((cause) => toClaudeServiceError(continuationOperation, cause)),
    Effect.flatMap(finishClaudeContinuationDecision),
  );
