import type { AgentEvent } from "@openducktor/core";
import {
  confirmClaudeNativeIdle,
  hasClaudeBlockingInput,
  hasClaudeNativeBackgroundActivity,
  isClaudeForegroundTurnActive,
  type ClaudeNativeActivityState,
} from "./claude-agent-sdk-activity";
import type { ClaudeResultLifecycleOutcome } from "./claude-agent-sdk-result-lifecycle";
import type {
  ClaudeSessionActivity,
  PendingApproval,
  PendingQuestion,
} from "./claude-agent-sdk-types";

export type ClaudeLifecycleSession = ClaudeNativeActivityState & {
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
  | { kind: "user_turn_cancelled" }
  | {
      kind: "result";
      outcome: ClaudeResultLifecycleOutcome;
      consumedMessageCount?: number | undefined;
    };

export const applyClaudeLifecycleEvent = (
  input: ClaudeLifecycleInput & { event: ClaudeLifecycleEvent },
): void => {
  if (input.event.kind === "sdk_state") {
    applyState({ ...input, state: input.event.state });
    return;
  }
  if (input.event.kind === "sdk_turn_started") {
    startTurn(input);
    return;
  }
  if (input.event.kind === "user_turn_cancelled") {
    cancelTurn(input);
    return;
  }
  finishTurn({
    ...input,
    outcome: input.event.outcome,
    consumedMessageCount: input.event.consumedMessageCount,
  });
};

/** Foreground readiness can change while background work keeps the session Running. */
export const publishClaudeActivity = (input: ClaudeLifecycleInput, force = false): void => {
  const { session, emit, timestamp } = input;
  const foregroundTurnActive = isClaudeForegroundTurnActive(session);
  const running =
    foregroundTurnActive ||
    hasClaudeBlockingInput(session) ||
    hasClaudeNativeBackgroundActivity(session) ||
    session.resultAwaitsSdkIdle === true ||
    session.sdkState === "requires_action";
  if (running) {
    const changed = session.activity !== "running";
    session.activity = "running";
    if (changed || force)
      emit({
        type: "session_status",
        externalSessionId: session.externalSessionId,
        timestamp,
        status: { type: "busy", message: null },
        foregroundTurnActive,
      });
  } else if (session.activity !== "idle") {
    session.activity = "idle";
    emit({ type: "session_idle", externalSessionId: session.externalSessionId, timestamp });
  }
};

const pendingUserTurnCount = (session: ClaudeLifecycleSession): number =>
  session.pendingUserTurnCount ?? 0;

const activeSdkUserTurnCount = (session: ClaudeLifecycleSession): number =>
  session.activeSdkUserTurnCount ?? 0;

const finishPendingTurn = (session: ClaudeLifecycleSession): number => {
  if (pendingUserTurnCount(session) <= 0) {
    return 0;
  }
  session.pendingUserTurnCount = pendingUserTurnCount(session) - 1;
  return session.pendingUserTurnCount;
};

const finishActiveTurn = (session: ClaudeLifecycleSession): number => {
  if (activeSdkUserTurnCount(session) <= 0) {
    return 0;
  }
  session.activeSdkUserTurnCount = activeSdkUserTurnCount(session) - 1;
  return session.activeSdkUserTurnCount;
};

const applyState = (
  input: ClaudeLifecycleInput & {
    state: Extract<ClaudeLifecycleEvent, { kind: "sdk_state" }>["state"];
  },
): void => {
  input.session.sdkState = input.state;
  if (input.state === "idle") {
    confirmClaudeNativeIdle(input.session);
    delete input.session.resultAwaitsSdkIdle;
    if (
      input.session.foregroundTurnActive !== true &&
      (input.session.activeSdkUserTurnCount ?? 0) === 0 &&
      pendingUserTurnCount(input.session) === 0
    ) {
      input.session.foregroundTurnActive = false;
    }
    publishClaudeActivity(input);
    return;
  }
  if (input.state === "running") {
    const hasLocalTurn =
      activeSdkUserTurnCount(input.session) > 0 || pendingUserTurnCount(input.session) > 0;
    // Startup can replay Running before any work starts. Work events confirm a new turn.
    if (input.session.activity === "idle" && !hasLocalTurn) {
      delete input.session.sdkState;
      return;
    }
    if (hasLocalTurn) input.session.foregroundTurnActive = true;
    publishClaudeActivity(input, true);
    return;
  }
  input.session.activity = "running";
};

/** The CLI cancels queued commands without a result. */
const cancelTurn = (input: ClaudeLifecycleInput): void => {
  const pendingTurns = finishPendingTurn(input.session);
  const activeTurns = finishActiveTurn(input.session);
  if (input.session.foregroundTurnActive === true && input.session.sdkInitiatedTurnActive) return;
  if (pendingTurns > 0 || activeTurns > 0 || hasClaudeBlockingInput(input.session)) {
    return;
  }
  input.session.foregroundTurnActive = false;
  input.session.sdkState = "idle";
  publishClaudeActivity(input, true);
};

const startTurn = (input: ClaudeLifecycleInput): void => {
  if (input.session.foregroundTurnActive === true) return;
  const hasLocalTurn =
    activeSdkUserTurnCount(input.session) > 0 || pendingUserTurnCount(input.session) > 0;
  input.session.foregroundTurnActive = true;
  if (!hasLocalTurn) {
    input.session.sdkInitiatedTurnActive = true;
  }
  publishClaudeActivity(input, true);
};

const finishTurn = (
  input: ClaudeLifecycleInput & {
    outcome: ClaudeResultLifecycleOutcome;
    consumedMessageCount?: number | undefined;
  },
): void => {
  delete input.session.sdkInitiatedTurnActive;
  const consumed = input.consumedMessageCount ?? 0;
  for (let index = 0; index < consumed; index++) finishPendingTurn(input.session);
  for (let index = 0; index < consumed; index++) finishActiveTurn(input.session);
  input.session.foregroundTurnActive = false;
  if (input.outcome === "awaiting_sdk_idle" && input.session.sdkState !== "idle") {
    input.session.resultAwaitsSdkIdle = true;
  } else delete input.session.resultAwaitsSdkIdle;
  if (!isClaudeForegroundTurnActive(input.session) && input.outcome !== "awaiting_sdk_idle")
    input.session.sdkState = "idle";
  publishClaudeActivity(input, true);
};
