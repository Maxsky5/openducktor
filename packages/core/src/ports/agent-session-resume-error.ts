/** Runtime-neutral reasons a resume-continuation request can be refused or fail. */
export const interruptedTurnResumeFailureReasons = [
  "unsupported",
  "live_turn",
  "waiting_input",
  "completed_turn",
  "ineligible_turn_state",
  "session_not_found",
  "identity_mismatch",
  "probe_failed",
  "compatibility_rejected",
  "continuation_failed",
] as const;

export type InterruptedTurnResumeFailureReason =
  (typeof interruptedTurnResumeFailureReasons)[number];

/**
 * A runtime adapter refuses or fails an interrupted-turn continuation.
 * Host adapters add session identity and the user-facing next action.
 */
export class InterruptedTurnResumeError extends Error {
  readonly reason: InterruptedTurnResumeFailureReason;
  readonly resumeCause: unknown;

  constructor(detail: {
    reason: InterruptedTurnResumeFailureReason;
    message: string;
    cause?: unknown;
  }) {
    super(detail.message);
    this.name = "InterruptedTurnResumeError";
    this.reason = detail.reason;
    this.resumeCause = detail.cause;
  }
}

export const interruptedTurnResumeError = (detail: {
  reason: InterruptedTurnResumeFailureReason;
  message: string;
  cause?: unknown;
}): InterruptedTurnResumeError => new InterruptedTurnResumeError(detail);
