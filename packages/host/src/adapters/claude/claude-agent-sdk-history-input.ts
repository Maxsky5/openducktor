import type { AgentSessionHistoryMessage, AgentSkillReference } from "@openducktor/core";
import type { ClaudeHistoryMessage } from "./claude-agent-sdk-history-import";
import {
  type ClaudeLiveUserMessage,
  createLiveUserMessageIdResolver,
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
import { historyMessageText, readStringProp } from "./claude-agent-sdk-utils";

type ClaudeVisibleHistoryMessage = Extract<
  AgentSessionHistoryMessage,
  { role: "assistant" | "user" }
>;

type ClaudeHistoryInputProjection =
  | { handled: false }
  | { handled: true; message?: ClaudeVisibleHistoryMessage };

const notHandled: ClaudeHistoryInputProjection = { handled: false };
const handledWithoutMessage: ClaudeHistoryInputProjection = { handled: true };

export const createClaudeHistoryInputProjector = (options: {
  liveUserMessages: readonly ClaudeLiveUserMessage[];
  skills?: readonly AgentSkillReference[];
}) => {
  const resolveLiveUserMessageId = createLiveUserMessageIdResolver(options.liveUserMessages);
  let pendingQueuedPrompt: { text: string; timestamp: string } | null = null;

  const createUserMessage = (input: {
    fallbackMessageId: string;
    message: unknown;
    text: string;
    timestamp: string;
  }): ClaudeVisibleHistoryMessage | undefined => {
    const displayParts = readClaudeHistoryDisplayParts(
      input.fallbackMessageId,
      input.message,
      options.skills,
    );
    if (input.text.trim().length === 0 && displayParts.length === 0) {
      return undefined;
    }
    return {
      messageId: resolveLiveUserMessageId(input.fallbackMessageId, input.text),
      role: "user",
      timestamp: input.timestamp,
      text: input.text,
      displayParts,
      state: "read",
      parts: [],
    };
  };

  return (entry: ClaudeHistoryMessage, timestamp: string): ClaudeHistoryInputProjection => {
    const queuedPrompt = readClaudeQueuedPrompt(entry);
    if (queuedPrompt) {
      pendingQueuedPrompt = { text: queuedPrompt, timestamp };
      return handledWithoutMessage;
    }

    if (entry.type === "system") {
      const subtype = readStringProp(entry, "subtype");
      if (subtype !== "local_command" && subtype !== "local_command_output") {
        return notHandled;
      }
      const content = readStringProp(entry, "content") ?? "";
      const messageId = entry.uuid ?? `claude-${subtype}:${timestamp}`;
      const command = readClaudeCommandEnvelope(content);
      if (command) {
        const text = pendingQueuedPrompt?.text ?? command;
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
    if (entry.parent_tool_use_id || isClaudeMetaHistoryMessage(entry)) {
      return handledWithoutMessage;
    }

    const rawText = historyMessageText(entry.message);
    const command = readClaudeCommandEnvelope(rawText);
    const text = command ? (pendingQueuedPrompt?.text ?? command) : rawText;
    const queuedPromptTimestamp =
      pendingQueuedPrompt?.text === text ? pendingQueuedPrompt.timestamp : undefined;
    const message = createUserMessage({
      fallbackMessageId: entry.uuid,
      message: command ? { content: text } : entry.message,
      text,
      timestamp: queuedPromptTimestamp ?? timestamp,
    });
    pendingQueuedPrompt = null;
    return message ? { handled: true, message } : handledWithoutMessage;
  };
};
