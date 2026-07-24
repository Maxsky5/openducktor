import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent, AgentStreamPart } from "@openducktor/core";
import { claudeSubagentExternalSessionId } from "./claude-agent-sdk-subagent-transcripts";
import { timestampMs } from "./claude-agent-sdk-tool-shapes";
import {
  isClaudeSubagentTaskRetracted,
  isClaudeToolUseRetracted,
  retireClaudeSubagentTask,
} from "./claude-agent-sdk-transcript-correlation";
import { isRecord, readStringProp } from "./claude-agent-sdk-utils";

type ClaudeSubagentSession = {
  externalSessionId: string;
  hiddenSubagentTaskIds?: Set<string>;
  retractedSubagentTaskIds?: Set<string>;
  retractedToolUseIds?: Set<string>;
  subagentMessageIdsByTaskId: Map<string, string>;
  subagentTaskIdsByToolUseId: Map<string, string>;
  toolMessageIdsByCallId: Map<string, string>;
  toolNamesByCallId: Map<string, string>;
};

type ClaudeSubagentSystemMessage = Extract<
  SDKMessage,
  {
    type: "system";
    subtype: "task_started" | "task_progress" | "task_updated" | "task_notification";
  }
>;

type SubagentStreamPart = Extract<AgentStreamPart, { kind: "subagent" }>;
type SubagentExecutionMode = NonNullable<SubagentStreamPart["executionMode"]>;

const shouldSuppressSubagentTask = (
  session: ClaudeSubagentSession,
  taskId: string,
  skipTranscript = false,
): boolean => {
  if (skipTranscript) {
    session.hiddenSubagentTaskIds ??= new Set<string>();
    session.hiddenSubagentTaskIds.add(taskId);
    return true;
  }
  return session.hiddenSubagentTaskIds?.has(taskId) ?? false;
};

const subagentStatusFromClaudeTaskStatus = (
  status: "pending" | "running" | "completed" | "failed" | "killed" | "paused" | undefined,
): Extract<AgentStreamPart, { kind: "subagent" }>["status"] => {
  if (status === "completed") {
    return "completed";
  }
  if (status === "failed") {
    return "error";
  }
  if (status === "killed") {
    return "cancelled";
  }
  return "running";
};

const isAgentToolName = (toolName: string | undefined): boolean =>
  toolName?.toLowerCase() === "agent";

const isVisibleSubagentTaskStart = (
  message: ClaudeSubagentSystemMessage,
  toolName: string | undefined,
): boolean => {
  if (readStringProp(message, "subagent_type")) {
    return true;
  }
  if (isAgentToolName(toolName)) {
    return true;
  }
  return readStringProp(message, "task_type") === "agent";
};

const emitSubagentPart = (
  emit: (event: AgentEvent) => void,
  session: ClaudeSubagentSession,
  taskId: string,
  status: Extract<AgentStreamPart, { kind: "subagent" }>["status"],
  timestamp: string,
  details: Partial<Extract<AgentStreamPart, { kind: "subagent" }>>,
): void => {
  const messageId = session.subagentMessageIdsByTaskId.get(taskId) ?? session.externalSessionId;
  emit({
    type: "assistant_part",
    externalSessionId: session.externalSessionId,
    timestamp,
    part: {
      kind: "subagent",
      messageId,
      partId: `claude-subagent:${taskId}`,
      correlationKey: taskId,
      status,
      externalSessionId: claudeSubagentExternalSessionId(session.externalSessionId, taskId),
      ...details,
    },
  });
};

const readStructuredAgentResult = (raw: Record<string, unknown>): Record<string, unknown> => {
  if (isRecord(raw.toolUseResult)) {
    return raw.toolUseResult;
  }
  if (isRecord(raw.structuredContent)) {
    return raw.structuredContent;
  }
  return raw;
};

const agentResultStatus = (
  result: Record<string, unknown>,
  isError: boolean,
): SubagentStreamPart["status"] => {
  if (isError) {
    return "error";
  }
  const status = readStringProp(result, "status");
  if (status === "async_launched" || status === "remote_launched") {
    return "running";
  }
  if (status === "running" || status === "pending") {
    return "running";
  }
  if (status === "completed") {
    return "completed";
  }
  if (status === "failed" || status === "error") {
    return "error";
  }
  if (status === "cancelled" || status === "canceled" || status === "killed") {
    return "cancelled";
  }
  return "completed";
};

