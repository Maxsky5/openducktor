import { hasRuntimeType } from "@openducktor/contracts";
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
    ...(() => {
      if (effectiveModel?.providerId) {
        return { providerId: effectiveModel.providerId };
      }
      return {};
    })(),
    ...(() => {
      if (effectiveModel?.modelId) {
        return { modelId: effectiveModel.modelId };
      }
      return {};
    })(),
    ...(() => {
      if (effectiveModel?.variant) {
        return { variant: effectiveModel.variant };
      }
      return {};
    })(),
    ...(() => {
      if (effectiveModel?.profileId) {
        return { profileId: effectiveModel.profileId };
      }
      return {};
    })(),
    ...(() => {
      if (parts.length > 0) {
        return { parts };
      }
      return {};
    })(),
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
            ...(() => {
              if (part.preview) {
                return { preview: part.preview };
              }
              return {};
            })(),
            ...(() => {
              if (part.title) {
                return { title: part.title };
              }
              return {};
            })(),
            ...(() => {
              if (part.displayLabel) {
                return { displayLabel: part.displayLabel };
              }
              return {};
            })(),
            ...(() => {
              if (input) {
                return { input };
              }
              return {};
            })(),
            ...(() => {
              if (output) {
                return { output };
              }
              return {};
            })(),
            ...(() => {
              if (error) {
                return { error };
              }
              return {};
            })(),
            ...(() => {
              if (part.fileDiffs) {
                return { fileDiffs: part.fileDiffs };
              }
              return {};
            })(),
            ...(() => {
              if (part.fileContent) {
                return { fileContent: part.fileContent };
              }
              return {};
            })(),
            ...(() => {
              if (part.fileChanges) {
                return { fileChanges: part.fileChanges };
              }
              return {};
            })(),
            ...(() => {
              if (part.metadata) {
                return { metadata: part.metadata };
              }
              return {};
            })(),
            ...(() => {
              if (hasRuntimeType(part.startedAtMs, "number")) {
                return { startedAtMs: part.startedAtMs };
              }
              return {};
            })(),
            ...(() => {
              if (hasRuntimeType(part.endedAtMs, "number")) {
                return { endedAtMs: part.endedAtMs };
              }
              return {};
            })(),
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
            ...(() => {
              if (part.agent) {
                return { agent: part.agent };
              }
              return {};
            })(),
            ...(() => {
              if (part.prompt) {
                return { prompt: part.prompt };
              }
              return {};
            })(),
            ...(() => {
              if (part.description) {
                return { description: part.description };
              }
              return {};
            })(),
            ...(() => {
              if (part.error) {
                return { error: part.error };
              }
              return {};
            })(),
            ...(() => {
              if (part.externalSessionId) {
                return { externalSessionId: part.externalSessionId };
              }
              return {};
            })(),
            ...(() => {
              if (part.executionMode) {
                return { executionMode: part.executionMode };
              }
              return {};
            })(),
            ...(() => {
              if (part.metadata) {
                return { metadata: part.metadata };
              }
              return {};
            })(),
            ...(() => {
              if (hasRuntimeType(part.startedAtMs, "number")) {
                return { startedAtMs: part.startedAtMs };
              }
              return {};
            })(),
            ...(() => {
              if (hasRuntimeType(part.endedAtMs, "number")) {
                return { endedAtMs: part.endedAtMs };
              }
              return {};
            })(),
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

// SAFETY: The schema parser validates every field required by `SessionHistoryPart[]` before returning.
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
            ...(() => {
              if (hasRuntimeType(activityStartedAtMs, "number")) {
                return { activityStartedAtMs };
              }
              return {};
            })(),
            ...(() => {
              if (hasRuntimeType(userAnchorAtMs, "number")) {
                return { userAnchorAtMs };
              }
              return {};
            })(),
            ...(() => {
              if (hasRuntimeType(previousAssistantCompletedAtMs, "number")) {
                return { previousAssistantCompletedAtMs };
              }
              return {};
            })(),
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
            ...(() => {
              if (lastAssistantTextMessage.meta.partId) {
                return { partId: lastAssistantTextMessage.meta.partId };
              }
              return {};
            })(),
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
        ...(() => {
          if (message.timestampIsApproximate) {
            return { timestampIsApproximate: true };
          }
          return {};
        })(),
        ...(() => {
          if (meta) {
            return { meta };
          }
          return {};
        })(),
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
