import type { AgentModelSelection, AgentSessionHistoryMessage } from "@openducktor/core";
import type { CodexCanonicalEvent } from "./codex-canonical-events";
import { requireNormalizedCodexToolInvocation } from "./codex-tool-normalizer";

export const projectCodexCanonicalEventsToHistory = (
  events: CodexCanonicalEvent[],
  model?: AgentModelSelection,
): AgentSessionHistoryMessage[] => {
  const messages: AgentSessionHistoryMessage[] = [];
  for (const event of events) {
    const timestamp = event.timestamp ?? new Date().toISOString();
    if (event.kind === "user_message") {
      const resolvedModel = event.model ?? model;
      const message: AgentSessionHistoryMessage = {
        messageId: event.messageId,
        role: "user",
        timestamp,
        text: event.message,
        displayParts: event.displayParts,
        state: event.state,
        parts: [],
      };
      if (resolvedModel) {
        message.model = resolvedModel;
      }
      messages.push(message);
      continue;
    }
    if (event.kind === "assistant_message") {
      const resolvedModel = event.model ?? model;
      const message: AgentSessionHistoryMessage = {
        messageId: event.messageId,
        role: "assistant",
        timestamp,
        text: event.message,
        parts: [],
      };
      if (resolvedModel) {
        message.model = resolvedModel;
      }
      if (event.totalTokens !== undefined) {
        message.totalTokens = event.totalTokens;
      }
      if (event.contextWindow !== undefined) {
        message.contextWindow = event.contextWindow;
      }
      messages.push(message);
      continue;
    }
    if (event.kind === "stream_part") {
      const existing = messages.find((message) => message.messageId === event.part.messageId);
      if (existing && existing.role === "assistant") {
        existing.parts.push(event.part);
      } else {
        const message: AgentSessionHistoryMessage = {
          messageId: event.part.messageId,
          role: "assistant",
          timestamp,
          text: "",
          parts: [event.part],
        };
        if (model) {
          message.model = model;
        }
        messages.push(message);
      }
      continue;
    }
    if (event.kind === "tool") {
      const part = requireNormalizedCodexToolInvocation(event.invocation);
      const message: AgentSessionHistoryMessage = {
        messageId: part.messageId,
        role: "assistant",
        timestamp,
        text: "",
        parts: [part],
      };
      if (model) {
        message.model = model;
      }
      messages.push(message);
      continue;
    }
    if (event.kind === "session_compacted") {
      messages.push({
        messageId: event.messageId ?? `session-compacted:${timestamp}`,
        role: "system",
        timestamp,
        text: event.message,
        notice: {
          tone: "info",
          reason: "session_compacted",
          title: "Compacted",
        },
        parts: [],
      });
    }
  }
  return messages;
};
