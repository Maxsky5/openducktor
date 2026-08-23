import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { ClaudeHistoryMessage } from "./claude-agent-sdk-history-import";
import {
  type ClaudeLiveUserMessage,
  createLiveUserMessageResolver,
  readClaudeHistoryDisplayParts,
  readHistoryToolResults,
} from "./claude-agent-sdk-history-support";
import {
  isClaudeMetaHistoryMessage,
  readClaudeCommandEnvelope,
  readClaudeLocalCommandOutput,
  readClaudeQueuedPrompt,
} from "./claude-agent-sdk-local-commands";
import { createClaudeFinishStepPart } from "./claude-agent-sdk-transcript-parts";
import { isClaudeHumanUserMessage } from "./claude-agent-sdk-user-messages";
import { historyMessageText, isRecord, readStringProp } from "./claude-agent-sdk-utils";

type ClaudeVisibleHistoryMessage = Extract<
  AgentSessionHistoryMessage,
  { role: "assistant" | "user" }
>;

type ClaudeHistoryInputProjection =
  | { handled: false }
  | {
      handled: true;
      manualCompaction?: { messageId: string; timestamp: string };
      message?: ClaudeVisibleHistoryMessage;
    };

const notHandled: ClaudeHistoryInputProjection = { handled: false };
const handledWithoutMessage: ClaudeHistoryInputProjection = { handled: true };

export const createClaudeHistoryInputProjector = (options: {
  liveUserMessages: readonly ClaudeLiveUserMessage[];
}) => {
  const resolveLiveUserMessage = createLiveUserMessageResolver(options.liveUserMessages);
  const compactPromptIds = new Set<string>();
  let pendingQueuedPrompt: { text: string; timestamp: string } | null = null;

  const createUserMessage = (input: {
    fallbackMessageId: string;
    message: unknown;
    text: string;
    timestamp: string;
  }): ClaudeVisibleHistoryMessage | undefined => {
    const liveUserMessage = resolveLiveUserMessage(
      input.fallbackMessageId,
      input.text,
      input.timestamp,
    );
    const messageId = liveUserMessage?.messageId ?? input.fallbackMessageId;
    const displayParts =
      liveUserMessage?.parts ?? readClaudeHistoryDisplayParts(messageId, input.message);
    if (input.text.trim().length === 0 && displayParts.length === 0) {
      return undefined;
    }
    return {
      messageId,
      role: "user",
      timestamp: input.timestamp,
      text: input.text,
      displayParts,
      state: liveUserMessage?.state ?? "read",
      ...(liveUserMessage?.model ? { model: liveUserMessage.model } : undefined),
      parts: [],
    };
  };

  return (entry: ClaudeHistoryMessage, timestamp: string): ClaudeHistoryInputProjection => {
    const entryValue = entry;
    const queuedPrompt = readClaudeQueuedPrompt(entry);
    if (queuedPrompt) {
      pendingQueuedPrompt = { text: queuedPrompt, timestamp };
      return handledWithoutMessage;
    }

    if (entry.type === "system") {
      const subtype = readStringProp(entryValue, "subtype");
      if (subtype !== "local_command" && subtype !== "local_command_output") {
        return notHandled;
      }
      const content = readStringProp(entryValue, "content") ?? "";
      const messageId = entry.uuid ?? `claude-${subtype}:${timestamp}`;
      const command = readClaudeCommandEnvelope(content);
      if (command) {
        const text = pendingQueuedPrompt?.text ?? command;
        if (text.trim().toLowerCase() === "/compact") {
          const commandTimestamp = pendingQueuedPrompt?.timestamp ?? timestamp;
          pendingQueuedPrompt = null;
          return {
            handled: true,
            manualCompaction: {
              messageId:
                resolveLiveUserMessage(messageId, text, commandTimestamp)?.messageId ?? messageId,
              timestamp: commandTimestamp,
            },
          };
        }
        const message = createUserMessage({
          fallbackMessageId: messageId,
          message: { content: text },
          text,
          timestamp: pendingQueuedPrompt?.timestamp ?? timestamp,
        });
        pendingQueuedPrompt = null;
        return message ? { handled: true, message } : handledWithoutMessage;
      }
      const output =
        subtype === "local_command_output" ? content.trim() : readClaudeLocalCommandOutput(content);
      if (!output) {
        return handledWithoutMessage;
      }
      return {
        handled: true,
        message: {
          messageId,
          role: "assistant",
          timestamp,
          text: output,
          parts: [createClaudeFinishStepPart({ messageId, reason: "stop" })],
        },
      };
    }

    if (entry.type !== "user" || readHistoryToolResults(entry).length > 0) {
      return notHandled;
    }
    if (
      entry.parent_tool_use_id ||
      isClaudeMetaHistoryMessage(entry) ||
      !isClaudeHumanUserMessage(entryValue)
    ) {
      return handledWithoutMessage;
    }

    const promptId = readStringProp(entryValue, "promptId");
    // SAFETY: The runtime adapter builds this value from the contract fields required by `{ isCompactSummary?: unknown }`.
    const isCompactSummary = (entry as { isCompactSummary?: unknown }).isCompactSummary === true;
    if (isCompactSummary) {
      if (promptId) {
        compactPromptIds.add(promptId);
      }
      return handledWithoutMessage;
    }
    if (pendingQueuedPrompt?.text.trim().toLowerCase() === "/compact" && promptId) {
      compactPromptIds.add(promptId);
    }

    const entryMessage = isRecord(entryValue) ? entryValue.message : undefined;
    const rawText = historyMessageText(entryMessage);
    const command = readClaudeCommandEnvelope(rawText);
    if (promptId && compactPromptIds.has(promptId) && !command) {
      return handledWithoutMessage;
    }
    const text = command ? (pendingQueuedPrompt?.text ?? command) : rawText;
    const queuedPromptTimestamp =
      pendingQueuedPrompt?.text === text ? pendingQueuedPrompt.timestamp : undefined;
    if (text.trim().toLowerCase() === "/compact") {
      const commandTimestamp = queuedPromptTimestamp ?? timestamp;
      pendingQueuedPrompt = null;
      return {
        handled: true,
        manualCompaction: {
          messageId:
            resolveLiveUserMessage(entry.uuid, text, commandTimestamp)?.messageId ?? entry.uuid,
          timestamp: commandTimestamp,
        },
      };
    }
    const message = createUserMessage({
      fallbackMessageId: entry.uuid,
      message: command ? { content: text } : entryMessage,
      text,
      timestamp: queuedPromptTimestamp ?? timestamp,
    });
    pendingQueuedPrompt = null;
    return message ? { handled: true, message } : handledWithoutMessage;
  };
};
