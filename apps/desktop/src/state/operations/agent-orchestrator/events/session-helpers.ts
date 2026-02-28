import { isOdtWorkflowMutationToolName } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { isTodoToolName, settleDanglingTodoToolMessages } from "../../agent-tool-messages";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import { finalizeDraftAssistantMessage } from "../support/utils";
import type { SessionEventContext, SessionPart } from "./session-event-types";

const MCP_TOOL_ERROR_PREFIX = /^\s*mcp\s+error\b/i;

export const inferToolPartStatus = (
  part: Extract<SessionPart, { kind: "tool" }>,
  output: string | undefined,
): Extract<SessionPart, { kind: "tool" }>["status"] => {
  if (
    part.status === "completed" &&
    isOdtWorkflowMutationToolName(part.tool) &&
    typeof output === "string" &&
    MCP_TOOL_ERROR_PREFIX.test(output)
  ) {
    return "error";
  }
  return part.status;
};

export const clearDraftBuffers = (context: SessionEventContext): void => {
  delete context.draftRawBySessionRef.current[context.sessionId];
  delete context.draftSourceBySessionRef.current[context.sessionId];
};

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
  if (!input) {
    return false;
  }
  return Object.values(input).some((value) => hasMeaningfulToolInputValue(value));
};

const shouldClearTurnFromCurrentState = (current: AgentSessionState): boolean => {
  return (
    current.draftAssistantText.trim().length > 0 &&
    current.pendingPermissions.length === 0 &&
    current.pendingQuestions.length === 0
  );
};

export const settleDraftToIdle = (context: SessionEventContext, timestamp: string): boolean => {
  let shouldClear = false;
  context.updateSession(context.sessionId, (current) => {
    const finalized = finalizeDraftAssistantMessage(
      current,
      timestamp,
      context.resolveTurnDurationMs(context.sessionId, timestamp, current.messages),
    );
    shouldClear = shouldClearTurnFromCurrentState(current);
    return {
      ...finalized,
      messages: settleDanglingTodoToolMessages(finalized.messages, timestamp),
      ...(current.status === "error" ? { status: "error" } : { status: "idle" }),
    };
  });
  return shouldClear;
};

export const toPartStreamKey = (part: SessionPart): string => {
  if (part.kind === "tool") {
    return `${part.messageId}:${part.callId || part.partId}`;
  }
  return `${part.messageId}:${part.partId}`;
};

export const createPrePartTodoSettlement = (
  part: SessionPart,
  timestamp: string,
): ((current: AgentSessionState) => AgentSessionState) => {
  const shouldSettleTodoToolRows = part.kind !== "tool" || !isTodoToolName(part.tool);
  return (current: AgentSessionState): AgentSessionState => {
    if (!shouldSettleTodoToolRows) {
      return current;
    }
    const settledMessages = settleDanglingTodoToolMessages(current.messages, timestamp);
    if (settledMessages === current.messages) {
      return current;
    }
    return {
      ...current,
      messages: settledMessages,
    };
  };
};

export const refreshTodosFromSessionRef = (context: SessionEventContext): void => {
  const session = context.sessionsRef.current[context.sessionId];
  if (!session) {
    return;
  }
  runOrchestratorSideEffect(
    "session-events-refresh-todos",
    context.loadSessionTodos(
      context.sessionId,
      session.baseUrl,
      session.workingDirectory,
      session.externalSessionId,
    ),
    {
      tags: {
        repoPath: context.repoPath,
        sessionId: context.sessionId,
        taskId: session.taskId,
        role: session.role,
        externalSessionId: session.externalSessionId,
      },
    },
  );
};
