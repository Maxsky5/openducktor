import type { SDKMessage, SessionMessage, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import {
  filterClaudeHistoryMessages,
  type ClaudeHistoryConversationMessage,
  type ClaudeHistoryMessage,
} from "./claude-agent-sdk-history-import";

type ClaudeSdkMessageFixture<MessageType extends SDKMessage["type"]> = {
  readonly type: MessageType;
  readonly uuid?: string;
  readonly session_id?: string;
};

type ClaudeSdkMessageFixtureResult<
  MessageType extends SDKMessage["type"],
  ExtraFields extends object,
> = Extract<SDKMessage, { readonly type: MessageType }> &
  Required<ClaudeSdkMessageFixture<MessageType>> &
  ExtraFields;

/**
 * Keeps intentionally partial SDK event fixtures honest about their public envelope while
 * centralizing the single assertion needed to omit unrelated protocol fields in focused tests.
 */
// SAFETY: Focused tests provide every SDK field read by the code path under test; this helper supplies the shared envelope fields.
export const claudeSdkMessageFixture = <
  MessageType extends SDKMessage["type"],
  ExtraFields extends object,
>(
  message: ClaudeSdkMessageFixture<MessageType> & ExtraFields,
): ClaudeSdkMessageFixtureResult<MessageType, ExtraFields> =>
  ({
    uuid: "fixture-message",
    session_id: "session-1",
    ...message,
  }) as ClaudeSdkMessageFixtureResult<MessageType, ExtraFields>;

/** Builds focused history inputs that include every field read by the history projection. */
// SAFETY: Each caller supplies the SDK discriminator and the complete field set read by the focused history path.
export const claudeHistoryMessagesFixture = <
  Messages extends Array<{ readonly type: ClaudeHistoryMessage["type"] }>,
>(
  messages: Messages,
): ClaudeHistoryMessage[] => messages as ClaudeHistoryMessage[];

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
