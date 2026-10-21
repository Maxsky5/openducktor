import type { SessionMessage, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import type {
  ClaudeHistoryConversationMessage,
  ClaudeHistoryMessage,
} from "./claude-agent-sdk-history-messages";
import { readText } from "./claude-agent-sdk-utils";

export const claudeHistoryMessagesFixture = (
  messages: readonly SessionStoreEntry[],
): ClaudeHistoryMessage[] =>
  messages.map((message): ClaudeHistoryMessage => {
    if (message.type === "user" || message.type === "assistant") {
      return claudeSessionMessageFixture({
        ...message,
        type: message.type,
        uuid: message.uuid ?? "00000000-0000-4000-8000-000000000001",
        message: message.message,
        session_id: readText(message.session_id) ?? readText(message.sessionId) ?? "session-1",
        parent_tool_use_id: readText(message.parent_tool_use_id) ?? null,
        parent_agent_id: readText(message.parent_agent_id) ?? null,
      });
    }
    if (message.type === "system") {
      // SAFETY: Shared projector tests construct the system-event fields their handlers validate.
      return { ...message, type: "system" } as ClaudeHistoryMessage;
    }
    if (message.type === "result") {
      return { ...message, type: "result" };
    }
    if (message.type === "queue-operation" && message.operation === "enqueue") {
      return {
        ...message,
        type: "queue-operation",
        operation: "enqueue",
        content: message.content,
      };
    }
    throw new Error(`Unsupported Claude projection fixture: ${message.type}`);
  });

type ClaudeSessionMessageFixture = SessionStoreEntry & {
  readonly type: SessionMessage["type"];
  readonly uuid: string;
  readonly session_id?: string;
  readonly message: SessionMessage["message"];
  readonly parent_tool_use_id?: string | null;
  readonly parent_agent_id?: string | null;
};

/** Builds the complete public SessionMessage envelope and preserves extra mirrored metadata. */
export const claudeSessionMessageFixture = <Fixture extends ClaudeSessionMessageFixture>(
  message: Fixture,
): SessionMessage & Fixture => ({
  ...message,
  session_id: message.session_id ?? "session-1",
  parent_tool_use_id: message.parent_tool_use_id ?? null,
  parent_agent_id: message.parent_agent_id ?? null,
});

export const claudeSessionMessageFixtures = (
  messages: readonly ClaudeSessionMessageFixture[],
): ClaudeHistoryConversationMessage[] => messages.map(claudeSessionMessageFixture);
