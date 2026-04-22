import type { AgentSessionRecord } from "@openducktor/contracts";
import {
  type AgentModelSelection,
  type AgentRole,
  type AgentScenario,
  type AgentSessionHistoryMessage,
  type AgentSubagentExecutionMode,
  type AgentSubagentStatus,
  type AgentUserMessageDisplayPart,
  defaultAgentScenarioForRole,
} from "@openducktor/core";
import { createRepoScopedAgentSessionState } from "@/state/repo-scoped-agent-session";
import type {
  AgentChatMessage,
  AgentSessionContextUsage,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { formatToolContent } from "../agent-tool-messages";
import { mergeModelSelection, normalizePersistedSelection } from "./models";
import {
  readPersistedRuntimeKind,
  requirePersistedSelectedModelRuntimeKind,
  requireSelectedModelRuntimeKindForPersistence,
  requireSessionRuntimeKindForPersistence,
} from "./session-runtime-metadata";
import { normalizeToolInput, normalizeToolText } from "./tool-messages";

type HistoryPart = AgentSessionHistoryMessage["parts"][number];
type SubagentMessageMeta = {
  kind: "subagent";
  partId: string;
  correlationKey: string;
  status: AgentSubagentStatus;
  agent?: string;
  prompt?: string;
  description?: string;
  sessionId?: string;
  executionMode?: AgentSubagentExecutionMode;
  metadata?: Record<string, unknown>;
  startedAtMs?: number;
  endedAtMs?: number;
};
type SubagentChatMessage = AgentChatMessage & {
  role: "system";
  meta: SubagentMessageMeta;
};
type LegacySubtaskHistoryPart = {
  kind: "subtask";
  partId: string;
  agent: string;
  prompt: string;
  description: string;
};
type HydrationHistoryPart = HistoryPart | LegacySubtaskHistoryPart;

type HydratedSubagentMessage = SubagentChatMessage;

export const toPersistedSessionRecord = (session: AgentSessionState): AgentSessionRecord => {
  const runtimeKind = requireSessionRuntimeKindForPersistence(session);

  return {
    sessionId: session.sessionId,
    externalSessionId: session.externalSessionId,
    role: session.role,
    scenario: session.scenario,
    startedAt: session.startedAt,
    runtimeKind,
    workingDirectory: session.workingDirectory,
    selectedModel: session.selectedModel
      ? {
          runtimeKind: requireSelectedModelRuntimeKindForPersistence(
            session.sessionId,
            runtimeKind,
            session.selectedModel,
          ),
          providerId: session.selectedModel.providerId,
          modelId: session.selectedModel.modelId,
          ...(session.selectedModel.variant ? { variant: session.selectedModel.variant } : {}),
          ...(session.selectedModel.profileId
            ? { profileId: session.selectedModel.profileId }
            : {}),
        }
      : null,
  };
};

export const defaultScenarioForRole = (role: AgentRole): AgentScenario => {
  return defaultAgentScenarioForRole(role);
};

export const fromPersistedSessionRecord = (
  session: AgentSessionRecord,
  fallbackTaskId: string,
  repoPath: string,
): AgentSessionState => {
  const runtimeKind = readPersistedRuntimeKind(session);

  return createRepoScopedAgentSessionState(
    {
      sessionId: session.sessionId,
      externalSessionId: session.externalSessionId ?? session.sessionId,
      taskId: fallbackTaskId,
      role: session.role,
      scenario: session.scenario,
      // Persisted Beads records are durable session metadata only.
      // Live state must always be derived from the runtime on hydration/reconciliation.
      status: "stopped",
      startedAt: session.startedAt,
      runtimeKind,
      runtimeId: null,
      runtimeRoute: null,
      workingDirectory: session.workingDirectory,
      historyHydrationState: "not_requested",
      runtimeRecoveryState: "idle",
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
      selectedModel: session.selectedModel
        ? normalizePersistedSelection({
            ...session.selectedModel,
            runtimeKind: requirePersistedSelectedModelRuntimeKind(
              session.sessionId,
              runtimeKind,
              session.selectedModel,
            ),
          })
        : null,
      isLoadingModelCatalog: false,
    },
    repoPath,
  );
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
  part: HydrationHistoryPart,
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
    case "subagent": {
      return {
        id: `subagent:${part.correlationKey}`,
        role: "system",
        content: `Subagent (${part.agent ?? "subagent"}): ${
          part.description ?? part.prompt ?? "Subagent activity"
        }`,
        timestamp: message.timestamp,
        meta: {
          kind: "subagent",
          partId: part.partId,
          correlationKey: part.correlationKey,
          status: part.status,
          ...(part.agent ? { agent: part.agent } : {}),
          ...(part.prompt ? { prompt: part.prompt } : {}),
          ...(part.description ? { description: part.description } : {}),
          ...(part.sessionId ? { sessionId: part.sessionId } : {}),
          ...(part.executionMode ? { executionMode: part.executionMode } : {}),
          ...(part.metadata ? { metadata: part.metadata } : {}),
          ...(typeof part.startedAtMs === "number" ? { startedAtMs: part.startedAtMs } : {}),
          ...(typeof part.endedAtMs === "number" ? { endedAtMs: part.endedAtMs } : {}),
        },
      };
    }
    case "subtask": {
      const correlationKey = `legacy:${message.messageId}:${part.partId}`;
      return {
        id: `subagent:${correlationKey}`,
        role: "system",
        content: `Subagent (${part.agent}): ${part.description}`,
        timestamp: message.timestamp,
        meta: {
          kind: "subagent",
          partId: part.partId,
          correlationKey,
          status: "completed",
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

const isHydratedSubagentMessage = (
  message: AgentChatMessage | null | undefined,
): message is HydratedSubagentMessage => {
  return message?.role === "system" && message.meta?.kind === "subagent";
};

const resolveHydratedSubagentStatus = (
  existingStatus: HydratedSubagentMessage["meta"]["status"] | undefined,
  incomingStatus: HydratedSubagentMessage["meta"]["status"],
): HydratedSubagentMessage["meta"]["status"] => {
  if (existingStatus === "error") {
    return "error";
  }
  if (incomingStatus === "error") {
    return "error";
  }
  if (existingStatus === "completed") {
    return "completed";
  }
  if (incomingStatus === "completed") {
    return "completed";
  }
  if (existingStatus === "running" && incomingStatus === "pending") {
    return "running";
  }

  return incomingStatus;
};

const formatHydratedSubagentContent = (meta: {
  agent?: string;
  prompt?: string;
  description?: string;
  sessionId?: string;
}): string => {
  const agentLabel = meta.agent?.trim() || "subagent";
  const summary =
    meta.description?.trim() ||
    meta.prompt?.trim() ||
    (meta.sessionId ? `Session ${meta.sessionId.slice(0, 8)}` : "Subagent activity");

  return `Subagent (${agentLabel}): ${summary}`;
};

const resolvePreferredHydratedCorrelationKey = (
  existingMeta: HydratedSubagentMessage["meta"],
  incomingMeta: HydratedSubagentMessage["meta"],
): string => {
  if (existingMeta.correlationKey.startsWith("part:")) {
    return existingMeta.correlationKey;
  }
  if (incomingMeta.correlationKey.startsWith("part:")) {
    return incomingMeta.correlationKey;
  }
  if (existingMeta.correlationKey.startsWith("spawn:")) {
    return existingMeta.correlationKey;
  }
  if (incomingMeta.correlationKey.startsWith("spawn:")) {
    return incomingMeta.correlationKey;
  }

  return existingMeta.correlationKey;
};

const matchesHydratedSubagentMessage = (
  existingMessage: HydratedSubagentMessage,
  incomingMessage: HydratedSubagentMessage,
): boolean => {
  if (existingMessage.meta.correlationKey === incomingMessage.meta.correlationKey) {
    return true;
  }

  const existingSessionId = existingMessage.meta.sessionId;
  const incomingSessionId = incomingMessage.meta.sessionId;
  if (existingSessionId && incomingSessionId) {
    return existingSessionId === incomingSessionId;
  }

  const existingIsPart = existingMessage.meta.correlationKey.startsWith("part:");
  const incomingIsPart = incomingMessage.meta.correlationKey.startsWith("part:");
  const existingIsSession = existingMessage.meta.correlationKey.startsWith("session:");
  const incomingIsSession = incomingMessage.meta.correlationKey.startsWith("session:");
  if (!(existingIsPart && incomingIsSession) && !(existingIsSession && incomingIsPart)) {
    return false;
  }

  const partMeta = existingIsPart ? existingMessage.meta : incomingMessage.meta;
  const sessionMeta = existingIsSession ? existingMessage.meta : incomingMessage.meta;
  if (!sessionMeta.sessionId) {
    return false;
  }
  if (!partMeta.agent || !partMeta.prompt) {
    return false;
  }

  return sessionMeta.agent === partMeta.agent && sessionMeta.prompt === partMeta.prompt;
};

const mergeHydratedSubagentMessages = (
  existingMessage: HydratedSubagentMessage,
  incomingMessage: HydratedSubagentMessage,
): HydratedSubagentMessage => {
  const existingMeta = existingMessage.meta;
  const incomingMeta = incomingMessage.meta;
  const status = resolveHydratedSubagentStatus(existingMeta.status, incomingMeta.status);
  const metadata =
    existingMeta.metadata && incomingMeta.metadata
      ? { ...existingMeta.metadata, ...incomingMeta.metadata }
      : (incomingMeta.metadata ?? existingMeta.metadata);
  const startedAtMs =
    typeof existingMeta.startedAtMs === "number" && typeof incomingMeta.startedAtMs === "number"
      ? Math.min(existingMeta.startedAtMs, incomingMeta.startedAtMs)
      : (incomingMeta.startedAtMs ?? existingMeta.startedAtMs);
  const endedAtMs =
    typeof existingMeta.endedAtMs === "number" && typeof incomingMeta.endedAtMs === "number"
      ? Math.max(existingMeta.endedAtMs, incomingMeta.endedAtMs)
      : status === "completed" || status === "error"
        ? (incomingMeta.endedAtMs ?? existingMeta.endedAtMs)
        : undefined;
  const agent = incomingMeta.agent ?? existingMeta.agent;
  const prompt = incomingMeta.prompt ?? existingMeta.prompt;
  const description = incomingMeta.description ?? existingMeta.description;
  const sessionId = incomingMeta.sessionId ?? existingMeta.sessionId;
  const executionMode = incomingMeta.executionMode ?? existingMeta.executionMode;
  const correlationKey = resolvePreferredHydratedCorrelationKey(existingMeta, incomingMeta);
  const nextMeta: HydratedSubagentMessage["meta"] = {
    kind: "subagent",
    partId: incomingMeta.partId,
    correlationKey,
    status,
    ...(typeof agent === "string" ? { agent } : {}),
    ...(typeof prompt === "string" ? { prompt } : {}),
    ...(typeof description === "string" ? { description } : {}),
    ...(typeof sessionId === "string" ? { sessionId } : {}),
    ...(executionMode ? { executionMode } : {}),
    ...(metadata ? { metadata } : {}),
    ...(typeof startedAtMs === "number" ? { startedAtMs } : {}),
    ...(typeof endedAtMs === "number" ? { endedAtMs } : {}),
  };

  return {
    ...existingMessage,
    id: `subagent:${correlationKey}`,
    content: formatHydratedSubagentContent(nextMeta),
    meta: nextMeta,
  };
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
  const findLastMatchingHydratedSubagentIndex = (
    incomingMessage: HydratedSubagentMessage,
  ): number => {
    for (let index = next.length - 1; index >= 0; index -= 1) {
      const entry = next[index];
      if (!isHydratedSubagentMessage(entry)) {
        continue;
      }
      if (matchesHydratedSubagentMessage(entry, incomingMessage)) {
        return index;
      }
    }

    return -1;
  };

  for (const message of history) {
    const userDisplayParts = message.role === "user" ? (message.displayParts ?? []) : [];

    for (const part of message.parts as HydrationHistoryPart[]) {
      const partMessage = historyPartToChatMessage(message, part);
      if (partMessage) {
        if (isHydratedSubagentMessage(partMessage)) {
          const existingIndex = findLastMatchingHydratedSubagentIndex(partMessage);
          if (existingIndex >= 0) {
            const existingMessage = next[existingIndex];
            if (isHydratedSubagentMessage(existingMessage)) {
              next[existingIndex] = mergeHydratedSubagentMessages(existingMessage, partMessage);
              continue;
            }
          }
        }
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