const agentResultExecutionMode = (
  result: Record<string, unknown>,
  input: Record<string, unknown> | undefined,
): SubagentExecutionMode => {
  const status = readStringProp(result, "status");
  if (status === "async_launched" || status === "remote_launched") {
    return "background";
  }
  return input?.run_in_background === true ? "background" : "foreground";
};

const firstNonEmptyString = (...values: Array<string | undefined | null>): string | undefined => {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
};

const readFailedTaskMessage = (value: Record<string, unknown>): string | undefined =>
  firstNonEmptyString(
    readStringProp(value, "error"),
    readStringProp(value, "message"),
    readStringProp(value, "reason"),
    readStringProp(value, "description"),
    readStringProp(value, "summary"),
  );

const readFailedTaskErrorReason = (value: Record<string, unknown>): string | undefined =>
  firstNonEmptyString(
    readStringProp(value, "error"),
    readStringProp(value, "message"),
    readStringProp(value, "reason"),
  );

export const emitClaudeAgentToolResultSubagentPart = ({
  emit,
  input,
  isError,
  resultRaw,
  resultText,
  session,
  timestamp,
  toolUseId,
}: {
  emit: (event: AgentEvent) => void;
  input?: Record<string, unknown>;
  isError: boolean;
  resultRaw: Record<string, unknown>;
  resultText: string;
  session: ClaudeSubagentSession;
  timestamp: string;
  toolUseId: string;
}): void => {
  if (isClaudeToolUseRetracted(session, toolUseId)) {
    return;
  }
  const structuredResult = readStructuredAgentResult(resultRaw);
  const agentId =
    readStringProp(structuredResult, "agentId") ?? readStringProp(structuredResult, "taskId");
  if (!agentId) {
    return;
  }

  const taskId = session.subagentTaskIdsByToolUseId.get(toolUseId);
  session.subagentTaskIdsByToolUseId.set(toolUseId, agentId);
  const externalSessionId = claudeSubagentExternalSessionId(session.externalSessionId, agentId);
  const status = agentResultStatus(structuredResult, isError);
  const executionMode = agentResultExecutionMode(structuredResult, input);
  const agent =
    readStringProp(structuredResult, "agentType") ?? readStringProp(input, "subagent_type");
  const prompt = readStringProp(structuredResult, "prompt") ?? readStringProp(input, "prompt");
  const description = taskId ? undefined : readStringProp(input, "description");
  const error =
    status === "error"
      ? (readFailedTaskErrorReason(structuredResult) ?? resultText ?? description)
      : undefined;
  const endedAtMs = timestampMs(timestamp);
  const totalDurationMs =
    typeof structuredResult.totalDurationMs === "number" ? structuredResult.totalDurationMs : null;
  const startedAtMs =
    totalDurationMs === null ? undefined : Math.max(0, endedAtMs - totalDurationMs);
  const metadata: Record<string, unknown> = {
    agentId,
    sourceToolUseId: toolUseId,
    ...(structuredResult.resolvedModel ? { resolvedModel: structuredResult.resolvedModel } : {}),
    ...(totalDurationMs === null ? {} : { totalDurationMs }),
    ...(typeof structuredResult.totalTokens === "number"
      ? { totalTokens: structuredResult.totalTokens }
      : {}),
    ...(structuredResult.outputFile ? { outputFile: structuredResult.outputFile } : {}),
    ...(typeof structuredResult.canReadOutputFile === "boolean"
      ? { canReadOutputFile: structuredResult.canReadOutputFile }
      : {}),
    ...(structuredResult.sessionUrl ? { sessionUrl: structuredResult.sessionUrl } : {}),
  };
  const messageId =
    session.toolMessageIdsByCallId.get(toolUseId) ??
    (taskId ? session.subagentMessageIdsByTaskId.get(taskId) : undefined) ??
    session.externalSessionId;

  emit({
    type: "assistant_part",
    externalSessionId: session.externalSessionId,
    timestamp,
    part: {
      kind: "subagent",
      messageId,
      partId: taskId ? `claude-subagent:${taskId}` : `claude-subagent:${agentId}`,
      correlationKey: taskId ?? `session:${toolUseId}:${externalSessionId}`,
      status,
      externalSessionId,
      executionMode,
      ...(agent ? { agent } : {}),
      ...(prompt ? { prompt } : {}),
      ...(description ? { description } : {}),
      ...(error ? { error } : {}),
      ...(typeof startedAtMs === "number" ? { startedAtMs } : {}),
      ...(status === "running" ? {} : { endedAtMs }),
      metadata,
    },
  });
};

