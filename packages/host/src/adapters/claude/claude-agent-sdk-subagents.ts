import type { AgentEvent, AgentStreamPart } from "@openducktor/core";
import { z } from "zod";
import type { ClaudeEventSession } from "./claude-agent-sdk-event-session";
import type { ClaudeHistorySubagentSystemMessageIngress } from "./claude-agent-sdk-ingress-schemas";
import type { ClaudeSdkSubagentSystemMessageProjection } from "./claude-agent-sdk-message-projection";
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
import {
  type ClaudeDecodedToolResult,
  type ClaudeDecodedToolUse,
  timestampMs,
} from "./claude-agent-sdk-tool-shapes";
import {
  isClaudeSubagentTaskRetracted,
  isClaudeToolUseRetracted,
  retireClaudeSubagentTask,
} from "./claude-agent-sdk-transcript-correlation";
import { settleClaudeStreamedAssistantText } from "./claude-agent-sdk-transcript-retractions";
import { readStringProp } from "./claude-agent-sdk-utils";

type ClaudeSubagentPart = Extract<AgentStreamPart, { kind: "subagent" }>;
type ClaudeSubagentPartDetails = Partial<
  Pick<
    ClaudeSubagentPart,
    | "agent"
    | "description"
    | "endedAtMs"
    | "error"
    | "executionMode"
    | "externalSessionId"
    | "messageId"
    | "metadata"
    | "prompt"
    | "startedAtMs"
  >
>;

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
  toolInputsByCallId: Map<string, NonNullable<ClaudeDecodedToolUse["input"]>>;
  toolMessageIdsByCallId: Map<string, string>;
  toolNamesByCallId: Map<string, string>;
};
type ClaudeTaskNotificationMessage = Extract<
  ClaudeHistorySubagentSystemMessageIngress,
  { subtype: "task_notification" }
>;
export type ClaudeHistoryTaskNotificationMessage = {
  output_file?: ClaudeTaskNotificationMessage["output_file"] | undefined;
  summary?: ClaudeTaskNotificationMessage["summary"] | undefined;
  uuid?: ClaudeTaskNotificationMessage["uuid"] | undefined;
} & Omit<ClaudeTaskNotificationMessage, "output_file" | "summary" | "uuid">;
type ClaudeSubagentSystemMessage =
  | ClaudeSdkSubagentSystemMessageProjection
  | ClaudeHistorySubagentSystemMessageIngress
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
  status: ClaudeSubagentPart["status"],
  timestamp: string,
  details: ClaudeSubagentPartDetails,
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
  if (pending.model) message.model = pending.model;
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
  input?: ClaudeDecodedToolUse["input"];
  isError: boolean;
  resultRaw: ClaudeDecodedToolResult["raw"];
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
  const parsedTotalDurationMs = z.number().safeParse(structuredResult.totalDurationMs);
  const totalDurationMs = parsedTotalDurationMs.success ? parsedTotalDurationMs.data : null;
  const startedAtMs =
    totalDurationMs === null ? undefined : Math.max(0, endedAtMs - totalDurationMs);
  const metadata: NonNullable<ClaudeSubagentPart["metadata"]> = {
    agentId,
    sourceToolUseId: toolUseId,
  };
  const resolvedModel = readStringProp(structuredResult, "resolvedModel");
  const outputFile = readStringProp(structuredResult, "outputFile");
  const sessionUrl = readStringProp(structuredResult, "sessionUrl");
  const totalTokens = z.number().safeParse(structuredResult.totalTokens);
  const canReadOutputFile = z.boolean().safeParse(structuredResult.canReadOutputFile);
  if (resolvedModel) metadata.resolvedModel = resolvedModel;
  if (totalDurationMs !== null) metadata.totalDurationMs = totalDurationMs;
  if (totalTokens.success) metadata.totalTokens = totalTokens.data;
  if (outputFile) metadata.outputFile = outputFile;
  if (canReadOutputFile.success) metadata.canReadOutputFile = canReadOutputFile.data;
  if (sessionUrl) metadata.sessionUrl = sessionUrl;
  const messageId =
    session.toolMessageIdsByCallId.get(toolUseId) ??
    (taskId ? session.subagentMessageIdsByTaskId.get(taskId) : undefined) ??
    session.externalSessionId;

  const details: ClaudeSubagentPartDetails = {
    executionMode,
    externalSessionId,
    messageId,
    metadata,
  };
  if (agent) details.agent = agent;
  if (prompt) details.prompt = prompt;
  if (description) details.description = description;
  if (error) details.error = error;
  if (startedAtMs !== undefined) details.startedAtMs = startedAtMs;
  if (status !== "running") details.endedAtMs = endedAtMs;
  emitSubagentPart(emit, session, agentId, toolUseId, status, timestamp, details);
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
  resultRaw: ClaudeDecodedToolResult["raw"];
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
  const toolUseId = "tool_use_id" in message ? message.tool_use_id : undefined;
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
    const details: ClaudeSubagentPartDetails = {
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
    const details: ClaudeSubagentPartDetails = {};
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
    const details: ClaudeSubagentPartDetails = {};
    const { patch } = message;
    const error =
      patch.error ??
      (patch.status === "failed"
        ? (firstClaudeTaskText(readClaudeFailedTaskReason(patch)) ??
          `Claude subagent ${message.task_id} failed.`)
        : undefined);
    if (error) {
      details.error = error;
    }
    if (patch.end_time !== undefined) {
      details.endedAtMs = patch.end_time;
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
      claudeSubagentStatusFromTaskStatus(patch.status),
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
  const details: ClaudeSubagentPartDetails = {
    endedAtMs: timestampMs(timestamp),
  };
  if (notificationError) details.error = notificationError;
  if (message.output_file) details.metadata = { outputFile: message.output_file };
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
