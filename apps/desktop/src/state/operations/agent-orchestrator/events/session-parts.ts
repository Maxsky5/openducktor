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
  sanitizeStreamingText,
  upsertMessage,
} from "../support/utils";
import type {
  SessionEvent,
  SessionEventContext,
  SessionPart,
  SessionPartEvent,
} from "./session-event-types";
import {
  createPrePartTodoSettlement,
  eventTimestampMs,
  hasMeaningfulToolInput,
  inferToolPartStatus,
  refreshTodosFromSessionRef,
  toPartStreamKey,
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

const resolveToolRefreshDecision = (
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

export const handleAssistantDelta = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "assistant_delta" }>,
): void => {
  if (context.draftSourceBySessionRef.current[context.sessionId] === "part") {
    return;
  }
  context.draftSourceBySessionRef.current[context.sessionId] = "delta";
  const nextRaw = `${context.draftRawBySessionRef.current[context.sessionId] ?? ""}${event.delta}`;
  context.draftRawBySessionRef.current[context.sessionId] = nextRaw;
  context.updateSession(
    context.sessionId,
    (current) => ({
      ...current,
      status: "running",
      draftAssistantText: sanitizeStreamingText(nextRaw),
    }),
    { persist: false },
  );
};

const handleTextPart = (
  context: SessionEventContext,
  part: Extract<SessionPart, { kind: "text" }>,
  prepareCurrent: PrepareCurrent,
): void => {
  if (part.synthetic) {
    return;
  }
  context.draftSourceBySessionRef.current[context.sessionId] = "part";
  context.draftRawBySessionRef.current[context.sessionId] = part.text;
  context.updateSession(
    context.sessionId,
    (current) => {
      const prepared = prepareCurrent(current);
      return {
        ...prepared,
        status: "running",
        draftAssistantText: sanitizeStreamingText(part.text),
      };
    },
    { persist: false },
  );
};

const handleReasoningPart = (
  context: SessionEventContext,
  event: SessionPartEvent,
  part: Extract<SessionPart, { kind: "reasoning" }>,
  streamMessageKey: string,
  prepareCurrent: PrepareCurrent,
): void => {
  context.updateSession(
    context.sessionId,
    (current) => {
      const prepared = prepareCurrent(current);
      const messageId = `thinking:${streamMessageKey}`;
      const existingMessage = prepared.messages.find((entry) => entry.id === messageId);
      const nextContent =
        part.text.trim().length > 0 ? part.text : (existingMessage?.content ?? "");
      if (nextContent.trim().length === 0) {
        return {
          ...prepared,
          status: "running",
        };
      }

      return {
        ...prepared,
        status: "running",
        messages: upsertMessage(prepared.messages, {
          id: messageId,
          role: "thinking",
          content: nextContent,
          timestamp: event.timestamp,
          meta: {
            kind: "reasoning",
            partId: part.partId,
            completed: part.completed,
          },
        }),
      };
    },
    { persist: false },
  );
};

const handleToolPart = (
  context: SessionEventContext,
  event: SessionPartEvent,
  part: ToolPart,
  streamMessageKey: string,
  prepareCurrent: PrepareCurrent,
): void => {
  const input = normalizeToolInput(part.input);
  const output = normalizeToolText(part.output);
  const error = normalizeToolText(part.error);
  const resolvedStatus = inferToolPartStatus(part, output);
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

      shouldRefreshTaskData = shouldRefreshTaskData || refreshDecision.shouldRefreshTaskData;
      shouldRefreshSessionTodos =
        shouldRefreshSessionTodos || refreshDecision.shouldRefreshSessionTodos;

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

const handleSubtaskPart = (
  context: SessionEventContext,
  event: SessionPartEvent,
  part: Extract<SessionPart, { kind: "subtask" }>,
  streamMessageKey: string,
  prepareCurrent: PrepareCurrent,
): void => {
  context.updateSession(
    context.sessionId,
    (current) => {
      const prepared = prepareCurrent(current);
      return {
        ...prepared,
        status: "running",
        messages: upsertMessage(prepared.messages, {
          id: `subtask:${streamMessageKey}`,
          role: "system",
          content: `Subtask (${part.agent}): ${part.description}`,
          timestamp: event.timestamp,
          meta: {
            kind: "subtask",
            partId: part.partId,
            agent: part.agent,
            prompt: part.prompt,
            description: part.description,
          },
        }),
      };
    },
    { persist: false },
  );
};

export const handleAssistantPart = (
  context: SessionEventContext,
  event: SessionPartEvent,
): void => {
  const part = event.part;
  const streamMessageKey = toPartStreamKey(part);
  const prepareCurrent = createPrePartTodoSettlement(part, event.timestamp);

  switch (part.kind) {
    case "text":
      handleTextPart(context, part, prepareCurrent);
      return;
    case "reasoning":
      handleReasoningPart(context, event, part, streamMessageKey, prepareCurrent);
      return;
    case "tool":
      handleToolPart(context, event, part, streamMessageKey, prepareCurrent);
      return;
    case "subtask":
      handleSubtaskPart(context, event, part, streamMessageKey, prepareCurrent);
      return;
    case "step":
      return;
  }
};
