import type { AgentSessionRecord } from "@openducktor/contracts";
import {
  type AgentModelSelection,
  type AgentRole,
  type AgentScenario,
  type AgentSessionHistoryMessage,
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
import {
  mergeTurnActivityTimestamp,
  readAssistantActivityStartedAtMsFromMessages,
  readAssistantActivityStartedAtMsFromParts,
  resolveAssistantTurnDurationMs,
} from "./assistant-turn-duration";
import { toReasoningMessageId, toToolMessageId } from "./chat-message-ids";
import { mergeModelSelection, normalizePersistedSelection } from "./models";
import {
  readPersistedRuntimeKind,
  requirePersistedSelectedModelRuntimeKind,
  requireSelectedModelRuntimeKindForPersistence,
  requireSessionRuntimeKindForPersistence,
} from "./session-runtime-metadata";
import {
  formatSubagentContent,
  isSubagentMessage,
  mergeSubagentMeta,
  type SubagentMessage,
} from "./subagent-messages";
import { normalizeToolInput, normalizeToolText } from "./tool-messages";

type HistoryPart = AgentSessionHistoryMessage["parts"][number];
type LegacySubtaskHistoryPart = {
  kind: "subtask";
  partId: string;
  agent: string;
  prompt: string;
  description: string;
};
type HydrationHistoryPart = HistoryPart | LegacySubtaskHistoryPart;

type HydratedSubagentMessage = SubagentMessage;

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
      purpose: "primary",
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
        id: toReasoningMessageId(message.messageId, part.partId),
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
        id: toToolMessageId({
          messageId: message.messageId,
          partId: part.partId,
          callId: part.callId,
        }),
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

  return false;
};

const mergeHydratedSubagentMessages = (
  existingMessage: HydratedSubagentMessage,
  incomingMessage: HydratedSubagentMessage,
): HydratedSubagentMessage => {
  const existingMeta = existingMessage.meta;
  const incomingMeta = incomingMessage.meta;
  const correlationKey = resolvePreferredHydratedCorrelationKey(existingMeta, incomingMeta);
  const nextMeta = mergeSubagentMeta(existingMeta, {
    ...incomingMeta,
    correlationKey,
  });

  return {
    ...existingMessage,
    id: `subagent:${correlationKey}`,
    content: formatSubagentContent(nextMeta),
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
  const hiddenSubagentsByCorrelationKey = new Map<string, HydratedSubagentMessage>();
  let userAnchorAtMs: number | undefined;
  let previousAssistantCompletedAtMs: number | undefined;
  const findLastMatchingHydratedSubagentIndex = (
    incomingMessage: HydratedSubagentMessage,
  ): number => {
    for (let index = next.length - 1; index >= 0; index -= 1) {
      const entry = next[index];
      if (!isSubagentMessage(entry)) {
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
        if (isSubagentMessage(partMessage)) {
          if (!partMessage.meta.sessionId) {
            hiddenSubagentsByCorrelationKey.set(partMessage.meta.correlationKey, partMessage);
            continue;
          }

          const hiddenSubagent = hiddenSubagentsByCorrelationKey.get(
            partMessage.meta.correlationKey,
          );
          const visiblePartMessage = hiddenSubagent
            ? mergeHydratedSubagentMessages(hiddenSubagent, partMessage)
            : partMessage;
          hiddenSubagentsByCorrelationKey.delete(partMessage.meta.correlationKey);
          const existingIndex = findLastMatchingHydratedSubagentIndex(visiblePartMessage);
          if (existingIndex >= 0) {
            const existingMessage = next[existingIndex];
            if (isSubagentMessage(existingMessage)) {
              next[existingIndex] = mergeHydratedSubagentMessages(
                existingMessage,
                visiblePartMessage,
              );
              continue;
            }
          }
          next.push(visiblePartMessage);
          continue;
        }
        next.push(partMessage);
      }
    }

    const content = message.text;
    const shouldRenderPrimaryMessage = content.length > 0 || userDisplayParts.length > 0;
    if (shouldRenderPrimaryMessage) {
      const isFinalAssistantMessage = isFinalAssistantHistoryMessage(message);
      const completedAtMs = Date.parse(message.timestamp);
      const activityStartedAtMs =
        message.role === "assistant" && isFinalAssistantMessage && !Number.isNaN(completedAtMs)
          ? mergeTurnActivityTimestamp(
              readAssistantActivityStartedAtMsFromMessages({
                messages: next,
                previousAssistantCompletedAtMs,
                completedAtMs,
              }),
              readAssistantActivityStartedAtMsFromParts(message.parts, completedAtMs),
            )
          : undefined;
      const assistantDurationMs =
        message.role === "assistant" && isFinalAssistantMessage && !Number.isNaN(completedAtMs)
          ? resolveAssistantTurnDurationMs({
              completedAtMs,
              ...(typeof activityStartedAtMs === "number" ? { activityStartedAtMs } : {}),
              ...(typeof userAnchorAtMs === "number" ? { userAnchorAtMs } : {}),
              ...(typeof previousAssistantCompletedAtMs === "number"
                ? { previousAssistantCompletedAtMs }
                : {}),
            })
          : undefined;
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
      userAnchorAtMs = Number.isNaN(parsed) ? userAnchorAtMs : parsed;
    }

    if (message.role === "assistant" && isFinalAssistantHistoryMessage(message)) {
      const parsed = Date.parse(message.timestamp);
      if (!Number.isNaN(parsed)) {
        previousAssistantCompletedAtMs = parsed;
      }
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
