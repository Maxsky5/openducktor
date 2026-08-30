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
type UserMessageMeta = Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "user" }>;
type ToolMessageMeta = Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "tool" }>;
type AssistantMessageMeta = Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "assistant" }>;
type AssistantTurnDurationInput = Parameters<typeof resolveAssistantTurnDurationMs>[0];

const userMessageMeta = (
  messageModel: AgentModelSelection | undefined,
  state: Extract<AgentSessionHistoryMessage, { role: "user" }>["state"],
  parts: AgentUserMessageDisplayPart[] = [],
) => {
  const effectiveModel = mergeModelSelection(null, messageModel);
  const meta: UserMessageMeta = { kind: "user", state };
  if (effectiveModel?.providerId) {
    meta.providerId = effectiveModel.providerId;
  }
  if (effectiveModel?.modelId) {
    meta.modelId = effectiveModel.modelId;
  }
  if (effectiveModel?.variant) {
    meta.variant = effectiveModel.variant;
  }
  if (effectiveModel?.profileId) {
    meta.profileId = effectiveModel.profileId;
  }
  if (parts.length > 0) {
    meta.parts = parts;
  }
  return meta;
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
      const meta: ToolMessageMeta = {
        kind: "tool",
        partId: part.partId,
        callId: part.callId,
        tool: part.tool,
        toolType: part.toolType,
        status: part.status,
      };
      if (part.preview) {
        meta.preview = part.preview;
      }
      if (part.title) {
        meta.title = part.title;
      }
      if (part.displayLabel) {
        meta.displayLabel = part.displayLabel;
      }
      if (input) {
        meta.input = input;
      }
      if (output) {
        meta.output = output;
      }
      if (error) {
        meta.error = error;
      }
      if (part.fileDiffs) {
        meta.fileDiffs = part.fileDiffs;
      }
      if (part.fileContent) {
        meta.fileContent = part.fileContent;
      }
      if (part.fileChanges) {
        meta.fileChanges = part.fileChanges;
      }
      if (part.metadata) {
        meta.metadata = part.metadata;
      }
      if (part.startedAtMs !== undefined) {
        meta.startedAtMs = part.startedAtMs;
      }
      if (part.endedAtMs !== undefined) {
        meta.endedAtMs = part.endedAtMs;
      }
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
          meta,
        },
        message,
      );
    }
    case "subagent": {
      const meta: Parameters<typeof createSubagentMessage>[0]["meta"] = {
        kind: "subagent",
        partId: part.partId,
        correlationKey: part.correlationKey,
        status: part.status,
      };
      if (part.agent) {
        meta.agent = part.agent;
      }
      if (part.prompt) {
        meta.prompt = part.prompt;
      }
      if (part.description) {
        meta.description = part.description;
      }
      if (part.error) {
        meta.error = part.error;
      }
      if (part.externalSessionId) {
        meta.externalSessionId = part.externalSessionId;
      }
      if (part.executionMode) {
        meta.executionMode = part.executionMode;
      }
      if (part.metadata) {
        meta.metadata = part.metadata;
      }
      if (part.startedAtMs !== undefined) {
        meta.startedAtMs = part.startedAtMs;
      }
      if (part.endedAtMs !== undefined) {
        meta.endedAtMs = part.endedAtMs;
      }
      return inheritTimestampAccuracy(
        createSubagentMessage({
          timestamp: message.timestamp,
          meta,
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

    for (const part of message.parts) {
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
    let assistantDurationMs: number | undefined;
    if (isFinalAssistantMessage && !Number.isNaN(completedAtMs)) {
      if (message.durationMs !== undefined) {
        assistantDurationMs = message.durationMs;
      } else {
        const durationInput: AssistantTurnDurationInput = { completedAtMs };
        if (activityStartedAtMs !== undefined) {
          durationInput.activityStartedAtMs = activityStartedAtMs;
        }
        if (userAnchorAtMs !== undefined) {
          durationInput.userAnchorAtMs = userAnchorAtMs;
        }
        if (previousAssistantCompletedAtMs !== undefined) {
          durationInput.previousAssistantCompletedAtMs = previousAssistantCompletedAtMs;
        }
        assistantDurationMs = resolveAssistantTurnDurationMs(durationInput);
      }
    }
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
        const nextMeta: AssistantMessageMeta = {
          ...assistantMeta,
          sourceMessageId: message.messageId,
        };
        if (lastAssistantTextMessage.meta.partId) {
          nextMeta.partId = lastAssistantTextMessage.meta.partId;
        }
        next[lastAssistantTextMessageIndex] = {
          ...lastAssistantTextMessage,
          meta: nextMeta,
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
      };
      if (message.timestampIsApproximate) {
        primaryMessage.timestampIsApproximate = true;
      }
      if (meta) {
        primaryMessage.meta = meta;
      }
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
    role: session.sessionAssociation.kind === "workflow" ? session.sessionAssociation.role : null,
  });
  const loadedMessages = createSessionMessagesState(session.externalSessionId, historyMessages);

  return {
    ...session,
    historyLoadState: "loaded",
    historyLoadFailure: null,
    messages: mergeHistoryMessages(session.externalSessionId, loadedMessages, session.messages),
  };
};
