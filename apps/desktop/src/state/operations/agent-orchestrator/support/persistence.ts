import type { AgentSessionRecord } from "@openducktor/contracts";
import {
  type AgentModelSelection,
  type AgentRole,
  type AgentScenario,
  type AgentSessionHistoryMessage,
  type AgentUserMessageDisplayPart,
  defaultAgentScenarioForRole,
} from "@openducktor/core";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import type {
  AgentChatMessage,
  AgentSessionContextUsage,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { formatToolContent } from "../agent-tool-messages";
import { mergeModelSelection, normalizePersistedSelection } from "./models";
import { normalizeToolInput, normalizeToolText } from "./tool-messages";

type HistoryPart = AgentSessionHistoryMessage["parts"][number];

export const toPersistedSessionRecord = (session: AgentSessionState): AgentSessionRecord => ({
  sessionId: session.sessionId,
  externalSessionId: session.externalSessionId,
  role: session.role,
  scenario: session.scenario,
  startedAt: session.startedAt,
  runtimeKind: session.runtimeKind ?? session.selectedModel?.runtimeKind ?? DEFAULT_RUNTIME_KIND,
  workingDirectory: session.workingDirectory,
  selectedModel: session.selectedModel
    ? {
        runtimeKind:
          session.selectedModel.runtimeKind ?? session.runtimeKind ?? DEFAULT_RUNTIME_KIND,
        providerId: session.selectedModel.providerId,
        modelId: session.selectedModel.modelId,
        ...(session.selectedModel.variant ? { variant: session.selectedModel.variant } : {}),
        ...(session.selectedModel.profileId ? { profileId: session.selectedModel.profileId } : {}),
      }
    : null,
});

export const defaultScenarioForRole = (role: AgentRole): AgentScenario => {
  return defaultAgentScenarioForRole(role);
};

export const fromPersistedSessionRecord = (
  session: AgentSessionRecord,
  fallbackTaskId: string,
): AgentSessionState => {
  return {
    sessionId: session.sessionId,
    externalSessionId: session.externalSessionId ?? session.sessionId,
    taskId: fallbackTaskId,
    role: session.role,
    scenario: session.scenario,
    // Persisted Beads records are durable session metadata only.
    // Live state must always be derived from the runtime on hydration/reconciliation.
    status: "stopped",
    startedAt: session.startedAt,
    runtimeKind: session.runtimeKind ?? session.selectedModel?.runtimeKind ?? DEFAULT_RUNTIME_KIND,
    runtimeId: null,
    runId: null,
    runtimeEndpoint: "",
    workingDirectory: session.workingDirectory,
    historyHydrationState: "not_requested",
    messages: [],
    draftAssistantText: "",
    draftAssistantMessageId: null,
    draftReasoningText: "",
    draftReasoningMessageId: null,
    contextUsage: null,
    pendingPermissions: [],
    pendingQuestions: [],
    todos: [],
    modelCatalog: null,
    selectedModel: normalizePersistedSelection(session.selectedModel),
    isLoadingModelCatalog: false,
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

const assistantMessageMeta = (
  role: AgentRole,
  selectedModel: AgentModelSelection | null,
  messageModel: AgentModelSelection | undefined,
  isFinal: boolean,
  durationMs: number | undefined,
  totalTokens: number | undefined,
) => {
  const effectiveModel = mergeModelSelection(selectedModel, messageModel);
  return {
    kind: "assistant",
    agentRole: role,
    isFinal,
    ...(effectiveModel?.providerId ? { providerId: effectiveModel.providerId } : {}),
    ...(effectiveModel?.modelId ? { modelId: effectiveModel.modelId } : {}),
    ...(effectiveModel?.variant ? { variant: effectiveModel.variant } : {}),
    ...(effectiveModel?.profileId ? { profileId: effectiveModel.profileId } : {}),
    ...(isFinal && typeof durationMs === "number" && durationMs > 0 ? { durationMs } : {}),
    ...(isFinal && typeof totalTokens === "number" && totalTokens > 0 ? { totalTokens } : {}),
  } satisfies Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "assistant" }>;
};

const isFinalAssistantHistoryMessage = (message: AgentSessionHistoryMessage): boolean => {
  if (message.role !== "assistant") {
    return false;
  }

  return message.parts.some(
    (part) => part.kind === "step" && part.phase === "finish" && part.reason === "stop",
  );
};

const userMessageMeta = (
  messageModel: AgentModelSelection | undefined,
  state: Extract<AgentSessionHistoryMessage, { role: "user" }>["state"],
  parts: AgentUserMessageDisplayPart[] = [],
) => {
  const effectiveModel = mergeModelSelection(null, messageModel);
  return {
    kind: "user",
    state,
    ...(effectiveModel?.providerId ? { providerId: effectiveModel.providerId } : {}),
    ...(effectiveModel?.modelId ? { modelId: effectiveModel.modelId } : {}),
    ...(effectiveModel?.variant ? { variant: effectiveModel.variant } : {}),
    ...(effectiveModel?.profileId ? { profileId: effectiveModel.profileId } : {}),
    ...(parts.length > 0 ? { parts } : {}),
  } satisfies Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "user" }>;
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
          ...(part.preview ? { preview: part.preview } : {}),
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
    const userDisplayParts = message.role === "user" ? (message.displayParts ?? []) : [];

    for (const part of message.parts) {
      const partMessage = historyPartToChatMessage(message, part);
      if (partMessage) {
        next.push(partMessage);
      }
    }

    const content = message.text;
    const shouldRenderPrimaryMessage = content.length > 0 || userDisplayParts.length > 0;
    if (shouldRenderPrimaryMessage) {
      const isFinalAssistantMessage = isFinalAssistantHistoryMessage(message);
      const assistantDurationMs = assistantDurationFromHistory(message, previousUserTimestampMs);
      let meta: AgentChatMessage["meta"] | undefined;
      if (message.role === "assistant") {
        meta = assistantMessageMeta(
          sessionContext.role,
          sessionContext.selectedModel,
          message.model,
          isFinalAssistantMessage,
          isFinalAssistantMessage ? assistantDurationMs : undefined,
          isFinalAssistantMessage ? message.totalTokens : undefined,
        );
      } else if (message.role === "user") {
        meta = userMessageMeta(message.model, message.state, userDisplayParts);
      }

      next.push({
        id: message.messageId,
        role: message.role,
        content,
        timestamp: message.timestamp,
        ...(meta ? { meta } : {}),
      });
    }

    if (message.role === "user" && (content.length > 0 || userDisplayParts.length > 0)) {
      const parsed = Date.parse(message.timestamp);
      previousUserTimestampMs = Number.isNaN(parsed) ? previousUserTimestampMs : parsed;
    }
  }

  return next;
};

export const historyToSessionContextUsage = (
  history: AgentSessionHistoryMessage[],
  selectedModel: AgentModelSelection | null,
): AgentSessionContextUsage | null => {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (!message || message.role !== "assistant") {
      continue;
    }
    if (!isFinalAssistantHistoryMessage(message)) {
      continue;
    }
    if (typeof message.totalTokens !== "number" || message.totalTokens <= 0) {
      continue;
    }

    const effectiveModel = mergeModelSelection(selectedModel, message.model);
    return {
      totalTokens: message.totalTokens,
      ...(effectiveModel?.providerId ? { providerId: effectiveModel.providerId } : {}),
      ...(effectiveModel?.modelId ? { modelId: effectiveModel.modelId } : {}),
      ...(effectiveModel?.variant ? { variant: effectiveModel.variant } : {}),
      ...(effectiveModel?.profileId ? { profileId: effectiveModel.profileId } : {}),
    };
  }

  return null;
};
