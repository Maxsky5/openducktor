import { isOdtWorkflowMutationToolName } from "@openducktor/core";
import type { AgentChatMessageMeta, AgentSessionState } from "@/types/agent-orchestrator";
import { formatToolContent, isTodoToolName } from "../../agent-tool-messages";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import {
  mergeTodoListPreservingOrder,
  normalizeToolInput,
  normalizeToolText,
  parseTodosFromToolInput,
  parseTodosFromToolOutput,
  resolveToolMessageId,
  upsertMessage,
} from "../support/utils";
import type { SessionEventContext, SessionPart, SessionPartEvent } from "./session-event-types";
import {
  eventTimestampMs,
  hasMeaningfulToolInput,
  inferToolPartStatus,
  refreshTodosFromSessionRef,
} from "./session-helpers";

type ToolPart = Extract<SessionPart, { kind: "tool" }>;
type ToolPartStatus = ToolPart["status"];
type ToolMeta = Extract<AgentChatMessageMeta, { kind: "tool" }>;
type PrepareCurrent = (current: AgentSessionState) => AgentSessionState;

type ToolTimingMeta = {
  observedStartedAtMs?: number;
  observedEndedAtMs?: number;
  inputReadyAtMs?: number;
};

type ToolRefreshDecision = {
  shouldRefreshTaskData: boolean;
  shouldRefreshSessionTodos: boolean;
};

type ToolPartSessionUpdate = {
  refreshDecision: ToolRefreshDecision;
  nextState: AgentSessionState;
};

const resolveTodoUpdateFromTool = (
  part: ToolPart,
  input: Record<string, unknown> | undefined,
  output: string | undefined,
) => {
  if (!isTodoToolName(part.tool)) {
    return null;
  }
  return parseTodosFromToolOutput(output) ?? parseTodosFromToolInput(input);
};

export const resolveToolRefreshDecision = (
  part: ToolPart,
  status: ToolPartStatus,
  previousStatus: ToolPartStatus | undefined,
): ToolRefreshDecision => {
  const transitionedToCompleted = status === "completed" && previousStatus !== "completed";
  return {
    shouldRefreshTaskData: isOdtWorkflowMutationToolName(part.tool) && transitionedToCompleted,
    shouldRefreshSessionTodos: isTodoToolName(part.tool) && transitionedToCompleted,
  };
};

const composeToolTimingMeta = (
  existingToolMeta: ToolMeta | null,
  observedEventTimestampMs: number,
  status: ToolPartStatus,
  input: Record<string, unknown> | undefined,
): ToolTimingMeta => {
  const observedStartedAtMs =
    typeof existingToolMeta?.observedStartedAtMs === "number"
      ? existingToolMeta.observedStartedAtMs
      : observedEventTimestampMs;
  const observedEndedAtMs =
    status === "completed" || status === "error" ? observedEventTimestampMs : undefined;
  const inputReadyAtMs =
    typeof existingToolMeta?.inputReadyAtMs === "number"
      ? existingToolMeta.inputReadyAtMs
      : hasMeaningfulToolInput(input)
        ? observedEventTimestampMs
        : undefined;

  return {
    observedStartedAtMs,
    ...(typeof observedEndedAtMs === "number" ? { observedEndedAtMs } : {}),
    ...(typeof inputReadyAtMs === "number" ? { inputReadyAtMs } : {}),
  };
};

const composeToolMessageMeta = (
  part: ToolPart,
  status: ToolPartStatus,
  input: Record<string, unknown> | undefined,
  output: string | undefined,
  error: string | undefined,
  timingMeta: ToolTimingMeta,
): ToolMeta => {
  return {
    kind: "tool",
    partId: part.partId,
    callId: part.callId,
    tool: part.tool,
    status,
    ...(part.preview ? { preview: part.preview } : {}),
    ...(part.title ? { title: part.title } : {}),
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    ...(error ? { error } : {}),
    ...(part.metadata ? { metadata: part.metadata } : {}),
    ...(typeof part.startedAtMs === "number" ? { startedAtMs: part.startedAtMs } : {}),
    ...(typeof part.endedAtMs === "number" ? { endedAtMs: part.endedAtMs } : {}),
    ...(typeof timingMeta.observedStartedAtMs === "number"
      ? { observedStartedAtMs: timingMeta.observedStartedAtMs }
      : {}),
    ...(typeof timingMeta.observedEndedAtMs === "number"
      ? { observedEndedAtMs: timingMeta.observedEndedAtMs }
      : {}),
    ...(typeof timingMeta.inputReadyAtMs === "number"
      ? { inputReadyAtMs: timingMeta.inputReadyAtMs }
      : {}),
  };
};

