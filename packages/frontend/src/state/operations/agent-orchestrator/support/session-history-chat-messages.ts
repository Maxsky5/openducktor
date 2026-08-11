import type {
  AgentModelSelection,
  AgentRole,
  AgentSessionHistoryMessage,
  AgentUserMessageDisplayPart,
} from "@openducktor/core";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import { formatToolContent } from "../agent-tool-messages";
import { createAssistantMessageMeta } from "./assistant-meta";
import {
  mergeTurnActivityTimestamp,
  readAssistantActivityStartedAtMsFromMessages,
  readAssistantActivityStartedAtMsFromParts,
  resolveAssistantTurnDurationMs,
} from "./assistant-turn-duration";
import { toReasoningMessageId, toTextMessageId, toToolMessageId } from "./chat-message-ids";
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
    const assistantTextMessageIndexes: number[] = [];

    for (const part of message.parts as SessionHistoryPart[]) {
      if (
        message.role === "assistant" &&
        part.kind === "text" &&
        !part.synthetic &&
        part.text.trim().length > 0
      ) {
        assistantTextMessageIndexes.push(next.length);
        next.push(
          inheritTimestampAccuracy(
            {
              id: toTextMessageId(message.messageId, part.partId),
              role: "assistant",
              content: part.text,
              timestamp: message.timestamp,
              meta: {
                ...createAssistantMessageMeta({
                  role: sessionContext.role,
                  model: message.model,
                  isFinal: false,
                }),
                partId: part.partId,
                sourceMessageId: message.messageId,
              },
            },
            message,
          ),
        );
        continue;
      }
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
    const isFinalAssistantMessage =
      message.role === "assistant" && isFinalAssistantHistoryMessage(message);
    const completedAtMs = Date.parse(message.timestamp);
    const activityStartedAtMs =
      isFinalAssistantMessage && !Number.isNaN(completedAtMs)
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
      isFinalAssistantMessage && !Number.isNaN(completedAtMs)
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
    const assistantMeta =
      message.role === "assistant"
        ? createAssistantMessageMeta({
            role: sessionContext.role,
            model: message.model,
            isFinal: isFinalAssistantMessage,
            durationMs: isFinalAssistantMessage ? assistantDurationMs : undefined,
            totalTokens: isFinalAssistantMessage ? message.totalTokens : undefined,
            contextWindow: isFinalAssistantMessage ? message.contextWindow : undefined,
          })
        : undefined;
    const lastAssistantTextMessageIndex = assistantTextMessageIndexes.at(-1);
    if (lastAssistantTextMessageIndex !== undefined && assistantMeta) {
      const lastAssistantTextMessage = next[lastAssistantTextMessageIndex];
      if (lastAssistantTextMessage?.meta?.kind === "assistant") {
        next[lastAssistantTextMessageIndex] = {
          ...lastAssistantTextMessage,
          meta: {
            ...assistantMeta,
            sourceMessageId: message.messageId,
            ...(lastAssistantTextMessage.meta.partId
              ? { partId: lastAssistantTextMessage.meta.partId }
              : {}),
          },
        };
      }
    }

    const shouldRenderPrimaryMessage =
      (message.role !== "assistant" || assistantTextMessageIndexes.length === 0) &&
      (content.length > 0 || userDisplayParts.length > 0);
    if (shouldRenderPrimaryMessage) {
      let meta: AgentChatMessage["meta"] | undefined;
      if (message.role === "assistant") {
        meta = assistantMeta;
      } else if (message.role === "user") {
        meta = userMessageMeta(message.model, message.state, userDisplayParts);
      } else if (message.role === "system" && message.notice) {
        const notice = message.notice;
        const { reason, title, tone } = notice;
        if (reason === "session_forked") {
          meta = {
            kind: "session_notice",
            tone,
            reason,
            title,
            parentExternalSessionId: notice.parentExternalSessionId,
          };
        } else if (reason === "session_error") {
          meta = {
            kind: "session_notice",
            tone,
            reason,
            title,
          };
        } else {
          meta = {
            kind: "session_notice",
            tone,
            reason,
            title,
          };
        }
      }

      const primaryMessage: AgentChatMessage = {
        id: message.messageId,
        role: message.role,
        content,
        timestamp: message.timestamp,
        ...(message.timestampIsApproximate ? { timestampIsApproximate: true } : {}),
        ...(meta ? { meta } : {}),
      };
      next.push(primaryMessage);
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

export const applyLoadedSessionHistory = (
  session: AgentSessionState,
  history: AgentSessionHistoryMessage[],
): AgentSessionState => {
  const historyMessages = historyToChatMessages(history, {
    role: session.role,
  });
  const loadedMessages = createSessionMessagesState(session.externalSessionId, historyMessages);

  return {
    ...session,
    historyLoadState: "loaded",
    historyLoadFailure: null,
    messages: mergeHistoryMessages(session.externalSessionId, loadedMessages, session.messages),
  };
};
