import type {
  AgentModelSelection,
  AgentRole,
  AgentSessionHistoryMessage,
  AgentUserMessageDisplayPart,
} from "@openducktor/core";
import type {
  AgentChatMessage,
  AgentSessionContextUsage,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { formatToolContent } from "../agent-tool-messages";
import { createAssistantMessageMeta } from "./assistant-meta";
import {
  mergeTurnActivityTimestamp,
  readAssistantActivityStartedAtMsFromMessages,
  readAssistantActivityStartedAtMsFromParts,
  resolveAssistantTurnDurationMs,
} from "./assistant-turn-duration";
import { toReasoningMessageId, toToolMessageId } from "./chat-message-ids";
import { isFinalAssistantHistoryMessage } from "./history-finality";
import { mergeHistoryMessages } from "./history-message-merge";
import { createSessionMessagesState } from "./messages";
import { mergeModelSelection } from "./models";
import {
  appendHistorySubagentMessage,
  createSubagentMessage,
  isSubagentMessage,
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
type SessionHistoryPart = HistoryPart | LegacySubtaskHistoryPart;

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

const inheritTimestampAccuracy = (
  chatMessage: AgentChatMessage,
  historyMessage: AgentSessionHistoryMessage,
): AgentChatMessage =>
  historyMessage.timestampIsApproximate
    ? { ...chatMessage, timestampIsApproximate: true }
    : chatMessage;

const historyPartToChatMessage = (
  message: AgentSessionHistoryMessage,
  part: SessionHistoryPart,
): AgentChatMessage | null => {
  switch (part.kind) {
    case "reasoning": {
      if (part.text.trim().length === 0) {
        return null;
      }
      return inheritTimestampAccuracy(
        {
          id: toReasoningMessageId(message.messageId, part.partId),
          role: "thinking",
          content: part.text,
          timestamp: message.timestamp,
          meta: {
            kind: "reasoning",
            partId: part.partId,
            completed: part.completed,
          },
        },
        message,
      );
    }
    case "tool": {
      const input = normalizeToolInput(part.input);
      const output = normalizeToolText(part.output);
      const error = normalizeToolText(part.error);
      return inheritTimestampAccuracy(
        {
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
            toolType: part.toolType,
            status: part.status,
            ...(part.preview ? { preview: part.preview } : {}),
            ...(part.title ? { title: part.title } : {}),
            ...(part.displayLabel ? { displayLabel: part.displayLabel } : {}),
            ...(input ? { input } : {}),
            ...(output ? { output } : {}),
            ...(error ? { error } : {}),
            ...(part.fileDiffs ? { fileDiffs: part.fileDiffs } : {}),
            ...(part.fileContent ? { fileContent: part.fileContent } : {}),
            ...(part.fileChanges ? { fileChanges: part.fileChanges } : {}),
            ...(part.metadata ? { metadata: part.metadata } : {}),
            ...(typeof part.startedAtMs === "number" ? { startedAtMs: part.startedAtMs } : {}),
            ...(typeof part.endedAtMs === "number" ? { endedAtMs: part.endedAtMs } : {}),
          },
        },
        message,
      );
    }
    case "subagent": {
      return inheritTimestampAccuracy(
        createSubagentMessage({
          timestamp: message.timestamp,
          meta: {
            kind: "subagent",
            partId: part.partId,
            correlationKey: part.correlationKey,
            status: part.status,
            ...(part.agent ? { agent: part.agent } : {}),
            ...(part.prompt ? { prompt: part.prompt } : {}),
            ...(part.description ? { description: part.description } : {}),
            ...(part.error ? { error: part.error } : {}),
            ...(part.externalSessionId ? { externalSessionId: part.externalSessionId } : {}),
            ...(part.executionMode ? { executionMode: part.executionMode } : {}),
            ...(part.metadata ? { metadata: part.metadata } : {}),
            ...(typeof part.startedAtMs === "number" ? { startedAtMs: part.startedAtMs } : {}),
            ...(typeof part.endedAtMs === "number" ? { endedAtMs: part.endedAtMs } : {}),
          },
        }),
        message,
      );
    }
    case "subtask": {
      const correlationKey = `legacy:${message.messageId}:${part.partId}`;
      return inheritTimestampAccuracy(
        createSubagentMessage({
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
        }),
        message,
      );
    }
    case "step":
    case "text":
      return null;
  }
};

export const historyToChatMessages = (
  history: AgentSessionHistoryMessage[],
  sessionContext: {
    role: AgentRole | null;
  },
): AgentChatMessage[] => {
  const next: AgentChatMessage[] = [];
  let userAnchorAtMs: number | undefined;
  let previousAssistantCompletedAtMs: number | undefined;

  for (const message of history) {
    const userDisplayParts = message.role === "user" ? (message.displayParts ?? []) : [];

    for (const part of message.parts as SessionHistoryPart[]) {
      const partMessage = historyPartToChatMessage(message, part);
      if (partMessage) {
        if (isSubagentMessage(partMessage)) {
          appendHistorySubagentMessage(next, partMessage);
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
          ? (message.durationMs ??
            resolveAssistantTurnDurationMs({
              completedAtMs,
              ...(typeof activityStartedAtMs === "number" ? { activityStartedAtMs } : {}),
              ...(typeof userAnchorAtMs === "number" ? { userAnchorAtMs } : {}),
              ...(typeof previousAssistantCompletedAtMs === "number"
                ? { previousAssistantCompletedAtMs }
                : {}),
            }))
          : undefined;
      let meta: AgentChatMessage["meta"] | undefined;
      if (message.role === "assistant") {
        meta = createAssistantMessageMeta({
          role: sessionContext.role,
          model: message.model,
          isFinal: isFinalAssistantMessage,
          durationMs: isFinalAssistantMessage ? assistantDurationMs : undefined,
          totalTokens: isFinalAssistantMessage ? message.totalTokens : undefined,
          contextWindow: isFinalAssistantMessage ? message.contextWindow : undefined,
        });
      } else if (message.role === "user") {
        meta = userMessageMeta(message.model, message.state, userDisplayParts);
      } else if (message.role === "system" && message.notice) {
        meta =
          message.notice.reason === "session_forked"
            ? {
                kind: "session_notice",
                tone: message.notice.tone,
                reason: message.notice.reason,
                title: message.notice.title,
                parentExternalSessionId: message.notice.parentExternalSessionId,
              }
            : {
                kind: "session_notice",
                tone: message.notice.tone,
                reason: message.notice.reason,
                title: message.notice.title,
              };
      }

      next.push({
        id: message.messageId,
        role: message.role,
        content,
        timestamp: message.timestamp,
        ...(message.timestampIsApproximate ? { timestampIsApproximate: true } : {}),
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
): AgentSessionContextUsage | null => {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role !== "assistant") {
      continue;
    }
    if (!isFinalAssistantHistoryMessage(message)) {
      continue;
    }
    if (typeof message.totalTokens !== "number" || message.totalTokens <= 0) {
      continue;
    }

    const effectiveModel = mergeModelSelection(null, message.model);
    return {
      totalTokens: message.totalTokens,
      ...(typeof message.contextWindow === "number"
        ? { contextWindow: message.contextWindow }
        : {}),
      ...(effectiveModel?.providerId ? { providerId: effectiveModel.providerId } : {}),
      ...(effectiveModel?.modelId ? { modelId: effectiveModel.modelId } : {}),
      ...(effectiveModel?.variant ? { variant: effectiveModel.variant } : {}),
      ...(effectiveModel?.profileId ? { profileId: effectiveModel.profileId } : {}),
    };
  }

  return null;
};

export const applyLoadedSessionHistory = (
  session: AgentSessionState,
  history: AgentSessionHistoryMessage[],
): AgentSessionState => {
  const historyMessages = historyToChatMessages(history, {
    role: session.role,
  });
  const loadedMessages = createSessionMessagesState(session.externalSessionId, historyMessages);
  const historyContextUsage = historyToSessionContextUsage(history);

  return {
    ...session,
    historyLoadState: "loaded",
    contextUsage: session.contextUsage ?? historyContextUsage,
    messages: mergeHistoryMessages(session.externalSessionId, loadedMessages, session.messages),
  };
};
