import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentSessionHistoryMessage } from "@openducktor/core";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import { formatToolContent } from "../../agent-tool-messages";
import { normalizePersistedSelection } from "./models";
import { normalizeToolInput, normalizeToolText } from "./tool-messages";

type HistoryPart = AgentSessionHistoryMessage["parts"][number];

export const toPersistedSessionRecord = (
  session: AgentSessionState,
  updatedAt: string,
): AgentSessionRecord => ({
  sessionId: session.sessionId,
  externalSessionId: session.externalSessionId,
  taskId: session.taskId,
  role: session.role,
  scenario: session.scenario,
  status: session.status,
  startedAt: session.startedAt,
  updatedAt,
  ...(session.status === "stopped" || session.status === "error" ? { endedAt: updatedAt } : {}),
  runtimeId: session.runtimeId ?? undefined,
  runId: session.runId ?? undefined,
  baseUrl: session.baseUrl,
  workingDirectory: session.workingDirectory,
  selectedModel: session.selectedModel ?? undefined,
});

export const fromPersistedSessionRecord = (session: AgentSessionRecord): AgentSessionState => {
  const normalizedStatus =
    session.status === "starting" || session.status === "running" ? "stopped" : session.status;
  return {
    sessionId: session.sessionId,
    externalSessionId: session.externalSessionId,
    taskId: session.taskId,
    role: session.role,
    scenario: session.scenario,
    status: normalizedStatus,
    startedAt: session.startedAt,
    runtimeId: session.runtimeId ?? null,
    runId: session.runId ?? null,
    baseUrl: session.baseUrl,
    workingDirectory: session.workingDirectory,
    messages: [],
    draftAssistantText: "",
    pendingPermissions: [],
    pendingQuestions: [],
    todos: [],
    modelCatalog: null,
    selectedModel: normalizePersistedSelection(session.selectedModel),
    isLoadingModelCatalog: true,
  };
};

const assistantDurationFromHistory = (
  message: AgentSessionHistoryMessage,
  previousUserTimestampMs: number | null,
): number | undefined => {
  if (message.role !== "assistant") {
    return undefined;
  }

  let startedAtMs: number | null = null;
  let endedAtMs: number | null = null;
  for (const part of message.parts) {
    if (part.kind !== "tool") {
      continue;
    }
    if (typeof part.startedAtMs === "number") {
      startedAtMs =
        startedAtMs === null ? part.startedAtMs : Math.min(startedAtMs, part.startedAtMs);
    }
    if (typeof part.endedAtMs === "number") {
      endedAtMs = endedAtMs === null ? part.endedAtMs : Math.max(endedAtMs, part.endedAtMs);
    }
  }

  if (startedAtMs !== null && endedAtMs !== null && endedAtMs >= startedAtMs) {
    return endedAtMs - startedAtMs;
  }

  const assistantTimestampMs = Date.parse(message.timestamp);
  if (previousUserTimestampMs !== null && !Number.isNaN(assistantTimestampMs)) {
    if (assistantTimestampMs >= previousUserTimestampMs) {
      return assistantTimestampMs - previousUserTimestampMs;
    }
  }

  return undefined;
};

const isSyntheticHistoryUserMessage = (message: AgentSessionHistoryMessage): boolean => {
  if (message.role !== "user") {
    return false;
  }

  let hasTextPart = false;
  for (const part of message.parts) {
    if (part.kind !== "text") {
      continue;
    }
    hasTextPart = true;
    if (!part.synthetic) {
      return false;
    }
  }

  return hasTextPart;
};

const assistantMessageMeta = (
  role: AgentRole,
  selectedModel: AgentModelSelection | null,
  durationMs: number | undefined,
  totalTokens: number | undefined,
) => {
  return {
    kind: "assistant",
    agentRole: role,
    ...(selectedModel?.providerId ? { providerId: selectedModel.providerId } : {}),
    ...(selectedModel?.modelId ? { modelId: selectedModel.modelId } : {}),
    ...(selectedModel?.variant ? { variant: selectedModel.variant } : {}),
    ...(selectedModel?.opencodeAgent ? { opencodeAgent: selectedModel.opencodeAgent } : {}),
    ...(typeof durationMs === "number" && durationMs > 0 ? { durationMs } : {}),
    ...(typeof totalTokens === "number" && totalTokens > 0 ? { totalTokens } : {}),
  } satisfies Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "assistant" }>;
};

const historyPartToChatMessage = (
  message: AgentSessionHistoryMessage,
  part: HistoryPart,
): AgentChatMessage | null => {
  switch (part.kind) {
    case "reasoning": {
      if (part.text.trim().length === 0) {
        return null;
      }
      return {
        id: `history:thinking:${message.messageId}:${part.partId}`,
        role: "thinking",
        content: part.text,
        timestamp: message.timestamp,
        meta: {
          kind: "reasoning",
          partId: part.partId,
          completed: part.completed,
        },
      };
    }
    case "tool": {
      const input = normalizeToolInput(part.input);
      const output = normalizeToolText(part.output);
      const error = normalizeToolText(part.error);
      return {
        id: `history:tool:${message.messageId}:${part.partId}`,
        role: "tool",
        content: formatToolContent(part),
        timestamp: message.timestamp,
        meta: {
          kind: "tool",
          partId: part.partId,
          callId: part.callId,
          tool: part.tool,
          status: part.status,
          ...(part.title ? { title: part.title } : {}),
          ...(input ? { input } : {}),
          ...(output ? { output } : {}),
          ...(error ? { error } : {}),
          ...(part.metadata ? { metadata: part.metadata } : {}),
          ...(typeof part.startedAtMs === "number" ? { startedAtMs: part.startedAtMs } : {}),
          ...(typeof part.endedAtMs === "number" ? { endedAtMs: part.endedAtMs } : {}),
        },
      };
    }
    case "subtask": {
      return {
        id: `history:subtask:${message.messageId}:${part.partId}`,
        role: "system",
        content: `Subtask (${part.agent}): ${part.description}`,
        timestamp: message.timestamp,
        meta: {
          kind: "subtask",
          partId: part.partId,
          agent: part.agent,
          prompt: part.prompt,
          description: part.description,
        },
      };
    }
    case "step":
    case "text":
      return null;
  }
};

export const historyToChatMessages = (
  history: AgentSessionHistoryMessage[],
  sessionContext: {
    role: AgentRole;
    selectedModel: AgentModelSelection | null;
  },
): AgentChatMessage[] => {
  const next: AgentChatMessage[] = [];
  let previousUserTimestampMs: number | null = null;

  for (const message of history) {
    for (const part of message.parts) {
      const partMessage = historyPartToChatMessage(message, part);
      if (partMessage) {
        next.push(partMessage);
      }
    }

    const content = message.text.trim();
    if (content.length > 0) {
      const assistantDurationMs = assistantDurationFromHistory(message, previousUserTimestampMs);
      next.push({
        id: `history:text:${message.messageId}`,
        role: message.role,
        content,
        timestamp: message.timestamp,
        ...(message.role === "assistant"
          ? {
              meta: assistantMessageMeta(
                sessionContext.role,
                sessionContext.selectedModel,
                assistantDurationMs,
                message.totalTokens,
              ),
            }
          : {}),
      });
    }

    if (message.role === "user" && !isSyntheticHistoryUserMessage(message)) {
      const parsed = Date.parse(message.timestamp);
      previousUserTimestampMs = Number.isNaN(parsed) ? previousUserTimestampMs : parsed;
    }
  }

  return next;
};
