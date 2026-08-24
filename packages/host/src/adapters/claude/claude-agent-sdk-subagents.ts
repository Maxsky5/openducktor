import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent, AgentStreamPart } from "@openducktor/core";
import type { ClaudeEventSession } from "./claude-agent-sdk-event-session";
import { readClaudeBackgroundAgentLaunch } from "./claude-agent-sdk-runtime-messages";
import {
  claudeAgentResultExecutionMode,
  claudeAgentResultStatus,
  claudeSubagentStatusFromTaskStatus,
  firstClaudeTaskText,
  isTerminalClaudeTaskStatus,
  readClaudeFailedTaskMessage,
  readClaudeFailedTaskReason,
  readClaudeTaskStopTaskId,
  readStructuredClaudeAgentResult,
  resolveClaudeSubagentToolUseId,
} from "./claude-agent-sdk-subagent-results";
import { claudeSubagentExternalSessionId } from "./claude-agent-sdk-subagent-transcripts";
import { timestampMs } from "./claude-agent-sdk-tool-shapes";
import {
  isClaudeSubagentTaskRetracted,
  isClaudeToolUseRetracted,
  retireClaudeSubagentTask,
} from "./claude-agent-sdk-transcript-correlation";
import { settleClaudeStreamedAssistantText } from "./claude-agent-sdk-transcript-retractions";
import { isRecord, readStringProp } from "./claude-agent-sdk-utils";

type ClaudeSubagentSession = {
  activeBackgroundSubagentTaskIds?: Set<string>;
  externalSessionId: string;
  hiddenSubagentTaskIds?: Set<string>;
  retractedSubagentTaskIds?: Set<string>;
  retractedToolUseIds?: Set<string>;
  subagentEventSessionsByToolUseId?: Map<string, ClaudeEventSession>;
  subagentMessageIdsByTaskId: Map<string, string>;
  subagentAgentIdsByToolUseId?: Map<string, string>;
  subagentTaskIdsByToolUseId: Map<string, string>;
  toolInputsByCallId: Map<string, Record<string, unknown>>;
  toolMessageIdsByCallId: Map<string, string>;
  toolNamesByCallId: Map<string, string>;
};
type ClaudeSdkSubagentSystemMessage = Extract<
  SDKMessage,
  {
    type: "system";
    subtype: "task_started" | "task_progress" | "task_updated" | "task_notification";
  }
>;
type ClaudeSdkTaskNotificationMessage = Extract<
  ClaudeSdkSubagentSystemMessage,
  { subtype: "task_notification" }
>;
export type ClaudeHistoryTaskNotificationMessage = Omit<
  ClaudeSdkTaskNotificationMessage,
  "output_file" | "summary"
