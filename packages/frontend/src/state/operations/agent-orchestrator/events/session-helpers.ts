import { agentToolDataSchema, type AgentToolData } from "@openducktor/contracts";
import { z } from "zod";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { settleDanglingTodoToolMessages } from "../agent-tool-messages";
import type { SessionLifecycleEventContext, SessionPart } from "./session-event-types";

export const eventTimestampMs = (timestamp: string): number => {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Date.now() : parsed;
};

const stringValueSchema = z.string();
const numberOrBooleanValueSchema = z.union([z.number(), z.boolean()]);

const hasMeaningfulToolInputValue = (value: AgentToolData[string]): boolean => {
  const stringResult = stringValueSchema.safeParse(value);
  if (stringResult.success) {
    return stringResult.data.trim().length > 0;
  }
  if (numberOrBooleanValueSchema.safeParse(value).success) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasMeaningfulToolInputValue(entry));
  }
  const objectValue = agentToolDataSchema.safeParse(value);
  if (!objectValue.success) {
    return false;
  }
  return Object.values(objectValue.data).some((entry) => hasMeaningfulToolInputValue(entry));
};

export const hasMeaningfulToolInput = (input: AgentToolData | undefined): boolean => {
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
    if (
      current.pendingUserMessageStartedAt !== undefined &&
      current.pendingApprovals.length === 0 &&
      current.pendingQuestions.length === 0
    ) {
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