export const handleClaudeSubagentSystemMessage = ({
  emit,
  message,
  session,
  timestamp,
}: {
  emit: (event: AgentEvent) => void;
  message: ClaudeSubagentSystemMessage;
  session: ClaudeSubagentSession;
  timestamp: string;
}): void => {
  const toolUseId = isRecord(message)
    ? (readStringProp(message, "tool_use_id") ?? readStringProp(message, "parent_tool_use_id"))
    : undefined;
  const toolMessageId = toolUseId ? session.toolMessageIdsByCallId.get(toolUseId) : undefined;
  const toolName = toolUseId ? session.toolNamesByCallId.get(toolUseId) : undefined;

  if (toolUseId && isClaudeToolUseRetracted(session, toolUseId)) {
    retireClaudeSubagentTask(session, message.task_id);
    return;
  }
  if (isClaudeSubagentTaskRetracted(session, message.task_id)) {
    return;
  }

  if (message.subtype === "task_started") {
    if (
      shouldSuppressSubagentTask(session, message.task_id, message.skip_transcript) ||
      !isVisibleSubagentTaskStart(message, toolName)
    ) {
      shouldSuppressSubagentTask(session, message.task_id, true);
      return;
    }
    if (toolUseId) {
      session.subagentTaskIdsByToolUseId.set(toolUseId, message.task_id);
    }
    if (toolMessageId) {
      session.subagentMessageIdsByTaskId.set(message.task_id, toolMessageId);
    }
    const details: Partial<Extract<AgentStreamPart, { kind: "subagent" }>> = {
      description: message.description,
      executionMode: "foreground",
      startedAtMs: timestampMs(timestamp),
    };
    const agent = message.subagent_type ?? message.workflow_name;
    if (agent) {
      details.agent = agent;
    }
    if (message.prompt) {
      details.prompt = message.prompt;
    }
    emitSubagentPart(emit, session, message.task_id, "running", timestamp, details);
    return;
  }

  if (message.subtype === "task_progress") {
    if (shouldSuppressSubagentTask(session, message.task_id)) {
      return;
    }
    const details: Partial<Extract<AgentStreamPart, { kind: "subagent" }>> = {};
    if (message.subagent_type) {
      details.agent = message.subagent_type;
    }
    emitSubagentPart(emit, session, message.task_id, "running", timestamp, details);
    return;
  }

  if (message.subtype === "task_updated") {
    if (shouldSuppressSubagentTask(session, message.task_id)) {
      return;
    }
    const details: Partial<Extract<AgentStreamPart, { kind: "subagent" }>> = {};
    const patch = message.patch as Record<string, unknown>;
    const error =
      readStringProp(patch, "error") ??
      readStringProp(message, "error") ??
      (message.patch.status === "failed"
        ? (firstNonEmptyString(
            readFailedTaskErrorReason(patch),
            readFailedTaskErrorReason(message),
          ) ?? `Claude subagent ${message.task_id} failed.`)
        : undefined);
    if (error) {
      details.error = error;
    }
    if (message.patch.end_time !== undefined) {
      details.endedAtMs = message.patch.end_time;
    }
    emitSubagentPart(
      emit,
      session,
      message.task_id,
      subagentStatusFromClaudeTaskStatus(message.patch.status),
      timestamp,
      details,
    );
    return;
  }

  if (shouldSuppressSubagentTask(session, message.task_id, message.skip_transcript)) {
    return;
  }
  const notificationError =
    message.status === "failed"
      ? (readFailedTaskMessage(message) ?? `Claude subagent ${message.task_id} failed.`)
      : undefined;
  emitSubagentPart(
    emit,
    session,
    message.task_id,
    message.status === "failed"
      ? "error"
      : message.status === "stopped"
        ? "cancelled"
        : "completed",
    timestamp,
    {
      ...(notificationError ? { error: notificationError } : {}),
      endedAtMs: timestampMs(timestamp),
      ...(message.output_file ? { metadata: { outputFile: message.output_file } } : {}),
    },
  );
};
