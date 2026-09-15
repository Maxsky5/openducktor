import type { AgentSessionLiveRef, AgentSessionResumeFailureReason } from "@openducktor/contracts";
import { InterruptedTurnResumeError } from "@openducktor/core";
import { HostOperationError } from "../effect/host-errors";

export const agentSessionResumeNextActions = {
  unsupported:
    "Use a runtime that supports interrupted-turn resume, or send a new message to start new work.",
  continuation_in_progress: "Wait for the continuation in progress to settle, then retry Resume.",
  live_turn: "Wait for the live turn to finish, then retry Resume if the turn is still unfinished.",
  waiting_input: "Answer the pending approval or question, then retry Resume.",
  completed_turn: "Send a new message to start new work.",
  ineligible_turn_state: "Send a new message to start new work.",
  runtime_unavailable: "Restore or restart the runtime for this session, then retry Resume.",
  session_not_found: "Reopen the session from the session list, then retry Resume.",
  identity_mismatch:
    "Reopen the session from the session list so the stored identity matches, then retry Resume.",
  probe_failed: "Fix the reported runtime connection or protocol error, then retry Resume.",
  compatibility_rejected:
    "Use a runtime version that supports interrupted-turn resume, or send a new message to start new work.",
  continuation_failed: "Resolve the reported runtime failure, then retry Resume.",
} as const satisfies Record<AgentSessionResumeFailureReason, string>;

export type AgentSessionResumeErrorInput = {
  readonly reason: AgentSessionResumeFailureReason;
  readonly sessionRef: AgentSessionLiveRef;
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
  readonly nextAction?: string;
};

export class AgentSessionResumeError extends HostOperationError {
  readonly reason: AgentSessionResumeFailureReason;
  readonly sessionRef: AgentSessionLiveRef;
  readonly resumeOperation: string;
  readonly nextAction: string;

  constructor(input: AgentSessionResumeErrorInput) {
    super({
      operation: input.operation,
      message: input.message,
      cause: input.cause,
    });
    this.reason = input.reason;
    this.sessionRef = input.sessionRef;
    this.resumeOperation = input.operation;
    this.nextAction = input.nextAction ?? agentSessionResumeNextActions[input.reason];
  }
}

export const agentSessionResumeError = (
  input: AgentSessionResumeErrorInput,
): AgentSessionResumeError => new AgentSessionResumeError(input);

/**
 * Maps a runtime adapter refusal or failure to the shared typed resume failure.
 * Unknown causes become `continuation_failed` so the user still gets a next action.
 */
export const toAgentSessionResumeError = (
  cause: unknown,
  sessionRef: AgentSessionLiveRef,
  operation: string,
): AgentSessionResumeError => {
  if (cause instanceof AgentSessionResumeError) {
    return cause;
  }
  if (cause instanceof HostOperationError && cause.cause instanceof InterruptedTurnResumeError) {
    return toAgentSessionResumeError(cause.cause, sessionRef, operation);
  }
  if (cause instanceof InterruptedTurnResumeError) {
    // SAFETY: the core reasons are a subset of the wire reasons, so the cast cannot widen.
    const reason = cause.reason as AgentSessionResumeFailureReason;
    const input: AgentSessionResumeErrorInput = {
      reason,
      sessionRef,
      operation,
      message: cause.message,
      cause: cause.resumeCause ?? cause,
    };
    return new AgentSessionResumeError(input);
  }
  return new AgentSessionResumeError({
    reason: "continuation_failed",
    sessionRef,
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
};
