import type { AgentChatMessageMeta, AgentSessionState } from "@/types/agent-orchestrator";
import { formatToolContent } from "../agent-tool-messages";
import { toToolMessageId } from "../support/chat-message-ids";
import { findSessionMessageById, upsertSessionMessageByTimestamp } from "../support/messages";
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
type ToolInput = NonNullable<ToolMeta["input"]>;
type PrepareCurrent = (current: AgentSessionState) => AgentSessionState;

type ToolTimingMeta = {
  observedStartedAtMs?: number;
  observedEndedAtMs?: number;
  inputReadyAtMs?: number;
};

const resolveTodoUpdateFromTool = (
  part: ToolPart,
  input: ToolInput | undefined,
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
  input: ToolInput | undefined,
): ToolTimingMeta => {
  const observedStartedAtMs =
    existingToolMeta?.observedStartedAtMs !== undefined
      ? existingToolMeta.observedStartedAtMs
      : observedEventTimestampMs;
  const observedEndedAtMs =
    status === "completed" || status === "error" ? observedEventTimestampMs : undefined;
  const inputReadyAtMs =
    existingToolMeta?.inputReadyAtMs !== undefined
      ? existingToolMeta.inputReadyAtMs
      : hasMeaningfulToolInput(input)
        ? observedEventTimestampMs
        : undefined;

  const timingMeta: ToolTimingMeta = { observedStartedAtMs };
  if (observedEndedAtMs !== undefined) {
    timingMeta.observedEndedAtMs = observedEndedAtMs;
  }
  if (inputReadyAtMs !== undefined) {
    timingMeta.inputReadyAtMs = inputReadyAtMs;
  }
  return timingMeta;
};

const composeToolMessageMeta = (
  part: ToolPart,
  status: ToolPartStatus,
  input: ToolInput | undefined,
  output: string | undefined,
  error: string | undefined,
  timingMeta: ToolTimingMeta,
): ToolMeta => {
  const meta: ToolMeta = {
    kind: "tool",
    partId: part.partId,
    callId: part.callId,
    tool: part.tool,
    toolType: part.toolType,
    status,
  };
  if (part.preview) {
    meta.preview = part.preview;
  }
  if (part.title) {
    meta.title = part.title;
  }
  if (part.displayLabel) {
    meta.displayLabel = part.displayLabel;
  }
  if (input) {
    meta.input = input;
  }
  if (output) {
    meta.output = output;
  }
  if (error) {
    meta.error = error;
  }
  if (part.fileDiffs) {
    meta.fileDiffs = part.fileDiffs;
  }
  if (part.fileContent) {
    meta.fileContent = part.fileContent;
  }
  if (part.fileChanges) {
    meta.fileChanges = part.fileChanges;
  }
  if (part.metadata) {
    meta.metadata = part.metadata;
  }
  if (part.startedAtMs !== undefined) {
    meta.startedAtMs = part.startedAtMs;
  }
  if (part.endedAtMs !== undefined) {
    meta.endedAtMs = part.endedAtMs;
  }
  if (timingMeta.observedStartedAtMs !== undefined) {
    meta.observedStartedAtMs = timingMeta.observedStartedAtMs;
  }
  if (timingMeta.observedEndedAtMs !== undefined) {
    meta.observedEndedAtMs = timingMeta.observedEndedAtMs;
  }
  if (timingMeta.inputReadyAtMs !== undefined) {
    meta.inputReadyAtMs = timingMeta.inputReadyAtMs;
  }
  return meta;
};

const preserveExistingToolValue = <T>(
  incoming: T | undefined,
  existing: T | undefined,
): T | undefined => (incoming !== undefined ? incoming : existing);

const nextSessionStatusForToolPart = (
  currentStatus: AgentSessionState["status"],
  status: ToolPartStatus,
): AgentSessionState["status"] => {
  if (status === "pending" || status === "running") {
    return "running";
  }
  return currentStatus;
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
  input: ToolInput | undefined;
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
  const resolvedInput = preserveExistingToolValue(input, existingToolMeta?.input);
  const resolvedOutput = preserveExistingToolValue(output, existingToolMeta?.output);
  const resolvedError = preserveExistingToolValue(error, existingToolMeta?.error);
  const resolvedPart: ToolPart = { ...part };
  if (part.fileDiffs === undefined && existingToolMeta?.fileDiffs !== undefined) {
    resolvedPart.fileDiffs = existingToolMeta.fileDiffs;
  }
  if (part.fileContent === undefined && existingToolMeta?.fileContent !== undefined) {
    resolvedPart.fileContent = existingToolMeta.fileContent;
  }
  if (part.fileChanges === undefined && existingToolMeta?.fileChanges !== undefined) {
    resolvedPart.fileChanges = existingToolMeta.fileChanges;
  }
  if (part.startedAtMs === undefined && existingToolMeta?.startedAtMs !== undefined) {
    resolvedPart.startedAtMs = existingToolMeta.startedAtMs;
  }
  if (part.endedAtMs === undefined && existingToolMeta?.endedAtMs !== undefined) {
    resolvedPart.endedAtMs = existingToolMeta.endedAtMs;
  }
  const timingMeta = composeToolTimingMeta(
    existingToolMeta,
    observedEventTimestampMs,
    status,
    resolvedInput,
  );

  const contentPart: ToolPart = { ...resolvedPart, status };
  if (resolvedError !== undefined && resolvedError.length > 0) {
    contentPart.error = resolvedError;
  }
  if (resolvedOutput !== undefined && resolvedOutput.length > 0) {
    contentPart.output = resolvedOutput;
  }

  return {
    ...prepared,
    status: nextSessionStatusForToolPart(prepared.status, status),
    messages: upsertSessionMessageByTimestamp(prepared, {
      id: messageId,
      role: "tool",
      content: formatToolContent(contentPart),
      timestamp: existing?.timestamp ?? timestamp,
      meta: composeToolMessageMeta(
        resolvedPart,
        status,
        resolvedInput,
        resolvedOutput,
        resolvedError,
        timingMeta,
      ),
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