const composeToolPartSessionUpdate = ({
  current,
  prepareCurrent,
  part,
  streamMessageKey,
  status,
  observedEventTimestampMs,
  input,
  output,
  error,
  todoUpdateFromTool,
  timestamp,
}: {
  current: AgentSessionState;
  prepareCurrent: PrepareCurrent;
  part: ToolPart;
  streamMessageKey: string;
  status: ToolPartStatus;
  observedEventTimestampMs: number;
  input: Record<string, unknown> | undefined;
  output: string | undefined;
  error: string | undefined;
  todoUpdateFromTool: ReturnType<typeof resolveTodoUpdateFromTool>;
  timestamp: string;
}): ToolPartSessionUpdate => {
  const prepared = prepareCurrent(current);
  const fallbackMessageId = `tool:${streamMessageKey}`;
  const messageId = resolveToolMessageId(
    prepared.messages,
    {
      messageId: part.messageId,
      callId: part.callId,
      tool: part.tool,
      status,
    },
    fallbackMessageId,
  );
  const existing = prepared.messages.find((entry) => entry.id === messageId);
  const previousStatus = existing?.meta?.kind === "tool" ? existing.meta.status : undefined;
  const existingToolMeta = existing?.meta?.kind === "tool" ? existing.meta : null;
  const refreshDecision = resolveToolRefreshDecision(part, status, previousStatus);
  const timingMeta = composeToolTimingMeta(
    existingToolMeta,
    observedEventTimestampMs,
    status,
    input,
  );

  return {
    refreshDecision,
    nextState: {
      ...prepared,
      status: "running",
      ...(todoUpdateFromTool
        ? { todos: mergeTodoListPreservingOrder(prepared.todos, todoUpdateFromTool) }
        : {}),
      messages: upsertMessage(prepared.messages, {
        id: messageId,
        role: "tool",
        content: formatToolContent({
          ...part,
          status,
          ...(typeof error === "string" && error.length > 0 ? { error } : {}),
          ...(typeof output === "string" && output.length > 0 ? { output } : {}),
        }),
        timestamp,
        meta: composeToolMessageMeta(part, status, input, output, error, timingMeta),
      }),
    },
  };
};

export const handleToolPart = (
  context: SessionEventContext,
  event: SessionPartEvent,
  part: ToolPart,
  streamMessageKey: string,
  prepareCurrent: PrepareCurrent,
): void => {
  const input = normalizeToolInput(part.input);
  const output = normalizeToolText(part.output);
  const error = normalizeToolText(part.error);
  const resolvedStatus = inferToolPartStatus(part);
  const observedEventTimestampMs = eventTimestampMs(event.timestamp);
  const todoUpdateFromTool = resolveTodoUpdateFromTool(part, input, output);
  let shouldRefreshTaskData = false;
  let shouldRefreshSessionTodos = false;

  context.updateSession(
    context.sessionId,
    (current) => {
      const { nextState, refreshDecision } = composeToolPartSessionUpdate({
        current,
        prepareCurrent,
        part,
        streamMessageKey,
        status: resolvedStatus,
        observedEventTimestampMs,
        input,
        output,
        error,
        todoUpdateFromTool,
        timestamp: event.timestamp,
      });

      shouldRefreshTaskData = refreshDecision.shouldRefreshTaskData;
      shouldRefreshSessionTodos = refreshDecision.shouldRefreshSessionTodos;

      return nextState;
    },
    { persist: false },
  );

  if (shouldRefreshTaskData) {
    runOrchestratorSideEffect(
      "session-events-refresh-task-data",
      context.refreshTaskData(context.repoPath),
      {
        tags: {
          repoPath: context.repoPath,
          sessionId: context.sessionId,
          tool: part.tool,
        },
      },
    );
  }

  if (shouldRefreshSessionTodos) {
    refreshTodosFromSessionRef(context);
  }
};
