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
import type { JsonValue } from "@openducktor/contracts";

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
  input: Record<string, JsonValue> | undefined,
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
  input: Record<string, JsonValue> | undefined,
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
    ...(() => {
      if (hasRuntimeType(observedEndedAtMs, "number")) {
        return { observedEndedAtMs };
      }
      return {};
    })(),
    ...(() => {
      if (hasRuntimeType(inputReadyAtMs, "number")) {
        return { inputReadyAtMs };
      }
      return {};
    })(),
  };
};

const composeToolMessageMeta = (
  part: ToolPart,
  status: ToolPartStatus,
  input: Record<string, JsonValue> | undefined,
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
    ...(() => {
      if (part.preview) {
        return { preview: part.preview };
      }
      return {};
    })(),
    ...(() => {
      if (part.title) {
        return { title: part.title };
      }
      return {};
    })(),
    ...(() => {
      if (part.displayLabel) {
        return { displayLabel: part.displayLabel };
      }
      return {};
    })(),
    ...(() => {
      if (input) {
        return { input };
      }
      return {};
    })(),
    ...(() => {
      if (output) {
        return { output };
      }
      return {};
    })(),
    ...(() => {
      if (error) {
        return { error };
      }
      return {};
    })(),
    ...(() => {
      if (part.fileDiffs) {
        return { fileDiffs: part.fileDiffs };
      }
      return {};
    })(),
    ...(() => {
      if (part.fileContent) {
        return { fileContent: part.fileContent };
      }
      return {};
    })(),
    ...(() => {
      if (part.fileChanges) {
        return { fileChanges: part.fileChanges };
      }
      return {};
    })(),
    ...(() => {
      if (part.metadata) {
        return { metadata: part.metadata };
      }
      return {};
    })(),
    ...(() => {
      if (hasRuntimeType(part.startedAtMs, "number")) {
        return { startedAtMs: part.startedAtMs };
      }
      return {};
    })(),
    ...(() => {
      if (hasRuntimeType(part.endedAtMs, "number")) {
        return { endedAtMs: part.endedAtMs };
      }
      return {};
    })(),
    ...(() => {
      if (hasRuntimeType(timingMeta.observedStartedAtMs, "number")) {
        return { observedStartedAtMs: timingMeta.observedStartedAtMs };
      }
      return {};
    })(),
    ...(() => {
      if (hasRuntimeType(timingMeta.observedEndedAtMs, "number")) {
        return { observedEndedAtMs: timingMeta.observedEndedAtMs };
      }
      return {};
    })(),
    ...(() => {
      if (hasRuntimeType(timingMeta.inputReadyAtMs, "number")) {
        return { inputReadyAtMs: timingMeta.inputReadyAtMs };
      }
      return {};
    })(),
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
  input: Record<string, JsonValue> | undefined;
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
    ...(() => {
      if (part.fileDiffs === undefined && existingToolMeta?.fileDiffs !== undefined) {
        return { fileDiffs: existingToolMeta.fileDiffs };
      }
      return {};
    })(),
    ...(() => {
      if (part.fileContent === undefined && existingToolMeta?.fileContent !== undefined) {
        return { fileContent: existingToolMeta.fileContent };
      }
      return {};
    })(),
    ...(() => {
      if (part.fileChanges === undefined && existingToolMeta?.fileChanges !== undefined) {
        return { fileChanges: existingToolMeta.fileChanges };
      }
      return {};
    })(),
    ...(() => {
      if (hasRuntimeType(part.startedAtMs, "number")) {
        return {};
      }
      return hasRuntimeType(existingToolMeta?.startedAtMs, "number")
        ? { startedAtMs: existingToolMeta.startedAtMs }
        : {};
    })(),
    ...(() => {
      if (hasRuntimeType(part.endedAtMs, "number")) {
        return {};
      }
      return hasRuntimeType(existingToolMeta?.endedAtMs, "number")
        ? { endedAtMs: existingToolMeta.endedAtMs }
        : {};
    })(),
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
        ...(() => {
          if (hasRuntimeType(resolvedError, "string") && resolvedError.length > 0) {
            return { error: resolvedError };
          }
          return {};
        })(),
        ...(() => {
          if (hasRuntimeType(resolvedOutput, "string") && resolvedOutput.length > 0) {
            return { output: resolvedOutput };
          }
          return {};
        })(),
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
