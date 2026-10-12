import type { AgentTurnOutcome } from "@openducktor/contracts";
import type { AgentEvent } from "@openducktor/core";
import type { ClaudeResultLifecycleOutcome } from "./claude-agent-sdk-result-lifecycle";
import type {
  ClaudeSessionActivity,
  PendingApproval,
  PendingQuestion,
} from "./claude-agent-sdk-types";

export type ClaudeLifecycleSession = {
  activeSdkUserTurnCount?: number;
  activity: ClaudeSessionActivity;
  externalSessionId: string;
  pendingApprovals?: Map<string, PendingApproval>;
  pendingQuestions?: Map<string, PendingQuestion>;
  sdkInitiatedTurnActive?: boolean;
  resultAwaitsSdkIdle?: boolean;
  sdkState?: "idle" | "requires_action" | "running";
  pendingUserTurnCount?: number;
};

type ClaudeLifecycleInput = {
  emit: (event: AgentEvent) => void;
  session: ClaudeLifecycleSession;
  timestamp: string;
};

type ClaudeLifecycleEvent =
  | { kind: "sdk_state"; state: "idle" | "requires_action" | "running" }
  | { kind: "sdk_turn_started" }
  /** The CLI cancelled a local user turn before it ran, so the turn never starts. */
  | { kind: "user_turn_cancelled" }
  | {
      kind: "result";
      outcome: ClaudeResultLifecycleOutcome;
    };

export const applyClaudeLifecycleEvent = (
  input: ClaudeLifecycleInput & { event: ClaudeLifecycleEvent },
): void => {
  if (input.event.kind === "sdk_state") {
    applySdkStateLifecycleEvent({ ...input, state: input.event.state });
    return;
  }
  if (input.event.kind === "sdk_turn_started") {
    applySdkTurnStartedLifecycleEvent(input);
    return;
  }
  if (input.event.kind === "user_turn_cancelled") {
    applyUserTurnCancelledLifecycleEvent(input);
    return;
  }
  applyResultLifecycleEvent({ ...input, outcome: input.event.outcome });
};

const hasPendingInput = (session: ClaudeLifecycleSession): boolean => {
  return (session.pendingApprovals?.size ?? 0) > 0 || (session.pendingQuestions?.size ?? 0) > 0;
};

const pendingUserTurnCount = (session: ClaudeLifecycleSession): number =>
  session.pendingUserTurnCount ?? 0;

const activeSdkUserTurnCount = (session: ClaudeLifecycleSession): number =>
  session.activeSdkUserTurnCount ?? 0;

/** Only an idle state after a turn result names an outcome. A bare SDK idle state ends no turn. */
const publishSessionIdle = (
  { emit, session, timestamp }: ClaudeLifecycleInput,
  turnOutcome: AgentTurnOutcome | undefined,
): void => {
  session.activity = "idle";
  const event: Extract<AgentEvent, { type: "session_idle" }> = {
    type: "session_idle",
    externalSessionId: session.externalSessionId,
    timestamp,
  };
  if (turnOutcome) event.turnOutcome = turnOutcome;
  emit(event);
};

const emitSessionIdle = (
  input: ClaudeLifecycleInput,
  turnOutcome: AgentTurnOutcome | undefined,
): void => {
  if (input.session.activity === "idle") {
    return;
  }
  publishSessionIdle(input, turnOutcome);
};

const emitSessionBusy = ({ emit, session, timestamp }: ClaudeLifecycleInput): void => {
  session.activity = "running";
  emit({
    type: "session_status",
    externalSessionId: session.externalSessionId,
    timestamp,
    status: { type: "busy", message: null },
  });
};

const completePendingUserTurn = (session: ClaudeLifecycleSession): number => {
  if (pendingUserTurnCount(session) <= 0) {
    return 0;
  }
  session.pendingUserTurnCount = pendingUserTurnCount(session) - 1;
  return session.pendingUserTurnCount;
};

const completeActiveSdkUserTurn = (session: ClaudeLifecycleSession): number => {
  if (activeSdkUserTurnCount(session) <= 0) {
    return 0;
  }
  session.activeSdkUserTurnCount = activeSdkUserTurnCount(session) - 1;
  return session.activeSdkUserTurnCount;
};

