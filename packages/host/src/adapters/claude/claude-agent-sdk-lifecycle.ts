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
  return (session.pendingApprovals?.size ?? 0) > 0 || (session.pendingQuestions?.size ?? 0) > 0;
};

const pendingUserTurnCount = (session: ClaudeLifecycleSession): number =>
  session.pendingUserTurnCount ?? 0;

const activeSdkUserTurnCount = (session: ClaudeLifecycleSession): number =>
  session.activeSdkUserTurnCount ?? 0;

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
  input.session.activity = "running";
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
  if (remainingPendingUserTurns > 0) {
    input.session.activity = "running";
    return;
  }
  input.session.sdkState = "idle";
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
