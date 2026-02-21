import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentSessionHistoryMessage } from "@openducktor/core";
import { formatToolContent } from "../../agent-tool-messages";
import { normalizePersistedSelection } from "./models";
import { normalizeToolInput, normalizeToolText } from "./tool-messages";

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
      if (part.kind === "reasoning") {
        if (part.text.trim().length === 0) {
          continue;
        }
        next.push({
          id: `history:thinking:${message.messageId}:${part.partId}`,
          role: "thinking",
          content: part.text,
          timestamp: message.timestamp,
          meta: {
            kind: "reasoning",
            partId: part.partId,
            completed: part.completed,
          },
        });
        continue;
      }

      if (part.kind === "tool") {
        const input = normalizeToolInput(part.input);
        const output = normalizeToolText(part.output);
        const error = normalizeToolText(part.error);
        next.push({
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
        });
        continue;
      }

      if (part.kind === "subtask") {
        next.push({
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
        });
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
              meta: {
                kind: "assistant",
                agentRole: sessionContext.role,
                ...(sessionContext.selectedModel?.providerId
                  ? { providerId: sessionContext.selectedModel.providerId }
                  : {}),
                ...(sessionContext.selectedModel?.modelId
                  ? { modelId: sessionContext.selectedModel.modelId }
                  : {}),
                ...(sessionContext.selectedModel?.variant
                  ? { variant: sessionContext.selectedModel.variant }
                  : {}),
                ...(sessionContext.selectedModel?.opencodeAgent
                  ? { opencodeAgent: sessionContext.selectedModel.opencodeAgent }
                  : {}),
                ...(typeof assistantDurationMs === "number" && assistantDurationMs > 0
                  ? { durationMs: assistantDurationMs }
                  : {}),
                ...(typeof message.totalTokens === "number" && message.totalTokens > 0
                  ? { totalTokens: message.totalTokens }
                  : {}),
              } satisfies Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "assistant" }>,
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