> & {
  output_file?: string;
  summary?: string;
};
type ClaudeSubagentSystemMessage =
  | Exclude<ClaudeSdkSubagentSystemMessage, ClaudeSdkTaskNotificationMessage>
  | ClaudeHistoryTaskNotificationMessage;
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
  const taskType = readStringProp(message, "task_type");
  return taskType === "local_agent" || taskType === "remote_agent";
};
const emitSubagentPart = (
  emit: (event: AgentEvent) => void,
  session: ClaudeSubagentSession,
  agentId: string,
  toolUseId: string | undefined,
  status: Extract<AgentStreamPart, { kind: "subagent" }>["status"],
  timestamp: string,
  details: Partial<Extract<AgentStreamPart, { kind: "subagent" }>>,
): void => {
  const correlationKey = toolUseId ?? agentId;
  const messageId =
    (toolUseId ? session.toolMessageIdsByCallId.get(toolUseId) : undefined) ??
    session.subagentMessageIdsByTaskId.get(agentId) ??
    session.externalSessionId;
  emit({
    type: "assistant_part",
    externalSessionId: session.externalSessionId,
    timestamp,
    part: {
      kind: "subagent",
      messageId,
      partId: `claude-subagent:${correlationKey}`,
      correlationKey,
      status,
      externalSessionId: claudeSubagentExternalSessionId(session.externalSessionId, agentId),
      ...details,
    },
  });
};
const emitCompletedSubagentAssistantMessage = (
  emit: (event: AgentEvent) => void,
  session: ClaudeSubagentSession,
  toolUseId: string | undefined,
  timestamp: string,
): void => {
  const childSession = toolUseId
    ? session.subagentEventSessionsByToolUseId?.get(toolUseId)
    : undefined;
  const pending = childSession?.pendingSubagentAssistantMessage;
  if (!childSession || !pending) {
    return;
  }
  const message: Extract<AgentEvent, { type: "assistant_message" }> = {
    type: "assistant_message",
    externalSessionId: childSession.externalSessionId,
    timestamp,
    messageId: pending.messageId,
    message: pending.text,
  };
  if (pending.model) Object.assign(message, { model: pending.model });
  emit(message);
  settleClaudeStreamedAssistantText({
    emit,
    preserveMessageId: pending.messageId,
    session: childSession,
    timestamp,
  });
  delete childSession.pendingSubagentAssistantMessage;
};
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
  const storedResult = readStructuredClaudeAgentResult(resultRaw);
  const backgroundLaunch = readClaudeBackgroundAgentLaunch(resultText);
  const structuredResult = backgroundLaunch
    ? { ...backgroundLaunch, ...storedResult }
    : storedResult;
  const resultAgentId =
    readStringProp(structuredResult, "agentId") ?? readStringProp(structuredResult, "taskId");
  const knownAgentId = session.subagentAgentIdsByToolUseId?.get(toolUseId);
  const agentId = resultAgentId ?? knownAgentId;
  if (!agentId) {
    return;
  }
  const taskId = session.subagentTaskIdsByToolUseId.get(toolUseId);
  session.subagentAgentIdsByToolUseId ??= new Map();
  session.subagentAgentIdsByToolUseId.set(toolUseId, agentId);
  const externalSessionId = claudeSubagentExternalSessionId(session.externalSessionId, agentId);
  const status = resultAgentId ? claudeAgentResultStatus(structuredResult, isError) : "running";
  const executionMode = claudeAgentResultExecutionMode(structuredResult, input);
  if (executionMode === "background" && status === "running") {
    session.activeBackgroundSubagentTaskIds ??= new Set();
    session.activeBackgroundSubagentTaskIds.add(taskId ?? agentId);
  }
  const agent =
    readStringProp(structuredResult, "agentType") ?? readStringProp(input, "subagent_type");
  const prompt = readStringProp(structuredResult, "prompt") ?? readStringProp(input, "prompt");
  const description = readStringProp(input, "description");
  const error =
    status === "error"
      ? (firstClaudeTaskText(
          readClaudeFailedTaskReason(structuredResult),
          resultText,
          description,
        ) ?? `Claude subagent ${agentId} failed.`)
      : undefined;
  const endedAtMs = timestampMs(timestamp);
  const totalDurationMs =
    typeof structuredResult.totalDurationMs === "number" ? structuredResult.totalDurationMs : null;
  const startedAtMs =
    totalDurationMs === null ? undefined : Math.max(0, endedAtMs - totalDurationMs);
  const resolvedModel = readStringProp(structuredResult, "resolvedModel");
  const outputFile = readStringProp(structuredResult, "outputFile");
  const sessionUrl = readStringProp(structuredResult, "sessionUrl");
  const metadata = {
    agentId,
    sourceToolUseId: toolUseId,
    ...(resolvedModel ? { resolvedModel } : undefined),
    ...(totalDurationMs !== null ? { totalDurationMs } : undefined),
    ...(typeof structuredResult.totalTokens === "number"
      ? { totalTokens: structuredResult.totalTokens }
      : undefined),
    ...(outputFile ? { outputFile } : undefined),
    ...(typeof structuredResult.canReadOutputFile === "boolean"
      ? { canReadOutputFile: structuredResult.canReadOutputFile }
      : undefined),
    ...(sessionUrl ? { sessionUrl } : undefined),
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
      partId: `claude-subagent:${toolUseId}`,
      correlationKey: toolUseId,
      status,
      externalSessionId,
      executionMode,
      ...(agent ? { agent } : undefined),
      ...(prompt ? { prompt } : undefined),
      ...(description ? { description } : undefined),
      ...(error ? { error } : undefined),
      ...(typeof startedAtMs === "number" ? { startedAtMs } : undefined),
      ...(status === "running" ? undefined : { endedAtMs }),
      metadata,
    },
  });
  if (status !== "running") {
    if (status === "completed") {
      emitCompletedSubagentAssistantMessage(emit, session, toolUseId, timestamp);
    }
    session.subagentEventSessionsByToolUseId?.delete(toolUseId);
  }
};

