import type { SessionMessage, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import { createHash, type UUID } from "node:crypto";
import { z } from "zod";
import {
  filterClaudeHistoryMessages,
  type ClaudeHistoryConversationMessage,
  type ClaudeHistoryMessage,
} from "./claude-agent-sdk-history-import";
import type { ClaudeSdkMessageFixtureInput } from "./claude-agent-sdk-message-projection";

const defaultClaudeSdkMessageUuid = "00000000-0000-4000-8000-000000000001" satisfies UUID;
const claudeSdkMessageUuidSchema = z.custom<UUID>((value) => z.uuid().safeParse(value).success);

export const claudeSdkMessageUuidFixture = (label: string): UUID => {
  const hash = createHash("sha256").update(label).digest("hex");
  return claudeSdkMessageUuidSchema.parse(
    `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
  );
};

export const claudeSdkMessageFixture = <const Message extends ClaudeSdkMessageFixtureInput>(
  message: Message,
) => ({
  ...message,
  uuid: message.uuid ?? defaultClaudeSdkMessageUuid,
  session_id: message.session_id ?? "session-1",
});

export const claudeHistoryMessagesFixture = (
  messages: readonly ClaudeHistoryMessage[],
): ClaudeHistoryMessage[] => [...messages];

type ClaudeSessionMessageFixture = {
  readonly type: SessionMessage["type"];
  readonly uuid: string;
  readonly session_id?: string;
  readonly message: unknown;
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
  messages: readonly (ClaudeSessionMessageFixture & Record<string, unknown>)[],
): ClaudeHistoryConversationMessage[] => messages.map(claudeSessionMessageFixture);

export const claudeHistoryMessageFixtures = (
  messages: readonly SessionStoreEntry[],
): ClaudeHistoryMessage[] => filterClaudeHistoryMessages(messages);