const applySdkStateLifecycleEvent = (
  input: ClaudeLifecycleInput & {
    state: Extract<ClaudeLifecycleEvent, { kind: "sdk_state" }>["state"];
  },
): void => {
  input.session.sdkState = input.state;
  if (input.state === "idle") {
    if (
      pendingUserTurnCount(input.session) > 0 ||
      activeSdkUserTurnCount(input.session) > 0 ||
      hasPendingInput(input.session)
    ) {
      input.session.activity = "running";
      return;
    }
    const resultAwaitedIdle = input.session.resultAwaitsSdkIdle === true;
    delete input.session.resultAwaitsSdkIdle;
    emitSessionIdle(input, resultAwaitedIdle ? "completed" : undefined);
    return;
  }
  if (input.state === "running") {
    const hasLocalTurn =
      activeSdkUserTurnCount(input.session) > 0 || pendingUserTurnCount(input.session) > 0;
    if (input.session.activity === "idle" && !hasLocalTurn) {
      delete input.session.sdkState;
      return;
    }
    emitSessionBusy(input);
    return;
  }
  if (hasPendingInput(input.session)) {
    input.session.activity = "running";
    return;
  }
  input.session.activity = "running";
};

/**
 * A local turn counts as pending and active from its send. When the CLI cancels it before it
 * runs, the CLI stays idle, and the turn ends with no outcome, so it releases no queued message.
 */
const applyUserTurnCancelledLifecycleEvent = (input: ClaudeLifecycleInput): void => {
  const remainingPendingUserTurns = completePendingUserTurn(input.session);
  const remainingActiveSdkUserTurns = completeActiveSdkUserTurn(input.session);
  if (
    remainingPendingUserTurns > 0 ||
    remainingActiveSdkUserTurns > 0 ||
    hasPendingInput(input.session)
  ) {
    return;
  }
  input.session.sdkState = "idle";
  emitSessionIdle(input, undefined);
};

const applySdkTurnStartedLifecycleEvent = (input: ClaudeLifecycleInput): void => {
  // Count the first work signal of an idle SDK turn. Its result must leave queued
  // local turns alone. A bare "running" state may replay after resume.
  if (input.session.activity !== "idle") {
    return;
  }
  input.session.activeSdkUserTurnCount = activeSdkUserTurnCount(input.session) + 1;
  input.session.sdkInitiatedTurnActive = true;
  emitSessionBusy(input);
};

// An SDK-initiated result completes its own turn and leaves queued local turns to
// their own results.
const completeResultUserTurns = (session: ClaudeLifecycleSession, sdkInitiatedTurn: boolean) => ({
  remainingActiveSdkUserTurns: completeActiveSdkUserTurn(session),
  remainingPendingUserTurns: sdkInitiatedTurn
    ? pendingUserTurnCount(session)
    : completePendingUserTurn(session),
});

const applyResultLifecycleEvent = (
  input: ClaudeLifecycleInput & {
    outcome: Extract<ClaudeLifecycleEvent, { kind: "result" }>["outcome"];
  },
): void => {
  const sdkInitiatedTurn = input.session.sdkInitiatedTurnActive === true;
  delete input.session.sdkInitiatedTurnActive;
  delete input.session.resultAwaitsSdkIdle;
  if (input.outcome === "awaiting_sdk_idle") {
    const { remainingActiveSdkUserTurns, remainingPendingUserTurns } = completeResultUserTurns(
      input.session,
      sdkInitiatedTurn,
    );
    if (
      remainingActiveSdkUserTurns > 0 ||
      remainingPendingUserTurns > 0 ||
      hasPendingInput(input.session)
    ) {
      input.session.activity = "running";
      return;
    }
    if (input.session.sdkState === "idle") {
      emitSessionIdle(input, "completed");
      return;
    }
    input.session.resultAwaitsSdkIdle = true;
    input.session.activity = "running";
    return;
  }
  const { remainingActiveSdkUserTurns, remainingPendingUserTurns } = completeResultUserTurns(
    input.session,
    sdkInitiatedTurn,
  );
  if (
    remainingActiveSdkUserTurns > 0 ||
    remainingPendingUserTurns > 0 ||
    hasPendingInput(input.session)
  ) {
    input.session.activity = "running";
    return;
  }
  input.session.sdkState = "idle";
  // Transcript activity can keep the renderer busy after the host goes idle.
  // Send completion even when the host already marks this session idle.
  publishSessionIdle(input, input.outcome);
};
