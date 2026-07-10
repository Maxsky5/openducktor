import type { AgentSessionState } from "@/types/agent-orchestrator";
import { settleDanglingTodoToolMessages } from "../agent-tool-messages";
import type { SessionLifecycleEventContext, SessionPart } from "./session-event-types";

export const eventTimestampMs = (timestamp: string): number => {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Date.now() : parsed;
};

const hasMeaningfulToolInputValue = (value: unknown): boolean => {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasMeaningfulToolInputValue(entry));
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.values(value as Record<string, unknown>).some((entry) =>
    hasMeaningfulToolInputValue(entry),
  );
};

export const hasMeaningfulToolInput = (input: Record<string, unknown> | undefined): boolean => {
  return input ? Object.values(input).some((value) => hasMeaningfulToolInputValue(value)) : false;
};

const shouldClearTurnFromCurrentState = (current: AgentSessionState): boolean => {
  return (
    current.status !== "error" &&
    current.pendingApprovals.length === 0 &&
    current.pendingQuestions.length === 0
  );
};

export const settleSessionToIdle = (
  context: Pick<SessionLifecycleEventContext, "session" | "store">,
  timestamp: string,
): boolean => {
  let shouldClear = false;
  context.store.updateSession(context.session.identity, (current) => {
    if (current.status === "starting") {
      return current;
    }

    shouldClear = shouldClearTurnFromCurrentState(current);
    const messages = settleDanglingTodoToolMessages(current, timestamp);
    const status = current.status === "error" ? "error" : "idle";
    const shouldClearPendingUserMessage =
      status === "idle" && current.pendingUserMessageStartedAt !== undefined;
    const shouldClearRuntimeStatusMessage = current.runtimeStatusMessage !== null;
    const didChange =
      messages !== current.messages ||
      current.status !== status ||
      shouldClearPendingUserMessage ||
      shouldClearRuntimeStatusMessage;
    if (!didChange) {
      return current;
    }

    return {
      ...current,
      messages,
      status,
      runtimeStatusMessage: null,
      pendingUserMessageStartedAt: undefined,
    };
  });
  return shouldClear;
};

export const createPrePartTodoSettlement = (
  part: SessionPart,
  timestamp: string,
): ((current: AgentSessionState) => AgentSessionState) => {
  const shouldSettleTodoToolRows = part.kind !== "tool" || part.toolType !== "todo";
  return (current: AgentSessionState): AgentSessionState => {
    if (!shouldSettleTodoToolRows) {
      return current;
    }
    const settledMessages = settleDanglingTodoToolMessages(current, timestamp);
    if (settledMessages === current.messages) {
      return current;
    }
    return {
      ...current,
      messages: settledMessages,
    };
  };
};
