import type { AgentEvent } from "@openducktor/core";
import type { ClaudeResultLifecycleOutcome } from "./claude-agent-sdk-result-lifecycle";
import type { ClaudeSessionActivity } from "./claude-agent-sdk-types";

export type ClaudeLifecycleSession = {
  activeSdkUserTurnCount?: number;
  activity: ClaudeSessionActivity;
  externalSessionId: string;
  pendingApprovals?: Map<string, unknown>;
  pendingQuestions?: Map<string, unknown>;
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
  | {
      kind: "result";
      outcome: ClaudeResultLifecycleOutcome;
    };

const hasPendingInput = (session: ClaudeLifecycleSession): boolean => {
  const pendingApprovals = "pendingApprovals" in session ? session.pendingApprovals : undefined;
  const pendingQuestions = "pendingQuestions" in session ? session.pendingQuestions : undefined;
  return (
    (pendingApprovals instanceof Map && pendingApprovals.size > 0) ||
    (pendingQuestions instanceof Map && pendingQuestions.size > 0)
  );
};

const pendingUserTurnCount = (session: ClaudeLifecycleSession): number =>
  typeof session.pendingUserTurnCount === "number" ? session.pendingUserTurnCount : 0;

const activeSdkUserTurnCount = (session: ClaudeLifecycleSession): number =>
  typeof session.activeSdkUserTurnCount === "number" ? session.activeSdkUserTurnCount : 0;

const emitSessionIdle = ({ emit, session, timestamp }: ClaudeLifecycleInput): void => {
  if (session.activity === "idle") {
    return;
  }
  session.activity = "idle";
  emit({
    type: "session_idle",
    externalSessionId: session.externalSessionId,
    timestamp,
  });
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
    emitSessionIdle(input);
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
  input.emit({
    type: "session_error",
    externalSessionId: input.session.externalSessionId,
    timestamp: input.timestamp,
    message: "Claude requires action, but no pending approval or question is available.",
  });
  emitSessionIdle(input);
};

const applyResultLifecycleEvent = (
  input: ClaudeLifecycleInput & {
    outcome: Extract<ClaudeLifecycleEvent, { kind: "result" }>["outcome"];
  },
): void => {
  if (input.outcome === "continuing") {
    input.session.activity = "running";
    return;
  }
  if (input.outcome === "awaiting_sdk_idle") {
    completeActiveSdkUserTurn(input.session);
    const remainingPendingUserTurns = completePendingUserTurn(input.session);
    if (remainingPendingUserTurns > 0) {
      input.session.activity = "running";
      return;
    }
    if (input.session.sdkState === "idle") {
      emitSessionIdle(input);
      return;
    }
    input.session.activity = "running";
    return;
  }
  completeActiveSdkUserTurn(input.session);
  const remainingPendingUserTurns = completePendingUserTurn(input.session);
  input.session.sdkState = "idle";
  if (input.outcome === "failed") {
    if (remainingPendingUserTurns > 0) {
      input.session.activity = "running";
      return;
    }
    emitSessionIdle(input);
    return;
  }
  if (remainingPendingUserTurns > 0) {
    input.session.activity = "running";
    return;
  }
  emitSessionIdle(input);
};

export const applyClaudeLifecycleEvent = (
  input: ClaudeLifecycleInput & { event: ClaudeLifecycleEvent },
): void => {
  if (input.event.kind === "sdk_state") {
    applySdkStateLifecycleEvent({ ...input, state: input.event.state });
    return;
  }
  applyResultLifecycleEvent({ ...input, outcome: input.event.outcome });
};
