import { hasRuntimeType } from "@openducktor/contracts";
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
    return {
      type: "user_message",
      externalSessionId: event.threadId,
      timestamp,
      messageId: event.messageId,
      message: event.message,
      parts: event.displayParts,
      state: event.state,
      ...(() => {
        if (event.model) {
          return { model: event.model };
        }
        return {};
      })(),
    };
  }

  if (event.kind === "assistant_message") {
    return {
      type: "assistant_message",
      externalSessionId: event.threadId,
      timestamp,
      messageId: event.messageId,
      message: event.message,
      ...(() => {
        if (hasRuntimeType(event.totalTokens, "number")) {
          return { totalTokens: event.totalTokens };
        }
        return {};
      })(),
      ...(() => {
        if (hasRuntimeType(event.contextWindow, "number")) {
          return { contextWindow: event.contextWindow };
        }
        return {};
      })(),
      ...(() => {
        if (event.model) {
          return { model: event.model };
        }
        return {};
      })(),
    };
  }

  if (event.kind === "assistant_delta") {
    return {
      type: "assistant_delta",
      externalSessionId: event.threadId,
      timestamp,
      channel: event.channel,
      ...(() => {
        if (event.messageId) {
          return { messageId: event.messageId };
        }
        return {};
      })(),
      delta: event.delta,
    };
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
    return {
      type: "session_compaction_started",
      externalSessionId: event.threadId,
      timestamp,
      ...(() => {
        if (event.messageId) {
          return { messageId: event.messageId };
        }
        return {};
      })(),
      message: event.message,
    };
  }

  if (event.kind === "session_compacted") {
    return {
      type: "session_compacted",
      externalSessionId: event.threadId,
      timestamp,
      ...(() => {
        if (event.messageId) {
          return { messageId: event.messageId };
        }
        return {};
      })(),
      message: event.message,
    };
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