export const emitClaudeTaskStopSubagentPart = ({
  emit,
  resultRaw,
  resultText,
  session,
  timestamp,
}: {
  emit: (event: AgentEvent) => void;
  resultRaw: Record<string, unknown>;
  resultText: string;
  session: ClaudeSubagentSession;
  timestamp: string;
}): void => {
  const taskId = readClaudeTaskStopTaskId(resultRaw, resultText);
  if (!taskId) {
    return;
  }
  const toolUseId = resolveClaudeSubagentToolUseId(
    session.subagentTaskIdsByToolUseId,
    session.subagentAgentIdsByToolUseId,
    taskId,
    undefined,
  );
  if (!toolUseId || isClaudeToolUseRetracted(session, toolUseId)) {
    return;
  }
  const activeTaskIds = session.activeBackgroundSubagentTaskIds;
  activeTaskIds?.delete(taskId);
  activeTaskIds?.delete(session.subagentTaskIdsByToolUseId.get(toolUseId) ?? taskId);
  const agentId = session.subagentAgentIdsByToolUseId?.get(toolUseId) ?? taskId;
  const endedAtMs = timestampMs(timestamp);
  emitSubagentPart(emit, session, agentId, toolUseId, "cancelled", timestamp, {
    endedAtMs,
    metadata: {
      agentId,
      sourceToolUseId: toolUseId,
    },
  });
  session.subagentEventSessionsByToolUseId?.delete(toolUseId);
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
  const launchAgentId = toolUseId && session.subagentAgentIdsByToolUseId?.get(toolUseId);
  const taskEnded =
    message.subtype === "task_notification" ||
    (message.subtype === "task_updated" && isTerminalClaudeTaskStatus(message.patch.status));
  if (taskEnded) {
    session.activeBackgroundSubagentTaskIds?.delete(message.task_id);
    session.activeBackgroundSubagentTaskIds?.delete(launchAgentId ?? message.task_id);
  }
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
      if (launchAgentId && launchAgentId !== message.task_id) {
        session.activeBackgroundSubagentTaskIds?.delete(launchAgentId);
      }
      session.subagentTaskIdsByToolUseId.set(toolUseId, message.task_id);
    }
    if (toolMessageId) {
      session.subagentMessageIdsByTaskId.set(message.task_id, toolMessageId);
    }
    session.activeBackgroundSubagentTaskIds ??= new Set();
    session.activeBackgroundSubagentTaskIds.add(message.task_id);
    const launchInput = toolUseId ? session.toolInputsByCallId.get(toolUseId) : undefined;
    const details: Partial<Extract<AgentStreamPart, { kind: "subagent" }>> = {
      description: readStringProp(launchInput, "description") ?? message.description,
      executionMode: "background",
      startedAtMs: timestampMs(timestamp),
    };
    const agent = message.subagent_type ?? message.workflow_name;
    if (agent) {
      details.agent = agent;
    }
    if (message.prompt) {
      details.prompt = message.prompt;
    }
    const agentId =
      (toolUseId ? session.subagentAgentIdsByToolUseId?.get(toolUseId) : undefined) ??
      message.task_id;
    emitSubagentPart(emit, session, agentId, toolUseId, "running", timestamp, details);
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
    const resolvedToolUseId = resolveClaudeSubagentToolUseId(
      session.subagentTaskIdsByToolUseId,
      session.subagentAgentIdsByToolUseId,
      message.task_id,
      toolUseId,
    );
    const agentId =
      (resolvedToolUseId
        ? session.subagentAgentIdsByToolUseId?.get(resolvedToolUseId)
        : undefined) ?? message.task_id;
    emitSubagentPart(emit, session, agentId, resolvedToolUseId, "running", timestamp, details);
    return;
  }

  if (message.subtype === "task_updated") {
    if (shouldSuppressSubagentTask(session, message.task_id)) {
      return;
    }
    const details: Partial<Extract<AgentStreamPart, { kind: "subagent" }>> = {};
    // SAFETY: The runtime adapter builds this value from the contract fields required by `Record<string, unknown>`.
    const patch = message.patch as Record<string, unknown>;
    const error =
      readStringProp(patch, "error") ??
      readStringProp(message, "error") ??
      (message.patch.status === "failed"
        ? (firstClaudeTaskText(
            readClaudeFailedTaskReason(patch),
            readClaudeFailedTaskReason(message),
          ) ?? `Claude subagent ${message.task_id} failed.`)
        : undefined);
    if (error) {
      details.error = error;
    }
    if (message.patch.end_time !== undefined) {
      details.endedAtMs = message.patch.end_time;
    }
    const resolvedToolUseId = resolveClaudeSubagentToolUseId(
      session.subagentTaskIdsByToolUseId,
      session.subagentAgentIdsByToolUseId,
      message.task_id,
      toolUseId,
    );
    const agentId =
      (resolvedToolUseId
        ? session.subagentAgentIdsByToolUseId?.get(resolvedToolUseId)
        : undefined) ?? message.task_id;
    emitSubagentPart(
      emit,
      session,
      agentId,
      resolvedToolUseId,
      claudeSubagentStatusFromTaskStatus(message.patch.status),
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
      ? (readClaudeFailedTaskMessage(message) ?? `Claude subagent ${message.task_id} failed.`)
      : undefined;
  const resolvedToolUseId = resolveClaudeSubagentToolUseId(
    session.subagentTaskIdsByToolUseId,
    session.subagentAgentIdsByToolUseId,
    message.task_id,
    toolUseId,
  );
  const agentId =
    (resolvedToolUseId ? session.subagentAgentIdsByToolUseId?.get(resolvedToolUseId) : undefined) ??
    message.task_id;
  const details: Partial<Extract<AgentStreamPart, { kind: "subagent" }>> = {
    endedAtMs: timestampMs(timestamp),
  };
  if (notificationError) Object.assign(details, { error: notificationError });
  if (message.output_file)
    Object.assign(details, { metadata: { outputFile: message.output_file } });
  const status =
    message.status === "failed"
      ? "error"
      : message.status === "stopped"
        ? "cancelled"
        : "completed";
  emitSubagentPart(emit, session, agentId, resolvedToolUseId, status, timestamp, details);
  if (message.status === "completed") {
    emitCompletedSubagentAssistantMessage(emit, session, resolvedToolUseId, timestamp);
  }
  if (resolvedToolUseId) {
    session.subagentEventSessionsByToolUseId?.delete(resolvedToolUseId);
  }
};
