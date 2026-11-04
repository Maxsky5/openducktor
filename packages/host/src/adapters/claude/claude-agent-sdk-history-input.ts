import type { SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { ClaudeHistoryMessage } from "./claude-agent-sdk-history-messages";
import { parseClaudeHistoryConversationEntry } from "./claude-agent-sdk-ingress-schemas";
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
import { historyMessageText, readStringProp } from "./claude-agent-sdk-utils";

type ClaudeVisibleHistoryMessage = Extract<
  AgentSessionHistoryMessage,
  { role: "assistant" | "user" }
>;

type PendingQueuedPrompt = {
  text: string;
  timestamp: string;
};

export type ManualCompactionInput = {
  messageId: string;
  timestamp: string;
};

type ClaudeHistoryInputProjection =
  | { handled: false }
  | {
      handled: true;
      manualCompaction?: ManualCompactionInput;
      message?: ClaudeVisibleHistoryMessage;
    };

const commandName = (text: string): string | undefined => text.trim().split(/\s/, 1)[0];

const notHandled: ClaudeHistoryInputProjection = { handled: false };
const handledWithoutMessage: ClaudeHistoryInputProjection = { handled: true };

export const createClaudeHistoryInputProjector = (options: {
  includeNestedEntries?: boolean;
  liveUserMessages: readonly ClaudeLiveUserMessage[];
}) => {
  const resolveLiveUserMessage = createLiveUserMessageResolver(options.liveUserMessages);
  const compactPromptIds = new Set<string>();
  let pendingQueuedPrompt: PendingQueuedPrompt | null = null;

  const createUserMessage = (input: {
    fallbackMessageId: string;
    message: SessionStoreEntry["message"];
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
    const message: ClaudeVisibleHistoryMessage = {
      messageId,
      role: "user",
      timestamp: input.timestamp,
      text: input.text,
      displayParts,
      state: "read",
      parts: [],
    };
    if (liveUserMessage?.model) {
      message.model = liveUserMessage.model;
    }
    return message;
  };

  // The queue also holds task notifications and peer messages. A queued prompt labels a command
  // only when it queued that command.
  const queuedCommand = (command: string): PendingQueuedPrompt | null =>
    pendingQueuedPrompt && commandName(pendingQueuedPrompt.text) === commandName(command)
      ? pendingQueuedPrompt
      : null;

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
        const queued = queuedCommand(command);
        const text = queued?.text ?? command;
        if (text.trim().toLowerCase() === "/compact") {
          const commandTimestamp = queued?.timestamp ?? timestamp;
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
          timestamp: queued?.timestamp ?? timestamp,
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

    if (entry.type !== "user") {
      return notHandled;
    }

    // A compact summary can be nested, so handle it before the nested-entry filter.
    const promptId = readStringProp(entryValue, "promptId");
    if (entry.isCompactSummary === true) {
      if (promptId) {
        compactPromptIds.add(promptId);
      }
      return handledWithoutMessage;
    }

    if (
      (entry.parent_tool_use_id && !options.includeNestedEntries) ||
      isClaudeMetaHistoryMessage(entry) ||
      !isClaudeHumanUserMessage(entryValue)
    ) {
      return handledWithoutMessage;
    }

    const entryMessage = parseClaudeHistoryConversationEntry(entryValue).message;
    if (
      readHistoryToolResults(entry).length > 0 &&
      readClaudeHistoryDisplayParts(entry.uuid, entryMessage).length === 0
    ) {
      return handledWithoutMessage;
    }

    if (pendingQueuedPrompt?.text.trim().toLowerCase() === "/compact" && promptId) {
      compactPromptIds.add(promptId);
    }

    const rawText = historyMessageText(entryMessage);
    const command = readClaudeCommandEnvelope(rawText);
    if (promptId && compactPromptIds.has(promptId) && !command) {
      return handledWithoutMessage;
    }
    const queued = command
      ? queuedCommand(command)
      : pendingQueuedPrompt?.text === rawText
        ? pendingQueuedPrompt
        : null;
    const text = queued?.text ?? command ?? rawText;
    const queuedPromptTimestamp = queued?.timestamp;
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
