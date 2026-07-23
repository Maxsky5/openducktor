import type {
  AgentModelSelection,
  AgentSessionTodoItem,
  AgentStreamPart,
  AgentUserMessageDisplayPart,
} from "@openducktor/core";
import type { NormalizedCodexToolInvocation } from "./codex-tool-normalizer";

export type CodexCanonicalSource = "live" | "thread_read";

// Live events use the emitting thread as owner; forked thread/read items are pre-owned at the fork boundary.
export type CodexCanonicalEventBase = {
  source: CodexCanonicalSource;
  mapper: string;
  threadId: string;
  turnId?: string;
  timestamp?: string;
  raw?: unknown;
};

export type CodexCanonicalToolEvent = CodexCanonicalEventBase & {
  kind: "tool";
  invocation: NormalizedCodexToolInvocation;
};

export type CodexCanonicalStreamPartEvent = CodexCanonicalEventBase & {
  kind: "stream_part";
  part: AgentStreamPart;
};

export type CodexCanonicalUserMessageEvent = CodexCanonicalEventBase & {
  kind: "user_message";
  messageId: string;
  message: string;
  displayParts: AgentUserMessageDisplayPart[];
  state: "read";
  model?: AgentModelSelection;
};

export type CodexCanonicalAssistantMessageEvent = CodexCanonicalEventBase & {
  kind: "assistant_message";
  messageId: string;
  message: string;
  model?: AgentModelSelection;
  totalTokens?: number;
  contextWindow?: number;
};

export type CodexCanonicalAssistantDeltaEvent = CodexCanonicalEventBase & {
  kind: "assistant_delta";
  messageId?: string;
  channel: "text" | "reasoning";
  delta: string;
};

export type CodexCanonicalSessionErrorEvent = CodexCanonicalEventBase & {
  kind: "session_error";
  message: string;
};

export type CodexCanonicalSessionIdleEvent = CodexCanonicalEventBase & {
  kind: "session_idle";
};

export type CodexCanonicalSessionCompactionStartedEvent = CodexCanonicalEventBase & {
  kind: "session_compaction_started";
  messageId?: string;
  message: string;
};

export type CodexCanonicalSessionCompactedEvent = CodexCanonicalEventBase & {
  kind: "session_compacted";
  messageId?: string;
  message: string;
};

export type CodexCanonicalTodoUpdateEvent = CodexCanonicalEventBase & {
  kind: "todo_update";
  todos: AgentSessionTodoItem[];
};

export type CodexCanonicalEvent =
  | CodexCanonicalToolEvent
  | CodexCanonicalStreamPartEvent
  | CodexCanonicalUserMessageEvent
  | CodexCanonicalAssistantMessageEvent
  | CodexCanonicalAssistantDeltaEvent
  | CodexCanonicalSessionErrorEvent
  | CodexCanonicalSessionIdleEvent
  | CodexCanonicalSessionCompactionStartedEvent
  | CodexCanonicalSessionCompactedEvent
  | CodexCanonicalTodoUpdateEvent;

export type CodexMappingContext = {
  source: CodexCanonicalSource;
  runtimeId?: string;
  threadId: string;
  turnId?: string;
  timestamp?: string;
};

export type CodexMappingResult = {
  events: CodexCanonicalEvent[];
  handled: boolean;
};

export const emptyCodexMappingResult = (): CodexMappingResult => ({
  events: [],
  handled: false,
});
