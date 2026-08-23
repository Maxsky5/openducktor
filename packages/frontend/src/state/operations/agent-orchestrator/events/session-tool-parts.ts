import { hasRuntimeType } from "@openducktor/contracts";
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
  const observedStartedAtMs = hasRuntimeType(existingToolMeta?.observedStartedAtMs, "number")
    ? existingToolMeta.observedStartedAtMs
    : observedEventTimestampMs;
  const observedEndedAtMs =
    status === "completed" || status === "error" ? observedEventTimestampMs : undefined;
  const inputReadyAtMs = hasRuntimeType(existingToolMeta?.inputReadyAtMs, "number")
    ? existingToolMeta.inputReadyAtMs
    : hasMeaningfulToolInput(input)
      ? observedEventTimestampMs
      : undefined;

  return {
    observedStartedAtMs,
    ...(hasRuntimeType(observedEndedAtMs, "number") ? { observedEndedAtMs } : undefined),
    ...(hasRuntimeType(inputReadyAtMs, "number") ? { inputReadyAtMs } : undefined),
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
    ...(part.preview ? { preview: part.preview } : undefined),
    ...(part.title ? { title: part.title } : undefined),
    ...(part.displayLabel ? { displayLabel: part.displayLabel } : undefined),
    ...(input ? { input } : undefined),
    ...(output ? { output } : undefined),
    ...(error ? { error } : undefined),
    ...(part.fileDiffs ? { fileDiffs: part.fileDiffs } : undefined),
    ...(part.fileContent ? { fileContent: part.fileContent } : undefined),
    ...(part.fileChanges ? { fileChanges: part.fileChanges } : undefined),
    ...(part.metadata ? { metadata: part.metadata } : undefined),
    ...(hasRuntimeType(part.startedAtMs, "number") ? { startedAtMs: part.startedAtMs } : undefined),
    ...(hasRuntimeType(part.endedAtMs, "number") ? { endedAtMs: part.endedAtMs } : undefined),
    ...(hasRuntimeType(timingMeta.observedStartedAtMs, "number")
      ? { observedStartedAtMs: timingMeta.observedStartedAtMs }
      : undefined),
    ...(hasRuntimeType(timingMeta.observedEndedAtMs, "number")
      ? { observedEndedAtMs: timingMeta.observedEndedAtMs }
      : undefined),
    ...(hasRuntimeType(timingMeta.inputReadyAtMs, "number")
      ? { inputReadyAtMs: timingMeta.inputReadyAtMs }
      : undefined),
  };
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
  const resolvedInput = preserveExistingToolValue(input, existingToolMeta?.input);
  const resolvedOutput = preserveExistingToolValue(output, existingToolMeta?.output);
  const resolvedError = preserveExistingToolValue(error, existingToolMeta?.error);
  const resolvedPart: ToolPart = {
    ...part,
    ...(part.fileDiffs === undefined && existingToolMeta?.fileDiffs !== undefined
      ? { fileDiffs: existingToolMeta.fileDiffs }
      : undefined),
    ...(part.fileContent === undefined && existingToolMeta?.fileContent !== undefined
      ? { fileContent: existingToolMeta.fileContent }
      : undefined),
    ...(part.fileChanges === undefined && existingToolMeta?.fileChanges !== undefined
      ? { fileChanges: existingToolMeta.fileChanges }
      : undefined),
    ...(!hasRuntimeType(part.startedAtMs, "number") &&
    hasRuntimeType(existingToolMeta?.startedAtMs, "number")
      ? { startedAtMs: existingToolMeta.startedAtMs }
      : undefined),
    ...(!hasRuntimeType(part.endedAtMs, "number") &&
    hasRuntimeType(existingToolMeta?.endedAtMs, "number")
      ? { endedAtMs: existingToolMeta.endedAtMs }
      : undefined),
  };
  const timingMeta = composeToolTimingMeta(
    existingToolMeta,
    observedEventTimestampMs,
    status,
    resolvedInput,
  );

  return {
    ...prepared,
    status: nextSessionStatusForToolPart(prepared.status, status),
    messages: upsertSessionMessageByTimestamp(prepared, {
      id: messageId,
      role: "tool",
      content: formatToolContent({
        ...resolvedPart,
        status,
        ...(hasRuntimeType(resolvedError, "string") && resolvedError.length > 0
          ? { error: resolvedError }
          : undefined),
        ...(hasRuntimeType(resolvedOutput, "string") && resolvedOutput.length > 0
          ? { output: resolvedOutput }
          : undefined),
      }),
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
