import type { AgentChatMessageMeta, AgentSessionState } from "../../../types/agent-orchestrator";
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
  toToolMessageMeta,
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

const preserveExistingToolValue = <T>(
  incoming: T | undefined,
  existing: T | undefined,
): T | undefined => (incoming !== undefined ? incoming : existing);

const composeToolPartSessionUpdate = ({
  current,
  prepareCurrent,
  part,
  observedEventTimestampMs,
  input,
  output,
  error,
  timestamp,
}: {
  current: AgentSessionState;
  prepareCurrent: PrepareCurrent;
  part: ToolPart;
  observedEventTimestampMs: number;
  input: ToolInput | undefined;
  output: string | undefined;
  error: string | undefined;
  timestamp: string;
}): AgentSessionState => {
  const { status } = part;
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
  const resolvedError =
    status === "error" ? preserveExistingToolValue(error, existingToolMeta?.error) : undefined;
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
  if (part.computerUse === undefined && existingToolMeta?.computerUse !== undefined) {
    resolvedPart.computerUse = existingToolMeta.computerUse;
  }
  if (part.startedAtMs === undefined && existingToolMeta?.startedAtMs !== undefined) {
    resolvedPart.startedAtMs = existingToolMeta.startedAtMs;
  }
  if (part.endedAtMs === undefined && existingToolMeta?.endedAtMs !== undefined) {
    resolvedPart.endedAtMs = existingToolMeta.endedAtMs;
  }
  delete resolvedPart.error;
  if (resolvedInput) resolvedPart.input = resolvedInput;
  if (resolvedOutput) resolvedPart.output = resolvedOutput;
  if (resolvedError) resolvedPart.error = resolvedError;
  // An input or output that the event lacks stays from a compact history row, still cut.
  if (existingToolMeta?.detailsOmitted && (input === undefined || output === undefined))
    resolvedPart.detailsOmitted = true;
  const timingMeta = composeToolTimingMeta(
    existingToolMeta,
    observedEventTimestampMs,
    status,
    resolvedInput,
  );

  return {
    ...prepared,
    messages: upsertSessionMessageByTimestamp(prepared, {
      id: messageId,
      role: "tool",
      content: formatToolContent(resolvedPart),
      timestamp: existing?.timestamp ?? timestamp,
      meta: { ...toToolMessageMeta(resolvedPart), ...timingMeta },
    }),
  };
};

export const handleToolPart = (
  context: SessionToolPartEventContext,
  event: SessionPartEvent,
  part: ToolPart,
  prepareCurrent: PrepareCurrent,
  firstTimestamp = event.timestamp,
): void => {
  const input = normalizeToolInput(part.input);
  const output = normalizeToolText(part.output);
  const error = normalizeToolText(part.error);
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
      observedEventTimestampMs,
      input,
      output,
      error,
      timestamp: firstTimestamp,
    });
  });
};
