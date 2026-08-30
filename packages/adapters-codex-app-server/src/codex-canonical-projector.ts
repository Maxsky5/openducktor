import type { AgentEvent } from "@openducktor/core";
import type { CodexCanonicalEvent } from "./codex-canonical-events";
import { requireNormalizedCodexToolInvocation } from "./codex-tool-normalizer";

const projectCodexCanonicalEvent = (event: CodexCanonicalEvent): AgentEvent => {
  const timestamp = event.timestamp ?? new Date().toISOString();
  if (event.kind === "tool") {
    return {
      type: "assistant_part",
      externalSessionId: event.threadId,
      timestamp,
      part: requireNormalizedCodexToolInvocation(event.invocation),
    };
  }

  if (event.kind === "stream_part") {
    return {
      type: "assistant_part",
      externalSessionId: event.threadId,
      timestamp,
      part: event.part,
    };
  }

  if (event.kind === "user_message") {
    const userMessage: AgentEvent = {
      type: "user_message",
      externalSessionId: event.threadId,
      timestamp,
      messageId: event.messageId,
      message: event.message,
      parts: event.displayParts,
      state: event.state,
    };
    if (event.model) {
      userMessage.model = event.model;
    }
    return userMessage;
  }

  if (event.kind === "assistant_message") {
    const assistantMessage: AgentEvent = {
      type: "assistant_message",
      externalSessionId: event.threadId,
      timestamp,
      messageId: event.messageId,
      message: event.message,
    };
    if (event.totalTokens !== undefined) {
      assistantMessage.totalTokens = event.totalTokens;
    }
    if (event.contextWindow !== undefined) {
      assistantMessage.contextWindow = event.contextWindow;
    }
    if (event.model) {
      assistantMessage.model = event.model;
    }
    return assistantMessage;
  }

  if (event.kind === "assistant_delta") {
    const deltaEvent: AgentEvent = {
      type: "assistant_delta",
      externalSessionId: event.threadId,
      timestamp,
      channel: event.channel,
      delta: event.delta,
    };
    if (event.messageId) {
      deltaEvent.messageId = event.messageId;
    }
    return deltaEvent;
  }

  if (event.kind === "session_error") {
    return {
      type: "session_error",
      externalSessionId: event.threadId,
      timestamp,
      message: event.message,
    };
  }

  if (event.kind === "session_idle") {
    return {
      type: "session_idle",
      externalSessionId: event.threadId,
      timestamp,
    };
  }

  if (event.kind === "session_compaction_started") {
    const compactionStartedEvent: AgentEvent = {
      type: "session_compaction_started",
      externalSessionId: event.threadId,
      timestamp,
      message: event.message,
    };
    if (event.messageId) {
      compactionStartedEvent.messageId = event.messageId;
    }
    return compactionStartedEvent;
  }

  if (event.kind === "session_compacted") {
    const compactedEvent: AgentEvent = {
      type: "session_compacted",
      externalSessionId: event.threadId,
      timestamp,
      message: event.message,
    };
    if (event.messageId) {
      compactedEvent.messageId = event.messageId;
    }
    return compactedEvent;
  }

  return {
    type: "session_todos_updated",
    externalSessionId: event.threadId,
    timestamp,
    todos: event.todos,
  };
};

export const projectCodexCanonicalEvents = (events: CodexCanonicalEvent[]): AgentEvent[] =>
  events.map(projectCodexCanonicalEvent);

export const latestTodosFromCanonicalEvents = (
  events: CodexCanonicalEvent[],
): import("@openducktor/core").AgentSessionTodoItem[] | null => {
  const todoEvent = [...events].reverse().find((event) => event.kind === "todo_update");
  return todoEvent?.kind === "todo_update" ? todoEvent.todos : null;
};
