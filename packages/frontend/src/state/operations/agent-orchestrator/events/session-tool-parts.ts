import type { AgentChatMessageMeta, AgentSessionState } from "@/types/agent-orchestrator";
import { formatToolContent } from "../agent-tool-messages";
import { toToolMessageId } from "../support/chat-message-ids";
import { findSessionMessageById, upsertSessionMessage } from "../support/messages";
import {
  mergeTodoListPreservingOrder,
  parseTodosFromToolInput,
  parseTodosFromToolOutput,
} from "../support/todos";
import {
  normalizeToolInput,
  normalizeToolText,
  resolveToolMessageId,
} from "../support/tool-messages";
import type {
  SessionPart,
  SessionPartEvent,
  SessionToolPartEventContext,
} from "./session-event-types";
import { eventTimestampMs, hasMeaningfulToolInput } from "./session-helpers";

type ToolPart = Extract<SessionPart, { kind: "tool" }>;
type ToolPartStatus = ToolPart["status"];
type ToolMeta = Extract<AgentChatMessageMeta, { kind: "tool" }>;
type PrepareCurrent = (current: AgentSessionState) => AgentSessionState;

type ToolTimingMeta = {
  observedStartedAtMs?: number;
  observedEndedAtMs?: number;
  inputReadyAtMs?: number;
};

const resolveTodoUpdateFromTool = (
  part: ToolPart,
  input: Record<string, unknown> | undefined,
  output: string | undefined,
) => {
  if (part.toolType !== "todo") {
    return null;
  }
  return parseTodosFromToolOutput(output) ?? parseTodosFromToolInput(input);
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
    toolType: part.toolType,
    status,
    ...(part.preview ? { preview: part.preview } : {}),
    ...(part.title ? { title: part.title } : {}),
    ...(part.displayLabel ? { displayLabel: part.displayLabel } : {}),
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    ...(error ? { error } : {}),
    ...(part.fileDiffs ? { fileDiffs: part.fileDiffs } : {}),
    ...(part.fileContent ? { fileContent: part.fileContent } : {}),
    ...(part.fileChanges ? { fileChanges: part.fileChanges } : {}),
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
  status,
  observedEventTimestampMs,
  input,
  output,
  error,
  timestamp,
}: {
  current: AgentSessionState;
  prepareCurrent: PrepareCurrent;
  part: ToolPart;
  status: ToolPartStatus;
  observedEventTimestampMs: number;
  input: Record<string, unknown> | undefined;
  output: string | undefined;
  error: string | undefined;
  timestamp: string;
}): AgentSessionState => {
  const prepared = prepareCurrent(current);
  const fallbackMessageId = toToolMessageId(part);
  const messageId = resolveToolMessageId(
    prepared,
    {
      messageId: part.messageId,
      callId: part.callId,
      tool: part.tool,
      status,
    },
    fallbackMessageId,
  );
  const existing = findSessionMessageById(prepared, messageId);
  const existingToolMeta = existing?.meta?.kind === "tool" ? existing.meta : null;
  const timingMeta = composeToolTimingMeta(
    existingToolMeta,
    observedEventTimestampMs,
    status,
    input,
  );

  return {
    ...prepared,
    status: "running",
    messages: upsertSessionMessage(prepared, {
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
  };
};

export const handleToolPart = (
  context: SessionToolPartEventContext,
  event: SessionPartEvent,
  part: ToolPart,
  prepareCurrent: PrepareCurrent,
): void => {
  const input = normalizeToolInput(part.input);
  const output = normalizeToolText(part.output);
  const error = normalizeToolText(part.error);
  const resolvedStatus = part.status;
  const observedEventTimestampMs = eventTimestampMs(event.timestamp);
  const todoUpdateFromTool = resolveTodoUpdateFromTool(part, input, output);
  const activeSession = context.store.readSession(context.session.identity);

  if (todoUpdateFromTool && activeSession) {
    context.todos.updateSessionTodos(
      { ...context.session.identity, repoPath: context.session.repoPath },
      (todos) => mergeTodoListPreservingOrder(todos, todoUpdateFromTool),
    );
  }

  context.store.updateSession(context.session.identity, (current) => {
    return composeToolPartSessionUpdate({
      current,
      prepareCurrent,
      part,
      status: resolvedStatus,
      observedEventTimestampMs,
      input,
      output,
      error,
      timestamp: event.timestamp,
    });
  });
};
